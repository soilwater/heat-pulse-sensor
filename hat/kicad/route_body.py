"""Routes the body of hp_hat.kicad_pcb (made by gen_pcb.py), pours the bottom GND plane, writes hp_hat_routed.kicad_pcb.

Run:  D:\KiCAD\bin\python.exe route_body.py
Purpose-built maze router: 0.125 mm grid, 8 directions, two outer signal layers,
with dedicated inner GND and +5V planes. Surface-mount power pads get short
escapes to ordinary through-vias outside their solder openings.
KiCad's DRC is the judge of the result.
"""
import functools, heapq, math, os, random, sys, time, pcbnew
from pathlib import Path
from pcbnew import VECTOR2I, FromMM, ToMM

BOARD, OUT = "hp_hat.kicad_pcb", "hp_hat_routed.kicad_pcb"
OUT = os.environ.get("ROUTE_OUTPUT", OUT)
OX, OY, BODY_L, BODY_W = 100.0, 80.0, 43.18, 17.78
G = 0.125
CLR = float(os.environ.get("ROUTE_CLEARANCE", "0.16"))  # Planning margin above the unchanged 0.127 mm board rule; final DRC remains mandatory.
W_SIG, W_PWR = 0.2, 0.25
VIA_D, VIA_DRILL = 0.6, 0.35
SOLDER_HOLE_GAP = 0.10              # ordinary unfilled via drills stay outside every SMD solder opening
WIDE = {"VIN", "VIN_P", "HEAT_P", "HEAT_RTN"}       # carry the 150 mA heater current
EDGE = 0.5
# Kelvin sensing: the INA226 sense pins must tap the shunt (R5) AT ITS PADS, on copper that carries no heater current.
KELVIN = {"VIN_P": dict(anchor="R5.1", sense=["U4.10"]), "HEAT_P": dict(anchor="R5.2", sense=["U4.9", "U4.8"])}
# Connect local bypass capacitors to their owning pins before joining the rail's
# other loads. Clock and reference nets receive first routing priority.
DIRECT_PAIRS = {"VREF": ("J4.3", "C13.1")}
CRITICAL_NETS = {"VREF", "NANO_VIN", "+5V"}
LOCAL_GROUNDS = {"C13.2"}
PROTECTED_NETS = {n for n in os.environ.get("ROUTE_LOCK_NETS", "").split(",") if n}
# The exact outline is not a multiple of the routing grid. Keep y=0 on the
# lattice; enforce the physical edges with keep-outs rather than shifting it.
Y_HALF = int(math.ceil(BODY_W / (2 * G)))
NX, NY = int(math.ceil(BODY_L / G)) + 1, 2 * Y_HALF + 1
F, B = 0, 1
KL = {F: pcbnew.F_Cu, B: pcbnew.B_Cu}
LAYER_COST, VIA_COST, FOREIGN_COST, HIST_W = {F: 1.0, B: float(os.environ.get("ROUTE_BACK_COST", "1.8"))}, 12.0, 60.0, 0.6

gx = lambda x: int(round(x / G))
gy = lambda y: int(round(y / G)) + Y_HALF
mm = lambda ix, iy: (ix * G, (iy - Y_HALF) * G)
idx = lambda ix, iy: ix * NY + iy
pt = lambda x, y: VECTOR2I(FromMM(OX + x), FromMM(OY + y))

SCRIPT_DIR = Path(__file__).resolve().parent
SEED = int(os.environ.get("ROUTE_SEED", "0"))
MAX_RIPS = int(os.environ.get("ROUTE_MAX_RIPS", "8"))
MAX_STEPS = int(os.environ.get("ROUTE_MAX_STEPS", "400"))
MAX_SECONDS = float(os.environ.get("ROUTE_MAX_SECONDS", "300"))
rng = random.Random(SEED)
b = pcbnew.LoadBoard(str(SCRIPT_DIR / BOARD))
if b.GetCopperLayerCount() != 4:
    raise RuntimeError("The compact layout requires four copper layers; regenerate its source board.")
