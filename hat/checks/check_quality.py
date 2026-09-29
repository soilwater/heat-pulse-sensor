"""Layout-quality gate for the routed compact hat (the EE-review rules). Run with KiCad's Python:
    D:\\KiCAD\\bin\\python.exe hat/checks/check_quality.py [board_routed.kicad_pcb]
Exit code 0 only if every rule passes. Rules:
  POWER    every trace that carries heater or battery current (including the Nano VIN feed) is >= 0.5 mm on the 1 oz
           outer layers and >= 1.2 mm on the 0.5 oz (15.2 um) inner layers, i.e. never less copper than 0.5 mm x 35 um
           (Kelvin sense branches excepted); every via on those nets has a copper barrel at least equal to a
           0.5 mm x 35 um trace at JLCPCB's 18 um minimum plating; the cable ground hole and the Nano ground pins
           reach the pours through >= 0.5 mm thermal spokes;
  MIRROR   the copper of every layer on the two side needles equals its own mirror image about the center line to
           within 0.01 mm^2, and every part there has a mirror twin (the heater needle is on the axis; its tip
           thermistor's two leads are reported, not required to mirror);
  BALANCE  on every copper layer, the body's copper area left and right of the center line agree within 10%;
  HEAT     every part dissipating more than 2 mW is centered on the axis (|y| <= 0.05 mm);
  ROUTING  no via-to-via jumper shorter than 3 mm, no signal via without copper on two layers, no zig-zag (a segment
           shorter than 0.3 mm between opposite turns), no acute (135 degree) turn.
"""
import math, os, sys
from collections import defaultdict
import pcbnew
from pcbnew import FromMM, ToMM

HERE = os.path.dirname(os.path.abspath(__file__))
KDIR = os.path.join(HERE, "..", "kicad")
BOARD = sys.argv[1] if len(sys.argv) > 1 else os.path.join(KDIR, "hp_hat_routed.kicad_pcb")
OX, OY = 100.0, 80.0
BODY_L = 43.18               # exact Arduino Nano R4 outline
BALANCE_MAX = 0.10           # left/right copper-area difference allowed on each layer
PWR_MIN = 0.5
PWR_MIN_INNER = 1.2          # 1.2 mm x 15.2 um (0.5 oz inner) >= 0.5 mm x 35 um (1 oz outer)
POWER_NETS = {"VIN", "VIN_P", "HEAT_P", "HEAT_RTN", "NANO_VIN"}
SENSE_PADS = {"U4.8", "U4.9", "U4.10"}                              # measurement taps: carry no load current
POWER_PADS = {"GND": ["C1.2", "C3.2", "Q1.2", "D2.2"]}              # supply pads whose ground links carry supply current
SPOKE_PADS = ("J1.3", "J3.12", "J4.14")                             # cable ground hole, both Nano ground pins
HEAT = {"D1": "reverse-polarity diode, heater current (~90 mW while heating)", "R18": "Nano VIN feed resistor (~3 mW)",
        "R5": "0.1 ohm shunt (6.6 mW at 14.4 V full-on)", "Q1": "heater MOSFET (2.2 mW at 14.4 V full-on, max Rds)"}

b = pcbnew.LoadBoard(BOARD)
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
fails, notes = [], []
mm = lambda v: ToMM(v)
P = lambda p: (round(mm(p.x) - OX, 4), round(mm(p.y) - OY, 4))
tracks = [t for t in b.GetTracks() if t.GetClass() == "PCB_TRACK"]
vias = [t for t in b.GetTracks() if t.GetClass() == "PCB_VIA"]
pads = {f"{fp.GetReference()}.{p.GetNumber()}": p for fp in b.GetFootprints() for p in fp.Pads() if p.GetNumber()}


def fail(rule, msg): fails.append(f"{rule}: {msg}")


# ------------------------------------------------------------ connectivity graph per net
def pad_hit(pt_iu, layer, net):
    for name, p in pads.items():
        if p.GetNetname() == net and p.IsOnLayer(layer) and p.HitTest(pt_iu, 0): return "P:" + name
    return None


def via_hit(pt_iu, net):
    """a track end anywhere on a same-net via's copper joins that via"""
    for v in vias:
        if v.GetNetname() == net and v.HitTest(pt_iu, 0): return f"V:{P(v.GetPosition())}"
    return None


