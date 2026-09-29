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

# TI LMR36503R5 (5 V fixed, 0.3 A, 3-65 V buck), RPE0009A. Pin functions from datasheet SNVSBB4B table 6-1.
BUCK = {1: ("RT", "input"), 2: ("PGOOD", "open_collector"), 3: ("EN", "input"), 4: ("VIN", "power_in"),
        5: ("SW", "power_out"), 6: ("BOOT", "passive"), 7: ("VCC", "power_out"), 8: ("VOUT", "input"), 9: ("GND", "power_in")}
body += ["(symbol \"LMR36503R5\" (exclude_from_sim no) (in_bom yes) (on_board yes)",
         f"  (property \"Reference\" \"U\" (at -7.62 8.89 0) {FONT})",
         f"  (property \"Value\" \"LMR36503R5RPER\" (at 0 -8.89 0) {FONT})",
         "  (property \"Footprint\" \"hp_sensor:TI_RPE0009A_VQFN-HR-9_2x2mm\" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))",
         "  (property \"Datasheet\" \"https://www.ti.com/lit/ds/symlink/lmr36503.pdf\" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))",
         "  (symbol \"LMR36503R5_0_1\"",
         "    (rectangle (start -7.62 7.62) (end 7.62 -7.62) (stroke (width 0.254) (type default)) (fill (type background))))",
         "  (symbol \"LMR36503R5_1_1\""]
for n, (x, y, ang) in {4: (-10.16, 5.08, 0), 3: (-10.16, 2.54, 0), 1: (-10.16, -2.54, 0), 2: (-10.16, -5.08, 0),
                       5: (10.16, 5.08, 180), 6: (10.16, 2.54, 180), 8: (10.16, 0, 180), 7: (10.16, -2.54, 180), 9: (0, -10.16, 90)}.items():
    name, typ = BUCK[n]
    body.append(f"    (pin {typ} line (at {x} {y} {ang}) (length 2.54) (name \"{name}\" {FONT}) (number \"{n}\" {FONT}))")
body += ["  )", ")"]
open("hp_sensor.kicad_sym", "w", encoding="utf8").write(
    "(kicad_symbol_lib (version 20231120) (generator \"make_lib\")\n" + "\n".join(body) + "\n)\n")

# ---------------- TI RPE0009A (VQFN-HR, 2 x 2 mm) ----------------
# Pads = TI "EXAMPLE BOARD LAYOUT" 4224447/C (datasheet page 49), exposed metal, non-solder-mask-defined.
# Drawing coordinates have +y up; KiCad has +y down, so every y below is negated. Corner pads are L-shaped.
RPE_PADS = {  # pin -> list of rectangles (x0, y0, x1, y1) in drawing coordinates (mm), union = pad copper
    1: [(-1.2, 0.625, -0.45, 0.85), (-0.85, 0.625, -0.45, 1.2)],
    2: [(-1.2, 0.125, -0.6, 0.375)],
    3: [(-1.2, -0.375, -0.6, -0.125)],
    4: [(-1.2, -0.85, -0.5, -0.625), (-0.85, -1.2, -0.5, -0.625)],
    5: [(0.5, -0.85, 1.2, -0.625), (0.5, -1.2, 0.85, -0.625)],
    6: [(0.6, -0.375, 1.2, -0.125)],
    7: [(0.6, 0.125, 1.2, 0.375)],
    8: [(0.45, 0.625, 1.2, 0.85), (0.45, 0.625, 0.85, 1.2)],
    9: [(-0.175, -0.1, 0.175, 1.2)],
}