print(f"routing {BODY_L:.2f} x {BODY_W:.2f} mm body; grid {G} mm; seed {SEED}; planning clearance {CLR:.3f} mm", flush=True)
S = {"trk": [[0] * (NX * NY) for _ in range(2)], "via": [[0] * (NX * NY) for _ in range(2)], "halo": [[0] * (NX * NY) for _ in range(2)]}
D = {"trk": [dict() for _ in range(2)], "via": [dict() for _ in range(2)], "hole": [dict()]}
HOLE_R = VIA_DRILL + 0.3             # centre-to-centre distance that keeps 0.25 mm+ between any two drilled holes      # cell -> set of unit ids that occupy it
HIST = [dict() for _ in range(2)]
S["hole"] = [0] * (NX * NY)
VIA_AT = {}                          # cell -> net of a committed via (a same-net path may reuse it instead of drilling a neighbour)


def cells_rect(x0, y0, x1, y1):
    for ix in range(max(0, gx(x0) - 1), min(NX - 1, gx(x1) + 1) + 1):
        for iy in range(max(0, gy(y0) - 1), min(NY - 1, gy(y1) + 1) + 1):
            x, y = mm(ix, iy)
            if x0 - 1e-6 <= x <= x1 + 1e-6 and y0 - 1e-6 <= y <= y1 + 1e-6: yield idx(ix, iy)


def cells_disc(cx, cy, r):
    for ix in range(max(0, gx(cx - r) - 1), min(NX - 1, gx(cx + r) + 1) + 1):
        for iy in range(max(0, gy(cy - r) - 1), min(NY - 1, gy(cy + r) + 1) + 1):
            x, y = mm(ix, iy)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9: yield idx(ix, iy)


def cells_seg(x0, y0, x1, y1, r):
    n = max(1, int(math.hypot(x1 - x0, y1 - y0) / (G * 0.8))); out = set()
    for k in range(n + 1):
        out.update(cells_disc(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r))
    return out


def s_claim(name, l, cells, net):
    g = S[name][l]
    for k in cells:
        v = g[k]; g[k] = net if v in (0, net) else -1


# ---- static: keep-outs ----
for ix in range(NX):
    for iy in range(NY):
        x, y = mm(ix, iy); k = idx(ix, iy)
        if x < EDGE - 1e-6 or x > BODY_L - EDGE + 1e-6 or abs(y) > BODY_W / 2 - EDGE + 1e-6:
            for l in (F, B): S["trk"][l][k] = -1; S["via"][l][k] = -1
        elif x > BODY_L - EDGE - 0.35 or x < EDGE + 0.35 or abs(y) > BODY_W / 2 - EDGE - 0.35:
            for l in (F, B): S["via"][l][k] = -1

# ---- static: pads; terminals ----
netname, terms = {}, {}
for fp in sorted(b.GetFootprints(), key=lambda f: f.GetReference()):
    for pad in sorted(fp.Pads(), key=lambda p: p.GetNumber()):
        bb = pad.GetBoundingBox()
        x0, y0, x1, y1 = ToMM(bb.GetLeft()) - OX, ToMM(bb.GetTop()) - OY, ToMM(bb.GetRight()) - OX, ToMM(bb.GetBottom()) - OY
        if x0 > BODY_L + 0.2: continue
        code = pad.GetNetCode() or -1
        layers = tuple(l for l in (F, B) if pad.IsOnLayer(KL[l]))
        for l in layers:
            s_claim("trk", l, cells_rect(x0 - CLR - W_SIG / 2, y0 - CLR - W_SIG / 2, x1 + CLR + W_SIG / 2, y1 + CLR + W_SIG / 2), code)
            s_claim("via", l, cells_rect(x0 - CLR - VIA_D / 2, y0 - CLR - VIA_D / 2, x1 + CLR + VIA_D / 2, y1 + CLR + VIA_D / 2), code)
            s_claim("halo", l, cells_rect(x0 - 0.8, y0 - 0.8, x1 + 0.8, y1 + 0.8), code)
        if len(layers) == 2:
            for k in cells_disc((x0 + x1) / 2, (y0 + y1) / 2, ToMM(pad.GetDrillSize().x) / 2 + VIA_DRILL / 2 + 0.3): S["hole"][k] = 1
        if pad.IsOnLayer(pcbnew.F_Mask) or pad.IsOnLayer(pcbnew.B_Mask):
            for l in layers:
                mask_layer = pcbnew.F_Mask if l == F else pcbnew.B_Mask
                if not pad.IsOnLayer(mask_layer): continue
                expansion = pad.GetSolderMaskExpansion(KL[l])
                opening = pcbnew.SHAPE_POLY_SET()
                pad.TransformShapeToPolygon(opening, KL[l], expansion, FromMM(0.001), pcbnew.ERROR_OUTSIDE)
                margin = VIA_DRILL / 2 + SOLDER_HOLE_GAP
                extent = margin + max(0.0, ToMM(expansion))
                for k in cells_rect(x0 - extent, y0 - extent, x1 + extent, y1 + extent):
                    ix, iy = divmod(k, NY)
                    if opening.Collide(pt(*mm(ix, iy)), FromMM(margin)):
                        S["hole"][k] = 1
        if code < 0: continue
        netname[code] = pad.GetNetname()
        cx, cy = ToMM(pad.GetPosition().x) - OX, ToMM(pad.GetPosition().y) - OY
        candidates = [((mm(ix, iy)[0] - cx) ** 2 + (mm(ix, iy)[1] - cy) ** 2, ix, iy)
                      for ix in range(max(0, gx(x0) - 1), min(NX - 1, gx(x1) + 1) + 1)
                      for iy in range(max(0, gy(y0) - 1), min(NY - 1, gy(y1) + 1) + 1)
                      if x0 - 1e-6 <= mm(ix, iy)[0] <= x1 + 1e-6 and y0 - 1e-6 <= mm(ix, iy)[1] <= y1 + 1e-6]
        if not candidates:
            raise RuntimeError(f"No routing grid point inside {fp.GetReference()}.{pad.GetNumber()} at ({cx:.3f}, {cy:.3f}) mm")
        best = min(candidates)
        terms.setdefault(code, []).append(dict(layers=layers, x=cx, y=cy, cell=(best[1], best[2]), label=f"{fp.GetReference()}.{pad.GetNumber()}", fp=fp.GetReference(), pad=pad))

