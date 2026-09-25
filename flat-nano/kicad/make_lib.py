"""Builds the project's own KiCad library parts from datasheet numbers:
  hp_sensor.kicad_sym                        - Renesas R7FA4M1AB3CFM (RA4M1, 64-LQFP); pinout = Renesas datasheet R01DS0355 Fig. 1.5
  hp_sensor.pretty/WAGO_2060-453.kicad_mod   - WAGO 2060-453/998-404 3-pole SMD push-in terminal; pads = WAGO data sheet land pattern
Run:  D:\KiCAD\bin\python.exe make_lib.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)  # All generated libraries stay inside this independent variant.

PINS = {  # pin number -> (name, electrical type)
    1: ("P400", "bidirectional"), 2: ("P401", "bidirectional"), 3: ("P402", "bidirectional"), 4: ("VBATT", "power_in"), 5: ("VCL", "passive"),
    6: ("P215/XCIN", "input"), 7: ("P214/XCOUT", "output"), 8: ("VSS", "power_in"), 9: ("P213/XTAL", "bidirectional"), 10: ("P212/EXTAL", "bidirectional"),
    11: ("VCC", "power_in"), 12: ("P411", "bidirectional"), 13: ("P410", "bidirectional"), 14: ("P409", "bidirectional"), 15: ("P408", "bidirectional"),
    16: ("P407", "bidirectional"), 17: ("VSS_USB", "power_in"), 18: ("P915/USB_DM", "bidirectional"), 19: ("P914/USB_DP", "bidirectional"),
    20: ("VCC_USB", "passive"), 21: ("VCC_USB_LDO", "power_in"), 22: ("P206", "bidirectional"), 23: ("P205", "bidirectional"), 24: ("P204", "bidirectional"),
    25: ("~{RES}", "input"), 26: ("P201/MD", "bidirectional"), 27: ("P200", "input"), 28: ("P304", "bidirectional"), 29: ("P303", "bidirectional"),
    30: ("P302", "bidirectional"), 31: ("P301", "bidirectional"), 32: ("P300/SWCLK", "bidirectional"), 33: ("P108/SWDIO", "bidirectional"),
    34: ("P109", "bidirectional"), 35: ("P110", "bidirectional"), 36: ("P111", "bidirectional"), 37: ("P112", "bidirectional"), 38: ("P113", "bidirectional"),
    39: ("VCC", "power_in"), 40: ("VSS", "power_in"), 41: ("P107", "bidirectional"), 42: ("P106", "bidirectional"), 43: ("P105", "bidirectional"),
    44: ("P104", "bidirectional"), 45: ("P103", "bidirectional"), 46: ("P102", "bidirectional"), 47: ("P101/SDA", "bidirectional"), 48: ("P100/SCL", "bidirectional"),
    49: ("P500", "bidirectional"), 50: ("P501", "bidirectional"), 51: ("P502", "bidirectional"), 52: ("P015", "bidirectional"), 53: ("P014/AN009", "bidirectional"),
    54: ("P013/VREFL", "bidirectional"), 55: ("P012/VREFH", "bidirectional"), 56: ("AVCC0", "power_in"), 57: ("AVSS0", "power_in"),
    58: ("P011/VREFL0", "passive"), 59: ("P010/VREFH0", "passive"), 60: ("P004", "bidirectional"), 61: ("P003", "bidirectional"),
    62: ("P002/AN002", "bidirectional"), 63: ("P001/AN001", "bidirectional"), 64: ("P000/AN000", "bidirectional"),
}
assert len(PINS) == 64

FONT = "(effects (font (size 1.27 1.27)))"
left, right = list(range(1, 33)), list(range(64, 32, -1))          # two columns of 32, 2.54 mm apart
H = 32 * 2.54
top = H / 2 - 1.27
body = ["(symbol \"R7FA4M1AB3CFM\" (exclude_from_sim no) (in_bom yes) (on_board yes)",
        f"  (property \"Reference\" \"U\" (at -20.32 {top + 5:.2f} 0) {FONT})",
        f"  (property \"Value\" \"R7FA4M1AB3CFM\" (at 0 {-(top + 5):.2f} 0) {FONT})",
        f"  (property \"Footprint\" \"Package_QFP:LQFP-64_10x10mm_P0.5mm\" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))",
        f"  (property \"Datasheet\" \"https://www.renesas.com/ra4m1\" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))",
        "  (symbol \"R7FA4M1AB3CFM_0_1\"",
        f"    (rectangle (start -20.32 {top + 2.54:.2f}) (end 20.32 {-(top + 2.54):.2f}) (stroke (width 0.254) (type default)) (fill (type background))))",
        "  (symbol \"R7FA4M1AB3CFM_1_1\""]
for col, nums, x, ang in (("L", left, -25.4, 0), ("R", right, 25.4, 180)):
    for i, n in enumerate(nums):
        name, typ = PINS[n]
        body.append(f"    (pin {typ} line (at {x} {top - i * 2.54:.2f} {ang}) (length 5.08) (name \"{name}\" {FONT}) (number \"{n}\" {FONT}))")
body += ["  )", ")"]
open("hp_sensor.kicad_sym", "w", encoding="utf8").write(
    "(kicad_symbol_lib (version 20231120) (generator \"make_lib\")\n" + "\n".join(body) + "\n)\n")

# ---------------- WAGO 2060-453 footprint ----------------
# Data sheet land pattern, per pole: one 6.0 x 2.0 mm pad and one 3.5 x 2.0 mm pad, 14.0 mm over both, poles on a 4.0 mm pitch.
# Body 13.1 x 11.9 x 4.5 mm; wires enter from the -x side (the long-pad end). Both pads of a pole are the same contact.
POLES, PITCH = 3, 4.0
fp = ["(footprint \"WAGO_2060-453\" (version 20240108) (generator \"make_lib\") (layer \"F.Cu\")",
      "  (descr \"WAGO 2060-453/998-404, 3-pole SMD PCB terminal block with push-buttons, 4 mm pitch, 4.5 mm tall, 18-24 AWG, wire entry from -x\")",
      "  (attr smd)",
      "  (property \"Reference\" \"REF**\" (at 0 -7.6 0) (layer \"F.SilkS\") (effects (font (size 1 1) (thickness 0.15))))",
      "  (property \"Value\" \"WAGO_2060-453\" (at 0 7.8 0) (layer \"F.Fab\") (effects (font (size 1 1) (thickness 0.15))))"]
for k in range(POLES):
    y = (k - (POLES - 1) / 2) * PITCH
    fp.append(f"  (pad \"{k + 1}\" smd rect (at -4.0 {y}) (size 6.0 2.0) (layers \"F.Cu\" \"F.Paste\" \"F.Mask\"))")
    fp.append(f"  (pad \"{k + 1}\" smd rect (at 5.25 {y}) (size 3.5 2.0) (layers \"F.Cu\" \"F.Paste\" \"F.Mask\"))")
hw = (POLES * PITCH - 0.1) / 2


def rect(layer, x0, y0, x1, y1, w):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    return [f"  (fp_line (start {a[0]} {a[1]}) (end {b[0]} {b[1]}) (stroke (width {w}) (type solid)) (layer \"{layer}\"))" for a, b in zip(pts, pts[1:])]


fp += rect("F.Fab", -6.6, -hw, 6.5, hw, 0.1) + rect("F.CrtYd", -7.5, -hw - 0.5, 7.5, hw + 0.5, 0.05)
fp += [f"  (fp_line (start -6.75 {-hw - 0.15}) (end 6.65 {-hw - 0.15}) (stroke (width 0.12) (type solid)) (layer \"F.SilkS\"))",
       f"  (fp_line (start -6.75 {hw + 0.15}) (end 6.65 {hw + 0.15}) (stroke (width 0.12) (type solid)) (layer \"F.SilkS\"))", ")"]
os.makedirs("hp_sensor.pretty", exist_ok=True)
open("hp_sensor.pretty/WAGO_2060-453.kicad_mod", "w", encoding="utf8").write("\n".join(fp) + "\n")
# ---------------- programming-clip hole row ----------------
# Five plated holes on a 2.54 mm pitch for a clothes-peg style pogo-pin clip ("2.54 mm 5P single row PCB clip"). Nothing is soldered here.
row = ["(footprint \"ClipRow_1x05_P2.54mm\" (version 20240108) (generator \"make_lib\") (layer \"F.Cu\")",
       "  (descr \"Row of 5 plated holes, 2.54 mm pitch, for a pogo-pin programming clip\")", "  (attr exclude_from_pos_files exclude_from_bom)",
       "  (property \"Reference\" \"REF**\" (at 5.08 -2 0) (layer \"F.SilkS\") (effects (font (size 1 1) (thickness 0.15))))",
       "  (property \"Value\" \"ClipRow_1x05\" (at 5.08 2 0) (layer \"F.Fab\") (effects (font (size 1 1) (thickness 0.15))))"]
for k in range(5):
    shape = "rect" if k == 0 else "circle"
    row.append(f"  (pad \"{k + 1}\" thru_hole {shape} (at {k * 2.54} 0) (size 1.6 1.6) (drill 1.0) (layers \"*.Cu\" \"*.Mask\"))")
row += rect("F.CrtYd", -1.0, -1.0, 4 * 2.54 + 1.0, 1.0, 0.05) + [")"]
open("hp_sensor.pretty/ClipRow_1x05_P2.54mm.kicad_mod", "w", encoding="utf8").write("\n".join(row) + "\n")

# Compact variant: three wires hand-soldered into bare plated holes. No connector
# is assembled; mask openings on both sides, no paste. Pad 1 is VIN, 2 data, 3 GND.
# Pad-level thermal settings override a solid plane setting for solderability.
cable = ["(footprint \"CableSolder_1x03\" (version 20240108) (generator \"make_lib\") (layer \"F.Cu\")",
         "  (descr \"Three cable solder holes: 1=VIN, 2=SDI-12, 3=GND; 1.2 mm drill, 2.4 mm pad, 4 mm pitch; no fitted connector\")",
         "  (attr through_hole exclude_from_pos_files exclude_from_bom)",
         "  (property \"Reference\" \"REF**\" (at 0 -6 0) (layer \"F.SilkS\") (effects (font (size 1 1) (thickness 0.15))))",
         "  (property \"Value\" \"CableSolder_1x03\" (at 0 6 0) (layer \"F.Fab\") (effects (font (size 1 1) (thickness 0.15))))"]
for k, y in enumerate((-4.0, 0.0, 4.0), 1):
    shape = "rect" if k == 1 else "circle"
    cable.append(f'  (pad "{k}" thru_hole {shape} (at 0 {y}) (size 2.4 2.4) (drill 1.2) (layers "*.Cu" "*.Mask") (zone_connect 1) (thermal_bridge_angle 45) (thermal_bridge_width 0.3) (thermal_gap 0.25))')
cable += rect("F.CrtYd", -1.5, -5.5, 1.5, 5.5, 0.05) + [")"]
open("hp_sensor.pretty/CableSolder_1x03.kicad_mod", "w", encoding="utf8").write("\n".join(cable) + "\n")
print("wrote compact-variant symbol library, programming footprints, and CableSolder_1x03")
