"""Hand-planned copper for the whole flat-nano body: every trace and via is drawn here deliberately (no auto-router).

Run:  D:\\KiCAD\\bin\\python.exe preroute.py        (after gen_pcb.py 12G)
Reads hp_sensor.kicad_pcb, writes hp_sensor_routed.kicad_pcb.
Coordinates are body-frame mm: x from the cable end, y from the center line (KiCad y down).

Layout rules applied here:
  * every trace that carries heater or battery current is >= PWR (0.5 mm) on the outer layers, with no narrower neck
    anywhere; the heater feed runs inside the board on In2 as a PWR_IN (1.2 mm) strip, which on JLC04081H-7628's 0.5 oz
    inner copper (15.2 um) has more cross-section than 0.5 mm of 1 oz outer copper. Keeping it off the bottom layer
    leaves that layer free for the few signals that must cross the center line;
  * every part that dissipates more than 2 mW sits on the center line;
  * the three needles are exact mirror images (y -> -y) and the copper of every layer is balanced left/right
    (checks/check_quality.py requires each layer's two halves to agree within 10%);
  * USB D+/D- are one coupled pair (0.30 mm traces, 0.20 mm gap ~ 88 ohm on JLC04081H-7628), no vias;
  * signals run straight or at 45 degrees; a via is used only where a signal has to change layer, and every signal
    that changes layer runs at least 3 mm on the bottom layer; the bottom layer is used only to cross the center line
    or another signal, and for the thermistor wires that arrive from the needles.
"""
import os, pcbnew
from pcbnew import FromMM, VECTOR2I

HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
OX, OY = 100.0, 80.0
BODY_L, BODY_W = 43.18, 17.78             # exact Arduino Nano R4 PCB outline
PWR = 0.5
PWR_IN = 1.2                              # inner-layer power strip (0.5 oz): 1.2 mm x 15.2 um >= 0.5 mm x 35 um
SIG = 0.2
LAYER = {"F": pcbnew.F_Cu, "B": pcbnew.B_Cu, "In2": pcbnew.In2_Cu}
USB_W = 0.30
VIA_D, VIA_DRILL = 0.6, 0.35

b = pcbnew.LoadBoard("hp_sensor.kicad_pcb")
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


def drop(name, ref, num, dx, dy, w=0.3):
    """plane connection: a short straight link from a pad to its own via"""
    x, y = pad(ref, num)
    T(name, "F", w, (x, y), (x + dx, y + dy)); V(name, x + dx, y + dy)


# ================================ supply input: J1 -> D1 (reverse protection) -> VIN_P =================================
ux = pad("U3", 9)[0]                                                   # buck converter center line (x); U3 sits on the axis
T("VIN", "F", PWR, pad("J1", 1), pad("D1", 2))                        # straight down the axis
T("VIN", "F", PWR, (pad("J1", 1)[0] + 0.8, -0.6), pad("D2", 1))        # surge clamp D2 at the input
d1k = pad("D1", 1)
vx = d1k[0] + 0.05                                                     # north branch: bulk C3 and the In2 take-off via
T("VIN_P", "F", PWR, d1k, (vx, -0.4), (vx, pad("C3", 1)[1] + 0.2), pad("C3", 1))
V("VIN_P", vx, -1.2)
T("VIN_P", "F", PWR, d1k, (ux - 1.55, 0.5), (ux - 1.0, 0.5))            # south-east: U3 EN + VIN
T("VIN_P", "F", PWR, (ux - 0.8, 0.9), pad("C18", 1))                   # U3 VIN -> 100 nF input bypass
T("VIN_P", "F", PWR, pad("C18", 1), (pad("C1", 1)[0] + 0.5, pad("C1", 1)[1]), pad("C1", 1))   # -> 4.7 uF input capacitor
# heater supply: along the axis inside the board (In2), under the regulator and the MCU, straight into the shunt R5
r5a, r5b = pad("R5", 1), pad("R5", 2)
qd, qs = pad("Q1", 3), pad("Q1", 2)
vin_via = (r5a[0] - 0.94, 0.0)                                          # between the MOSFET drain and the shunt
T("VIN_P", "In2", PWR_IN, (vx, -1.2), (vx + 1.2, 0.0), vin_via)
V("VIN_P", *vin_via)
T("VIN_P", "F", PWR, vin_via, (r5a[0] - 0.3, 0.0))
# Kelvin sense: taps at the south edge of the shunt pads, carry no load current
u10, u8, u9 = pad("U4", 10), pad("U4", 8), pad("U4", 9)
T("VIN_P", "F", SIG, (r5a[0] - 0.44, 0.6), (r5a[0] - 0.84, 1.0), (u10[0], 1.0), (u10[0], 2.2))
T("HEAT_P", "F", SIG, (r5b[0] - 0.36, 0.55), (r5b[0] - 0.36, 1.25), (u8[0] + 0.3, 1.25), (u8[0], 1.55), (u8[0], 2.2))
T("HEAT_P", "F", SIG, u9, u8)

