"""Compact Nano-sized heat-pulse SDI-12 sensor, r2 - PCB generator: outline, placement and prong wiring. route_body.py then routes the body and pours the ground plane.

Run:  D:\KiCAD\bin\python.exe gen_pcb.py 12G      (after gen_schematic.py, which writes netlist.json)
Board frame (mm): x = 0 at the cable end ... BODY_L at the prong roots, +x towards the tips; y = 0 on the centre line.

The prongs slide into STOCK tri-bevel piercing needles (3 inch for all three needles) which are then filled with
epoxy. Everything is on the TOP side (cheapest assembly). The first EMBED mm of each prong sits inside the cast body: no heater there.
"""
import json, os, sys, math, pcbnew
from pathlib import Path
os.chdir(Path(__file__).resolve().parent)
from pcbnew import VECTOR2I, FromMM

# Stock needle bores (Birmingham gauge, regular wall). prong_w / board_t chosen so board + soldered parts clear the bore with margin.
NEEDLES = {
    "12G": dict(od=2.77, bore=2.16, prong_w=1.4, board_t=0.8, th2_on_prong=True),
}
GAUGE = sys.argv[1] if len(sys.argv) > 1 else "12G"
if GAUGE != "12G":
    raise SystemExit("The flat-nano variant preserves the current 12G sensor configuration only.")
ND = NEEDLES[GAUGE]
# Tri-bevel piercing needles: the open bevel is ~4.5 x OD long and must not contain any electronics. Keep HEADSPACE mm clear before it.
# All three needles are 3 inch. The existing prong geometry and assumed bevel clearance are preserved.
NEEDLE_LEN_HEATER, NEEDLE_LEN_SIDE, HEADSPACE = 76.2, 76.2, 5.0     # one box of 12G x 3 inch does all three needles
BEVEL = ND["od"] / math.tan(math.radians(15))      # 15 degree tri-bevel (user measured)
USABLE_HEATER, USABLE_SIDE = NEEDLE_LEN_HEATER - BEVEL - HEADSPACE, NEEDLE_LEN_SIDE - BEVEL - HEADSPACE

NL = json.load(open("netlist.json"))
N, PITCH = NL["n_heat"], NL["pitch"]
BOARD_T, PRONG_W = ND["board_t"], ND["prong_w"]
HEATER_PRONG_W = 1.4  # +0.2 mm routed-width tolerance still accommodates 0603 maximum body and insulation.
BODY_L, BODY_W = 43.18, 17.78
SPACING, TIP_L = 8.0, 0.6                    # blunt chamfer only - the steel needle does the piercing
EMBED = 8.0                                  # prong + needle length buried in the epoxy body
ROOT_HW, FLARE_L = 1.2, 1.5                  # each prong flares to 2*ROOT_HW (2.4 mm) at the body junction, tapering to its own
                                             # width over FLARE_L mm. Buried in the epoxy head, monotonic (adds no new neck), and
                                             # short enough to leave straight prong for the needle back-end. Answers JLC's >=2 mm tab.
HEATER_FIRST_Z = 8.8
Z0 = HEATER_FIRST_Z - 0.8
HEATED = (N - 1) * PITCH + 1.6               # 0603 nominal body length.
TH_Z = 29.8                                 # Preserve the released side-thermistor locations.
LANE, LANE_W, RET_W = 0.43, 0.127, 0.3
VIA_D, VIA_DRILL = 0.6, 0.35                  # Body/side vias; three center-prong vias use 0.50/0.30 mm.
FP_DIR = r"D:\KiCAD\share\kicad\footprints"
OX, OY = 100.0, 80.0
LOCAL_FP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hp_sensor.pretty")

# ---- body placement. All assembly components are on the top side; dimensions are in mm.
PLACE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "placement.json")))

