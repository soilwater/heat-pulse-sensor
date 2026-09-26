"""Export stored KiCad copper geometry without refilling or saving the PCB.

Run from any directory using D:/KiCAD/bin/python.exe. Filled-zone polygons come
directly from the saved board. Native pad polygons include curved-edge
tessellation; physical drill cutouts are exported separately as holePolygons.
Render polygon contours with even-odd filling, including KiCad's fractured
filled-zone contours. Do not simplify them or connect separate islands.
"""
from pathlib import Path
import csv, hashlib, json
import pcbnew as p

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'flat-nano/kicad/hp_sensor_routed.kicad_pcb'
BOM = HERE.parent / 'flat-nano/fab/HP-SDI12-NANO_BOM.csv'
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bom_hash = hashlib.sha256(BOM.read_bytes()).hexdigest()
board = p.LoadBoard(str(SOURCE))
parts = {}
for row in csv.DictReader(BOM.open(encoding='utf-8-sig')):
    for ref in row['Designator'].split(','):
        parts[ref.strip()] = {'mpn': row['Manufacturer Part Number'], 'lcsc': row['LCSC Part #'], 'description': row['Description'], 'bomValue': row['Comment']}

def xy(v): return [round(p.ToMM(v.x)-100, 4), round(p.ToMM(v.y)-71, 4)]
def size(v): return [round(p.ToMM(v.x),4), round(p.ToMM(v.y),4)]

COPPER_LAYERS = [(p.F_Cu, 'top'), (p.In1_Cu, 'inner1'), (p.In2_Cu, 'inner2'), (p.B_Cu, 'bottom')]
LAYER_NAMES = dict(COPPER_LAYERS)
board.BuildConnectivity()
SHAPES = {p.PAD_SHAPE_CIRCLE: 'circle', p.PAD_SHAPE_RECT: 'rectangle',
          p.PAD_SHAPE_OVAL: 'oval', p.PAD_SHAPE_TRAPEZOID: 'trapezoid',
          p.PAD_SHAPE_ROUNDRECT: 'roundrect', p.PAD_SHAPE_CHAMFERED_RECT: 'chamfered-rectangle',
          p.PAD_SHAPE_CUSTOM: 'custom'}

def copper_layers(item):
    return [label for layer, label in COPPER_LAYERS if item.IsOnLayer(layer) and item.FlashLayer(layer)]

def contour(chain):
    # Stored fill/pad tessellations have linear segments. Refuse to silently
    # straighten any future curved segment that requires another export method.
    if chain.ArcCount():
        raise ValueError('Unexpected arc in polygon contour; review its export before drawing it.')
    return [[round(p.ToMM(chain.CPoint(i).x) - 100, 6),
             round(p.ToMM(chain.CPoint(i).y) - 71, 6)] for i in range(chain.PointCount())]

def polygons(poly, layer=None):
    result = []
    for i in range(poly.OutlineCount()):
        item = {'outer': contour(poly.Outline(i)),
                'holes': [contour(poly.Hole(i, h)) for h in range(poly.HoleCount(i))]}
        if layer is not None:
            item['layer'] = layer
        result.append(item)
    return result

def pad_geometry(pad):
    copper = []
    for layer, label in COPPER_LAYERS:
        if pad.IsOnLayer(layer) and pad.FlashLayer(layer):
            copper.extend(polygons(pad.GetEffectivePolygon(layer), label))
    holes = p.SHAPE_POLY_SET()
    if pad.HasDrilledHole():
        pad.TransformHoleToPolygon(holes, 0, p.FromMM(0.001), p.ERROR_INSIDE)
    return {'pin': pad.GetNumber(), 'net': pad.GetNetname(), 'xy': xy(pad.GetPosition()),
            'size': size(pad.GetBoundingBox().GetSize()), 'drill': size(pad.GetDrillSize()),
            'layers': copper_layers(pad), 'shape': SHAPES.get(pad.GetShape(), str(pad.GetShape())),
            'rotation': round(pad.GetOrientationDegrees(), 6), 'copperPolygons': copper,
            'holePolygons': polygons(holes)}