# ================================ heater: R5 -> heater prong (F.Cu axis), return (B.Cu axis) -> Q1 ======================
T("HEAT_P", "F", PWR, (r5b[0] + 0.3, 0.0), (BODY_L - 1.0, 0.0))
ret_via = (qd[0] + 0.03, 1.2)                                           # heater return comes up just south of the drain
T("HEAT_RTN", "B", PWR, (BODY_L - 1.0, 0.0), (38.6, 0.0), (37.4, 1.2), ret_via)
V("HEAT_RTN", *ret_via)
T("HEAT_RTN", "F", PWR, ret_via, (ret_via[0], 0.0))
for sx in (34.0, 34.85):                                                # source: two ground vias
    T("GND", "F", PWR, (sx, qs[1]), (sx, 1.62)); V("GND", sx, 1.62)

# ================================ buck converter U3 (TI layout example orientation) ===================================
T("GND", "F", PWR, (ux, -0.2), (ux, -2.0)); V("GND", ux, -2.0)          # exposed GND bar -> via
T("GND", "F", PWR, (ux - 0.55, -1.0), (ux, -1.0))                       # RT -> GND (2.2 MHz)
c18g = pad("C18", 2)
T("GND", "F", PWR, c18g, (ux, 1.3), (ux, 0.0))                          # input loop: C18 GND -> GND bar, between VIN and SW
T("GND", "F", PWR, c18g, (ux + 0.95, 2.35)); V("GND", ux + 0.95, 2.35)
l1s, l1o = pad("L1", 1), pad("L1", 2)
T("SW", "F", PWR, (ux + 0.95, 0.85), (l1s[0] - 0.3, 0.85))                # switch node -> C19 -> L1, short
T("BOOT", "F", 0.3, (ux + 1.05, 0.25), (pad("C19", 1)[0] - 0.15, 0.1))
T("VCC_BUCK", "F", SIG, (ux + 1.05, -0.25), (ux + 1.2, -0.25), (pad("C20", 1)[0] - 0.15, -0.9))
c20g = pad("C20", 2); T("GND", "F", PWR, c20g, (c20g[0], -2.65)); V("GND", c20g[0], -2.65)
d7a, d7k = pad("D7", 2), pad("D7", 1)
T("5V_BUCK", "F", PWR, (l1o[0] + 0.2, 0.0), (d7a[0] - 0.2, 0.0))          # L1 -> D7
c2o = pad("C2", 1)
T("5V_BUCK", "F", PWR, (d7a[0], 0.15), (c2o[0] - 0.1, c2o[1] - 0.4), c2o)   # -> output capacitor
T("5V_BUCK", "F", 0.3, (ux + 0.7, -0.9), (ux + 0.7, -3.25), (ux + 2.75, -3.25), (ux + 3.75, -2.25),
  (l1o[0] - 0.1, -2.25), (l1o[0], -2.15), (l1o[0], -1.7))                  # VOUT sense to the output node at L1