def build_graph(net):
    """nodes: pads 'P:ref.n', vias 'V:x,y', free points 'T:x,y,layer'; edges: tracks (with width, layer)"""
    edges = []
    for t in tracks:
        if t.GetNetname() != net: continue
        ends = []
        for q in (t.GetStart(), t.GetEnd()):
            key = pad_hit(q, t.GetLayer(), net) or via_hit(q, net) or f"T:{P(q)}:{t.GetLayer()}"
            ends.append(key)
        edges.append((ends[0], ends[1], t))
    return edges


def current_edges(net, load_pads):
    """edges that lie on a path between two load terminals: prune leaves that are not load terminals"""
    edges = build_graph(net)
    alive = set(range(len(edges)))
    while True:
        deg = defaultdict(int)
        for i in alive:
            a, c, _ = edges[i]; deg[a] += 1; deg[c] += 1
        leaves = {n for n, d in deg.items() if d == 1 and not (n.startswith("P:") and n[2:] in load_pads)}
        drop = {i for i in alive if edges[i][0] in leaves or edges[i][1] in leaves}
        if not drop: break
        alive -= drop
    return [edges[i][2] for i in alive], edges


# ------------------------------------------------------------ POWER
heater_nets = {str(n) for n in b.GetNetsByName().keys() if str(n).startswith("H_")}
for net in sorted(POWER_NETS | heater_nets):
    if b.FindNet(net) is None: fail("POWER", f"net {net} missing"); continue
    loads = {k for k, p in pads.items() if p.GetNetname() == net and k not in SENSE_PADS}
    cur, edges = current_edges(net, loads)
    if net in POWER_NETS and not cur: fail("POWER", f"{net}: no current-carrying copper found between its loads {sorted(loads)}")
    for t in cur:
        need = PWR_MIN if t.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu) else PWR_MIN_INNER
        if mm(t.GetWidth()) < need - 1e-6:
            fail("POWER", f"{net} trace {P(t.GetStart())}->{P(t.GetEnd())} on {b.GetLayerName(t.GetLayer())} is {mm(t.GetWidth()):.2f} mm (min {need})")
    widths = sorted({(b.GetLayerName(t.GetLayer()), round(mm(t.GetWidth()), 2)) for t in cur})
    if net in POWER_NETS: notes.append(f"POWER {net}: current path {', '.join(f'{l} {w} mm' for l, w in widths)}")
for net, plist in POWER_PADS.items():
    for name in plist:
        p = pads.get(name)
        if p is None: fail("POWER", f"{name} missing"); continue
        for t in tracks:
            if t.GetNetname() == net and (p.HitTest(t.GetStart(), 0) or p.HitTest(t.GetEnd(), 0)) and mm(t.GetWidth()) < PWR_MIN - 1e-6:
                fail("POWER", f"{name} {net} link {P(t.GetStart())}->{P(t.GetEnd())} is {mm(t.GetWidth()):.2f} mm")
for v in vias:
    if v.GetNetname() in POWER_NETS:
        barrel = math.pi * mm(v.GetDrillValue()) * 0.018
        if barrel < PWR_MIN * 0.035 - 1e-9:
            fail("POWER", f"{v.GetNetname()} via at {P(v.GetPosition())} barrel {barrel:.4f} mm2 < {PWR_MIN * 0.035:.4f}")
for name in SPOKE_PADS:
    p = pads[name]
    ov = p.GetLocalThermalSpokeWidthOverride()
    ov = ov.value_or(0) if hasattr(ov, "value_or") else (ov or 0)
    notes.append(f"POWER {name} ({p.GetNetname()}) thermal spokes {mm(ov):.2f} mm")
    if p.GetNetname() != "GND" or mm(ov) < PWR_MIN - 1e-6: fail("POWER", f"{name} ground thermal spokes narrower than 0.5 mm (or not ground)")

# ------------------------------------------------------------ MIRROR
LAYERS = [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu]
xmax_board = max(mm(d.GetEnd().x) for d in b.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts) - OX + 1
mirror = lambda s: s.Mirror(pcbnew.VECTOR2I(FromMM(OX), FromMM(OY)), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)


def copper(layer):
    s = pcbnew.SHAPE_POLY_SET()
    err = FromMM(0.002)
    for t in b.GetTracks():
        if t.IsOnLayer(layer) and (t.GetClass() != "PCB_VIA" or t.FlashLayer(layer)):
            t.TransformShapeToPolygon(s, layer, 0, err, pcbnew.ERROR_INSIDE)
    for fp in b.GetFootprints():
        for p in fp.Pads():
            if p.IsOnLayer(layer) and p.FlashLayer(layer):
                p.TransformShapeToPolygon(s, layer, 0, err, pcbnew.ERROR_INSIDE)
    for z in b.Zones():
        if not z.GetIsRuleArea() and z.IsOnLayer(layer): s.BooleanAdd(z.GetFilledPolysList(layer))
    s.Simplify()
    return s