NOT_FITTED = {"J1", "J2", "J5"}     # bare copper features: nothing is soldered there
b = pcbnew.BOARD()
b.SetCopperLayerCount(4)
ds = b.GetDesignSettings()
ds.SetBoardThickness(FromMM(BOARD_T))
ds.m_CopperEdgeClearance = FromMM(0.2); ds.m_NetSettings.GetDefaultNetclass().SetClearance(FromMM(0.127))
ds.m_MinClearance = FromMM(0.127); ds.m_TrackMinWidth = FromMM(0.10); ds.m_ViasMinSize = FromMM(.50); ds.m_MinThroughDrill = FromMM(.30)
ds.m_HoleClearance = FromMM(0.2); ds.m_ViasMinAnnularWidth = FromMM(0.1)
ds.m_SolderMaskMinWidth = FromMM(0.1)
ds.m_SolderMaskToCopperClearance = FromMM(0.09)
pt = lambda x, y: VECTOR2I(FromMM(OX + x), FromMM(OY + y))
_nets = {}


def net(name):
    if name not in _nets:
        _nets[name] = pcbnew.NETINFO_ITEM(b, name); b.Add(_nets[name])
    return _nets[name]


def place(ref, x, y, rot=0, side="F"):
    info = NL["parts"][ref]; lib, name = info["footprint"].split(":")
    fp = pcbnew.FootprintLoad(LOCAL_FP if lib == "hp_sensor" else os.path.join(FP_DIR, lib + ".pretty"), name)
    if fp is None: raise SystemExit(f"{ref}: footprint {info['footprint']} not found")
    fp.SetReference(ref); fp.SetValue(info["value"]); fp.SetPosition(pt(x, y)); b.Add(fp)
    if side == "B": fp.Flip(pt(x, y), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
    fp.SetOrientationDegrees(rot); fp.Value().SetVisible(False); fp.Reference().SetVisible(False)      # tiny board: no reference text on the silkscreen
    if ref in NOT_FITTED: fp.SetAttributes(fp.GetAttributes() | pcbnew.FP_EXCLUDE_FROM_POS_FILES | pcbnew.FP_EXCLUDE_FROM_BOM)
    for pad in fp.Pads():
        n = info["pins"].get(pad.GetNumber())
        if n: pad.SetNet(net(n))
    return fp


def pad_xy(fp, num):
    p = fp.FindPadByNumber(str(num)).GetPosition()
    return pcbnew.ToMM(p.x) - OX, pcbnew.ToMM(p.y) - OY


def track(pts, netname, layer=pcbnew.F_Cu, w=LANE_W):
    for a, c in zip(pts, pts[1:]):
        t = pcbnew.PCB_TRACK(b); t.SetStart(pt(*a)); t.SetEnd(pt(*c)); t.SetWidth(FromMM(w)); t.SetLayer(layer); t.SetNet(net(netname)); b.Add(t)


def via(x, y, netname, diameter=VIA_D, drill=VIA_DRILL):
    v = pcbnew.PCB_VIA(b); v.SetPosition(pt(x, y)); v.SetWidth(pcbnew.F_Cu, FromMM(diameter)); v.SetDrill(FromMM(drill)); v.SetNet(net(netname)); v.Padstack().SetUnconnectedLayerMode(pcbnew.UNCONNECTED_LAYER_MODE_REMOVE_EXCEPT_START_AND_END); b.Add(v)


def outline(prongs):
    L, W = BODY_L, BODY_W / 2
    pts = [(0, -W), (L, -W)]
    for yc, pl in prongs:
        hw = (HEATER_PRONG_W if yc == 0 else PRONG_W) / 2
        rhw = max(ROOT_HW, hw)     # flare only widens the root; the finger keeps its needle-fit width
        lo, hi = yc - rhw, yc + rhw
        if hi > W: lo, hi = W - 2 * rhw, W      # outer prongs: outer root edge flush with the body edge,
        if lo < -W: lo, hi = -W, -W + 2 * rhw   # the flare goes inward only (root stays 2*ROOT_HW wide)
        pts += [(L, lo), (L + FLARE_L, yc - hw), (L + pl - TIP_L, yc - hw), (L + pl, yc - hw + TIP_L * 0.5),
                (L + pl, yc + hw - TIP_L * 0.5), (L + pl - TIP_L, yc + hw), (L + FLARE_L, yc + hw), (L, hi)]
    pts += [(L, W), (0, W)]
    for a, c in zip(pts, pts[1:] + pts[:1]):
        if a == c: continue
        s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_SEGMENT); s.SetLayer(pcbnew.Edge_Cuts)
        s.SetStart(pt(*a)); s.SetEnd(pt(*c)); s.SetWidth(FromMM(0.1)); b.Add(s)


