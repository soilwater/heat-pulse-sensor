"""Apply the selected JLCPCB construction without changing circuit geometry.

JLC04081H-7628, nominal 0.8 mm, 1 oz outer / 0.5 oz inner copper.
The inner 0.0152 mm value is JLCPCB's published finished stack value for
the nominal 0.5 oz option; do not replace it with a generic 0.0175 mm.
Source: https://jlcpcb.com/impedance (0.8 mm selection, 2026-09-23).
Template API code: 20211110050413; default equivalent: 20220913081702554.
Mask thickness models JLC's C2 above-copper thickness, 0.6 mil. Its C1/C3
substrate/inter-track thickness is 1.2 mil. This is not impedance certification.
"""
from pathlib import Path
import argparse

from sexpr import parse, dump, find


STACKUP = '''(stackup
  (layer "F.SilkS" (type "Top Silk Screen") (color "White"))
  (layer "F.Paste" (type "Top Solder Paste"))
  (layer "F.Mask" (type "Top Solder Mask") (color "Green") (thickness 0.01524) (epsilon_r 3.8))
  (layer "F.Cu" (type "copper") (thickness 0.035))
  (layer "dielectric 1" (type "prepreg") (thickness 0.2104) (material "7628") (epsilon_r 4.4))
  (layer "In1.Cu" (type "copper") (thickness 0.0152))
  (layer "dielectric 2" (type "core") (thickness 0.25) (material "FR4") (epsilon_r 4.6))
  (layer "In2.Cu" (type "copper") (thickness 0.0152))
  (layer "dielectric 3" (type "prepreg") (thickness 0.2104) (material "7628") (epsilon_r 4.4))
  (layer "B.Cu" (type "copper") (thickness 0.035))
  (layer "B.Mask" (type "Bottom Solder Mask") (color "Green") (thickness 0.01524) (epsilon_r 3.8))
  (layer "B.Paste" (type "Bottom Solder Paste"))
  (layer "B.SilkS" (type "Bottom Silk Screen") (color "White"))
  (copper_finish "HASL lead free")
  (dielectric_constraints no)
)'''


def configure_file(path):
    path = Path(path)
    tree = parse(path.read_text(encoding="utf8"))
    if tree[0] != "kicad_pcb":
        raise ValueError("Expected a KiCad PCB")
    layers = find(tree, "layers")[0]
    copper = [str(item[1]) for item in layers[1:] if str(item[1]).endswith(".Cu")]
    if copper != ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]:
        raise ValueError(f"Unexpected compact-board copper stack: {copper}")
    thickness = float(find(find(tree, "general")[0], "thickness")[0][1])
    if abs(thickness - 0.8) > 1e-9:
        raise ValueError("The needle-compatible board must remain 0.8 mm nominal")
    setup = find(tree, "setup")[0]
    replacement = {
        "stackup": parse(STACKUP),
        "solder_mask_min_width": parse("(solder_mask_min_width 0.1)"),
        "pad_to_mask_clearance": parse("(pad_to_mask_clearance 0)"),
        "tenting": parse("(tenting (front yes) (back yes))"),
    }
    setup[:] = [setup[0]] + list(replacement.values()) + [
        item for item in setup[1:] if not (isinstance(item, list) and item[0] in replacement)
    ]
    result = dump(tree) + "\n"
    # Guard against a serializer changing any non-setup content.
    written = parse(result)
    without_setup = lambda t: [x for x in t if not (isinstance(x, list) and x[0] == "setup")]
    if without_setup(written) != without_setup(tree):
        raise ValueError("Unexpected serialization change outside fabrication setup")
    path.write_text(result, encoding="utf8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("board", type=Path)
    parser.add_argument("--finalize-copper", action="store_true")
    args = parser.parse_args()
    if args.finalize_copper:
        import pcbnew
        from finalize_copper import finalize_copper
        board = pcbnew.LoadBoard(str(args.board))
        changes = finalize_copper(board)
        board.BuildConnectivity()
        pcbnew.ZONE_FILLER(board).Fill(board.Zones())
        pcbnew.SaveBoard(str(args.board), board)
        print("Copper cleanup:", changes)
    configure_file(args.board)
    print("JLC04081H-7628: 0.8 mm, 1 oz outer / 0.5 oz inner, green, lead-free HASL, tented vias")


if __name__ == "__main__":
    main()
