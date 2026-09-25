"""Compact heat-pulse HAT for the Arduino Nano R4, rev 4 - schematic generator.
Shares the released flat-nano heater and sensing circuit. A headerless Nano R4
uses ordinary pin strips soldered through both boards, face-to-face with the hat.

Run:  D:\KiCAD\bin\python.exe gen_schematic.py
Writes hp_hat.kicad_sch (+ netlist.json used later by the PCB generator).
The circuit is DATA (the PARTS list below): edit a value / net there and re-run; do not hand-edit the .kicad_sch.
Every pin gets a short stub and a net label, grouped by functional block - no long wires to trace.
"""
import json, os, uuid
from sexpr import Sym, dump, get_symbol, pins, find

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PROJECT = "hp_hat"
N_HEAT = 17            # One-sided 0603 chain, identical to flat-nano: 43.2 mm body-to-body heated extent.
PITCH = 2.6
R_HEAT = "3.3"         # 56.1 ohm total; Vishay CRCW06033R30FKEAHP, 0.33 W at 70 C.
ROOT = str(uuid.uuid4())
uid = lambda: str(uuid.uuid4())

FP = dict(R0402="Resistor_SMD:R_0402_1005Metric", R0603="Resistor_SMD:R_0603_1608Metric", R0805="Resistor_SMD:R_0805_2012Metric",
          C0402="Capacitor_SMD:C_0402_1005Metric", C0603="Capacitor_SMD:C_0603_1608Metric", C0805="Capacitor_SMD:C_0805_2012Metric")
PARTS, TEXTS = [], []


def part(ref, lib, value, fp, x, y, pinmap, **fields):
    x, y = round(x / 2.54) * 2.54, round(y / 2.54) * 2.54          # snap to the 100 mil schematic grid
    PARTS.append(dict(ref=ref, lib=lib, value=value, fp=fp, x=x, y=y, pins={str(k): v for k, v in pinmap.items()}, fields=fields))


def two(ref, lib, value, fp, x, y, a, b, **f):          # vertical 2-pin part: pin 1 on top
    part(ref, lib, value, fp, x, y, {1: a, 2: b}, **f)


def text(s, x, y, size=2.0, right=585):
    import textwrap                                         # wrap so headings never run off the sheet (KiCad text anchors at the bottom line)
    width = int((right - x) / (size * 0.95))
    lines = [w for para in s.splitlines() for w in (textwrap.wrap(para, width) or [""])]
    TEXTS.append((chr(10).join(lines), x, y + (len(lines) - 1) * size * 1.7, size))


def flag(n, net, x, y):
    part(f"#FLG{n:02d}", "power:PWR_FLAG", "PWR_FLAG", "", x, y, {1: net})


# ------------------------------------------------------------------ POWER ------------------------------------------------------------------
X, Y = 40, 60
text("POWER IN   -   12 V battery / logger supply, normally 11.5-14.4 V, through three soldered wires. D1 provides reverse-polarity protection. "
     "The Nano VIN branch uses R18; its onboard regulator supplies the hat's 5 V. The TVS and R18 do not guarantee a 21 V surge limit.", 30, 25, 2.0, right=300)
part("J1", "Connector_Generic:Conn_01x03", "Hand-soldered cable (3 wires)", "hp_sensor:CablePads_1x03_P4mm", X, Y, {1: "VIN", 2: "SDI_LINE", 3: "GND"},
     Note="1 = 12V, 2 = SDI-12 data, 3 = GND; solder after assembly and provide cable strain relief")