def side_thermistor(ref, yc, z):
    """Sensing prong: top trace straight down the centre to pad 1; pad 2 -> via just beyond the part -> bottom centre trace back.
    No trace ever has to pass a via, so this works on the narrowest prong."""
    fp = place(ref, BODY_L + z, yc, 0, "F")
    (x1, _), (x2, _) = pad_xy(fp, 1), pad_xy(fp, 2)
    n1, n2 = NL["parts"][ref]["pins"]["1"], NL["parts"][ref]["pins"]["2"]
    track([(BODY_L - 1.0, yc), (x1, yc)], n1, pcbnew.F_Cu, 0.2)
    via(x2 + 0.85, yc, n2); track([(x2, yc), (x2 + 0.85, yc)], n2, pcbnew.F_Cu, 0.2)
    track([(x2 + 0.85, yc), (BODY_L - 1.0, yc)], n2, pcbnew.B_Cu, 0.2)
    return z + 0.5 + 0.85 + VIA_D / 2


def tip_thermistor(ref, yc, z):
    """Heater prong tip: both traces on the bottom copper either side of the heater return, one via at each end of the part."""
    fp = place(ref, BODY_L + z, yc, 0, "F")
    (x1, _), (x2, _) = pad_xy(fp, 1), pad_xy(fp, 2)
    n1, n2 = NL["parts"][ref]["pins"]["1"], NL["parts"][ref]["pins"]["2"]
    for vx, px, n, lane in ((x1 - 0.85, x1, n1, -LANE), (x2 + 0.85, x2, n2, LANE)):
        via(vx, yc, n, .50, .30); track([(vx, yc), (px, yc)], n, pcbnew.F_Cu, 0.2)
        entry_lane = math.copysign(.55, lane)
        track([(BODY_L - 1.0, yc + entry_lane),
               (BODY_L - 1.0 + abs(entry_lane - lane), yc + lane),
               (vx, yc + lane), (vx, yc)], n, pcbnew.B_Cu, .10)
    return z + 0.5 + 0.85 + VIA_D / 2


# ---- prong geometry ----
heater_end = Z0 + HEATED
ret_via_z = 51.95                            # 0.275 mm hole-to-heater mask opening clearance (zero pad expansion).
th2_z = 54.08                                # Preserve TH2 and all prong lengths.
HEAT_L = (th2_z + 0.5 + 0.85 + VIA_D / 2 if ND["th2_on_prong"] else ret_via_z + VIA_D / 2) + 0.35 + TIP_L
SIDE_L = TH_Z + 0.5 + 0.85 + VIA_D / 2 + 0.35 + TIP_L
last_heater_part = (th2_z + 0.5 + 0.85 + VIA_D / 2) if ND["th2_on_prong"] else ret_via_z + VIA_D / 2
last_side_part = TH_Z + 0.5 + 0.85 + VIA_D / 2
if last_heater_part > USABLE_HEATER + 1e-6: raise SystemExit(f"heater prong electronics end at {last_heater_part:.1f} mm but only {USABLE_HEATER:.1f} mm is usable")
if last_side_part > USABLE_SIDE + 1e-6: raise SystemExit(f"side thermistor ends at {last_side_part:.1f} mm but only {USABLE_SIDE:.1f} mm of the sensing needle is usable - reduce EMBED")
outline([(-SPACING, SIDE_L), (0.0, HEAT_L), (SPACING, SIDE_L)])

for ref, (x, y, rot, side) in PLACE.items():
    place(ref, x, y, rot, side)
missing = [r for r in NL["parts"] if r not in PLACE and not r.startswith(("RH", "TH1", "TH2", "TH3"))]
if missing: raise SystemExit(f"no placement for: {missing}")

# ---- heater: single chain on the top side, return on the bottom centre line ----
fps = [place(f"RH{i + 1}", BODY_L + HEATER_FIRST_Z + i * PITCH, 0, 0, "F") for i in range(N)]
for f1, f2, i in zip(fps, fps[1:], range(1, N)):
    track([pad_xy(f1, 2), pad_xy(f2, 1)], f"H_{i}", pcbnew.F_Cu, 0.3)
