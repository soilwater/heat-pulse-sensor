"""Hand-planned copper for the whole compact-hat body: every trace and via is drawn here deliberately (no auto-router).

Run:  D:\\KiCAD\\bin\\python.exe preroute.py        (after gen_pcb.py 12G)
Reads hp_hat.kicad_pcb, writes hp_hat_routed.kicad_pcb.
Coordinates are body-frame mm: x from the cable end, y from the center line (KiCad y down).

The body is exactly the Arduino Nano R4 outline (43.18 x 17.78 mm) with the Nano's two pin rows. Parts sit on both
sides: the top (F) side faces the Nano, the bottom (B) side faces outward into the potting.
Layout rules applied here:
  * every trace that carries heater or battery current is >= PWR (0.5 mm) on the outer layers, with no narrower neck
    anywhere; the heater supply (VIN_P) and the Nano supply (NANO_VIN) run inside the board on In2 as PWR_IN (1.2 mm)
    strips, which on JLC04081H-7628's 0.5 oz inner copper (15.2 um) have more cross-section than 0.5 mm of 1 oz outer
    copper. Keeping both off the outer layers leaves the center line free for the signals that must cross it;
  * every part that dissipates more than 2 mW (D1, R18, R5, Q1) sits on the center line;
  * the three needles are exact mirror images (y -> -y), both side-needle wires enter the body alike, and the copper
    of every layer is balanced left/right (checks/check_quality.py requires each layer's two halves to agree within 10%);
  * signals run straight or at 45 degrees; a via is used only where a signal has to change layer.
"""
import os, pcbnew
from pcbnew import FromMM, VECTOR2I

HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
OX, OY = 100.0, 80.0
BODY_L, BODY_W = 43.18, 17.78
LANE_SPLIT = 35.18                        # the two TH2 lanes separate here, clear of the MOSFET drain pad
PWR = 0.5
PWR_IN = 1.2                              # inner-layer power strip (0.5 oz): 1.2 mm x 15.2 um >= 0.5 mm x 35 um
SIG = 0.2
LAYER = {"F": pcbnew.F_Cu, "B": pcbnew.B_Cu, "In2": pcbnew.In2_Cu}
VIA_D, VIA_DRILL = 0.6, 0.35

b = pcbnew.LoadBoard("hp_hat.kicad_pcb")
pt = lambda x, y: VECTOR2I(FromMM(OX + x), FromMM(OY + y))


def net(name):
    ni = b.FindNet(name)
    if ni is None: raise SystemExit(f"unknown net {name}")
    return ni


def T(name, layer, w, *pts):
    for a, c in zip(pts, pts[1:]):
        t = pcbnew.PCB_TRACK(b); t.SetStart(pt(*a)); t.SetEnd(pt(*c)); t.SetWidth(FromMM(w))
        t.SetLayer(LAYER[layer]); t.SetNet(net(name)); b.Add(t)


def V(name, x, y, d=VIA_D, drill=VIA_DRILL):
    v = pcbnew.PCB_VIA(b); v.SetPosition(pt(x, y)); v.SetWidth(pcbnew.F_Cu, FromMM(d)); v.SetDrill(FromMM(drill))
    v.SetNet(net(name)); v.Padstack().SetUnconnectedLayerMode(pcbnew.UNCONNECTED_LAYER_MODE_REMOVE_EXCEPT_START_AND_END); b.Add(v)


def pad(ref, num):
    p = b.FindFootprintByReference(ref).FindPadByNumber(str(num)).GetPosition()
    return round(pcbnew.ToMM(p.x) - OX, 4), round(pcbnew.ToMM(p.y) - OY, 4)


J = lambda row, k: (3.81 + 2.54 * (k - 1), 7.62 if row == "J3" else -7.62)       # Nano pin k of J3 (digital) / J4 (analog)