# ---- static: prong wiring that reaches into the body ----
for t in sorted(b.GetTracks(), key=lambda t: (t.GetNetname(), t.GetLayer(), t.GetStart().x, t.GetStart().y, t.GetEnd().x, t.GetEnd().y)):
    if t.GetClass() == "PCB_VIA": continue
    l = F if t.GetLayer() == pcbnew.F_Cu else B
    x0, y0, x1, y1 = ToMM(t.GetStart().x) - OX, ToMM(t.GetStart().y) - OY, ToMM(t.GetEnd().x) - OX, ToMM(t.GetEnd().y) - OY
    if min(x0, x1) > BODY_L: continue
    code = t.GetNetCode(); netname[code] = t.GetNetname(); w = ToMM(t.GetWidth())
    a, c = (min(x0, BODY_L), y0), (min(x1, BODY_L), y1)
    s_claim("trk", l, cells_seg(*a, *c, w / 2 + CLR + W_SIG / 2), code); s_claim("via", l, cells_seg(*a, *c, w / 2 + CLR + VIA_D / 2), code)
    ex, ey = (x0, y0) if x0 < x1 else (x1, y1)
    if ex <= BODY_L - EDGE + 1e-6:
        terms.setdefault(code, []).append(dict(layers=(l,), x=ex, y=ey, cell=(gx(ex), gy(ey)), label=f"prong{ey:+.2f}", fp="prong", pad=None, stub_width=w))

GND = next(c for c, n in netname.items() if n == "GND")
V5 = next(c for c, n in netname.items() if n == "+5V")
STATIC_TRACKS = []                     # (layer, x0, y0, x1, y1, w, net) created here rather than by the maze search

# ---- static: escape stubs for the fine-pitch chips ----
for code, ts in terms.items():
    for t in ts:
        if t["fp"] not in ("U1", "U4"): continue
        pad = t["pad"]; bb = pad.GetBoundingBox(); fpos = b.FindFootprintByReference(t["fp"]).GetPosition()
        fx, fy = ToMM(fpos.x) - OX, ToMM(fpos.y) - OY
        half = ToMM(max(bb.GetWidth(), bb.GetHeight())) / 2
        if t["layers"] != (F,):
            raise RuntimeError(f"Fine-pitch escape assumes top copper: {t['label']}")
        for reach in (0.5, 0.375, 0.25, 0.125):          # longest stub whose entire centreline clears other nets
            if bb.GetWidth() > bb.GetHeight(): ex, ey = round((t["x"] + math.copysign(half + reach, t["x"] - fx)) / G) * G, t["y"]
            else: ex, ey = t["x"], round((t["y"] + math.copysign(half + reach, t["y"] - fy)) / G) * G
            if all(S["trk"][F][k] in (0, code) for k in cells_seg(t["x"], t["y"], ex, ey, 0.01)): break
        else:
            raise RuntimeError(f"No clear fine-pitch escape for {t['label']} ({netname[code]}); adjust nearby placement")
        STATIC_TRACKS.append((F, t["x"], t["y"], ex, ey, W_SIG, code))
        s_claim("trk", F, cells_seg(t["x"], t["y"], ex, ey, W_SIG / 2 + CLR + W_SIG / 2), code); s_claim("via", F, cells_seg(t["x"], t["y"], ex, ey, W_SIG / 2 + CLR + VIA_D / 2), code)
        t.update(x=ex, y=ey, cell=(gx(ex), gy(ey)), layers=(F,))