track([(BODY_L - 1.0, 0), (pad_xy(fps[0], 1)[0], 0)], "HEAT_P", pcbnew.F_Cu, 0.3)
# Keep the unfilled return-via hole 0.275 mm beyond RH17's mask opening.
return_via_x = BODY_L + ret_via_z
track([(pad_xy(fps[-1], 2)[0], 0), (return_via_x, 0)], "HEAT_RTN", pcbnew.F_Cu, 0.3)
via(return_via_x, 0, "HEAT_RTN", .50, .30)
track([(return_via_x, 0), (BODY_L - 1.0, 0)], "HEAT_RTN", pcbnew.B_Cu, RET_W)

if ND["th2_on_prong"]: tip_thermistor("TH2", 0.0, th2_z)
side_thermistor("TH1", -SPACING, TH_Z)
side_thermistor("TH3", SPACING, TH_Z)

# ---- silkscreen: all text is on the BOTTOM (no parts there), mirrored so it reads correctly from that side ----
LABELS = [("12V", 4.9, -4.0), ("SDI", 4.9, 0.0), ("GND", 4.9, 4.0),
          ("5V", 3.75, 5.7), ("D-", 6.29, 5.7), ("D+", 8.83, 5.7), ("G", 11.37, 5.7), ("B", 13.91, 5.7),
          ("G 5V IO CK RS", 8.8, -5.7), ("HP-NANO r2", 27.0, 0.0)]
for s, x, y in LABELS:
    t = pcbnew.PCB_TEXT(b); t.SetText(s); t.SetPosition(pt(x, y)); t.SetLayer(pcbnew.B_SilkS); t.SetMirrored(True)
    t.SetTextSize(VECTOR2I(FromMM(1.0), FromMM(1.0))); t.SetTextThickness(FromMM(0.15)); b.Add(t)
for layer in (pcbnew.B_SilkS,):
    for yc in (-SPACING, 0.0, SPACING):
        s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_SEGMENT); s.SetLayer(layer); s.SetWidth(FromMM(0.12))
        s.SetStart(pt(BODY_L + EMBED, yc - 0.3)); s.SetEnd(pt(BODY_L + EMBED, yc + 0.3)); b.Add(s)


def bore_margin(h, part_w, pcb_w, pcb_t):
    """Vertical clearance at the upper component corners with PCB resting in the stated bore; no insulation included."""
    r = ND["bore"] / 2; yb = -math.sqrt(r * r - pcb_w ** 2 / 4)
    return math.sqrt(r * r - (part_w / 2) ** 2) - (yb + pcb_t + h)


out = "hp_sensor.kicad_pcb" if GAUGE == "12G" else f"hp_sensor_{GAUGE}.kicad_pcb"
pcbnew.SaveBoard(out, b)
from configure_fabrication import configure_file
configure_file(out)
print(f"{out}: {GAUGE} needle (OD {ND['od']}, minimum specified bore {ND['bore']}) | heater prong {HEATER_PRONG_W} x {BOARD_T} mm; sides {PRONG_W} mm")
print(f"  heater worst PCB + package corner clearance before insulation: {bore_margin(.65, .95, HEATER_PRONG_W + .2, BOARD_T + .1):.3f} mm; verify insulated dry fit")
print(f"  bevel assumed {BEVEL:.1f} mm + {HEADSPACE} mm headspace -> usable length: heater needle {USABLE_HEATER:.1f} of {NEEDLE_LEN_HEATER}, sensing needles {USABLE_SIDE:.1f} of {NEEDLE_LEN_SIDE}")
print(f"  embed {EMBED} mm | heater {N} x 0603, z = {Z0:.1f}-{heater_end:.1f} ({HEATED:.1f} mm heated) | side thermistors z = {TH_Z:.1f} (electronics end {last_side_part:.1f}) | heater-prong electronics end {last_heater_part:.1f}")
print(f"  PCB prongs: heater {HEAT_L:.1f} mm, side {SIDE_L:.1f} mm | exposed needle: heater {NEEDLE_LEN_HEATER - EMBED:.1f} mm, sensing {NEEDLE_LEN_SIDE - EMBED:.1f} mm")