c2g = pad("C2", 2); T("GND", "F", PWR, c2g, (15.0, c2g[1])); V("GND", 15.0, c2g[1])
T("+5V", "F", PWR, d7k, (d7k[0], -0.445), (18.6, -1.1)); V("+5V", 18.6, -1.1)   # clear of C16, the MCU pins and the In2 strip
# input ground returns
c1g = pad("C1", 2); T("GND", "F", PWR, c1g, (c1g[0] + 1.1, c1g[1])); V("GND", c1g[0] + 1.1, c1g[1])   # hole clear of the pad opening
c3g = pad("C3", 2); T("GND", "F", PWR, c3g, (c3g[0] + 0.85, c3g[1])); V("GND", c3g[0] + 0.85, c3g[1])
d2g = pad("D2", 2); T("GND", "F", PWR, d2g, (d2g[0], -3.85)); V("GND", d2g[0], -3.85)          # between the C3 pads
c17p, c17g = pad("C17", 1), pad("C17", 2)
T("+5V", "F", PWR, c17p, (c17p[0] - 0.85, c17p[1])); V("+5V", c17p[0] - 0.85, c17p[1])
T("GND", "F", PWR, c17g, (c17g[0] + 0.95, c17g[1])); V("GND", c17g[0] + 0.95, c17g[1])

# ================================ MCU decoupling: each capacitor sits on its own pins ================================
def pin_to(ref_pin, cap_pad, w=0.3):
    a, c = pad(*ref_pin), pad(*cap_pad)
    edge = a[1] + (0.775 if a[1] > 0 else -0.775) if abs(a[1]) > 4 else a[1]      # north/south pins: start at the pad tip
    if abs(a[1]) > 4: T(NETOF[ref_pin], "F", w, (a[0], edge), c)
    else: T(NETOF[ref_pin], "F", w, (a[0] + 0.775, a[1]), c)                     # east pins: start at the pad tip
NETOF = {("U1", 11): "+5V", ("U1", 8): "GND", ("U1", 39): "+5V", ("U1", 40): "GND", ("U1", 5): "VCL",
         ("U1", 56): "+5V", ("U1", 57): "GND", ("U1", 58): "GND"}
pin_to(("U1", 11), ("C7", 1)); pin_to(("U1", 8), ("C7", 2))
pin_to(("U1", 39), ("C8", 1)); pin_to(("U1", 40), ("C8", 2))
pin_to(("U1", 5), ("C10", 1))
pin_to(("U1", 56), ("C9", 1)); pin_to(("U1", 57), ("C9", 2))
T("GND", "F", 0.3, (pad("U1", 58)[0] + 0.775, pad("U1", 58)[1]), (pad("C9", 2)[0] - 0.3, pad("C9", 2)[1]))
drop("+5V", "C9", 1, 0, 0.72); drop("GND", "C9", 2, 0, -0.72)             # both vias clear of the In2 strip
drop("+5V", "C7", 1, 0, -0.75); drop("GND", "C7", 2, 0, -0.75)
drop("+5V", "C8", 1, 0, 0.75); drop("GND", "C8", 2, 0, 0.75)
drop("GND", "C10", 2, 0.925, 0)
# MCU plane pins without a capacitor of their own: a via in the 0.9 mm fan-out ring just inside the pads
T("GND", "F", 0.25, (20.3, -3.75), (21.25, -3.75)); V("GND", 21.25, -3.75)          # pin 17
T("+5V", "F", 0.25, (20.3, -1.75), (21.25, -1.75)); V("+5V", 21.25, -1.75)          # pin 21
T("+5V", "F", 0.25, (27.75, -5.2), (27.75, -4.35)); V("+5V", 27.75, -4.35)          # pin 4