# pad-centre -> grid-node stubs for everything else
for code, ts in terms.items():
    for t in ts:
        x, y = mm(*t["cell"])
        if len(t["layers"]) == 1 and (abs(x - t["x"]) > 1e-6 or abs(y - t["y"]) > 1e-6):
            l, w = t["layers"][0], t.get("stub_width", W_SIG)
            STATIC_TRACKS.append((l, t["x"], t["y"], x, y, w, code))
            s_claim("trk", l, cells_seg(t["x"], t["y"], x, y, w / 2 + CLR + W_SIG / 2), code)
            s_claim("via", l, cells_seg(t["x"], t["y"], x, y, w / 2 + CLR + VIA_D / 2), code)

# ---- routing units ----
units = {}                              # uid -> dict(net, kind, terms | term, wide)
for code, ts in terms.items():
    if code in (GND, V5):
        for i, t in enumerate(ts):
            if len(t["layers"]) == 1 and t["layers"][0] == F:
                units[f"{netname[code]}#{t['label']}#{i}"] = dict(net=code, kind="plane", term=t, wide=False)
    elif len(ts) > 1:
        units[netname[code]] = dict(net=code, kind="net", terms=ts, wide=False, fat=netname[code] in WIDE)
unit_net = {u: d["net"] for u, d in units.items()}
termcells = {}
for code, ts in terms.items():
    termcells[code] = {(l, t["cell"][0], t["cell"][1]) for t in ts for l in t["layers"]}
routed = {}                             # uid -> dict(segs=[(l,x0,y0,x1,y1,w)], vias=[(x,y)], marks=[(name,l,k)])


def ok_static(name, l, ix, iy, net):
    if not (0 <= ix < NX and 0 <= iy < NY): return False
    v = S[name][l][idx(ix, iy)]
    return v == 0 or v == net or (name == "trk" and (l, ix, iy) in termcells.get(net, ()))


def foreign(name, l, ix, iy, net):
    occ = D[name][l].get(idx(ix, iy))
    return [u for u in occ if unit_net[u] != net] if occ else []