# ================================ supply input (bottom): J1 -> D1 (reverse protection) -> VIN_P ======================
j1 = pad("J1", 1); d1a, d1k = pad("D1", 2), pad("D1", 1)
T("VIN", "B", PWR, j1, d1a)                                              # straight down the axis
T("VIN", "B", PWR, (8.1, 0.9), (9.1, 1.9), pad("D2", 1))                # surge clamp D2 at the input
vin_via = (13.5, 0.0)                                                    # D1 stays 1.3 mm from the 12 V cable hole
T("VIN_P", "B", PWR, d1k, pad("C1", 1)); V("VIN_P", *vin_via)          # D1 -> 4.7 uF (bottom) and the In2 take-off
T("VIN_P", "F", PWR, vin_via, pad("C3", 1))                              # 22 uF bulk on the top side
c1g, c3g = pad("C1", 2), pad("C3", 2)
T("GND", "F", PWR, c3g, (c3g[0], -1.5)); V("GND", c3g[0], -1.5)          # both input capacitors share one ground via
T("GND", "B", PWR, c1g, (c3g[0], -1.125), (c3g[0], -1.5))
# heater and Nano supply: along the axis inside the board (In2) to the shunt R5 (top) and the Nano feed resistor R18 (bottom)
r5a, r5b = pad("R5", 1), pad("R5", 2)
feed = (30.3, 0.0)                                                        # between R18 (bottom) and the shunt (top)
T("VIN_P", "In2", PWR_IN, vin_via, feed); V("VIN_P", *feed)
T("VIN_P", "F", PWR, feed, r5a)
T("VIN_P", "B", PWR, feed, pad("R18", 1))
# Nano VIN: R18 -> via -> In2 strip along the J4 row to the Nano VIN pin J4.15
r18n = pad("R18", 2); nv = (25.975, -1.1)
T("NANO_VIN", "B", PWR, r18n, nv); V("NANO_VIN", *nv)
T("NANO_VIN", "In2", PWR_IN, (nv[0], -1.4), (nv[0], -5.95), (38.3, -5.95), (39.37, -7.02), J("J4", 15))

# ================================ heater: R5 -> heater prong (F.Cu axis), return (B.Cu axis) -> Q1 ======================
T("HEAT_P", "F", PWR, r5b, (BODY_L - 1.0, 0.0))
T("HEAT_RTN", "B", PWR, (BODY_L - 1.0, 0.0), pad("Q1", 3))
qs = pad("Q1", 2)
T("GND", "B", PWR, qs, (qs[0], -1.9)); V("GND", qs[0], -1.9)             # MOSFET source -> ground plane
# Kelvin sense: taps on the north edge of the shunt pads (the load current enters and leaves on the axis), each one via
# down to the power monitor U4 on the bottom side
T("VIN_P", "F", SIG, (30.95, -0.5), (30.95, -1.55)); V("VIN_P", 30.95, -1.55)
T("VIN_P", "B", SIG, (30.95, -1.55), (30.95, -2.6))                       # -> U4 IN+ (pin 10)
T("HEAT_P", "F", SIG, (33.35, -0.5), (33.35, -1.55)); V("HEAT_P", 33.35, -1.55)
T("HEAT_P", "B", SIG, (33.35, -1.55), (33.35, -2.6), (32.85, -3.1), pad("U4", 9))   # -> U4 IN- (pin 9)
T("HEAT_P", "B", SIG, (31.1, -3.1), (31.1, -3.6))                          # VBUS (pin 8) joins IN- at the pad ends
# U4 supply and ground: VS -> C12 -> +5V via; GND pin 7 -> C12 -> ground via; address pins A0/A1 tied to ground
c12v, c12g = pad("C12", 1), pad("C12", 2)
T("+5V", "B", 0.3, pad("U4", 6), (c12v[0], -4.6))
T("+5V", "B", 0.3, c12v, (33.2, c12v[1])); V("+5V", 33.2, c12v[1])
T("+5V", "B", 0.3, J("J4", 12), (31.75, -6.72), (32.3, -6.17), c12v)     # Nano 5 V pin -> U4 supply
T("GND", "B", 0.3, pad("U4", 7), (c12g[0], -4.1))
T("GND", "B", 0.3, c12g, (33.42, c12g[1]), (33.9, -4.35)); V("GND", 33.9, -4.35)
T("GND", "B", 0.3, (25.7, -2.6), (25.7, -3.1))
# gate: D9 arrives on the top side, drops through one via to R9; R10 pull-down beside the gate
T("D9_HEAT", "F", SIG, J("J3", 4), (11.43, 6.72), (11.95, 6.2), (27.8, 6.2)); V("D9_HEAT", 27.8, 6.2)
r9d, r9g, r10g, r10z = pad("R9", 1), pad("R9", 2), pad("R10", 1), pad("R10", 2)
T("D9_HEAT", "B", SIG, (27.8, 6.2), (27.8, 4.1), (r9d[0], r9d[1] + 0.01))
T("HEAT_GATE", "B", SIG, r9g, r10g, (r10g[0], 1.0))                       # -> gate pad from the south
T("GND", "B", 0.3, r10z, (33.3, r10z[1])); V("GND", 33.3, r10z[1])

