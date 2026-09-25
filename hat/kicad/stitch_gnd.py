"""Ground stitching: after routing, any piece of ground pour that is cut off from the rest gets a via to the pour on the other side.
    D:\\KiCAD\\bin\\python.exe stitch_gnd.py board_routed.kicad_pcb
A via is only placed where a full via pad fits inside the ground copper of BOTH layers and its hole keeps its distance from every other hole."""
import json, math, sys, pcbnew
from pathlib import Path
from pcbnew import FromMM, ToMM

VIA_D, VIA_DRILL, HOLE_GAP = 0.6, 0.35, 0.3
SOLDER_HOLE_GAP = 0.10
path = sys.argv[1]
b = pcbnew.LoadBoard(path)
GND = b.GetNetcodeFromNetname("GND")
zones = {z.GetLayer(): z for z in b.Zones() if z.GetNetCode() == GND}
SOLDER_OPENINGS = []
for fp in b.GetFootprints():
    for pad in fp.Pads():
        # Every exterior solder opening, including through-hole headers, is protected.
        for layer, mask_layer in ((pcbnew.F_Cu, pcbnew.F_Mask), (pcbnew.B_Cu, pcbnew.B_Mask)):
            if not pad.IsOnLayer(layer) or not pad.IsOnLayer(mask_layer): continue
            polygon = pcbnew.SHAPE_POLY_SET()
            pad.TransformShapeToPolygon(polygon, layer, pad.GetSolderMaskExpansion(layer), FromMM(0.001), pcbnew.ERROR_OUTSIDE)
            margin = FromMM(VIA_DRILL / 2 + SOLDER_HOLE_GAP)
            SOLDER_OPENINGS.append((polygon, margin))


def clears_solder(c):
    return not any(poly.Collide(c, margin) for poly, margin in SOLDER_OPENINGS)


def holes():
    h = [(v.GetPosition(), v.GetDrill()) for v in b.GetTracks() if v.GetClass() == "PCB_VIA"]
    h += [(p.GetPosition(), p.GetDrillSize().x) for f in b.GetFootprints() for p in f.Pads() if p.GetDrillSize().x > 0]
    return h


def shrunk(layer):
    s = pcbnew.SHAPE_POLY_SET(zones[layer].GetFilledPolysList(layer))
    s.Deflate(FromMM(VIA_D / 2 + 0.05), pcbnew.CORNER_STRATEGY_ROUND_ALL_CORNERS, FromMM(0.005))
    return s


def links():
    """points that join the two layers on GND: vias and plated-through pads"""
    pts = [v.GetPosition() for v in b.GetTracks() if v.GetClass() == "PCB_VIA" and v.GetNetCode() == GND]
    return pts + [p.GetPosition() for f in b.GetFootprints() for p in f.Pads() if p.GetDrillSize().x > 0 and p.GetNetCode() == GND]


def pieces():
    out = []
    for layer in sorted(zones):
        fill = zones[layer].GetFilledPolysList(layer)
        for i in range(fill.OutlineCount()):
            s = pcbnew.SHAPE_POLY_SET(); s.AddOutline(fill.Outline(i))
            for h in range(fill.HoleCount(i)): s.AddHole(fill.Hole(i, h), 0)
            out.append((layer, s, fill.Outline(i).Area()))
    return out


def groups(P):
    """union-find: two pieces belong together when one via / through pad lies in both"""
    parent = list(range(len(P)))
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for pt in links():
        inside = [k for k, (l, s, a) in enumerate(P) if s.Contains(pt)]
        for k in inside[1:]: parent[find(k)] = find(inside[0])
    return [find(k) for k in range(len(P))]


def small(s):
    r = pcbnew.SHAPE_POLY_SET(s); r.Deflate(FromMM(VIA_D / 2 + 0.05), pcbnew.CORNER_STRATEGY_ROUND_ALL_CORNERS, FromMM(0.005)); return r


_via_geometry = None