# ================================ MCU west side: USB support, MD, RESET, NMI, D9 ======================================
u = lambda n: pad("U1", n)
T("VCC_USB", "F", SIG, (u(20)[0] - 0.4, u(20)[1]), (17.7, u(20)[1]))                # -> C16
drop("GND", "C16", 2, 0, 0.95)
# VBUS sense divider on the north pin 16
T("VBUS_SENSE", "F", SIG, (u(16)[0], u(16)[1] - 0.55), (u(16)[0], -6.9), (21.2, -7.45))
T("VBUS_SENSE", "F", SIG, (u(16)[0], -6.9), (22.1, -7.25), (22.1, -7.4))
drop("GND", "R16", 2, 0, -0.75)
# MD (boot mode): via in the fan-out ring, bottom layer north-west to the pull-up R2 and clip hole 5 (BOOT)
T("MD", "F", SIG, (u(26)[0] + 0.47, u(26)[1]), (21.0, u(26)[1]), (21.25, 1.0)); V("MD", 21.25, 1.0)
r2m = pad("R2", 2)
T("MD", "B", SIG, (21.25, 1.0), (20.4, 0.15), (20.4, -4.3), (19.3, -5.4), (r2m[0] + 0.8, -5.4), (r2m[0], -4.6))
V("MD", r2m[0], -4.6)
T("MD", "F", SIG, (r2m[0], -4.6), r2m)
T("MD", "F", SIG, r2m, (r2m[0], -6.1), (r2m[0] - 0.25, -6.35), (8.25, -6.35), (7.8, -6.8))   # -> clip hole 5
drop("+5V", "R2", 1, 0, 1.2)
# RESET and NMI leave from the pad tips, run south along the west side to their pull-ups
T("RESET", "F", SIG, (u(25)[0] - 0.4, u(25)[1]), (18.6, u(25)[1]), (17.95, 0.9), (17.95, pad("C11", 1)[1]), pad("R1", 2))
drop("GND", "C11", 2, 0, 0.77)
drop("+5V", "R1", 1, -0.72, 0)
T("NMI", "F", SIG, (u(27)[0] - 0.4, u(27)[1]), (18.6, u(27)[1]), (18.6, 6.6), (19.2, 7.2))
drop("+5V", "R14", 1, 0.8, 0)
# D9 (heater PWM): via in the fan-out ring, bottom layer under the MCU and across the center line to the gate resistor
T("D9_HEAT", "F", SIG, (u(29)[0] + 0.47, u(29)[1]), (21.25, u(29)[1])); V("D9_HEAT", 21.25, u(29)[1])
r9d, r9g = pad("R9", 1), pad("R9", 2)
T("D9_HEAT", "B", SIG, (21.25, u(29)[1]), (30.6, u(29)[1]), (34.45, -1.6), (40.25, -1.6)); V("D9_HEAT", 40.25, -1.6)
T("D9_HEAT", "F", SIG, (40.25, -1.6), r9d)
# gate: R9 -> gate pad from the north-east, R10 pull-down beside it
T("HEAT_GATE", "F", SIG, r9g, (35.4, -1.6), (34.9, -1.1))
T("HEAT_GATE", "F", SIG, pad("R10", 1), r9g)
c24g, r10g = pad("C24", 2), pad("R10", 2)
T("GND", "F", 0.3, (c24g[0] + 0.3, r10g[1] - 0.15), (r10g[0] - 0.3, r10g[1] - 0.15))  # C24 ground joins R10 ground
T("GND", "F", 0.3, r10g, (39.25, r10g[1])); V("GND", 39.25, r10g[1])

# ================================ USB D-/D+: one coupled pair, no vias ==============================================
dm, dp = pad("U1", 18), pad("U1", 19)
hm, hp = pad("J2", 2), pad("J2", 3)
cxp = (hm[0] + hp[0]) / 2                                               # pair runs north midway between its two holes
xm, xp = cxp + 0.25, cxp - 0.25                                          # 0.5 mm centers = 0.20 mm gap at 0.30 mm width
fan = hm[0] - xm                                                         # 45-degree fan-out, equal for both lines
T("USB_DM", "F", USB_W, (dm[0] - 0.4, dm[1]), (xm + 0.5, dm[1]), (xm, dm[1] - 0.5), (xm, -5.2), (hm[0], -5.2 - fan), hm)
T("USB_DP", "F", USB_W, (dp[0] - 0.4, dp[1]), (xp + 0.7929, dp[1]), (xp, dp[1] - 0.7929), (xp, -5.2), (hp[0], -5.2 - fan), hp)
# USB bench power: J2.1 -> D5 (0.5 mm, it carries the board supply on the bench); R15 is the presence-sense tap
j21, d5a, d5k = pad("J2", 1), pad("D5", 2), pad("D5", 1)
T("VUSB", "F", PWR, (d5a[0], j21[1] + 0.6), d5a)
T("VUSB", "F", SIG, (j21[0] + 0.6, pad("R15", 1)[1]), pad("R15", 1))
T("+5V", "F", PWR, d5k, (d5k[0], d5k[1] + 0.9)); V("+5V", d5k[0], d5k[1] + 0.9)