data = {'revision':'HP-SDI12-NANO r2 / 17 x 3.3 ohm high-power heater', 'copperLayers': ['top', 'inner1', 'inner2', 'bottom'], 'bodyLengthMm': 43.18, 'source':'flat-nano/kicad/hp_sensor_routed.kicad_pcb',
        'sha256':source_hash, 'bomSha256':bom_hash, 'bomSource':BOM.relative_to(HERE.parent).as_posix(),
        'heaterSpec': {'heaterCount':17, 'rEachOhm':3.3, 'heaterRatingW':0.33,
                       'heaterDeratingStartC':70, 'heaterMaxC':155,
                       'heaterPartNumber':'CRCW06033R30FKEAHP', 'tolerancePct':1,
                       'heaterStartMm':8.8, 'heaterPitchMm':2.6},
        'geometryNotes': {'zones': 'Stored filled polygons; no refill performed. Preserve fractured contours and use even-odd filling.',
                          'pads': 'Native effective copper polygons; subtract the separately exported physical holePolygons.',
                          'padCurves': 'Curved edges use KiCad native polygon tessellation.',
                          'holePolygonMaxErrorMm': 0.001},
        'footprints':[], 'tracks':[], 'outline':[], 'zones':[]}
for fp in board.GetFootprints():
    ref = fp.GetReference()
    pads = [pad_geometry(pad) for pad in fp.Pads()]
    data['footprints'].append({'ref':ref,'value':fp.GetValue(),'xy':xy(fp.GetPosition()),'angle':fp.GetOrientationDegrees(),
                               'layer':'bottom' if fp.GetLayer()==p.B_Cu else 'top','pads':pads,**parts.get(ref,{})})
heaters = sorted((fp for fp in data['footprints'] if fp['ref'].startswith('RH')), key=lambda fp:int(fp['ref'][2:]))
if [fp['ref'] for fp in heaters] != [f'RH{i}' for i in range(1,18)]:
    raise ValueError('Expected exactly RH1–RH17 in the r2 board.')
for index, fp in enumerate(heaters):
    if fp.get('mpn') != 'CRCW06033R30FKEAHP' or fp.get('lcsc') != 'C313752':
        raise ValueError(f"{fp['ref']}: PCB and released heater BOM do not match r2.")
    if abs(fp['xy'][0]-(data['bodyLengthMm']+8.8+index*2.6)) > .001 or abs(fp['xy'][1]-9) > .001:   # center line: y = 80 mm board, 71 mm frame offset
        raise ValueError(f"{fp['ref']}: heater position differs from the r2 thermal model.")
for t in board.GetTracks():
    via = t.GetClass()=='PCB_VIA'
    item = {'a':xy(t.GetStart()),'b':xy(t.GetEnd()),'net':t.GetNetname(),'layer':LAYER_NAMES.get(t.GetLayer(), 'top'),
            'width':round(p.ToMM(t.GetWidth(p.F_Cu) if via else t.GetWidth()),4),'via':via}
    if via:
        item.update(layers=copper_layers(t), holeLayers=[label for layer, label in COPPER_LAYERS if t.IsOnLayer(layer)], drill=round(p.ToMM(t.GetDrill()), 6))
    data['tracks'].append(item)
for edge in board.GetDrawings():
    if edge.GetLayer()==p.Edge_Cuts:
        data['outline'].append([xy(edge.GetStart()),xy(edge.GetEnd())])
for zone in board.Zones():
    for layer, label in COPPER_LAYERS:
        if zone.IsOnLayer(layer):
            data['zones'].append({'net':zone.GetNetname(), 'layer':label,
                                  'polygons':polygons(zone.GetFilledPolysList(layer))})
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != source_hash or hashlib.sha256(BOM.read_bytes()).hexdigest() != bom_hash:
    raise RuntimeError('PCB or BOM changed during export; regenerate from a stable source.')
(HERE.parent/'docs'/'board-data.js').write_text('/* Actual stored PCB geometry; regenerate with export_board.py. */\nwindow.SensorBoard = '+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
print(f'Extracted {len(data["footprints"])} footprints, {len(data["tracks"])} tracks/vias, '
      f'{len(data["zones"])} filled zones; PCB and BOM hashes unchanged.')