MOVES = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def search(net, sources, targets, wide, soft, plane=False, uid=None, avoid=(), avoid_via=()):
    tl = sorted(targets)
    if plane or not tl: h = lambda ix, iy: 0.0
    else: h = lambda ix, iy: min(max(abs(ix - a), abs(iy - c)) + 0.4142 * min(abs(ix - a), abs(iy - c)) for (_, a, c) in tl)
    h = functools.lru_cache(maxsize=None)(h)

    @functools.lru_cache(maxsize=None)
    def cell_cost(l, ix, iy):
        """None = impassable, else extra cost."""
        if (l, ix, iy) in avoid or not ok_static("trk", l, ix, iy, net): return None
        fo = foreign("trk", l, ix, iy, net)
        if wide:
            for a, c in N4:
                if not ok_static("trk", l, ix + a, iy + c, net): return None
                fo += foreign("trk", l, ix + a, iy + c, net)
        if any(u in PROTECTED_NETS for u in fo): return None
        if fo and not soft: return None
        return FOREIGN_COST * len(set(fo)) + HIST_W * HIST[l].get(idx(ix, iy), 0)

    @functools.lru_cache(maxsize=None)
    def via_cost(ix, iy):
        if any((l, ix, iy) in avoid or (l, ix, iy) in avoid_via for l in (F, B)): return None
        if S["hole"][idx(ix, iy)]: return None
        if VIA_AT.get(idx(ix, iy)) == net: return 0.0
        holes = D["hole"][0].get(idx(ix, iy), ())
        if uid in holes: return None              # never drill next to our own via
        fo = list(holes)
        for k in (F, B):
            if not (ok_static("via", k, ix, iy, net) and ok_static("trk", k, ix, iy, net)): return None
            fo += foreign("via", k, ix, iy, net) + foreign("trk", k, ix, iy, net)
        if any(u in PROTECTED_NETS for u in fo): return None
        if fo and not soft: return None
        return FOREIGN_COST * len(set(fo))

    dist, prev, pq = {}, {}, []
    best_plane_goal, best_plane_cost = None, float("inf")
    for s in sorted(sources):
        dist[s] = 0.0; heapq.heappush(pq, (h(s[1], s[2]), 0.0, s))
    while pq:
        f, d, s = heapq.heappop(pq)
        if d > dist.get(s, 1e18): continue
        if plane and d >= best_plane_cost: return best_plane_goal, prev
        l, ix, iy = s
        if plane:
            # Actual via/copper, hole, edge and SMD-opening checks determine
            # manufacturability. An extra pad halo can trap valid ground pads.
            if l == F and s not in sources:
                vc = via_cost(ix, iy)
                if vc is not None and d + vc < best_plane_cost:
                    best_plane_goal, best_plane_cost = s, d + vc
        elif s in targets: return s, prev
        for dx, dy, c in MOVES:
            jx, jy = ix + dx, iy + dy
            cc = cell_cost(l, jx, jy)
            if cc is None: continue
            if dx and dy:
                guard_a, guard_b = cell_cost(l, jx, iy), cell_cost(l, ix, jy)
                if guard_a is None or guard_b is None: continue
                if soft: cc += guard_a + guard_b
            nd = d + c * LAYER_COST[l] + cc; ns = (l, jx, jy)
            if nd < dist.get(ns, 1e18): dist[ns] = nd; prev[ns] = s; heapq.heappush(pq, (nd + h(jx, jy), nd, ns))
        if not plane:
            vc = via_cost(ix, iy)
            if vc is not None:
                ns = (1 - l, ix, iy); nd = d + VIA_COST + vc
                if nd < dist.get(ns, 1e18): dist[ns] = nd; prev[ns] = s; heapq.heappush(pq, (nd + h(ix, iy), nd, ns))
    return best_plane_goal, prev


def walk(goal, prev, sources):
    p = [goal]
    while p[-1] not in sources: p.append(prev[p[-1]])
    return p[::-1]


def commit(uid, path, w, plane_via=False):
    r = routed.setdefault(uid, dict(segs=[], vias=[], marks=[]))

    def mark(name, l, cells):
        dd = D[name][l]
        for k in cells: dd.setdefault(k, set()).add(uid); r["marks"].append((name, l, k))

    def seg(run):
        if len(run) < 2: return
        (l, ax, ay), (_, cx, cy) = run[0], run[-1]; a, c = mm(ax, ay), mm(cx, cy)
        r["segs"].append((l, *a, *c, w)); mark("trk", l, cells_seg(*a, *c, w / 2 + CLR + W_SIG / 2)); mark("via", l, cells_seg(*a, *c, w / 2 + CLR + VIA_D / 2))

    def addvia(ix, iy):
        x, y = mm(ix, iy); r["vias"].append((x, y)); VIA_AT[idx(ix, iy)] = unit_net[uid]; r.setdefault("viacells", []).append(idx(ix, iy))
        for l in (F, B): mark("trk", l, cells_disc(x, y, VIA_D / 2 + CLR + W_SIG / 2)); mark("via", l, cells_disc(x, y, VIA_D / 2 + CLR + VIA_D / 2))
        mark("hole", 0, cells_disc(x, y, HOLE_R))

    run = [path[0]]
    for a, c in zip(path, path[1:]):
        if a[0] != c[0]: seg(run); addvia(a[1], a[2]); run = [c]
        else:
            if len(run) >= 2 and (run[-1][1] - run[-2][1], run[-1][2] - run[-2][2]) != (c[1] - a[1], c[2] - a[2]): seg(run); run = [a]
            run.append(c)
    seg(run)
    if plane_via: addvia(path[-1][1], path[-1][2])


def rip(uid, record_history=True):
    r = routed.pop(uid, None)
    if not r: return
    for k in r.get("viacells", []):
        owner = next((other for other, saved in routed.items() if k in saved.get("viacells", [])), None)
        if owner is None: VIA_AT.pop(k, None)
        else: VIA_AT[k] = unit_net[owner]
    for name, l, k in r["marks"]:
        occ = D[name][l].get(k)
        if occ:
            occ.discard(uid)
            if not occ: del D[name][l][k]
        if record_history and name == "trk": HIST[l][k] = HIST[l].get(k, 0) + 1


