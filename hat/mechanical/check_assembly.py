"""Conservative compact-hat/Nano R4 assembly-envelope checks, without edits.

Run with KiCad Python; --board accepts a placement or routed board, --json prints
all checked clearances. XY uses inflated axis-aligned boxes, NOT exact solid
intersection. Nano heights come from Arduino's nominal STEP vertex envelopes;
their curved extrema and production tolerances are not guaranteed by the model.
The allowances below are engineering budgets, not supplier-certified tolerances.
Physical first-article fit and height measurements remain required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
import pcbnew as pcb

HERE = Path(__file__).resolve().parent
HAT = HERE.parent
LENGTH, WIDTH = 43.18, 17.78
XY_ALLOWANCE = .20  # Each opposing envelope, including nominal-model extrema.
NANO_HEIGHT_ALLOWANCE = .20
GAP_ALLOWANCE = .10
SOLDER_ALLOWANCE = .10
MIN_CLEARANCE = .40
DEFAULT_GAP = 4.0
PINOUT_URL = "https://docs.arduino.cc/resources/pinouts/ABX00142-full-pinout.pdf"

# Independent transcription of the official pinout viewed component-side,
# USB at top. Digital contacts are on the right, analog/power on the left.
# When Nano faces DOWN over KiCad's top view with USB pointing left, digital
# contacts belong at +7.62 mm Y. KiCad screen-down Y and STEP right-handed Y
# differ: do not mirror the STEP Y coordinates a second time.
ROWS = {
    "J3": {"y": 7.62,
           "labels": ("D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND", "RST", "D0", "D1"),
           "nets": ("", "", "", "D9_HEAT", "", "", "", "", "D4_EXC", "", "D2_SDI12", "GND", "", "", "")},
    "J4": {"y": -7.62,
           "labels": ("D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "BOOT", "GND", "VIN"),
           "nets": ("", "", "VREF", "A0_TH1", "A1_TH2", "A2_TH3", "A3_TH4", "A4_SDA", "A5_SCL", "", "", "+5V", "", "GND", "NANO_VIN")},
}

# Where a verified part maximum is available, add 0.10 mm solder allowance.
# Other small packages use an intentionally generous 1.50 mm assembled design
# envelope. That generic bound is a documented assumption to check on receipt;
# it must not be presented as a manufacturer maximum for unspecified parts.
HEIGHTS = {
    "C1": (1.40 + SOLDER_ALLOWANCE,
           "CL21A475KBQNNNE thickness 1.25 +/-0.15 mm; Samsung product table",
           "https://product.samsungsem.com/mlcc/CL21A475KBQNNN.do"),
    "C2": (1.45 + SOLDER_ALLOWANCE,
           "CL21A106KAYNNNE thickness 1.25 +/-0.20 mm; Samsung product table",
           "https://product.samsungsem.com/mlcc/CL21A106KAYNNN.do"),
    "U4": (1.10 + SOLDER_ALLOWANCE,
           "INA226 DGS0010A VSSOP package drawing: 1.10 mm maximum",
           "https://www.ti.com/lit/ds/symlink/ina226.pdf"),
    "D4": (1.10 + SOLDER_ALLOWANCE,
           "PESD5V0S1BA SOD323 package drawing: dimension A 1.10 mm maximum",
           "https://assets.nexperia.com/documents/data-sheet/PESD5V0S1BA.pdf"),
}
GENERIC_PACKAGES = {
    "C_0402_1005Metric", "R_0402_1005Metric", "R_0603_1608Metric",
    "R_0805_2012Metric", "R_0805_2012Metric_Pad1.20x1.40mm_HandSolder",
    "SOT-23", "D_SOD-123F", "R_0402_1005Metric_Pad0.72x0.64mm_HandSolder",
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def near(a, b, tolerance=.001):
    return abs(a-b) <= tolerance


def overlap(a, b, allowance=0.):
    return (a[0]-allowance <= b[2]+allowance and b[0]-allowance <= a[2]+allowance and
            a[1]-allowance <= b[3]+allowance and b[1]-allowance <= a[3]+allowance)


def board_origin(board):
    points = [p for shape in board.GetDrawings() if shape.GetLayer() == pcb.Edge_Cuts
              for p in (shape.GetStart(), shape.GetEnd())]
    if not points:
        raise ValueError("No board outline")
    return min(pcb.ToMM(p.x) for p in points), (min(pcb.ToMM(p.y) for p in points)+max(pcb.ToMM(p.y) for p in points))/2


def xy(point, origin):
    return pcb.ToMM(point.x)-origin[0], pcb.ToMM(point.y)-origin[1]


def box_mm(box, origin):
    return [pcb.ToMM(box.GetLeft())-origin[0], pcb.ToMM(box.GetTop())-origin[1],
            pcb.ToMM(box.GetRight())-origin[0], pcb.ToMM(box.GetBottom())-origin[1]]


def body_box(fp, origin):
    """Actual placed F.Fab drawings plus pads; no reference/value text.

    Bounding Fab ink slightly overestimates packages, deliberately conservative.
    Including pads also includes leads/land-pattern extents in the box.
    """
    shapes = [item for item in fp.GraphicalItems() if isinstance(item, pcb.PCB_SHAPE) and item.GetLayer() == pcb.F_Fab]
    if not shapes:
        raise ValueError(f"{fp.GetReference()}: missing F.Fab body geometry")
    boxes = [box_mm(item.GetBoundingBox(), origin) for item in shapes + list(fp.Pads())]
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def hat_height(fp):
    ref, package = fp.GetReference(), fp.GetFPIDAsString().split(":")[-1]
    if ref in HEIGHTS:
        height, basis, source = HEIGHTS[ref]
        return {"assembled_height_mm": height, "basis": basis, "source": source, "manufacturer_max_used": True}
    if package in GENERIC_PACKAGES:
        return {"assembled_height_mm": 1.50, "basis": "Conservative assembled package envelope; verify actual supplied part <=1.50 mm",
                "source": None, "manufacturer_max_used": False}
    raise ValueError(f"{ref}: no reviewed height allowance for {package}; add its package maximum")


def run(board_path, envelope_path, gap, minimum):
    before = {path: digest(path) for path in (board_path, envelope_path)}
    board = pcb.LoadBoard(str(board_path))
    envelope = json.loads(envelope_path.read_text(encoding="utf8"))
    origin = board_origin(board)
    fps = {fp.GetReference(): fp for fp in board.GetFootprints()}
    errors, warnings, pairs, contacts, hats = [], [], [], [], []
    def check(condition, message):
        if not condition:
            errors.append(message)
    check(envelope.get("units") == "mm", "Nano envelope units must be millimetres")
    check("Nano y-8.89" in envelope.get("face_to_face_mapping", ""),
          "Nano envelope mapping must use the corrected STEP-to-KiCad face-down Y convention")
    source = HERE / envelope["source_file"]
    check(source.is_file() and digest(source) == envelope["source_sha256"], "Arduino STEP source hash mismatch")
    nano_parts = {part["ref"]: part for part in envelope["parts"]}
    check({"Board", "J1", "J2", "U1", "DL2", "DL3"} <= set(nano_parts), "Nano model lacks required board/connector/orientation landmarks")
    # Independently anchor STEP row orientation to official pinout LEDs.
    check(nano_parts["DL2"]["bbox_max_mm"][1] < WIDTH/2 and nano_parts["DL3"]["bbox_min_mm"][1] > WIDTH/2,
          "STEP LED landmarks disagree with analog-left/digital-right official pinout")
    for ref, row in ROWS.items():
        if ref not in fps:
            check(False, f"Missing Nano mating row {ref}")
            continue
        fp = fps[ref]
        check(fp.GetLayer() == pcb.F_Cu, f"{ref}: header insulator must be mounted on hat component side")
        check(fp.GetFPIDAsString().split(":")[-1] == "Nano_SolderStack_1x15",
              f"{ref}: expected direct solder Samtec HTSW stack footprint")
        pads = {pad.GetNumber(): pad for pad in fp.Pads() if pad.GetNumber()}
        check(set(pads) == {str(i) for i in range(1, 16)}, f"{ref}: expected 15 contacts")
        for i, (label, net) in enumerate(zip(row["labels"], row["nets"]), 1):
            pad = pads.get(str(i))
            if pad is None:
                continue
            actual = xy(pad.GetPosition(), origin)
            expected = (3.81+2.54*(i-1), row["y"])
            check(all(near(a, b) for a, b in zip(actual, expected)),
                  f"{ref}.{i} ({label}): position {actual} must be {expected} for face-down Nano")
            check(pad.GetNetname().lstrip("/") == net, f"{ref}.{i} ({label}): net must be {net!r}, got {pad.GetNetname()!r}")
            check(pad.GetAttribute() == pcb.PAD_ATTRIB_PTH, f"{ref}.{i}: connector contact is not plated through-hole")
            check(near(pcb.ToMM(pad.GetDrillSize().x), 1.1) and near(pcb.ToMM(pad.GetDrillSize().y), 1.1),
                  f"{ref}.{i}: expected 1.10 mm finished drill for 0.635 mm square HTSW pins")
            check(near(pcb.ToMM(pad.GetSize().x), 1.8) and near(pcb.ToMM(pad.GetSize().y), 1.8),
                  f"{ref}.{i}: expected 1.80 mm copper pad")
            contacts.append({"reference": ref, "pin": i, "nano_signal": label, "hat_net": net, "hat_xy_mm": actual})
    for ref, fp in fps.items():
        if xy(fp.GetPosition(), origin)[0] > LENGTH or ref in ("J3", "J4"):
            continue
        check(fp.GetLayer() == pcb.F_Cu, f"{ref}: unexpected bottom component changes the height budget")
        if ref == "J1":
            # Cable exits on the exposed rear of the HAT. Cap the solder mound
            # on the face toward Nano at 0.50 mm; wires themselves must not run
            # through the inter-board gap. Check each pad, not their empty span.
            for pad in fp.Pads():
                hats.append({"ref": f"J1.{pad.GetNumber()} solder mound", "bbox": box_mm(pad.GetBoundingBox(), origin),
                             "assembled_height_mm": .50, "basis": "Assembly limit: wires exit HAT rear, facing solder mound <=0.50 mm",
                             "manufacturer_max_used": False})
            continue
        height = hat_height(fp)
        hats.append({"ref": ref, "bbox": body_box(fp, origin), **height})
    for hat in hats:
        check(hat["bbox"][0] >= -.1 and hat["bbox"][2] <= LENGTH+.1 and
              hat["bbox"][1] >= -WIDTH/2-.1 and hat["bbox"][3] <= WIDTH/2+.1,
              f"{hat['ref']}: package envelope extends beyond the head")
        for ref, part in nano_parts.items():
            if ref == "Board":
                continue
            lo, hi = part["bbox_min_mm"], part["bbox_max_mm"]
            nano_box = [lo[0], lo[1]-WIDTH/2, hi[0], hi[1]-WIDTH/2]
            if not overlap(hat["bbox"], nano_box, XY_ALLOWANCE):
                continue
            clear = gap-GAP_ALLOWANCE-max(0, hi[2])-NANO_HEIGHT_ALLOWANCE-hat["assembled_height_mm"]
            pairs.append({"hat": hat["ref"], "nano": ref, "clearance_after_allowances_mm": round(clear, 6),
                          "hat_bbox_mm": hat["bbox"], "nano_bbox_mm": nano_box})
            check(clear >= minimum-1e-6, f"{hat['ref']} opposite Nano {ref}: {clear:.3f} mm clearance is below {minimum:.3f} mm")
    connector_clearances = {}
    for ref, label in (("J1", "USB-C"), ("J2", "Qwiic")):
        part = nano_parts[ref]
        clearance = gap-GAP_ALLOWANCE-part["bbox_max_mm"][2]-NANO_HEIGHT_ALLOWANCE
        connector_clearances[label] = round(clearance, 6)
        check(clearance >= minimum, f"Nano {label}: connector-to-bare-hat gap is only {clearance:.3f} mm")
    warnings.append("Generic 1.50 mm assembled-height budgets are assumptions; confirm actual supplied parts and solder height.")
    warnings.append("STEP vertex boxes with 0.20 mm inflation are screening envelopes, not supplier tolerance-certified solid models.")
    warnings.append("Direct solder HTSW header housings intentionally excluded from opposing-part collision pairs; housing fit, 4.00 mm fixture spacing and trimmed outer solid tails require the documented assembly fit check.")
    warnings.append("USB/Qwiic envelope check covers connector bodies; do not install a Qwiic cable in the potted head. USB cable is temporary before potting.")
    for path, old in before.items():
        check(digest(path) == old, f"Input was modified during read-only validation: {path}")
    return {"passed": not errors, "errors": errors, "warnings": warnings,
            "board": str(board_path), "board_sha256": before[board_path],
            "envelope_sha256": before[envelope_path], "pinout_source": PINOUT_URL,
            "mapping": "HAT x=Nano x, HAT y=Nano y-8.89, HAT facing height=gap-Nano z",
            "interconnect": {"part": "Samtec HTSW-115-07-T-S", "quantity": 2, "joint_type": "Soldered through both boards; no sockets",
                             "hat_hole_mm": 1.10, "hat_pad_mm": 1.80, "maximum_outer_pin_solder_projection_each_face_mm": .50},
            "assumptions_mm": {"nominal_gap": gap, "gap_reduction": GAP_ALLOWANCE, "minimum_clearance": minimum,
                               "xy_inflation_each_envelope": XY_ALLOWANCE, "nano_height_increase": NANO_HEIGHT_ALLOWANCE,
                               "solder_allowance_on_part_maxima": SOLDER_ALLOWANCE},
            "nominal_board_and_gap_thickness_mm": round(pcb.ToMM(board.GetDesignSettings().GetBoardThickness())+
                                                         gap+envelope["board_thickness_mm"], 6),
            "thickness_note": "Board-and-gap total excludes outer connector tails, solder joints, cable and encapsulation; not the finished head thickness.",
            "minimum_opposing_part_clearance_mm": min((p["clearance_after_allowances_mm"] for p in pairs), default=None),
            "connector_to_bare_hat_clearance_mm": connector_clearances,
            "contacts_checked": contacts, "hat_envelopes": hats,
            "opposing_pairs": sorted(pairs, key=lambda item: item["clearance_after_allowances_mm"])}


def self_test():
    assert overlap([0, 0, 1, 1], [1.3, 0, 2, 1], .2), "XY uncertainty must capture near misses"
    assert not overlap([0, 0, 1, 1], [1.5, 0, 2, 1], .2), "Separated XY boxes incorrectly overlap"
    assert near(16.51-WIDTH/2, ROWS["J3"]["y"]), "Digital row mirror"
    assert near(1.27-WIDTH/2, ROWS["J4"]["y"]), "Analog row mirror"
    assert ROWS["J4"]["nets"][12] == "", "BOOT must remain unconnected"
    assert ROWS["J3"]["nets"][11] == "GND", "Digital row ground pin"
    print("PASS: XY allowances, STEP/KiCad mirror, BOOT isolation and digital ground fixtures")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board", type=Path, default=HAT / "kicad/hp_hat_routed.kicad_pcb")
    parser.add_argument("--envelope", type=Path, default=HERE / "nano-r4-envelope.json")
    parser.add_argument("--gap-mm", type=float, default=DEFAULT_GAP)
    parser.add_argument("--minimum-clearance-mm", type=float, default=MIN_CLEARANCE)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    result = run(args.board, args.envelope, args.gap_mm, args.minimum_clearance_mm)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Compact hat assembly envelope: {'PASS' if result['passed'] else 'FAIL'}; {len(result['errors'])} errors")
        print(f"Checked {len(result['contacts_checked'])} pin positions/nets and {len(result['opposing_pairs'])} opposing part pairs")
        print("Minimum opposing-part clearance after allowances:", result["minimum_opposing_part_clearance_mm"], "mm")
        print("USB/Qwiic body-to-bare-hat gaps:", result["connector_to_bare_hat_clearance_mm"], "mm")
        for message in result["errors"]:
            print("ERROR:", message)
        for message in result["warnings"]:
            print("NOTE:", message)
    return int(not result["passed"])


if __name__ == "__main__":
    sys.exit(main())