def region(*boxes):
    r = pcbnew.SHAPE_POLY_SET()
    for x0, y0, x1, y1 in boxes:
        r.NewOutline()
        for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)): r.Append(FromMM(OX + x), FromMM(OY + y))
    return r


clip = region((BODY_L, -12, xmax_board, -2.0), (BODY_L, 2.0, xmax_board, 12))          # the two side needles
center_needle = region((BODY_L, -2.0, xmax_board, 2.0))
for layer in LAYERS:
    cn = copper(layer); cn.BooleanIntersection(center_needle)
    mn = pcbnew.SHAPE_POLY_SET(cn); mirror(mn)
    e1 = pcbnew.SHAPE_POLY_SET(cn); e1.BooleanSubtract(mn); e2 = pcbnew.SHAPE_POLY_SET(mn); e2.BooleanSubtract(cn)
    ea = (e1.Area() + e2.Area()) / 1e12
    if ea > 0.001:
        bb = e1.BBox() if e1.OutlineCount() else e2.BBox()
        notes.append(f"MIRROR {b.GetLayerName(layer)} heater needle (on the axis): {ea:.3f} mm2 differs, near x = "
                     f"{mm(bb.GetLeft()) - OX:.1f}..{mm(bb.GetRight()) - OX:.1f} mm (tip thermistor leads to its two lanes)")
for layer in LAYERS:
    c = copper(layer); c.BooleanIntersection(clip)
    m = pcbnew.SHAPE_POLY_SET(c); mirror(m)
    diff = pcbnew.SHAPE_POLY_SET(c); diff.BooleanSubtract(m)
    d2 = pcbnew.SHAPE_POLY_SET(m); d2.BooleanSubtract(c); diff.BooleanAdd(d2)
    area = diff.Area() / 1e12
    notes.append(f"MIRROR {b.GetLayerName(layer)}: copper {c.Area() / 1e12:.2f} mm2 on the side needles, asymmetric {area:.4f} mm2")
    if area > 0.01:
        bb = diff.BBox()
        fail("MIRROR", f"{b.GetLayerName(layer)} copper differs from its mirror image by {area:.4f} mm2 near "
                       f"({mm(bb.GetLeft()) - OX:.2f}..{mm(bb.GetRight()) - OX:.2f}, {mm(bb.GetTop()) - OY:.2f}..{mm(bb.GetBottom()) - OY:.2f})")
zone_fps = [fp for fp in b.GetFootprints() if mm(fp.GetPosition().x) - OX > BODY_L]
zone_fps_check = [fp for fp in zone_fps if not (mm(fp.GetPosition().x) - OX > BODY_L and abs(mm(fp.GetPosition().y) - OY) < 2.0)]
for fp in zone_fps_check:
    x, y = mm(fp.GetPosition().x) - OX, mm(fp.GetPosition().y) - OY
    twin = [g for g in zone_fps if g.GetFPIDAsString() == fp.GetFPIDAsString() and g.GetLayer() == fp.GetLayer()
            and abs(mm(g.GetPosition().x) - OX - x) < 1e-3 and abs(mm(g.GetPosition().y) - OY + y) < 1e-3]
    if not twin: fail("MIRROR", f"{fp.GetReference()} at ({x:.2f}, {y:.2f}) has no mirror twin")

# ------------------------------------------------------------ HEAT
for ref, why in HEAT.items():
    fp = b.FindFootprintByReference(ref)
    y = mm(fp.GetPosition().y) - OY
    notes.append(f"HEAT {ref} ({'top' if fp.GetLayer() == pcbnew.F_Cu else 'bottom'}) y = {y:+.3f} mm ({why})")
    if abs(y) > 0.05: fail("HEAT", f"{ref} ({why}) is {y:+.3f} mm off the axis")

# ------------------------------------------------------------ ROUTING
nets_all = defaultdict(list)
for t in tracks: nets_all[t.GetNetname()].append(t)
for v in vias:
    net = v.GetNetname(); pos = v.GetPosition()
    layers = {t.GetLayer() for t in nets_all[net] if t.HitTest(pos, 0) or v.HitTest(t.GetStart(), 0) or v.HitTest(t.GetEnd(), 0)}
    plane = net in ("GND", "+5V")
    if not plane and len(layers) < 2:                        # a signal via must join copper on two layers
        fail("ROUTING", f"{net} via at {P(pos)} has copper on only {sorted(b.GetLayerName(l) for l in layers)}")
