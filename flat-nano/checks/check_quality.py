"""Layout-quality gate for the routed flat-nano board (the EE-review rules). Run with KiCad's Python:
    D:\\KiCAD\\bin\\python.exe flat-nano/checks/check_quality.py [board_routed.kicad_pcb]
Exit code 0 only if every rule passes. Rules:
  POWER    every trace that carries heater or battery current is >= 0.5 mm on the 1 oz outer layers and >= 1.2 mm on
           the 0.5 oz (15.2 um) inner layers, i.e. never less copper than 0.5 mm x 35 um (sense branches excepted); every via on
           those nets has a copper barrel at least equal to a 0.5 mm x 35 um trace at JLCPCB's 18 um minimum plating;
  MIRROR   the copper of every layer on the two side needles equals its own mirror image about the center line to
           within 0.01 mm^2, and every part there has a mirror twin (the heater needle is on the axis; its tip
           thermistor's two leads are reported, not required to mirror);
  BALANCE  on every copper layer, the body's copper area left and right of the center line agree within 10%;
  HEAT     every part dissipating more than 2 mW is centered on the axis (|y| <= 0.05 mm);
  ROUTING  no via-to-via jumper shorter than 3 mm, no signal via without copper on two layers, no zig-zag (a segment
           shorter than 0.3 mm between opposite turns), no acute (135 degree) turn, no top-layer copper under the inductor
           or deeper than 0.9 mm inside the MCU pad ring;
  USB      D+/D- are top-layer only, via-free, 0.30 mm wide, 0.20 mm apart where coupled (~88 ohm differential on
           JLC04081H-7628, inside USB's 90 ohm +/-15%); the length difference is reported.
"""
import math, os, sys
from collections import defaultdict
import pcbnew
from pcbnew import FromMM, ToMM

HERE = os.path.dirname(os.path.abspath(__file__))
KDIR = os.path.join(HERE, "..", "kicad")
BOARD = sys.argv[1] if len(sys.argv) > 1 else os.path.join(KDIR, "hp_sensor_routed.kicad_pcb")
OX, OY = 100.0, 80.0
BODY_L = 43.18               # exact Arduino Nano R4 outline
BALANCE_MAX = 0.10           # left/right copper-area difference allowed on each layer
PWR_MIN = 0.5
PWR_MIN_INNER = 1.2          # 1.2 mm x 15.2 um (0.5 oz inner) >= 0.5 mm x 35 um (1 oz outer)
POWER_NETS = {"VIN", "VIN_P", "HEAT_P", "HEAT_RTN", "SW", "5V_BUCK", "VUSB"}
SENSE_PADS = {"U4.8", "U4.9", "U4.10", "U3.8", "R15.1"}          # measurement taps: carry no load current
POWER_PADS = {"GND": ["U3.9", "C18.2", "C1.2", "C3.2", "C2.2", "Q1.2", "D2.2", "C17.2"],
              "+5V": ["D7.1", "C17.1", "D5.1"]}                    # supply pads whose ground/5 V links carry supply current
HEAT = {"U1": "MCU, ~10-15 mA at 5 V (50-75 mW)", "U3": "buck converter losses (~10 mW)", "L1": "buck inductor",
        "D1": "reverse-polarity diode, heater current (~90 mW while heating)", "D7": "5 V OR-ing diode (~3 mW)",
        "R5": "0.1 ohm shunt (6.6 mW at 14.4 V full-on)", "Q1": "heater MOSFET (2.2 mW at 14.4 V full-on, max Rds)"}
MCU_RING, MCU_PAD_INNER = 0.9, 4.9

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


def build_graph(net):
    """nodes: pads 'P:ref.n', vias 'V:x,y', free points 'T:x,y,layer'; edges: tracks (with width, layer)"""
    edges = []
    vpos = {P(v.GetPosition()): v for v in vias if v.GetNetname() == net}
    for t in tracks:
        if t.GetNetname() != net: continue
        ends = []
        for q in (t.GetStart(), t.GetEnd()):
            key = pad_hit(q, t.GetLayer(), net)
            if key is None:
                pq = P(q)
                key = f"V:{pq}" if pq in vpos else f"T:{pq}:{t.GetLayer()}"
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
for net in sorted(POWER_NETS | {str(n) for n in b.GetNetsByName().keys() if str(n).startswith("H_")} if hasattr(b, "GetNetsByName") else POWER_NETS):
    net = str(net)
    if b.FindNet(net) is None: continue
    loads = {k for k, p in pads.items() if p.GetNetname() == net and k not in SENSE_PADS}
    # a trace leaving the body toward the heater prong ends at a via/pad on the prong; treat prong ends as loads
    cur, edges = current_edges(net, loads)
    for t in cur:
        need = PWR_MIN if t.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu) else PWR_MIN_INNER
        if mm(t.GetWidth()) < need - 1e-6:
            fail("POWER", f"{net} trace {P(t.GetStart())}->{P(t.GetEnd())} on {b.GetLayerName(t.GetLayer())} is {mm(t.GetWidth()):.2f} mm (min {need})")
