"""Dump a board's footprints, pads, tracks and vias to JSON for plot_view.py (layout review drawings).
Run:  D:\\KiCAD\\bin\\python.exe export_view.py board.kicad_pcb out.json
Coordinates are body-frame mm: x from the cable end, y from the center line (KiCad y-down)."""
import json, sys, pcbnew
from pcbnew import ToMM

OX, OY = 100.0, 80.0
b = pcbnew.LoadBoard(sys.argv[1])
out = dict(parts=[], pads=[], tracks=[], vias=[], edges=[])
for fp in b.GetFootprints():
    cy = fp.GetCourtyard(pcbnew.F_CrtYd if fp.GetLayer() == pcbnew.F_Cu else pcbnew.B_CrtYd).BBox()
    out["parts"].append(dict(ref=fp.GetReference(), x=ToMM(fp.GetPosition().x) - OX, y=ToMM(fp.GetPosition().y) - OY,
                             rot=fp.GetOrientationDegrees(), cy=[ToMM(cy.GetLeft()) - OX, ToMM(cy.GetTop()) - OY, ToMM(cy.GetRight()) - OX, ToMM(cy.GetBottom()) - OY]))
    for p in fp.Pads():
        poly = p.GetEffectivePolygon(pcbnew.F_Cu if p.IsOnLayer(pcbnew.F_Cu) else pcbnew.B_Cu)
        o = poly.Outline(0)
        out["pads"].append(dict(ref=fp.GetReference(), num=p.GetNumber(), net=p.GetNetname(), x=ToMM(p.GetPosition().x) - OX, y=ToMM(p.GetPosition().y) - OY,
                                th=p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH,
                                poly=[(ToMM(o.CPoint(i).x) - OX, ToMM(o.CPoint(i).y) - OY) for i in range(o.PointCount())]))
for t in b.GetTracks():
    if t.GetClass() == "PCB_VIA":
        out["vias"].append(dict(net=t.GetNetname(), x=ToMM(t.GetPosition().x) - OX, y=ToMM(t.GetPosition().y) - OY, d=ToMM(t.GetWidth(pcbnew.F_Cu))))
    else:
        out["tracks"].append(dict(net=t.GetNetname(), layer=t.GetLayerName(), w=ToMM(t.GetWidth()),
                                  a=(ToMM(t.GetStart().x) - OX, ToMM(t.GetStart().y) - OY), b=(ToMM(t.GetEnd().x) - OX, ToMM(t.GetEnd().y) - OY)))
for d in b.GetDrawings():
    if d.GetLayer() == pcbnew.Edge_Cuts:
        out["edges"].append(((ToMM(d.GetStart().x) - OX, ToMM(d.GetStart().y) - OY), (ToMM(d.GetEnd().x) - OX, ToMM(d.GetEnd().y) - OY)))
json.dump(out, open(sys.argv[2], "w"))
print(f"{len(out['parts'])} parts, {len(out['pads'])} pads, {len(out['tracks'])} tracks, {len(out['vias'])} vias")