# ================================ SDI-12: protection at the cable, series resistor R3, D2 on the bottom layer =========
T("SDI_LINE", "F", 0.25, (2.6, 4.8), (4.85, 7.05), pad("D4", 1))                    # J1 pad 2 -> TVS D4
T("SDI_LINE", "F", 0.25, pad("D4", 1), pad("R3", 1))                               # through C4, R4 to R3
drop("GND", "D4", 2, -0.85, 0)
T("GND", "F", 0.3, pad("C4", 2), pad("R4", 2)); T("GND", "F", 0.3, (6.7, pad("C4", 2)[1]), (6.7, 5.45)); V("GND", 6.7, 5.45)
d2p = u(43)
T("D2_SDI12", "F", SIG, (d2p[0], d2p[1] + 0.5), (d2p[0], 7.1)); V("D2_SDI12", d2p[0], 7.1)
T("D2_SDI12", "B", SIG, (d2p[0], 7.1), (d2p[0] - 0.25, 7.35), (11.35, 7.35)); V("D2_SDI12", 11.35, 7.35)
T("D2_SDI12", "F", SIG, (11.35, 7.35), (pad("R3", 2)[0], 7.35))

# ================================ I2C to the power monitor U4 ======================================================
s47, s48 = u(47), u(48)
u4sda, u4scl = pad("U4", 4), pad("U4", 5)
T("A4_SDA", "F", SIG, (s47[0], s47[1] + 0.5), (s47[0], 7.3), (s47[0] + 0.4, 7.7), (u4sda[0], 7.7), (u4sda[0], 7.3))
drop("+5V", "R6", 1, 0, -0.79)
# SCL crosses under SDA on the bottom layer (the MCU and U4 order the two lines oppositely)
T("A5_SCL", "F", SIG, (s48[0], s48[1] + 0.5), (s48[0], 6.5), (29.7, 6.95)); V("A5_SCL", 29.7, 6.95)
T("A5_SCL", "B", SIG, (29.7, 6.95), (37.0, 6.95), (38.3, 8.25), (u4scl[0], 8.25)); V("A5_SCL", u4scl[0], 8.25)
T("A5_SCL", "F", SIG, (u4scl[0], 8.25), (u4scl[0], 7.2))
T("A5_SCL", "F", SIG, (u4scl[0], pad("R7", 2)[1]), pad("R7", 2))
drop("+5V", "R7", 1, 0, -0.82)
# U4 supply and ground: VS to C12 from the side of pin 6; pin 7 joins the address pins A0/A1 under the body
T("+5V", "F", 0.3, (39.0, pad("C12", 1)[1]), pad("C12", 1)); T("+5V", "F", 0.3, (39.75, pad("C12", 1)[1]), (39.75, 1.8)); V("+5V", 39.75, 1.8)
drop("GND", "C12", 2, 0, 0.87)
T("GND", "F", SIG, (38.5, 3.1), (38.5, 3.6), (37.25, 4.85), (37.25, 6.1))
T("GND", "F", 0.25, (36.9, 6.1), (36.5, 6.1), (36.15, 5.75), (36.15, 5.5)); V("GND", 36.15, 5.5)

# ================================ thermistor dividers ===============================================================
# VREF leaves the reference pin 59 on its inner end and runs in the MCU fan-out ring: north to the divider bank
# (around its far side, so no thermistor line crosses it) and south to the left-needle (TH3) divider and to R11 (from D4).
H = -5.95                                                                 # bank node line
T("VREF", "F", SIG, (u(59)[0] - 0.58, u(59)[1]), (30.05, u(59)[1]), (30.05, -4.35), (31.5, -5.8), (31.5, -7.35), (31.75, -7.6))
T("VREF", "F", 0.3, (31.75, -7.6), (pad("C13", 1)[0] + 0.1, -7.6))        # bus through R22, R21, R24 to C13
T("VREF", "F", SIG, (30.05, u(59)[1]), (30.05, 4.25), (32.9, 4.25))       # -> R23
T("VREF", "F", SIG, (33.5, 4.45), (33.73, 4.68), (33.73, 5.4))             # R23 -> R11
d45 = u(45)
T("D4_EXC", "F", SIG, (d45[0], d45[1] - 0.37), (d45[0], 4.6), (31.9, 4.6), (32.7, 5.4))
tip = lambda n: (u(n)[0] + 0.32, u(n)[1])
# A1 (pin 64) -> R22/C22 column, TH2 arrives on the bottom layer
T("A1_TH2", "F", SIG, tip(64), (32.1, -3.75), (32.35, -4.0), (32.35, H + 0.25), (32.6, H), (32.9, H))
# A2 (pin 63) -> R21/C21 column, TH1 arrives on the bottom layer
T("A2_TH1", "F", SIG, tip(63), (34.4, -3.25), (34.65, -3.5), (34.65, H + 0.25), (34.9, H), (35.1, H))
# A3 (pin 62) -> R24/C24 column and the on-board thermistor TH4
T("A3_TH4", "F", SIG, tip(62), (36.6, -2.75), (36.85, -3.0), (36.85, H + 0.25), (37.1, H), (37.3, H))
for n, cx in (("A1_TH2", 33.1), ("A2_TH1", 35.3), ("A3_TH4", 37.45)):
    T(n, "F", SIG, (cx, H + 0.35), (cx, H + 1.0))                          # R node pad -> C node pad