# ================================ SDI-12 (top side): protection at the cable, series resistor R3 ====================
T("SDI_LINE", "F", 0.25, pad("J1", 2), (8.5, 5.0), pad("R3", 1))          # through D4, C4, R4 to R3
T("GND", "F", 0.3, pad("D4", 2), (9.4, 2.9)); V("GND", 9.4, 2.9)
T("GND", "F", 0.3, pad("C4", 2), (11.72, 3.2), (12.84, 3.2), pad("R4", 2)); V("GND", 12.28, 3.2)
T("D2_SDI12", "F", SIG, pad("R3", 2), (28.4, 5.0), (29.21, 5.81), J("J3", 11))

# ================================ thermistor excitation (bottom): D4 -> R11 -> VREF bus =============================
T("D4_EXC", "B", SIG, J("J3", 9), (24.13, 1.4), (21.4, -1.33))
# divider bank under the analog pins: pin -> capacitor -> reference resistor, straight down each column
for k, n in ((4, "A0_TH3"), (5, "A1_TH2"), (6, "A2_TH1"), (7, "A3_TH4")):
    x = J("J4", k)[0]
    T(n, "B", SIG, J("J4", k), (x, -4.325))
T("VREF", "B", SIG, (11.43, -2.675), (19.05, -2.675))                     # bus through the four reference resistors
T("VREF", "B", SIG, (11.43, -2.675), (9.7, -2.675), (9.7, -6.81), J("J4", 3))    # -> Nano AREF
T("VREF", "B", SIG, (19.05, -2.675), (19.05, -1.95), (21.4, -1.95))       # -> R11
T("VREF", "B", SIG, (19.42, -1.95), pad("C13", 1))                        # -> C13
T("A3_TH4", "B", SIG, (19.05, -4.325), (19.84, -4.325), (20.35, -3.815))  # on-board thermistor TH4
T("GND", "B", 0.3, pad("TH4", 2), (21.91, -2.79), (22.4, -2.3)); V("GND", 22.4, -2.3)

# ================================ I2C to the power monitor U4 (bottom), pull-ups on the top side ======================
T("A4_SDA", "B", SIG, J("J4", 8), (21.59, -6.72), (24.21, -4.1), pad("U4", 4))
T("A5_SCL", "B", SIG, J("J4", 9), (24.13, -6.72), (26.25, -4.6))
T("A4_SDA", "F", SIG, J("J4", 8), pad("R6", 2))
T("A5_SCL", "F", SIG, J("J4", 9), pad("R7", 2))
T("+5V", "F", 0.3, pad("R6", 1), pad("R7", 1)); V("+5V", 22.86, -4.57)
c17v, c17g = pad("C17", 1), pad("C17", 2)
T("+5V", "B", 0.3, c17v, (c17v[0], 3.4)); V("+5V", c17v[0], 3.4)
T("GND", "B", 0.3, c17g, (c17g[0], 3.4)); V("GND", c17g[0], 3.4)

# ================================ needle wires (top side) to the analog pins ========================================
# The thermistor wires run under the Nano on the top side and enter their Nano pins J4.4-J4.6 (the divider parts sit
# directly below those pins on the bottom side): the right-needle (TH1) and tip wires north of the center line, the
# left-needle (TH3) wire south of it, so the top copper stays balanced left/right. Left and right are as seen on the
# top face with the cable end up and the needles pointing down.
T("A2_TH1", "F", SIG, (27.5, -6.2), (25.2, -3.9), (16.51, -3.9), J("J4", 6))          # right needle
T("A1_TH2", "F", SIG, (34.4, -1.235), (34.4, -2.9), (33.9, -3.4), (13.97, -3.4), J("J4", 5))   # heater-prong tip
T("A0_TH3", "F", SIG, (30.9, 6.2), (29.64, 4.94), (29.64, 2.6), (29.04, 2.0), (12.03, 2.0), (11.43, 1.4), J("J4", 4))  # left needle


