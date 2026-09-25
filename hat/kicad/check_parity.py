"""Independent check that the routed board matches the schematic.
Compares KiCad's own netlist export of hp_hat.kicad_sch with the pad nets on hp_hat_routed.kicad_pcb,
and checks that every component of the schematic is on the board with the right footprint.
Run:  D:\KiCAD\bin\python.exe check_parity.py   (after: kicad-cli sch export netlist -o hp_hat.net hp_hat.kicad_sch)
"""
import sys, pcbnew
from sexpr import parse, find

net = parse(open("hp_hat.net", encoding="utf8").read())
sch_pins, sch_fp = {}, {}
for comp in find(find(net, "components")[0], "comp"):
    ref = find(comp, "ref")[0][1]
    sch_fp[ref] = find(comp, "footprint")[0][1] if find(comp, "footprint") else ""
for n in find(find(net, "nets")[0], "net"):
    name = find(n, "name")[0][1]
    for node in find(n, "node"):
        sch_pins[(find(node, "ref")[0][1], find(node, "pin")[0][1])] = name.lstrip("/")

b = pcbnew.LoadBoard("hp_hat_routed.kicad_pcb")
pcb_pins, pcb_fp = {}, {}
for fp in b.GetFootprints():
    pcb_fp[fp.GetReference()] = str(fp.GetFPID().GetUniStringLibId()) if hasattr(fp.GetFPID(), "GetUniStringLibId") else fp.GetFPIDAsString()
    for pad in fp.Pads():
        if pad.GetNumber(): pcb_pins.setdefault((fp.GetReference(), pad.GetNumber()), set()).add(pad.GetNetname())

errors = []
for ref in sch_fp:
    if ref.startswith("#"): continue
    if ref not in pcb_fp: errors.append(f"{ref}: in schematic, missing on board")
for ref in pcb_fp:
    if ref not in sch_fp: errors.append(f"{ref}: on board, not in schematic")
for key, name in sch_pins.items():
    if key[0].startswith("#"): continue
    got = pcb_pins.get(key)
    if got is None: errors.append(f"{key[0]}.{key[1]}: pad missing on board (schematic net {name})")
    elif name.startswith("unconnected-") and got == {""}: pass        # KiCad names no-connect pins; an empty pad net is the same thing
    elif got != {name}: errors.append(f"{key[0]}.{key[1]}: schematic net {name} but board has {sorted(got)}")
for key, got in pcb_pins.items():
    if key not in sch_pins and got != {""}: errors.append(f"{key[0]}.{key[1]}: board pad on {sorted(got)} but schematic has the pin unconnected")
print(f"schematic: {len([r for r in sch_fp if not r.startswith('#')])} components, {len(sch_pins)} connected pins | board: {len(pcb_fp)} footprints")
print("PARITY OK - board matches schematic" if not errors else "PARITY ERRORS:\n  " + "\n  ".join(errors))
sys.exit(1 if errors else 0)