def blockers(path, net, wide, plane_via=False):
    out = set()
    for a, c in zip(path, path[1:] + [path[-1]]):
        l, ix, iy = a
        out.update(foreign("trk", l, ix, iy, net))
        if wide:
            for p, q in N4: out.update(foreign("trk", l, ix + p, iy + q, net))
        if a[0] == c[0] and ix != c[1] and iy != c[2]:
            for jx, jy in ((c[1], iy), (ix, c[2])):
                out.update(foreign("trk", l, jx, jy, net))
                if wide:
                    for p, q in N4: out.update(foreign("trk", l, jx + p, jy + q, net))
        if a[0] != c[0] or (plane_via and a == path[-1]):
            for k in (F, B): out.update(foreign("via", k, ix, iy, net)); out.update(foreign("trk", k, ix, iy, net))
            if VIA_AT.get(idx(ix, iy)) != net:
                out.update(D["hole"][0].get(idx(ix, iy), ()))
    return out


def route_unit(uid, soft=False):
    """Returns (ok, set of blocking units found in soft mode)."""
    if not soft: return _route_unit(uid, False)
    # A soft multi-branch plan must reserve its own copper and holes too.
    # Roll these provisional reservations back without adding rip-up history.
    if uid in routed: raise RuntimeError("Remove a unit's previous routing before soft planning")
    via_snapshot = dict(VIA_AT)
    try:
        ok, blocked = _route_unit(uid, True)
        return ok, blocked - {uid}
    finally:
        rip(uid, record_history=False)
        VIA_AT.clear(); VIA_AT.update(via_snapshot)