# ================================ needle end: both side needles wired alike ========================================
def needle_end(s, sig):
    """s = -1 north, +1 south: the side-needle wire turns inside the Nano pins 14-15, its ground return, ground stitching."""
    y = lambda v: s * v
    T(sig, "F", SIG, (BODY_L - 1.0, y(8.0)), (41.4, y(8.0)), (39.6, y(6.2)), (27.5 if s < 0 else 30.9, y(6.2)))
    T("GND", "B", SIG, (BODY_L - 1.0, y(8.0)), (41.6, y(7.42))); V("GND", 41.6, y(7.42))    # its ground return
    for x, v in ((36.2, 2.4), (38.3, 2.4), (40.4, 2.4), (37.3, 4.4), (39.9, 4.4), (42.3, 3.6)):   # stitching
        V("GND", x, y(v))


needle_end(-1, "A2_TH1")
needle_end(+1, "A0_TH3")
# TH2 lanes: straight and parallel beside the heater return, then the signal lane goes north to a via, the ground lane south
T("A1_TH2", "B", 0.09, (BODY_L - 1.0, -0.455), (LANE_SPLIT, -0.455), (34.4, -1.235)); V("A1_TH2", 34.4, -1.235)
T("GND", "B", 0.09, (BODY_L - 1.0, 0.455), (LANE_SPLIT, 0.455), (34.4, 1.235)); V("GND", 34.4, 1.235)

# ================================ planes and pours ===================================================================
GND, V5 = net("GND"), net("+5V")
for layer, name, n in ((pcbnew.F_Cu, "GND top fill", GND), (pcbnew.In1_Cu, "Dedicated ground plane", GND),
                       (pcbnew.In2_Cu, "Dedicated 5V plane", V5), (pcbnew.B_Cu, "GND bottom fill", GND)):
    z = pcbnew.ZONE(b); z.SetLayer(layer); z.SetNet(n); z.SetZoneName(name)
    ol = z.Outline(); ol.NewOutline(); py = BODY_W / 2 - 0.6
    for x, yy in ((0.3, -py), (BODY_L - 0.3, -py), (BODY_L - 0.3, py), (0.3, py)): ol.Append(FromMM(OX + x), FromMM(OY + yy))
    z.SetLocalClearance(FromMM(0.2)); z.SetMinThickness(FromMM(0.2))
    z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS); z.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
    b.Add(z)
# Keep the bottom ground pour off the center-prong strip so the TH2 signal lane and the TH2 ground lane see identical copper.
ka = pcbnew.ZONE(b); ka.SetIsRuleArea(True); ka.SetLayer(pcbnew.B_Cu); ka.SetZoneName("TH2 lane strip: no pour")
ka.SetDoNotAllowZoneFills(True); ka.SetDoNotAllowTracks(False); ka.SetDoNotAllowVias(False); ka.SetDoNotAllowPads(False); ka.SetDoNotAllowFootprints(False)
ol = ka.Outline(); ol.NewOutline()
for x, yy in ((34.9, -1.0), (BODY_L + 0.5, -1.0), (BODY_L + 0.5, 1.0), (34.9, 1.0)): ol.Append(FromMM(OX + x), FromMM(OY + yy))
b.Add(ka)
# No top-side pour along the pin rows: the needle wires run just inside the pins there, and a sliver of pour beside a
# pin would be an island hanging on one thermal spoke. The Nano pins reach ground through the inner plane and the bottom.
for sgn in (-1, 1):
    kr = pcbnew.ZONE(b); kr.SetIsRuleArea(True); kr.SetLayer(pcbnew.F_Cu); kr.SetZoneName("pin row: no top pour")
    kr.SetDoNotAllowZoneFills(True); kr.SetDoNotAllowTracks(False); kr.SetDoNotAllowVias(False); kr.SetDoNotAllowPads(False); kr.SetDoNotAllowFootprints(False)
    ol = kr.Outline(); ol.NewOutline()
    for x, yy in ((0.0, 6.35), (BODY_L, 6.35), (BODY_L, 9.0), (0.0, 9.0)): ol.Append(FromMM(OX + x), FromMM(OY + sgn * yy))
    b.Add(kr)

pcbnew.SaveBoard("hp_hat_routed.kicad_pcb", b)
print("hp_hat_routed.kicad_pcb written (hand-routed)")