two("D2", "Device:D_TVS", "SMF15CA 15V bidir TVS", "Diode_SMD:D_SOD-123F", X + 40, Y, "VIN", "GND")
two("D1", "Device:D_Schottky", "1A 40V Schottky (SOD-123F)", "Diode_SMD:D_SOD-123F", X + 75, Y, "VIN_P", "VIN", Note="reverse-polarity protection")
two("C1", "Device:C", "4.7u 50V", FP["C0805"], X + 100, Y, "VIN_P", "GND")
two("C2", "Device:C", "10u 10V", FP["C0805"], X + 125, Y, "+5V", "GND")
two("R18", "Device:R", "22", FP["R0603"], X + 150, Y, "VIN_P", "NANO_VIN", Note="input filter resistor; not overvoltage protection (Nano VIN operating range 6-21 V)")
for i, net in enumerate(["VIN", "VIN_P", "GND", "+5V"]):
    flag(i + 1, net, X + 40 + 25 * i, Y + 35)

# ------------------------------------------------------------------ SDI-12 ------------------------------------------------------------------
X, Y = 300, 60
text("SDI-12 DATA   -   R3 limits transmit and fault current; R4 sets the idle load. C4 slows transitions and D4 provides ESD protection. "
     "Direct 5 V GPIO receive thresholds are not guaranteed for every compliant SDI-12 sender; verify with the intended logger and cable.", 285, 22, 2.0, right=425)
two("R3", "Device:R", "1.5k 1%", FP["R0603"], X, Y, "SDI_LINE", "D2_SDI12")
two("R4", "Device:R", "220k", FP["R0402"], X + 60, Y, "SDI_LINE", "GND")
two("C4", "Device:C", "3.3n", FP["C0402"], X + 75, Y, "SDI_LINE", "GND")
two("D4", "Device:D_TVS", "bidir ESD diode 6-7V (SOD-323)", "Diode_SMD:D_SOD-323", X + 30, Y, "SDI_LINE", "GND")

# ------------------------------------------------------------------ NANO SOCKETS ------------------------------------------------------------------
text("ARDUINO NANO R4 ABX00142   -   two Samtec HTSW-115-07-T-S 1x15 strips soldered through BOTH boards; components face inward. "
     "Seat header insulators on hat front and use a fixture to hold a 4.00 mm board gap during soldering. Trim solid pin tails to 0.5 mm maximum outside each board. "
     "USB-C faces the cable end. Loose pins are not reliable contacts. Program using Arduino Nano R4 in the IDE before potting.", 30, 118, 2.0, right=420)
part("J3", "Connector_Generic:Conn_01x15", "Nano solder-stack header", "hp_sensor:Nano_SolderStack_1x15", 80, 190,
     dict(zip(range(1, 16), [None, None, None, "D9_HEAT", None, None, None, None, "D4_EXC", None, "D2_SDI12", "GND", None, None, None])),
     Note="1 D12, 2 D11, 3 D10, 4 D9, 5 D8, 6 D7, 7 D6, 8 D5, 9 D4, 10 D3, 11 D2, 12 GND, 13 RST, 14 RX, 15 TX")
part("J4", "Connector_Generic:Conn_01x15", "Nano solder-stack header", "hp_sensor:Nano_SolderStack_1x15", 200, 190,
     dict(zip(range(1, 16), [None, None, "VREF", "A0_TH1", "A1_TH2", "A2_TH3", "A3_TH4", "A4_SDA", "A5_SCL", None, None, "+5V", None, "GND", "NANO_VIN"])),
     Note="1 D13, 2 3V3, 3 AREF (printed B0), 4 A0, 5 A1, 6 A2, 7 A3, 8 A4, 9 A5, 10 A6, 11 A7, 12 5V, 13 BOOT (printed B1) - leave unconnected, 14 GND, 15 VIN (6-21 V)")

# ------------------------------------------------------------------ HEATER ------------------------------------------------------------------
X, Y = 440, 60
text("HEATER DRIVE + POWER MONITOR   -   heater runs from the battery, never from USB alone. Firmware must bound pulse duration to 15 s, monitor V and I, "
     "and switch OFF on timeout or a fault. Refuse heating above 15 V input. R10 holds the gate low when D9 is high impedance; it is not a watchdog.", 430, 10, 2.0)
