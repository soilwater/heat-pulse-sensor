"""Reject ordinary drilled vias in, or too near, any exterior pad opening.

Read-only. Run with KiCad's Python from any directory:
  python check_solder_vias.py [--board PATH] [--json] [--margin-mm 0.10]

The default board is this variant's routed board. An exit status of 1 means
violations; 0 means this geometric check passed. This checks both board sides,
including pads with mask but no paste. Tenting is not accepted as an exemption:
an overlapping component mask opening exposes the hole anyway. This variant
uses ordinary drilled vias, not a filled-and-capped manufacturing process.

Geometry uses KiCad's actual rounded/rotated/custom copper pad polygons and
effective mask expansion (pad, footprint, and board settings). A drill is a
circle at the via position. Required edge separation is 0.10 mm by default.
This does not model manufacturer mask editing/registration or certify assembly.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import pcbnew as pcb


DEFAULT_BOARD = Path(__file__).resolve().parents[1] / "kicad/hp_sensor_routed.kicad_pcb"
LAYER_PAIRS = ((pcb.F_Cu, pcb.F_Mask), (pcb.B_Cu, pcb.B_Mask))
POLYGON_ERROR_MM = 0.001


def exterior_mask_openings(board):
    """Return dictionaries with pad identity and effective mask polygon.

    `polygon` is a pcbnew.SHAPE_POLY_SET in KiCad nanometres. Each actual board
    side is returned separately. The original board and pads are never changed.
    """
    openings = []
    for footprint in board.GetFootprints():
        for pad in footprint.Pads():
            for copper_layer, mask_layer in LAYER_PAIRS:
                if not pad.IsOnLayer(mask_layer):
                    continue
                expansion = pad.GetSolderMaskExpansion(copper_layer)
                polygon = pcb.SHAPE_POLY_SET()
                pad.TransformShapeToPolygon(
                    polygon, copper_layer, expansion,
                    pcb.FromMM(POLYGON_ERROR_MM), pcb.ERROR_OUTSIDE,
                )
                if not polygon.OutlineCount():
                    continue
                openings.append({
                    "reference": footprint.GetReference(),
                    "pad": pad.GetNumber(),
                    "net": pad.GetNetname(),
                    "pad_type": "SMD" if pad.GetAttribute() == pcb.PAD_ATTRIB_SMD else "PTH" if pad.GetAttribute() == pcb.PAD_ATTRIB_PTH else "other",
                    "layer": copper_layer,
                    "layer_name": board.GetLayerName(copper_layer),
                    "mask_expansion_mm": pcb.ToMM(expansion),
                    "polygon": polygon,
                })
    return openings


def scan_board(board, margin_mm=0.10):
    """Return a serializable geometry report; no files or board mutations."""
    if not math.isfinite(margin_mm) or margin_mm < 0:
        raise ValueError("margin_mm must be finite and nonnegative")
    openings = exterior_mask_openings(board)
    vias = [track for track in board.GetTracks() if track.GetClass() == "PCB_VIA"]
    violations = []
    for via in vias:
        position = via.GetPosition()
        drill = via.GetDrill()
        required_radius = math.ceil(drill / 2 + pcb.FromMM(margin_mm))
        for opening in openings:
            if not via.IsOnLayer(opening["layer"]):
                continue
            polygon = opening["polygon"]
            if not polygon.Collide(position, required_radius):
                continue
            violations.append({
                key: value for key, value in opening.items()
                if key not in ("polygon", "layer")
            } | {
                "via_uuid": via.m_Uuid.AsString(),
                "via_net": via.GetNetname(),
                "via_x_mm": round(pcb.ToMM(position.x), 6),
                "via_y_mm": round(pcb.ToMM(position.y), 6),
                "via_drill_mm": pcb.ToMM(drill),
                "via_diameter_mm": pcb.ToMM(via.GetWidth(opening["layer"])),
                "hole_overlaps_opening": bool(polygon.Collide(position, math.ceil(drill / 2))),
                "via_center_inside_opening": bool(polygon.Contains(position)),
            })
    violations.sort(key=lambda item: (item["reference"], item["pad"], item["layer_name"], item["via_x_mm"], item["via_y_mm"]))
    return {
        "check": "ordinary_via_to_exterior_pad_opening",
        "passed": not violations,
        "required_hole_to_opening_margin_mm": margin_mm,
        "polygon_approximation_mm": POLYGON_ERROR_MM,
        "pad_openings_checked": len(openings),
        "smd_openings_checked": sum(item["pad_type"] == "SMD" for item in openings),
        "pth_openings_checked": sum(item["pad_type"] == "PTH" for item in openings),
        "vias_checked": len(vias),
        "violation_count": len(violations),
        "affected_vias": len({item["via_uuid"] for item in violations}),
        "violations": violations,
    }


def check_board(path=DEFAULT_BOARD, margin_mm=0.10):
    path = Path(path).resolve()
    report = scan_board(pcb.LoadBoard(str(path)), margin_mm)
    return {"board": str(path), "board_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **report}


def self_test():
    """Small geometry fixtures, with no files written."""
    def fixture(pad_type, side, x, expansion=0.0, mask=True):
        board = pcb.BOARD()
        footprint = pcb.FOOTPRINT(board); footprint.SetReference("TEST"); board.Add(footprint)
        pad = pcb.PAD(footprint); pad.SetNumber("1"); pad.SetAttribute(pad_type)
        pad.SetShape(pcb.PAD_SHAPE_CIRCLE); pad.SetSize(pcb.VECTOR2I(pcb.FromMM(1), pcb.FromMM(1)))
        pad.SetPosition(pcb.VECTOR2I(0, 0)); pad.SetLocalSolderMaskMargin(pcb.FromMM(expansion))
        layers = pcb.LSET(); layers.AddLayer(side)
        if mask: layers.AddLayer(pcb.F_Mask if side == pcb.F_Cu else pcb.B_Mask)
        pad.SetLayerSet(layers)
        if pad_type == pcb.PAD_ATTRIB_PTH:
            pad.SetDrillSize(pcb.VECTOR2I(pcb.FromMM(.4), pcb.FromMM(.4)))
        footprint.Add(pad)
        via = pcb.PCB_VIA(board); via.SetPosition(pcb.VECTOR2I(pcb.FromMM(x), 0))
        via.SetWidth(pcb.F_Cu, pcb.FromMM(.6)); via.SetDrill(pcb.FromMM(.35))
        via.SetViaType(pcb.VIATYPE_THROUGH); via.SetLayerPair(pcb.F_Cu, pcb.B_Cu); board.Add(via)
        return scan_board(board)
    cases = [
        ("front SMD overlap", pcb.PAD_ATTRIB_SMD, pcb.F_Cu, .6, 0, True, False),
        ("front PTH overlap", pcb.PAD_ATTRIB_PTH, pcb.F_Cu, .6, 0, True, False),
        ("bottom PTH overlap", pcb.PAD_ATTRIB_PTH, pcb.B_Cu, .6, 0, True, False),
        ("PTH gap below margin", pcb.PAD_ATTRIB_PTH, pcb.F_Cu, .75, 0, True, False),
        ("PTH sufficient margin", pcb.PAD_ATTRIB_PTH, pcb.F_Cu, .80, 0, True, True),
        ("effective mask expansion", pcb.PAD_ATTRIB_SMD, pcb.F_Cu, .80, .1, True, False),
        ("no mask opening", pcb.PAD_ATTRIB_SMD, pcb.F_Cu, .6, 0, False, True),
    ]
    for label, attr, side, x, expansion, mask, expected in cases:
        result = fixture(attr, side, x, expansion, mask)
        assert result["passed"] == expected, (label, result)
        assert result["vias_checked"] == 1
        if attr == pcb.PAD_ATTRIB_PTH: assert result["pth_openings_checked"] == 1
        print("PASS", label)
    print("Seven exterior-pad solder-via regression fixtures passed.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--board", type=Path, default=DEFAULT_BOARD)
    parser.add_argument("--margin-mm", type=float, default=0.10)
    parser.add_argument("--json", action="store_true", help="Print the full machine-readable report to stdout")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    report = check_board(args.board, args.margin_mm)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Exterior-pad solder-via check: {'PASS' if report['passed'] else 'FAIL'}; "
              f"{report['vias_checked']} vias tested against {report['pad_openings_checked']} openings "
              f"({report['smd_openings_checked']} SMD / {report['pth_openings_checked']} PTH); "
              f"{report['violation_count']} conflicts on {report['affected_vias']} vias; "
              f"required hole-edge separation {args.margin_mm:.3f} mm")
        print(f"Board SHA256: {report['board_sha256']}")
        for item in report["violations"]:
            kind = "hole overlaps opening" if item["hole_overlaps_opening"] else "less than required margin"
            print(f"  {item['reference']}.{item['pad']} {item['layer_name']}: {kind}; "
                  f"via ({item['via_x_mm']:.3f}, {item['via_y_mm']:.3f}) mm, "
                  f"drill {item['via_drill_mm']:.3f} mm, net {item['via_net']}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