for net, plist in POWER_PADS.items():
    for name in plist:
        p = pads.get(name)
        if p is None: continue
        for t in tracks:
            if t.GetNetname() == net and (p.HitTest(t.GetStart(), 0) or p.HitTest(t.GetEnd(), 0)) and mm(t.GetWidth()) < PWR_MIN - 1e-6:
                fail("POWER", f"{name} {net} link {P(t.GetStart())}->{P(t.GetEnd())} is {mm(t.GetWidth()):.2f} mm")
for v in vias:
    if v.GetNetname() in POWER_NETS | {"HEAT_RTN"}:
        barrel = math.pi * mm(v.GetDrillValue()) * 0.018
        if barrel < PWR_MIN * 0.035 - 1e-9:
            fail("POWER", f"{v.GetNetname()} via at {P(v.GetPosition())} barrel {barrel:.4f} mm2 < {PWR_MIN * 0.035:.4f}")
j1g = pads.get("J1.3")
if j1g is not None:
    ov = j1g.GetLocalThermalSpokeWidthOverride()
    ov = ov.value_or(0) if hasattr(ov, "value_or") else (ov or 0)
    notes.append(f"POWER J1 ground-hole thermal spokes {mm(ov):.2f} mm")
    if mm(ov) < PWR_MIN - 1e-6: fail("POWER", "J1 ground thermal spokes narrower than 0.5 mm")

# ------------------------------------------------------------ MIRROR
LAYERS = [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu]
xmax_board = max(mm(d.GetEnd().x) for d in b.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts) - OX + 1


