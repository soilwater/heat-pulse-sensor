"""Transplant the flared prong outline onto the AUDITED routed board without
touching copper, so finalize_copper's coordinate-pinned repairs stay valid.

Why this exists: flat-nano is released via `release.py --verify-existing` on one
hand-audited routed board (finalize_copper hard-codes R24.1/U4.6 copper at
absolute coordinates). A full re-route would break that. The JLC >=2 mm prong-neck
flare is an Edge_Cuts-only change, so we edit just the board outline here.

Workflow:
  1. Restore hp_sensor_routed.kicad_pcb (+ .kicad_pro) from OneDrive to the 13:14
     version (SHA below). This script refuses to run on any other board.
  2. D:\\KiCAD\\bin\\python.exe gen_pcb.py 12G      # writes the FLARED outline into hp_sensor.kicad_pcb (unrouted)
  3. D:\\KiCAD\\bin\\python.exe patch_flare.py       # copies that outline onto the routed board, refills zones
  4. D:\\KiCAD\\bin\\python.exe release.py --verify-existing

Run with KiCad's Python.
"""
import hashlib
import shutil
import sys

import pcbnew

ROUTED = "hp_sensor_routed.kicad_pcb"
FRESH = "hp_sensor.kicad_pcb"                 # flared, unrouted, straight from gen_pcb.py 12G
AUDITED_SHA = "c2e3629a0424d9fac3f02bf377cdc9516ef266c8ae9b11466cce4138515ff8d5"


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def edge_segments(board):
    return [s for s in board.GetDrawings()
            if s.GetLayer() == pcbnew.Edge_Cuts and isinstance(s, pcbnew.PCB_SHAPE)
            and s.GetShape() == pcbnew.SHAPE_T_SEGMENT]


def main():
    have = sha(ROUTED)
    if have != AUDITED_SHA:
        sys.exit(f"REFUSING: {ROUTED} SHA is {have}, not the audited {AUDITED_SHA}.\n"
                 f"Restore the 2026-09-23 13:14 version from OneDrive version history first.")

    fresh = pcbnew.LoadBoard(FRESH)
    fresh_edges = edge_segments(fresh)
    if not fresh_edges:
        sys.exit(f"No Edge_Cuts segments in {FRESH}; run `gen_pcb.py 12G` (flared) first.")

    routed = pcbnew.LoadBoard(ROUTED)
    shutil.copyfile(ROUTED, ROUTED + ".preflare.bak")

    removed = 0
    for s in list(routed.GetDrawings()):
        if s.GetLayer() == pcbnew.Edge_Cuts:
            routed.Remove(s)
            removed += 1
    for s in fresh_edges:
        ns = pcbnew.PCB_SHAPE(routed)
        ns.SetShape(pcbnew.SHAPE_T_SEGMENT)
        ns.SetLayer(pcbnew.Edge_Cuts)
        ns.SetWidth(s.GetWidth())
        ns.SetStart(s.GetStart())
        ns.SetEnd(s.GetEnd())
        routed.Add(ns)

    filler = pcbnew.ZONE_FILLER(routed)
    filler.Fill(routed.Zones())
    routed.BuildConnectivity()
    pcbnew.SaveBoard(ROUTED, routed)
    print(f"Edge_Cuts replaced: removed {removed}, added {len(fresh_edges)} flared segments. "
          f"Copper untouched. Backup: {ROUTED}.preflare.bak")
    print("Next: release.py --verify-existing")


if __name__ == "__main__":
    main()
