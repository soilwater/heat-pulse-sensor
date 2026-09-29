"""Export stored KiCad copper geometry without refilling or saving the PCB.

Run from any directory using D:/KiCAD/bin/python.exe. Filled-zone polygons come
directly from the saved board. Native pad polygons include curved-edge
tessellation; physical drill cutouts are exported separately as holePolygons.
Render polygon contours with even-odd filling, including KiCad's fractured
filled-zone contours. Do not simplify them or connect separate islands.
Each footprint also carries its footprint name and an axis-aligned bodyBox
[x0, y0, x1, y1] taken from its fabrication outline (bodySource 'fab'), else its
courtyard ('courtyard'), else its pads ('pads'). Keepout rule areas are skipped.
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

def frame_box(left, top, right, bottom):
    return [round(p.ToMM(left)-100, 4), round(p.ToMM(top)-71, 4),
            round(p.ToMM(right)-100, 4), round(p.ToMM(bottom)-71, 4)]

def body_box(fp):
    """Axis-aligned package box in frame coordinates and where it came from.

    Uses the footprint's fabrication outline, else its courtyard, else the
    extent of its pads. Stroke widths are removed so the box follows the drawn
    outline's centerline (the package edge), not the width of the pen."""
    back = fp.GetLayer() == p.B_Cu
    for layer, label in ((p.B_Fab if back else p.F_Fab, 'fab'), (p.B_CrtYd if back else p.F_CrtYd, 'courtyard')):
        shapes = [g for g in fp.GraphicalItems() if g.GetClass() == 'PCB_SHAPE' and g.GetLayer() == layer]
        if shapes:
            edges = []
            for shape in shapes:
                box, half = shape.GetBoundingBox(), shape.GetWidth() // 2
                edges.append((box.GetLeft()+half, box.GetTop()+half, box.GetRight()-half, box.GetBottom()-half))
            return frame_box(min(e[0] for e in edges), min(e[1] for e in edges),
                             max(e[2] for e in edges), max(e[3] for e in edges)), label
    boxes = [pad.GetBoundingBox() for pad in fp.Pads()]
    return frame_box(min(b.GetLeft() for b in boxes), min(b.GetTop() for b in boxes),
                     max(b.GetRight() for b in boxes), max(b.GetBottom() for b in boxes)), 'pads'

data = {'board':'HP-SDI12-NANO / 17 x 3.3 ohm heater', 'copperLayers': ['top', 'inner1', 'inner2', 'bottom'], 'bodyLengthMm': 43.18, 'source':'flat-nano/kicad/hp_sensor_routed.kicad_pcb',
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
    box, box_source = body_box(fp)
    data['footprints'].append({'ref':ref,'value':fp.GetValue(),'footprint':str(fp.GetFPID().GetLibItemName()),
                               'xy':xy(fp.GetPosition()),'angle':fp.GetOrientationDegrees(),
                               'layer':'bottom' if fp.GetLayer()==p.B_Cu else 'top',
                               'bodyBox':box,'bodySource':box_source,'pads':pads,**parts.get(ref,{})})
heaters = sorted((fp for fp in data['footprints'] if fp['ref'].startswith('RH')), key=lambda fp:int(fp['ref'][2:]))
if [fp['ref'] for fp in heaters] != [f'RH{i}' for i in range(1,18)]:
    raise ValueError('Expected exactly RH1-RH17 on the flat-nano board.')
for index, fp in enumerate(heaters):
    if fp.get('mpn') != 'CRCW06033R30FKEAHP' or fp.get('lcsc') != 'C313752':
        raise ValueError(f"{fp['ref']}: PCB and BOM heater identity differ.")
    if abs(fp['xy'][0]-(data['bodyLengthMm']+8.8+index*2.6)) > .001 or abs(fp['xy'][1]-9) > .001:   # center line: y = 80 mm board, 71 mm frame offset
        raise ValueError(f"{fp['ref']}: heater position differs from the thermal model.")
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
    if zone.GetIsRuleArea():   # keepouts carry no copper
        continue
    for layer, label in COPPER_LAYERS:
        if zone.IsOnLayer(layer):
            data['zones'].append({'net':zone.GetNetname(), 'layer':label,
                                  'polygons':polygons(zone.GetFilledPolysList(layer))})
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != source_hash or hashlib.sha256(BOM.read_bytes()).hexdigest() != bom_hash:
    raise RuntimeError('PCB or BOM changed during export; regenerate from a stable source.')
(HERE.parent/'docs'/'board-data.js').write_text('/* Actual stored PCB geometry; regenerate with export_board.py. */\nwindow.SensorBoard = '+json.dumps(data,separators=(',',':'))+';\n',encoding='utf-8')
print(f'Extracted {len(data["footprints"])} footprints, {len(data["tracks"])} tracks/vias, '
      f'{len(data["zones"])} filled zones; PCB and BOM hashes unchanged.')