def _route_unit(uid, soft=False):
    u = units[uid]; net = u["net"]; w = W_PWR if u.get("fat") else W_SIG; blk = set()
    if u["kind"] == "plane":
        t = u["term"]; src = {(F, t["cell"][0], t["cell"][1])}
        goal, prev = search(net, src, set(), False, soft, plane=True, uid=uid)
        if goal is None: return False, blk
        path = walk(goal, prev, src)
        if soft: blk |= blockers(path, net, False, plane_via=True)
        commit(uid, path, w, plane_via=True)
        return True, blk
    ts = u["terms"]; kel = KELVIN.get(netname[net]); main_avoid = set(); main_via_avoid = set()
    direct = DIRECT_PAIRS.get(netname[net])
    preferred = None
    if direct:
        start = next(t for t in ts if t["label"] == direct[0])
        preferred = next(t for t in ts if t["label"] == direct[1])
        ts = [start, preferred] + [t for t in ts if t is not start and t is not preferred]
    if kel:
        anchor = next(t for t in ts if t["label"] == kel["anchor"])
        sense = [t for t in ts if t["label"] in kel["sense"]]
        ts = [anchor] + [t for t in ts if t is not anchor and t not in sense]
        # Reserve the short measurement branches before routing the load path.
        # The load may join these branches only inside the actual shunt pad;
        # using an arbitrary radius around its centre is not a Kelvin guarantee.
        ax, ay = anchor["cell"]
        stree = {(l, ax, ay) for l in anchor["layers"]}
        pad_region = pcbnew.SHAPE_POLY_SET(anchor["pad"].GetEffectivePolygon(pcbnew.F_Cu))
        pad_region.Deflate(FromMM(W_PWR / 2), pcbnew.CORNER_STRATEGY_ROUND_ALL_CORNERS, FromMM(0.001))

        def reserve_sense(l, cells):
            for k in cells:
                ix, iy = divmod(k, NY)
                if l != F or not pad_region.Contains(pt(*mm(ix, iy))):
                    main_avoid.add((l, ix, iy))

        for t in sense:
            targets = {(l, t["cell"][0], t["cell"][1]) for l in t["layers"]}
            goal, prev = search(net, stree, targets, False, soft, uid=uid)
            if goal is None:
                if soft: print('   (sense trace for', t['label'], 'has no path)', flush=True)
                return False, blk
            path = walk(goal, prev, stree)
            if soft: blk |= blockers(path, net, False)
            commit(uid, path, W_SIG)
            stree |= set(path)
            for a, c in zip(path, path[1:]):
                if a[0] == c[0]:
                    reserve_sense(a[0], cells_seg(*mm(*a[1:]), *mm(*c[1:]), W_SIG / 2 + CLR + W_PWR / 2))
                    for k in cells_seg(*mm(*a[1:]), *mm(*c[1:]), W_SIG / 2 + CLR + VIA_D / 2):
                        ix, iy = divmod(k, NY); main_via_avoid.add((a[0], ix, iy))
                else:
                    for l in (F, B):
                        reserve_sense(l, cells_disc(*mm(*a[1:]), VIA_D / 2 + CLR + W_PWR / 2))
                        for k in cells_disc(*mm(*a[1:]), VIA_D + CLR):
                            ix, iy = divmod(k, NY); main_via_avoid.add((l, ix, iy))
            # Also protect the fixed IC escape stub and its pad, which are
            # outside the maze path and must never become a load junction.
            pad = t["pad"]; pos = pad.GetPosition(); bb = pad.GetBoundingBox()
            reserve_sense(F, cells_seg(ToMM(pos.x) - OX, ToMM(pos.y) - OY, *mm(*t["cell"]), W_SIG / 2 + CLR + W_PWR / 2))
            reserve_sense(F, cells_rect(ToMM(bb.GetLeft()) - OX - CLR - W_PWR / 2,
                                       ToMM(bb.GetTop()) - OY - CLR - W_PWR / 2,
                                       ToMM(bb.GetRight()) - OX + CLR + W_PWR / 2,
                                       ToMM(bb.GetBottom()) - OY + CLR + W_PWR / 2))
            for k in cells_seg(ToMM(pos.x) - OX, ToMM(pos.y) - OY, *mm(*t["cell"]), W_SIG / 2 + CLR + VIA_D / 2):
                ix, iy = divmod(k, NY); main_via_avoid.add((F, ix, iy))
            for k in cells_rect(ToMM(bb.GetLeft()) - OX - CLR - VIA_D / 2,
                                ToMM(bb.GetTop()) - OY - CLR - VIA_D / 2,
                                ToMM(bb.GetRight()) - OX + CLR + VIA_D / 2,
                                ToMM(bb.GetBottom()) - OY + CLR + VIA_D / 2):
                ix, iy = divmod(k, NY); main_via_avoid.add((F, ix, iy))
    tree = {(l, ts[0]["cell"][0], ts[0]["cell"][1]) for l in ts[0]["layers"]}; todo = ts[1:]
    while todo:
        candidates = [preferred] if preferred is not None else todo
        targets = {(l, t["cell"][0], t["cell"][1]) for t in candidates for l in t["layers"]}
        goal, prev = search(net, tree, targets, u["wide"], soft, uid=uid, avoid=main_avoid, avoid_via=main_via_avoid)
        if goal is None:
            if soft: print(f"   ({uid}: no main path to {[t['label'] for t in todo]}; explored {len(prev)} states)", flush=True)
            return False, blk
        path = walk(goal, prev, tree)
        if soft: blk |= blockers(path, net, u["wide"])
        commit(uid, path, w)
        tree |= set(path)
        hit = [t for t in todo if t["cell"] == (goal[1], goal[2]) and goal[0] in t["layers"]]
        if preferred in hit: preferred = None
        for t in hit: tree |= {(l, t["cell"][0], t["cell"][1]) for l in t["layers"]}
        todo = [t for t in todo if t not in hit]
    return True, blk


def span(u):
    ts = units[u]["terms"] if units[u]["kind"] == "net" else [units[u]["term"]]
    return (max(t["x"] for t in ts) - min(t["x"] for t in ts)) + (max(t["y"] for t in ts) - min(t["y"] for t in ts))


t_start = time.time()
# Seed 0 is the stable baseline. Other seeds vary the order within each priority
# class, without changing geometry or manufacturing rules.
jitter_span = float(os.environ.get("ROUTE_JITTER", "6.0"))
priority_jitter = {u: rng.uniform(-jitter_span, jitter_span) if SEED else 0.0 for u in sorted(units)}
def routing_priority(uid):
    u = units[uid]
    if uid == "+5V": return 0
    if u["kind"] == "plane" and u["term"]["label"] in LOCAL_GROUNDS: return 1
    if uid in CRITICAL_NETS: return 2
    return 3 if u["kind"] == "plane" else 4