for cx in (33.1, 35.3):
    T("GND", "F", 0.3, (cx, -3.805), (cx + 0.9, -3.805)); V("GND", cx + 0.9, -3.805)
T("A1_TH2", "F", SIG, (33.4, H), (34.05, H)); V("A1_TH2", 34.05, H)
T("A2_TH1", "F", SIG, (35.6, H), (36.25, H)); V("A2_TH1", 36.25, H)
T("A3_TH4", "F", SIG, (37.8, H), (38.6, H))
T("GND", "F", 0.3, pad("TH4", 2), (pad("TH4", 2)[0], -6.85)); V("GND", pad("TH4", 2)[0], -6.85)
T("GND", "F", 0.3, pad("C13", 2), (pad("C13", 2)[0], -6.85))
# A0 (pin 53) -> R23/C23 on the south side; TH3 arrives on the bottom layer
T("A0_TH3", "F", SIG, tip(53), (32.1, 1.75), (32.75, 2.4), (34.6, 2.4))
T("A0_TH3", "F", SIG, (34.45, 2.4), (34.45, 3.2)); V("A0_TH3", 34.45, 3.2)
drop("GND", "C23", 2, 0, 0.85)

# ================================ needle end: both side needles wired alike ========================================
def needle_end(s, sig):
    """s = -1 north, +1 south: the side-needle wire, its ground return and ground stitching, mirror images of each other."""
    y = lambda v: s * v
    T(sig, "F", SIG, (BODY_L - 1.0, y(8.0)), (40.85, y(8.0))); V(sig, 40.85, y(8.0))   # side-needle wire, straight
    T("GND", "B", SIG, (BODY_L - 1.0, y(8.0)), (41.6, y(7.42))); V("GND", 41.6, y(7.42))   # its ground return
    for x, v in ((42.2, 2.2), (42.2, 4.4)):                                               # stitching
        V("GND", x, y(v))
needle_end(-1, "A2_TH1")
needle_end(+1, "A0_TH3")
# needle wires continue on the bottom layer to their divider nodes
T("A2_TH1", "B", SIG, (40.85, -8.0), (36.7, -8.0), (36.25, -7.55), (36.25, H))
T("A0_TH3", "B", SIG, (40.85, 8.0), (36.8, 3.95), (35.2, 3.95), (34.45, 3.2))
# TH2 lanes: signal lane north on the bottom layer to its divider node, ground lane to a ground via
T("A1_TH2", "B", 0.09, (BODY_L - 1.0, -0.455), (40.9, -0.455), (40.8, -0.555))
T("A1_TH2", "B", SIG, (40.8, -0.555), (40.8, -4.6), (40.5, -4.9), (34.35, -4.9), (34.05, -5.2), (34.05, H))
T("GND", "B", 0.09, (BODY_L - 1.0, 0.455), (40.8, 0.455))
T("GND", "B", 0.09, (40.8, 0.455), (40.55, 0.705)); T("GND", "B", SIG, (40.55, 0.705), (40.55, 1.3)); V("GND", 40.55, 1.3)

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
for x, yy in ((40.2, -1.0), (BODY_L + 0.5, -1.0), (BODY_L + 0.5, 1.0), (40.2, 1.0)): ol.Append(FromMM(OX + x), FromMM(OY + yy))
b.Add(ka)

pcbnew.SaveBoard("hp_sensor_routed.kicad_pcb", b)
print("hp_sensor_routed.kicad_pcb written (hand-routed)")