for net, ts in nets_all.items():
    if net in ("GND", "+5V"): continue
    vset = {P(v.GetPosition()) for v in vias if v.GetNetname() == net}
    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        # chains of segments on one layer; a chain whose two ends are both vias and that touches no pad is a jumper
        segs = [t for t in ts if t.GetLayer() == layer]
        adj = defaultdict(list)
        for t in segs:
            a, c = P(t.GetStart()), P(t.GetEnd()); adj[a].append((c, t)); adj[c].append((a, t))
        seen = set()
        for start in list(adj):
            if start in seen: continue
            comp, stack = set(), [start]
            while stack:
                n = stack.pop()
                if n in comp: continue
                comp.add(n)
                for m_, t in adj[n]:
                    if m_ not in comp: stack.append(m_)
            seen |= comp
            comp_segs = {id(t): t for n in comp for _, t in adj[n]}
            length = sum(mm(t.GetLength()) for t in comp_segs.values())
            touches_pad = any(pad_hit(pcbnew.VECTOR2I(FromMM(OX + n[0]), FromMM(OY + n[1])), layer, net) for n in comp)
            ends_v = [n for n in comp if n in vset]
            if len(ends_v) >= 2 and not touches_pad and length < 3.0:
                fail("ROUTING", f"{net} {b.GetLayerName(layer)} jumper {length:.2f} mm between vias {ends_v[:2]}")
# zig-zags and acute turns
for net, ts in nets_all.items():
    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        segs = [t for t in ts if t.GetLayer() == layer and t.GetLength() > 0]
        by_pt = defaultdict(list)
        for t in segs:
            by_pt[P(t.GetStart())].append(t); by_pt[P(t.GetEnd())].append(t)
        def other(t, p):
            return P(t.GetEnd()) if P(t.GetStart()) == p else P(t.GetStart())
        for p, lst in by_pt.items():
            if len(lst) != 2: continue
            a, c = other(lst[0], p), other(lst[1], p)
            v1 = (a[0] - p[0], a[1] - p[1]); v2 = (c[0] - p[0], c[1] - p[1])
            n1, n2 = math.hypot(*v1), math.hypot(*v2)
            if n1 < 1e-6 or n2 < 1e-6: continue
            ang = math.degrees(math.acos(max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))))
            if ang < 89.0 and not pad_hit(pcbnew.VECTOR2I(FromMM(OX + p[0]), FromMM(OY + p[1])), layer, net):
                fail("ROUTING", f"{net} {b.GetLayerName(layer)} acute {180 - ang:.0f}-degree turn at {p}")
        for t in segs:
            if mm(t.GetLength()) >= 0.3: continue
            a, c = P(t.GetStart()), P(t.GetEnd())
            if pad_hit(t.GetStart(), layer, net) or pad_hit(t.GetEnd(), layer, net): continue
            na = [u for u in by_pt[a] if u is not t]; nc = [u for u in by_pt[c] if u is not t]
            if len(na) != 1 or len(nc) != 1: continue
            pa, pc = other(na[0], a), other(nc[0], c)
            cross = lambda o, q, r: (q[0] - o[0]) * (r[1] - o[1]) - (q[1] - o[1]) * (r[0] - o[0])
            if cross(pa, a, c) * cross(a, c, pc) < -1e-9:
                fail("ROUTING", f"{net} {b.GetLayerName(layer)} zig-zag: {mm(t.GetLength()):.2f} mm jog at {a}->{c}")

# ------------------------------------------------------------ BALANCE
for layer in LAYERS:
    c = copper(layer)
    halves = []
    for sgn in (-1, 1):
        h = region((0, min(0, sgn * 12), BODY_L, max(0, sgn * 12)))
        cc = pcbnew.SHAPE_POLY_SET(c); cc.BooleanIntersection(h); halves.append(cc.Area() / 1e12)
    dev = (halves[1] - halves[0]) / max(halves)
    notes.append(f"BALANCE {b.GetLayerName(layer)} body: north {halves[0]:.1f} mm2, south {halves[1]:.1f} mm2 ({100 * dev:+.1f}%)")
    if abs(dev) > BALANCE_MAX + 1e-9:
        fail("BALANCE", f"{b.GetLayerName(layer)} left/right copper differs by {100 * dev:+.1f}% (limit {100 * BALANCE_MAX:.0f}%)")

for n in notes: print(n)
if fails:
    print(f"QUALITY FAILED: {len(fails)} finding(s)")
    for f in fails: print("  " + f)
    sys.exit(1)
print("QUALITY OK - power widths, mirrored needles, left/right copper balance, heat sources on axis and routing style all pass")