queue = sorted(units, key=lambda u: (routing_priority(u), span(u) + priority_jitter[u], u))
rips, steps, stuck, retry_passes = {}, 0, [], 0
while steps < MAX_STEPS and time.time() - t_start < MAX_SECONDS:
    if not queue:
        missing_now = [u for u in units if u not in routed]
        if not missing_now or retry_passes >= 3: break
        retry_passes += 1
        queue = sorted(missing_now, key=lambda u: (routing_priority(u), span(u), u))
        print(f"  retry pass {retry_passes}: {len(queue)} incomplete units", flush=True)
    uid = queue.pop(0); steps += 1
    if steps % 10 == 0:
        print(f"  step {steps}: routing {uid}, queue {len(queue)}, routed {len(routed)}/{len(units)}, {time.time() - t_start:.0f} s", flush=True)
    ok, _ = route_unit(uid)
    if ok: continue
    rip(uid)                                           # drop any partial tree
    ok, blk = route_unit(uid, soft=True)
    if not ok or not blk:
        stuck.append(uid); continue                    # blocked by static copper: a placement problem, not congestion
    for v in sorted(blk): rip(v)
    ok, _ = route_unit(uid)
    if not ok:
        rip(uid); stuck.append(uid)
    for v in sorted(blk):
        rips[v] = rips.get(v, 0) + 1
        if rips[v] > MAX_RIPS: stuck.append(v)
        else: queue.append(v)

missing = [u for u in units if u not in routed]
print(f"routed {len(routed)}/{len(units)} units in {steps} steps, {time.time() - t_start:.0f} s; rip-ups: {sum(rips.values())}")
if missing: print("NOT ROUTED:", missing, "| stuck:", stuck)


# ---- write copper to the board ----
def add_track(l, x0, y0, x1, y1, w, code):
    if math.hypot(x1 - x0, y1 - y0) < 1e-6: return
    t = pcbnew.PCB_TRACK(b); t.SetStart(pt(x0, y0)); t.SetEnd(pt(x1, y1)); t.SetWidth(FromMM(w)); t.SetLayer(KL[l]); t.SetNetCode(code); b.Add(t)


for l, x0, y0, x1, y1, w, code in STATIC_TRACKS: add_track(l, x0, y0, x1, y1, w, code)
seen_vias = set()
for uid, r in routed.items():
    code = unit_net[uid]
    for l, x0, y0, x1, y1, w in r["segs"]: add_track(l, x0, y0, x1, y1, w, code)
    for x, y in r["vias"]:
        if (round(x, 3), round(y, 3)) in seen_vias: continue
        seen_vias.add((round(x, 3), round(y, 3)))
        v = pcbnew.PCB_VIA(b); v.SetPosition(pt(x, y)); v.SetWidth(pcbnew.F_Cu, FromMM(VIA_D)); v.SetDrill(FromMM(VIA_DRILL)); v.SetNetCode(code); v.Padstack().SetUnconnectedLayerMode(pcbnew.UNCONNECTED_LAYER_MODE_REMOVE_EXCEPT_START_AND_END); b.Add(v)

# The inner planes stop at the body, leaving needle copper on F.Cu/B.Cu only.
for layer, name, plane_net in ((pcbnew.F_Cu, "GND top fill", GND),
                               (pcbnew.In1_Cu, "Dedicated ground plane", GND),
                               (pcbnew.In2_Cu, "Dedicated 5V plane", V5),
                               (pcbnew.B_Cu, "GND bottom fill", GND)):
    z = pcbnew.ZONE(b); z.SetLayer(layer); z.SetNetCode(plane_net); z.SetZoneName(name)
    ol = z.Outline(); ol.NewOutline()
    pour_y = BODY_W / 2 - 0.3
    for x, y in ((0.3, -pour_y), (BODY_L - 0.3, -pour_y), (BODY_L - 0.3, pour_y), (0.3, pour_y)): ol.Append(FromMM(OX + x), FromMM(OY + y))
    z.SetLocalClearance(FromMM(0.2)); z.SetMinThickness(FromMM(0.2))
    z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)   # drop copper islands that reach no pad or via
    z.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)          # solid joins: no starved thermal spokes on the tiny ground pads
    b.Add(z)
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard(str(SCRIPT_DIR / OUT), b)
print("saved", OUT, "| tracks", sum(1 for t in b.GetTracks() if t.GetClass() != "PCB_VIA"), "vias", sum(1 for t in b.GetTracks() if t.GetClass() == "PCB_VIA"))
sys.exit(1 if missing else 0)