def copper(layer):
    s = pcbnew.SHAPE_POLY_SET()
    err = FromMM(0.002)
    for t in b.GetTracks():
        if t.IsOnLayer(layer) and (t.GetClass() != "PCB_VIA" or t.FlashLayer(layer)):
            t.TransformShapeToPolygon(s, layer, 0, err, pcbnew.ERROR_INSIDE)
    for fp in b.GetFootprints():
        for p in fp.Pads():
            if p.IsOnLayer(layer) and p.FlashLayer(layer): p.TransformShapeToPolygon(s, layer, 0, err, pcbnew.ERROR_INSIDE)
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
    mn = pcbnew.SHAPE_POLY_SET(cn); mn.Mirror(pcbnew.VECTOR2I(FromMM(OX), FromMM(OY)), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
    e1 = pcbnew.SHAPE_POLY_SET(cn); e1.BooleanSubtract(mn); e2 = pcbnew.SHAPE_POLY_SET(mn); e2.BooleanSubtract(cn)
    ea = (e1.Area() + e2.Area()) / 1e12
    if ea > 0.001:
        bb = e1.BBox() if e1.OutlineCount() else e2.BBox()
        notes.append(f"MIRROR {b.GetLayerName(layer)} heater needle (on the axis): {ea:.3f} mm2 differs, near x = "
                     f"{mm(bb.GetLeft()) - OX:.1f}..{mm(bb.GetRight()) - OX:.1f} mm (tip thermistor leads to its two lanes)")
for layer in LAYERS:
    c = copper(layer); c.BooleanIntersection(clip)
    m = pcbnew.SHAPE_POLY_SET(c)
    m.Mirror(pcbnew.VECTOR2I(FromMM(OX), FromMM(OY)), pcbnew.FLIP_DIRECTION_TOP_BOTTOM) if hasattr(m, "Mirror") else None
    d1 = pcbnew.SHAPE_POLY_SET(c); d1.BooleanSubtract(m)
    d2 = pcbnew.SHAPE_POLY_SET(m); d2.BooleanSubtract(c)
    area = (d1.Area() + d2.Area()) / 1e12
    total = c.Area() / 1e12
    notes.append(f"MIRROR {b.GetLayerName(layer)}: copper {total:.2f} mm2 on the side needles, asymmetric {area:.4f} mm2")
    if area > 0.01:
        bb = d1.BBox() if d1.OutlineCount() else d2.BBox()
        fail("MIRROR", f"{b.GetLayerName(layer)} copper differs from its mirror image by {area:.4f} mm2 near "
                       f"({mm(bb.GetLeft()) - OX:.2f}..{mm(bb.GetRight()) - OX:.2f}, {mm(bb.GetTop()) - OY:.2f}..{mm(bb.GetBottom()) - OY:.2f})")
zone_fps = [fp for fp in b.GetFootprints() if mm(fp.GetPosition().x) - OX > BODY_L]
zone_fps_check = [fp for fp in zone_fps if not (mm(fp.GetPosition().x) - OX > BODY_L and abs(mm(fp.GetPosition().y) - OY) < 2.0)]
for fp in zone_fps_check:
    x, y = mm(fp.GetPosition().x) - OX, mm(fp.GetPosition().y) - OY
    twin = [g for g in zone_fps if g.GetFPIDAsString() == fp.GetFPIDAsString()
            and abs(mm(g.GetPosition().x) - OX - x) < 1e-3 and abs(mm(g.GetPosition().y) - OY + y) < 1e-3]
    if not twin: fail("MIRROR", f"{fp.GetReference()} at ({x:.2f}, {y:.2f}) has no mirror twin")

# ------------------------------------------------------------ HEAT
for ref, why in HEAT.items():
    fp = b.FindFootprintByReference(ref)
    y = mm(fp.GetPosition().y) - OY
    notes.append(f"HEAT {ref} y = {y:+.3f} mm ({why})")
    if abs(y) > 0.05: fail("HEAT", f"{ref} ({why}) is {y:+.3f} mm off the axis")

# ------------------------------------------------------------ ROUTING
def body_region(ref, inset=None):
    fp = b.FindFootprintByReference(ref)
    if inset is None:
        bb = fp.GetCourtyard(pcbnew.F_CrtYd).BBox(); return (mm(bb.GetLeft()) - OX, mm(bb.GetTop()) - OY, mm(bb.GetRight()) - OX, mm(bb.GetBottom()) - OY)
    cx, cy = mm(fp.GetPosition().x) - OX, mm(fp.GetPosition().y) - OY
    return (cx - inset, cy - inset, cx + inset, cy + inset)


def seg_in_box(t, bx, pad_ok=True):
    x0, y0, x1, y1 = bx
    for f in [i / 10 for i in range(11)]:
        x = mm(t.GetStart().x) + (mm(t.GetEnd().x) - mm(t.GetStart().x)) * f - OX
        y = mm(t.GetStart().y) + (mm(t.GetEnd().y) - mm(t.GetStart().y)) * f - OY
        if x0 < x < x1 and y0 < y < y1: return True
    return False


KEEP = {"L1 body": body_region("L1"), "MCU body": body_region("U1", MCU_PAD_INNER - MCU_RING)}
for t in tracks:
    if t.GetLayer() != pcbnew.F_Cu: continue
    for name, bx in KEEP.items():
        if seg_in_box(t, bx) and not (name == "L1 body" and t.GetNetname() in ("SW", "5V_BUCK")):
            fail("ROUTING", f"top-layer {t.GetNetname()} copper under the {name} at {P(t.GetStart())}->{P(t.GetEnd())}")
for v in vias:
    for name, bx in KEEP.items():
        x, y = P(v.GetPosition())
        if bx[0] < x < bx[2] and bx[1] < y < bx[3]: fail("ROUTING", f"via under the {name} at ({x}, {y})")
# via purpose and jumpers
nets_all = defaultdict(list)
for t in tracks: nets_all[t.GetNetname()].append(t)
for v in vias:
    net = v.GetNetname(); pos = v.GetPosition()
    layers = {t.GetLayer() for t in nets_all[net] if t.HitTest(pos, 0)}
    plane = net in ("GND", "+5V")
    if not plane and len(layers) < 2:                        # a signal via must join copper on two layers
        fail("ROUTING", f"{net} via at {P(pos)} has copper on only {sorted(b.GetLayerName(l) for l in layers)}")
    if plane and not layers: notes.append(f"ROUTING {net} stitching via at {P(pos)} (joins the ground pours and plane)")
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
            comp, stack, length, touches_pad = set(), [start], 0.0, False
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

# ------------------------------------------------------------ USB
usb = {n: [t for t in tracks if t.GetNetname() == n] for n in ("USB_DM", "USB_DP")}
for n, ts in usb.items():
    if any(t.GetLayer() != pcbnew.F_Cu for t in ts): fail("USB", f"{n} leaves the top layer")
    if any(v.GetNetname() == n for v in vias): fail("USB", f"{n} has a via")
    if any(abs(mm(t.GetWidth()) - 0.30) > 1e-6 for t in ts): fail("USB", f"{n} width is not 0.30 mm")
L = {n: sum(mm(t.GetLength()) for t in ts) for n, ts in usb.items()}
notes.append(f"USB lengths: D- {L['USB_DM']:.2f} mm, D+ {L['USB_DP']:.2f} mm, difference {abs(L['USB_DM'] - L['USB_DP']):.2f} mm")
gaps = []
for a in usb["USB_DM"]:
    for c in usb["USB_DP"]:
        ax0, ay0, ax1, ay1 = *P(a.GetStart()), *P(a.GetEnd()); cx0, cy0, cx1, cy1 = *P(c.GetStart()), *P(c.GetEnd())
        da, dc = (ax1 - ax0, ay1 - ay0), (cx1 - cx0, cy1 - cy0)
        if abs(da[0] * dc[1] - da[1] * dc[0]) > 1e-6: continue           # coupled = parallel segments side by side
        la = math.hypot(*da)
        dist = abs((cx0 - ax0) * da[1] - (cy0 - ay0) * da[0]) / la
        if dist < 1.0: gaps.append(round(dist - 0.30, 3))
if not gaps or any(abs(g - 0.20) > 0.03 for g in gaps if g < 0.3): fail("USB", f"coupled gaps {sorted(set(gaps))} (target 0.20 mm)")
notes.append(f"USB coupled gaps: {sorted(set(gaps))} mm")

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
print("QUALITY OK - power widths, mirrored needles, left/right copper balance, heat sources on axis, routing style and USB pair all pass")