two("R5", "Device:R", "0.1 1%", FP["R0805"], X, Y, "VIN_P", "HEAT_P", Note="current shunt")
part("U4", "Sensor_Energy:INA226", "INA226", "Package_SO:MSOP-10_3x3mm_P0.5mm", X + 50, Y,
     {10: "VIN_P", 9: "HEAT_P", 8: "HEAT_P", 6: "+5V", 7: "GND", 4: "A4_SDA", 5: "A5_SCL", 3: None, 1: "GND", 2: "GND"}, Note="I2C address 0x40")
two("C12", "Device:C", "100n", FP["C0402"], X + 95, Y, "+5V", "GND")
two("R6", "Device:R", "4.7k", FP["R0402"], X + 108, Y, "+5V", "A4_SDA")
two("R7", "Device:R", "4.7k", FP["R0402"], X + 121, Y, "+5V", "A5_SCL")
part("Q1", "Transistor_FET:AO3400A", "AO3400A", "Package_TO_SOT_SMD:SOT-23", X + 15, Y + 65, {1: "HEAT_GATE", 2: "GND", 3: "HEAT_RTN"}, Note="logic-level N-MOSFET, low side")
two("R9", "Device:R", "1.5k", FP["R0402"], X + 48, Y + 65, "D9_HEAT", "HEAT_GATE", Note="1%; limits RA4M1 gate charging current below 4 mA")
two("R10", "Device:R", "100k", FP["R0402"], X + 63, Y + 65, "HEAT_GATE", "GND", Note="gate pull-down")

text(f"HEATER RESISTOR CHAIN (top side of the centre prong only)   -   {N_HEAT} x {R_HEAT} ohm 1% 0603 in series, {PITCH} mm pitch. EXACT Vishay CRCW06033R30FKEAHP, 0.33 W at 70 C. The return runs on the bottom copper of the prong. "
     "Use Panasonic ERJ2GEJ5R1X, 0.1 W; resistor tolerance and local temperature affect the margin. First resistor starts outside the epoxy body. "
     "Firmware must detect zero heater current as a fault.", 30, 365, 2.0)
for i in range(N_HEAT):
    two(f"RH{i + 1}", "Device:R", R_HEAT, "hp_sensor:R_0603_Vishay_HP", 40 + 16.5 * i, 395, "HEAT_P" if i == 0 else f"H_{i}", "HEAT_RTN" if i == N_HEAT - 1 else f"H_{i + 1}")

# ------------------------------------------------------------------ THERMISTORS ------------------------------------------------------------------
X, Y = 470, 215
text("THERMISTORS   -   dividers and Nano AREF share filtered VREF. Q2 switches their ground return to reduce self-heating between readings. "
     "Firmware: analogReference(AR_EXTERNAL), analogReadResolution(14); D4 HIGH, wait 10 ms, sample, D4 LOW. Verify settling, noise and calibration on assembled hardware. "
     "NTC = Murata NCP15XH103F03RC (10k, 1%); Rref = 10k 0.1% 25 ppm.", 430, 160, 2.0)
two("R11", "Device:R", "10", FP["R0402"], X, Y + 15, "+5V", "VREF", Note="filters the reference node")
two("C13", "Device:C", "1u", FP["C0402"], X + 14, Y + 15, "VREF", "GND")
part("Q2", "Transistor_FET:AO3400A", "AO3400A", "Package_TO_SOT_SMD:SOT-23", X + 45, Y + 20, {1: "EXC_GATE", 2: "GND", 3: "TH_RTN"}, Note="switches the thermistor ground")
two("R12", "Device:R", "1.5k", FP["R0402"], X + 75, Y + 15, "D4_EXC", "EXC_GATE", Note="1%; limits gate charging current below 4 mA")
two("R17", "Device:R", "100k", FP["R0402"], X + 90, Y + 15, "EXC_GATE", "GND")
names = {1: ("left prong", "A0_TH1"), 2: ("heater prong tip", "A1_TH2"), 3: ("right prong", "A2_TH3"), 4: ("board body (diagnostic)", "A3_TH4")}
for i in range(1, 5):
    x = X - 30 + 36 * (i - 1)
    node = names[i][1]
    two(f"R2{i}", "Device:R", "10k 0.1%", FP["R0603"], x, Y + 85, "VREF", node, Note="reference resistor")
    two(f"TH{i}", "Device:Thermistor_NTC", "10k NTC 1%", FP["R0402"], x, Y + 125, node, "TH_RTN", Note=names[i][0])
    two(f"C2{i}", "Device:C", "100n", FP["C0402"], x + 18, Y + 125, node, "GND")

