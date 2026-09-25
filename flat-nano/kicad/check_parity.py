"""Independent check that the routed board matches the schematic.
Compares KiCad's own netlist export of hp_sensor.kicad_sch with the pad nets on hp_sensor_routed.kicad_pcb,
and checks that every component of the schematic is on the board with the right footprint.
Run:  D:\KiCAD\bin\python.exe check_parity.py   (after: kicad-cli sch export netlist -o hp_sensor.net hp_sensor.kicad_sch)
"""
import sys, pcbnew, os, json
from sexpr import parse, find

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

net = parse(open("hp_sensor.net", encoding="utf8").read())
sch_pins, sch_fp, sch_values = {}, {}, {}
for comp in find(find(net, "components")[0], "comp"):
    ref = find(comp, "ref")[0][1]
    sch_fp[ref] = find(comp, "footprint")[0][1] if find(comp, "footprint") else ""
    sch_values[ref] = find(comp, "value")[0][1] if find(comp, "value") else ""
for n in find(find(net, "nets")[0], "net"):
    name = find(n, "name")[0][1]
    for node in find(n, "node"):
        sch_pins[(find(node, "ref")[0][1], find(node, "pin")[0][1])] = name.lstrip("/")

b = pcbnew.LoadBoard("hp_sensor_routed.kicad_pcb")
pcb_pins, pcb_fp, pcb_values = {}, {}, {}
for fp in b.GetFootprints():
    pcb_fp[fp.GetReference()] = str(fp.GetFPID().GetUniStringLibId()) if hasattr(fp.GetFPID(), "GetUniStringLibId") else fp.GetFPIDAsString()
    pcb_values[fp.GetReference()] = fp.GetValue()
    for pad in fp.Pads():
        if pad.GetNumber(): pcb_pins.setdefault((fp.GetReference(), pad.GetNumber()), set()).add(pad.GetNetname())

errors = []
for ref in sch_fp:
    if ref.startswith("#"): continue
    if ref not in pcb_fp: errors.append(f"{ref}: in schematic, missing on board")
for ref in pcb_fp:
    if ref not in sch_fp: errors.append(f"{ref}: on board, not in schematic")
    else:
        # FootprintLoad(path, name) may serialize only the item name. Compare
        # library-qualified IDs when available; otherwise retain item-name check.
        expected_fp = sch_fp[ref] if ":" in pcb_fp[ref] else sch_fp[ref].split(":", 1)[-1]
        if pcb_fp[ref] != expected_fp: errors.append(f"{ref}: schematic footprint {sch_fp[ref]} differs from board {pcb_fp[ref]}")
        if pcb_values[ref] != sch_values[ref]: errors.append(f"{ref}: schematic value {sch_values[ref]} differs from board {pcb_values[ref]}")
for key, name in sch_pins.items():
    if key[0].startswith("#"): continue
    got = pcb_pins.get(key)
    if got is None: errors.append(f"{key[0]}.{key[1]}: pad missing on board (schematic net {name})")
    elif name.startswith("unconnected-") and got == {""}: pass        # KiCad names no-connect pins; an empty pad net is the same thing
    elif got != {name}: errors.append(f"{key[0]}.{key[1]}: schematic net {name} but board has {sorted(got)}")
for key, got in pcb_pins.items():
    if key not in sch_pins and got != {""}: errors.append(f"{key[0]}.{key[1]}: board pad on {sorted(got)} but schematic has the pin unconnected")

# Explicit r2 changes: seventeen 3.3-ohm Vishay 0603 heater resistors in one
# series chain, plus 1.5-kohm 0402 R9/R12 gate resistors. J1 stays bare cable
# solder pads. Every other original part and electrical connection is retained.
original_path = os.path.abspath(os.path.join(HERE, "..", "..", "flat", "kicad", "netlist.json"))
original = json.load(open(original_path, encoding="utf8"))["parts"]
variant = json.load(open("netlist.json", encoding="utf8"))["parts"]
old_heaters = {f"RH{i}" for i in range(1, 23)}
new_heaters = {f"RH{i}" for i in range(1, 18)}
expected_refs = (set(original) - old_heaters) | new_heaters
if expected_refs != set(variant): errors.append("Variant component references differ from the reviewed r2 circuit.")
for ref in original.keys() & variant.keys():
    expected_pins = original[ref]["pins"]
    if ref in new_heaters:
        index = int(ref[2:])
        expected_pins = {"1": "HEAT_P" if index == 1 else f"H_{index - 1}",
                         "2": "HEAT_RTN" if index == 17 else f"H_{index}"}
    if expected_pins != variant[ref]["pins"]: errors.append(f"{ref}: electrical pin/net assignments differ from the reviewed r2 circuit")
    if ref != "J1":
        for field in ("value", "footprint"):
            expected = original[ref][field]
            if ref in new_heaters:
                expected = "3.3" if field == "value" else "hp_sensor:R_0603_Vishay_HP"
            elif ref in {"R9", "R12"} and field == "value":
                expected = "1.5k"
            if expected != variant[ref][field]: errors.append(f"{ref}: {field} differs from the reviewed r2 circuit")
    if sch_values.get(ref) != variant[ref]["value"]: errors.append(f"{ref}: exported schematic value differs from generator netlist")
    for pin, expected in variant[ref]["pins"].items():
        got = sch_pins.get((ref, pin), "")
        if expected is None:
            if got and not got.startswith("unconnected-"): errors.append(f"{ref}.{pin}: expected no-connect in variant source")
        elif got != expected: errors.append(f"{ref}.{pin}: exported schematic net differs from variant source")
print("Reviewed r2 circuit preserved: 17-part heater chain, two gate resistors, bare J1; all other components/connections unchanged." if not errors else "Variant preservation/parity needs correction.")
print(f"schematic: {len([r for r in sch_fp if not r.startswith('#')])} components, {len(sch_pins)} connected pins | board: {len(pcb_fp)} footprints")
print("PARITY OK - board matches schematic" if not errors else "PARITY ERRORS:\n  " + "\n  ".join(errors))
sys.exit(1 if errors else 0)