def via_geometry():
    """Actual foreign copper and outline, independent of previous GND fills."""
    global _via_geometry
    if _via_geometry is not None: return _via_geometry
    project = json.loads(Path(path).with_suffix(".kicad_pro").read_text())
    rules = project["board"]["design_settings"]["rules"]
    gap = max(rules["min_clearance"], *(c["clearance"] for c in project["net_settings"]["classes"])) + 0.02
    edge = rules["min_copper_edge_clearance"] + 0.02
    inside = pcbnew.SHAPE_POLY_SET()
    if not b.GetBoardPolygonOutlines(inside, False):
        raise RuntimeError("Cannot determine the exact outline for ground stitching")
    inside.Deflate(FromMM(VIA_D / 2 + edge), pcbnew.CORNER_STRATEGY_ROUND_ALL_CORNERS, FromMM(0.001))
    copper = []
    for fp in b.GetFootprints():
        for pad in fp.Pads():
            if pad.GetNetCode() == GND: continue
            for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
                if pad.IsOnLayer(layer): copper.append(pcbnew.SHAPE_POLY_SET(pad.GetEffectivePolygon(layer)))
    for track in b.GetTracks():
        if track.GetNetCode() == GND: continue
        for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
            if not track.IsOnLayer(layer): continue
            poly = pcbnew.SHAPE_POLY_SET()
            track.TransformShapeToPolygon(poly, layer, 0, FromMM(0.001), pcbnew.ERROR_OUTSIDE)
            copper.append(poly)
    for zone in b.Zones():
        if zone.GetNetCode() != GND:
            for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
                if zone.IsOnLayer(layer): copper.append(pcbnew.SHAPE_POLY_SET(zone.GetFilledPolysList(layer)))
    radius = FromMM(VIA_D / 2 + gap)
    bounded = []
    for poly in copper:
        bb = poly.BBox()
        bounded.append((bb.GetLeft() - radius, bb.GetTop() - radius,
                        bb.GetRight() + radius, bb.GetBottom() + radius, poly))
    _via_geometry = inside, bounded, radius
    print(f"ground stitching fallback: checks actual copper at {gap:.3f} mm clearance and {edge:.3f} mm edge gap")
    return _via_geometry


def narrow_spot(P, g, main, lone, hs):
    """A via may extend beyond its own existing fill if foreign copper clears.

    Its centre must remain inside connected copper on both layers. The complete
    annulus is checked against other nets and the actual board outline; drilled
    holes retain the original spacing rule. Final filled-board DRC is required.
    """
    inside, copper, radius = via_geometry()
    for k in lone:
        for m in range(len(P)):
            if g[m] != main or P[m][0] == P[k][0]: continue
            room = pcbnew.SHAPE_POLY_SET(P[k][1])
            room.BooleanIntersection(P[m][1]); room.BooleanIntersection(inside)
            # Require a positive contact with both saved fills, not a tangent.
            room.Deflate(FromMM(0.02), pcbnew.CORNER_STRATEGY_ROUND_ALL_CORNERS, FromMM(0.001))
            if not room.OutlineCount(): continue
            candidates = []
            for o in range(room.OutlineCount()):
                line = room.Outline(o)
                candidates.extend(pcbnew.VECTOR2I(line.CPoint(n)) for n in range(line.PointCount()))
            bb = room.BBox(); step = FromMM(0.1)
            candidates.extend(pcbnew.VECTOR2I(x, y)
                              for x in range(bb.GetLeft(), bb.GetRight() + 1, step)
                              for y in range(bb.GetTop(), bb.GetBottom() + 1, step))
            for c in candidates:
                if not room.Contains(c): continue
                if not clears_solder(c): continue
                if any(math.hypot(ToMM(c.x - q.x), ToMM(c.y - q.y)) < (VIA_DRILL + ToMM(d)) / 2 + HOLE_GAP for q, d in hs): continue
                if any(x0 <= c.x <= x1 and y0 <= c.y <= y1 and poly.Collide(c, radius)
                       for x0, y0, x1, y1, poly in copper): continue
                return c
    return None


added = 0
for _ in range(20):
    P = pieces(); g = groups(P)
    area = {}
    for k, (l, s, a) in enumerate(P): area[g[k]] = area.get(g[k], 0) + a
    main = max(area, key=area.get)
    lone = [k for k in range(len(P)) if g[k] != main]
    if not lone: break
    hs = holes(); spot = None
    for k in lone:
        for m in range(len(P)):
            if g[m] != main or P[m][0] == P[k][0]: continue
            room = small(P[k][1]); room.BooleanIntersection(small(P[m][1]))
            for o in range(room.OutlineCount()):
                line = room.Outline(o)
                for n in range(line.PointCount()):
                    c = line.CPoint(n)
                    if clears_solder(c) and all(math.hypot(ToMM(c.x - q.x), ToMM(c.y - q.y)) >= (VIA_DRILL + ToMM(d)) / 2 + HOLE_GAP for q, d in hs):
                        spot = pcbnew.VECTOR2I(c.x, c.y); break
                if spot: break
            if spot: break
        if spot: break
    if not spot: spot = narrow_spot(P, g, main, lone, hs)
    if not spot: break
    v = pcbnew.PCB_VIA(b); v.SetPosition(spot); v.SetWidth(pcbnew.F_Cu, FromMM(VIA_D)); v.SetDrill(FromMM(VIA_DRILL)); v.SetNetCode(GND); b.Add(v)
    added += 1
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
if added: pcbnew.SaveBoard(path, b)
print(f"ground stitching: {added} via(s) added")
remaining = len(set(groups(pieces())))
if remaining > 1: print(f"ground stitching: {remaining} separate copper groups remain; board is not ready for release")