# =============================================================== writer ===============================================================
EFF = lambda size=1.27, just=None, hide=False: [Sym("effects"), [Sym("font"), [Sym("size"), size, size]]] + ([[Sym("justify")] + [Sym(j) for j in just]] if just else []) + ([[Sym("hide"), Sym("yes")]] if hide else [])
OUT = {0: (-1, 0, 180, ["right", "bottom"]), 180: (1, 0, 0, ["left", "bottom"]), 270: (0, -1, 90, ["left", "bottom"]), 90: (0, 1, 270, ["right", "bottom"])}
STUB = 2.54


STUBS = []


def check_collisions(stubs):
    """Any point of one net's stub lying on another net's stub would silently short them in KiCad."""
    def on(pt, a, b):
        return min(a[0], b[0]) - 1e-6 <= pt[0] <= max(a[0], b[0]) + 1e-6 and min(a[1], b[1]) - 1e-6 <= pt[1] <= max(a[1], b[1]) + 1e-6
    bad = [(n1, r1, n2, r2) for i, (n1, r1, a1, b1) in enumerate(stubs) for (n2, r2, a2, b2) in stubs[i + 1:]
           if n1 != n2 and (on(a1, a2, b2) or on(b1, a2, b2) or on(a2, a1, b1) or on(b2, a1, b1))]
    if bad:
        raise SystemExit("SHORT between label stubs - move the parts apart: " + "; ".join(f"{r1}:{n1} x {r2}:{n2}" for n1, r1, n2, r2 in bad))