def l_outline(rects):
    """Outline (drawing coords) of one rectangle or of an L made of two rectangles sharing a corner region."""
    if len(rects) == 1:
        x0, y0, x1, y1 = rects[0]
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    from itertools import product
    xs = sorted({v for r in rects for v in (r[0], r[2])}); ys = sorted({v for r in rects for v in (r[1], r[3])})
    inside = lambda px, py: any(r[0] < px < r[2] and r[1] < py < r[3] for r in rects)
    cells = {(i, j) for i, j in product(range(len(xs) - 1), range(len(ys) - 1)) if inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)}
    edges = set()                                   # boundary edges of the union of grid cells, walked into one loop
    for i, j in cells:
        for (a, b), nb in ((((i, j), (i + 1, j)), (i, j - 1)), (((i + 1, j), (i + 1, j + 1)), (i + 1, j)),
                           (((i + 1, j + 1), (i, j + 1)), (i, j + 1)), (((i, j + 1), (i, j)), (i - 1, j))):
            if nb not in cells: edges.add((a, b))
    start = next(iter(sorted(edges))); loop = [start[0]]; nxt = {a: b for a, b in edges}; cur = start[1]
    while cur != loop[0]: loop.append(cur); cur = nxt[cur]
    pts = [(xs[i], ys[j]) for i, j in loop]
    return [p for k, p in enumerate(pts) if not ((pts[k - 1][0] == p[0] == pts[(k + 1) % len(pts)][0]) or (pts[k - 1][1] == p[1] == pts[(k + 1) % len(pts)][1]))]


rpe = ["(footprint \"TI_RPE0009A_VQFN-HR-9_2x2mm\" (version 20240108) (generator \"make_lib\") (layer \"F.Cu\")",
       "  (descr \"TI RPE0009A VQFN-HR 9 pin 2x2 mm (LMR36503), land pattern per TI 4224447/C example board layout\")",
       "  (attr smd)",
       "  (property \"Reference\" \"REF**\" (at 0 -2.2 0) (layer \"F.SilkS\") (effects (font (size 0.6 0.6) (thickness 0.1))))",
       "  (property \"Value\" \"LMR36503\" (at 0 2.2 0) (layer \"F.Fab\") (effects (font (size 0.6 0.6) (thickness 0.1))))"]
for pin, rects in RPE_PADS.items():
    pts = [(x, -y) for x, y in l_outline(rects)]                       # to KiCad y-down
    ax = sum(p[0] for p in pts) / len(pts); ay = sum(p[1] for p in pts) / len(pts)
    x0, y0, x1, y1 = rects[0]; ax, ay = (x0 + x1) / 2, -(y0 + y1) / 2   # anchor inside the first rectangle
    poly = " ".join(f"(xy {px - ax:.4f} {py - ay:.4f})" for px, py in pts)
    rpe.append(f"  (pad \"{pin}\" smd custom (at {ax:.4f} {ay:.4f}) (size 0.2 0.2) (layers \"F.Cu\" \"F.Paste\" \"F.Mask\")"
               f" (options (clearance outline) (anchor rect)) (primitives (gr_poly (pts {poly}) (width 0) (fill yes))))")

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
# Pad 1 (VIN, square) sits on the board axis so the heater supply runs straight down the center line;
# ground is on the -y side, SDI-12 on the +y side. Thermal spokes are 0.5 mm: no narrower copper in the supply path.
for k, y in ((1, 0.0), (2, 4.0), (3, -4.0)):
    shape = "rect" if k == 1 else "circle"
    cable.append(f'  (pad "{k}" thru_hole {shape} (at 0 {y}) (size 2.4 2.4) (drill 1.2) (layers "*.Cu" "*.Mask") (zone_connect 1) (thermal_bridge_angle 45) (thermal_bridge_width 0.5) (thermal_gap 0.25))')
cable += rect("F.CrtYd", -1.5, -5.5, 1.5, 5.5, 0.05) + [")"]
open("hp_sensor.pretty/CableSolder_1x03.kicad_mod", "w", encoding="utf8").write("\n".join(cable) + "\n")
rpe += rect("F.Fab", -1.0, -1.0, 1.0, 1.0, 0.1) + rect("F.CrtYd", -1.45, -1.45, 1.45, 1.45, 0.05)
rpe += ["  (fp_circle (center -1.25 -1.25) (end -1.15 -1.25) (stroke (width 0.1) (type solid)) (fill yes) (layer \"F.SilkS\"))", ")"]
open("hp_sensor.pretty/TI_RPE0009A_VQFN-HR-9_2x2mm.kicad_mod", "w", encoding="utf8").write("\n".join(rpe) + "\n")
print("wrote compact-variant symbol library, programming footprints, CableSolder_1x03 and TI_RPE0009A")