def build():
    lib_syms, items, netlist = {}, [], {}
    for p in PARTS:
        sym = lib_syms.setdefault(p["lib"], get_symbol(p["lib"]))
        plist = pins(sym)
        ys = [q["y"] for q in plist] or [0]; xs = [q["x"] for q in plist] or [0]
        top, bot, right = max(ys), min(ys), max(xs)
        twopin = len(plist) <= 2 and p["lib"].split(":")[0] in ("Device", "Jumper")
        rx, ry, vx, vy, just = (p["x"] + 3.0, p["y"] - 1.5, p["x"] + 3.0, p["y"] + 1.5, ["left"]) if twopin else (p["x"] - right + 2, p["y"] - top - 2.5, p["x"] - right + 2, p["y"] - bot + 4.5, ["left"])
        if twopin and len({q["y"] for q in plist}) == 1:        # horizontal symbol (diode, LED, jumper): text above / below, clear of the stubs
            rx, ry, vx, vy, just = p["x"], p["y"] - 4.5, p["x"], p["y"] + 5.0, None
        if p["lib"].startswith("Connector:TestPoint"): rx, ry, vx, vy = p["x"] + 2.5, p["y"] - 3, p["x"] + 2.5, p["y"] - 0.8
        power = p["ref"].startswith("#")
        inst = [Sym("symbol"), [Sym("lib_id"), p["lib"]], [Sym("at"), p["x"], p["y"], 0], [Sym("unit"), 1], [Sym("exclude_from_sim"), Sym("no")],
                [Sym("in_bom"), Sym("no" if power else "yes")], [Sym("on_board"), Sym("no" if power else "yes")], [Sym("dnp"), Sym("no")], [Sym("uuid"), uid()],
                [Sym("property"), "Reference", p["ref"], [Sym("at"), rx, ry, 0], EFF(just=just, hide=power)],
                [Sym("property"), "Value", p["value"], [Sym("at"), vx, vy, 0], EFF(just=just, hide=power and False)],
                [Sym("property"), "Footprint", p["fp"], [Sym("at"), p["x"], p["y"], 0], EFF(hide=True)],
                [Sym("property"), "Datasheet", "~", [Sym("at"), p["x"], p["y"], 0], EFF(hide=True)]]
        for k, v in p["fields"].items():
            inst.append([Sym("property"), k, v, [Sym("at"), vx, vy + 2.2, 0], EFF(size=1.0, just=just)])
        seen = set()
        for q in plist:
            if q["num"] in seen: continue
            seen.add(q["num"]); inst.append([Sym("pin"), q["num"], [Sym("uuid"), uid()]])
            net = p["pins"].get(q["num"], "__missing__")
            if net == "__missing__": raise SystemExit(f"{p['ref']}: pin {q['num']} ({q['name']}) has no net assignment")
            ex, ey = round(p["x"] + q["x"], 4), round(p["y"] - q["y"], 4)
            if net is None:
                items.append([Sym("no_connect"), [Sym("at"), ex, ey], [Sym("uuid"), uid()]]); continue
            dx, dy, ang, lj = OUT[int(q["ang"]) % 360]
            sx, sy = round(ex + dx * STUB, 4), round(ey + dy * STUB, 4)
            STUBS.append((net, p["ref"], (ex, ey), (sx, sy)))
            items.append([Sym("wire"), [Sym("pts"), [Sym("xy"), ex, ey], [Sym("xy"), sx, sy]], [Sym("stroke"), [Sym("width"), 0], [Sym("type"), Sym("default")]], [Sym("uuid"), uid()]])
            items.append([Sym("label"), net, [Sym("at"), sx, sy, ang], EFF(just=lj), [Sym("uuid"), uid()]])
            if not power: netlist.setdefault(net, []).append(f"{p['ref']}.{q['num']}")
        extra = set(p["pins"]) - seen
        if extra: raise SystemExit(f"{p['ref']}: pin(s) {sorted(extra)} not in symbol {p['lib']}")
        inst.append([Sym("instances"), [Sym("project"), PROJECT, [Sym("path"), "/" + ROOT, [Sym("reference"), p["ref"]], [Sym("unit"), 1]]]])
        items.append(inst)
    check_collisions(STUBS)
    for s, x, y, size in TEXTS:
        items.append([Sym("text"), s.replace("\n", chr(92) + "n"), [Sym("exclude_from_sim"), Sym("no")], [Sym("at"), x, y, 0], EFF(size=size, just=["left", "bottom"]), [Sym("uuid"), uid()]])
    sch = [Sym("kicad_sch"), [Sym("version"), 20250114], [Sym("generator"), "eeschema"], [Sym("generator_version"), "9.0"], [Sym("uuid"), ROOT], [Sym("paper"), "A2"],
           [Sym("title_block"), [Sym("title"), "Compact heat-pulse hat for Arduino Nano R4, SDI-12 (rev 4)"], [Sym("company"), "K-State Soil Water Processes Lab"], [Sym("comment"), 1, "Generated by gen_schematic.py - edit the script, not this file"]],
           [Sym("lib_symbols")] + list(lib_syms.values())] + items + [[Sym("sheet_instances"), [Sym("path"), "/", [Sym("page"), "1"]]], [Sym("embedded_fonts"), Sym("no")]]
    return sch, netlist


if __name__ == "__main__":
    sch, netlist = build()
    open(PROJECT + ".kicad_sch", "w", encoding="utf8").write(dump(sch) + "\n")
    parts = {p["ref"]: dict(value=p["value"], footprint=p["fp"], pins=p["pins"], **p["fields"]) for p in PARTS if not p["ref"].startswith("#")}
    json.dump(dict(parts=parts, nets=netlist, n_heat=N_HEAT, pitch=PITCH), open("netlist.json", "w"), indent=1)
    single = {n: v for n, v in netlist.items() if len(v) < 2}
    print(f"{len(parts)} parts, {len(netlist)} nets -> {PROJECT}.kicad_sch")
    if single: print("WARNING single-pin nets:", single)
