"""Read-only checks for the compact Nano R4 hat against released flat-nano.

Run using KiCad's Python. Defaults validate geometry and the newest hat BOM.
Use --skip-bom during placement, --board for a candidate, and --cli PATH for
fresh schematic parity/ERC/DRC (required before release). CLI scratch files are
created under hat/checks/tmp on D: and removed automatically. No board, source,
reference, netlist, or fabrication file is rewritten. This checks PCB geometry;
it does not certify connector mating, assembled height, or epoxy compatibility.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
import pcbnew as pcb

HERE = Path(__file__).resolve().parent
HAT = HERE.parent
ROOT = HAT.parent
REFERENCE = ROOT / "flat-nano/kicad/hp_sensor_routed.kicad_pcb"
REFERENCE_BOM = ROOT / "flat-nano/fab/HP-SDI12-NANO_BOM.csv"
HEAD_LENGTH, HEAD_WIDTH, THICKNESS = 43.18, 17.78, .8
LAYERS = (pcb.F_Cu, pcb.In1_Cu, pcb.In2_Cu, pcb.B_Cu)
INNER_NETS = {pcb.In1_Cu: "GND", pcb.In2_Cu: "+5V"}
ROUNDING = 4  # 0.1 micrometre, allowing only integer-coordinate rounding.


def mm(value):
    return pcb.ToMM(value)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def near(a, b, tolerance=.0001):
    return abs(a - b) <= tolerance


def footprints(board):
    return {fp.GetReference(): fp for fp in board.GetFootprints()}


def board_edges(board):
    return [s for s in board.GetDrawings() if s.GetLayer() == pcb.Edge_Cuts]


def origin(board):
    points = [p for edge in board_edges(board) for p in (edge.GetStart(), edge.GetEnd())]
    if not points:
        raise ValueError("Board has no outline")
    return min(mm(p.x) for p in points), (min(mm(p.y) for p in points) + max(mm(p.y) for p in points)) / 2


def point(p, zero):
    return tuple(round(mm(v) - base, ROUNDING) for v, base in zip((p.x, p.y), zero))


def outline_signature(board):
    zero = origin(board)
    return Counter((edge.GetShape(), tuple(sorted((point(edge.GetStart(), zero), point(edge.GetEnd(), zero)))))
                   for edge in board_edges(board))


def prong_tracks(board):
    zero = origin(board)
    zero = (zero[0] + HEAD_LENGTH, zero[1])
    items = Counter()
    for track in board.GetTracks():
        if isinstance(track, pcb.PCB_VIA):
            p = point(track.GetPosition(), zero)
            if p[0] >= 0:
                items[("via", p, track.GetNetname(), round(mm(track.GetWidth(pcb.F_Cu)), 6),
                       round(mm(track.GetDrill()), 6))] += 1
            continue
        a, b = point(track.GetStart(), zero), point(track.GetEnd(), zero)
        if max(a[0], b[0]) <= 0:
            continue
        if min(a[0], b[0]) < 0:
            fraction = -a[0] / (b[0] - a[0])
            cross = (0., round(a[1] + fraction * (b[1] - a[1]), ROUNDING))
            if a[0] < 0:
                a = cross
            else:
                b = cross
        items[("track", tuple(sorted((a, b))), track.GetNetname(), track.GetLayer(),
               round(mm(track.GetWidth()), 6))] += 1
    return items


def pad_signature(fp, relative=True):
    zero = (mm(fp.GetPosition().x), mm(fp.GetPosition().y)) if relative else (0., 0.)
    return Counter((pad.GetNumber(), point(pad.GetPosition(), zero), pad.GetShape(),
                    tuple(round(mm(v), 6) for v in (pad.GetSize().x, pad.GetSize().y)),
                    tuple(round(mm(v), 6) for v in (pad.GetDrillSize().x, pad.GetDrillSize().y)),
                    pad.GetAttribute(), pad.GetNetname()) for pad in fp.Pads())


def read_bom(path):
    result = {}
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            for ref in row["Designator"].replace(";", ",").split(","):
                ref = ref.strip()
                if ref in result:
                    raise ValueError(f"Duplicate {ref} in {path.name}")
                result[ref] = row
    return result


class Audit:
    def __init__(self):
        self.errors, self.warnings, self.details = [], [], {}

    def check(self, condition, message):
        if not condition:
            self.errors.append(message)

    def geometry(self, board, reference):
        fps, reference_fps = footprints(board), footprints(reference)
        self.check(len(fps) == len(list(board.GetFootprints())), "Duplicate component references")
        self.check(board.GetCopperLayerCount() == 4 and all(board.IsLayerEnabled(layer) for layer in LAYERS),
                   "Required four-layer stack is F.Cu / In1.Cu / In2.Cu / B.Cu")
        self.check(near(mm(board.GetDesignSettings().GetBoardThickness()), THICKNESS), "Board thickness must be 0.8 mm")
        self.check(all(isinstance(s, pcb.PCB_SHAPE) and s.GetShape() == pcb.SHAPE_T_SEGMENT for s in board_edges(board)),
                   "Unexpected curved outline; update the independent outline comparison before release")
        self.check(outline_signature(board) == outline_signature(reference),
                   "Complete outline must match the flat-nano body and needles")
        outline = pcb.SHAPE_POLY_SET()
        self.check(board.GetBoardPolygonOutlines(outline, False) and outline.OutlineCount() == 1,
                   "Board outline must form one closed valid contour")
        self.check(prong_tracks(board) == prong_tracks(reference), "Needle copper differs from released flat-nano")
        zero, rz = origin(board), origin(reference)
        expected_prongs = {ref for ref, fp in reference_fps.items() if point(fp.GetPosition(), rz)[0] > HEAD_LENGTH}
        actual_prongs = {ref for ref, fp in fps.items() if point(fp.GetPosition(), zero)[0] > HEAD_LENGTH}
        self.check(actual_prongs == expected_prongs, "Needle component set differs from flat-nano")
        for ref in sorted(expected_prongs & set(fps)):
            a, b = fps[ref], reference_fps[ref]
            self.check(point(a.GetPosition(), zero) == point(b.GetPosition(), rz) and
                       near(a.GetOrientationDegrees(), b.GetOrientationDegrees()) and a.GetLayer() == b.GetLayer(),
                       f"{ref}: needle placement/side/orientation differs from flat-nano")
            self.check(pad_signature(a) == pad_signature(b), f"{ref}: needle pad geometry/net differs from flat-nano")
        self.check(len([r for r in fps if r.startswith("RH")]) == 17 and
                   all(f"RH{i}" in fps and fps[f"RH{i}"].GetValue() == "3.3" for i in range(1, 18)),
                   "Heater chain must be 17 x 3.3 ohm")
        self.check({"TH1", "TH2", "TH3", "TH4"} <= set(fps), "All four thermistors must be present")
        for ref in sorted(set(fps) & set(reference_fps) - {"J1", "J3", "J4", "D2"}):
            self.check(fps[ref].GetValue() == reference_fps[ref].GetValue(), f"{ref}: value differs from flat-nano")
            self.check(fps[ref].GetFPIDAsString().split(":")[-1] == reference_fps[ref].GetFPIDAsString().split(":")[-1],
                       f"{ref}: footprint differs from flat-nano")
        # The Nano VIN limit differs from the discrete regulator in flat-nano.
        # Preserve the hat's deliberately selected TVS rather than blindly
        # copying the flat board's 16 V TVS. This does not certify clamp safety.
        self.check("D2" in fps and fps["D2"].GetValue() == "SMF15CA 15V bidir TVS" and
                   fps["D2"].GetFPIDAsString().split(":")[-1] == "D_SOD-123F",
                   "Hat D2 must retain the explicitly reviewed SMF15CA / SOD-123F exception")
        if "J1" in fps:
            self.check(pad_signature(fps["J1"]) == pad_signature(reference_fps["J1"]),
                       "J1 must retain flat-nano cable solder-hole sizes, spacing, and pin assignment")
            for bit in (pcb.FP_EXCLUDE_FROM_BOM, pcb.FP_EXCLUDE_FROM_POS_FILES):
                self.check(bool(fps["J1"].GetAttributes() & bit), "Bare J1 must be excluded from assembly BOM/CPL")
        else:
            self.check(False, "J1 cable solder pads missing")
        self.connector_rows(fps)
        self.courtyards_and_fit(board, fps, outline)
        self.inner_planes(board, zero)
        self.details["footprints"] = len(fps)
        self.details["dimensions_mm"] = {"body": [HEAD_LENGTH, HEAD_WIDTH], "pcb_thickness": THICKNESS}

    def connector_rows(self, fps):
        rows = []
        for ref in ("J3", "J4"):
            if ref not in fps:
                self.check(False, f"Missing Nano row {ref}")
                continue
            pads = {pad.GetNumber(): pad for pad in fps[ref].Pads() if pad.GetNumber()}
            self.check(set(pads) == {str(i) for i in range(1, 16)}, f"{ref}: expected 15 numbered contacts")
            if len(pads) != 15 or "1" not in pads or "15" not in pads:
                continue
            points = [(mm(pads[str(i)].GetPosition().x), mm(pads[str(i)].GetPosition().y)) for i in range(1, 16)]
            for index, (a, b) in enumerate(zip(points, points[1:]), 1):
                self.check(near(math.dist(a, b), 2.54), f"{ref}.{index}/{index+1}: pitch is not 2.54 mm")
                self.check(near(a[1], b[1]), f"{ref}: Nano connector row is not along the board length")
            rows.append((ref, points))
        if len(rows) == 2:
            a, b = rows[0][1], rows[1][1]
            self.check(all(near(x[0], y[0]) and near(abs(x[1]-y[1]), 15.24) for x, y in zip(a, b)),
                       "J3/J4 pin correspondence must align at 15.24 mm row spacing")

    def courtyards_and_fit(self, board, fps, outline):
        zero = origin(board)
        courts = {pcb.F_Cu: {}, pcb.B_Cu: {}}
        for ref, fp in fps.items():
            side = fp.GetLayer()
            fab_side = pcb.F_Fab if side == pcb.F_Cu else pcb.B_Fab
            objects = [(pad, False) for pad in fp.Pads()] + [(shape, True) for shape in fp.GraphicalItems()
                       if isinstance(shape, pcb.PCB_SHAPE) and shape.GetLayer() == fab_side]
            for item, is_body in objects:
                box = item.GetBoundingBox()
                # Fabrication outlines describe the package at the centre of
                # their pen strokes; the drawing's ink width is not body width.
                if is_body and item.GetShape() == pcb.SHAPE_T_POLY:
                    box = item.GetPolyShape().BBox()
                elif is_body and item.GetShape() in (pcb.SHAPE_T_RECT, pcb.SHAPE_T_SEGMENT):
                    a, b = item.GetStart(), item.GetEnd()
                    box = pcb.BOX2I(pcb.VECTOR2I(min(a.x, b.x), min(a.y, b.y)),
                                    pcb.VECTOR2I(abs(a.x-b.x), abs(a.y-b.y)))
                corners = [pcb.VECTOR2I(x, y) for x in (box.GetLeft(), box.GetRight()) for y in (box.GetTop(), box.GetBottom())]
                self.check(all(outline.Contains(p, -1, pcb.FromMM(.001)) for p in corners),
                           f"{ref}: a physical pad/body extends beyond the outline")
                if point(fp.GetPosition(), zero)[0] <= HEAD_LENGTH:
                    self.check(all(-.001 <= point(p, zero)[0] <= HEAD_LENGTH+.001 and
                                   abs(point(p, zero)[1]) <= HEAD_WIDTH/2+.001 for p in corners),
                               f"{ref}: body component extends beyond the Nano-sized head")
            court = fp.GetCourtyard(side)
            self.check(not court.IsEmpty(), f"{ref}: missing component courtyard on placement side")
            for layer in courts:
                court = fp.GetCourtyard(layer)
                if not court.IsEmpty():
                    courts[layer][ref] = court
        for layer, shapes in courts.items():
            refs = sorted(shapes)
            for index, a in enumerate(refs):
                for b in refs[index+1:]:
                    overlap = pcb.SHAPE_POLY_SET(shapes[a])
                    overlap.BooleanIntersection(shapes[b])
                    self.check(overlap.Area() < 1e7, f"{board.GetLayerName(layer)} courtyard overlap: {a}/{b}")

    def inner_planes(self, board, zero):
        board.BuildConnectivity()
        found = set()
        def confined(polygon):
            if polygon.IsEmpty():
                return True
            box = polygon.BBox()
            return (mm(box.GetLeft()) >= zero[0]-.0001 and mm(box.GetRight()) <= zero[0]+HEAD_LENGTH+.0001 and
                    mm(box.GetTop()) >= zero[1]-HEAD_WIDTH/2-.0001 and mm(box.GetBottom()) <= zero[1]+HEAD_WIDTH/2+.0001)
        for zone in board.Zones():
            if zone.GetIsRuleArea():
                continue
            for layer, net in INNER_NETS.items():
                if not zone.IsOnLayer(layer):
                    continue
                found.add(layer)
                self.check(zone.GetNetname() == net, f"{board.GetLayerName(layer)} plane must be {net}")
                self.check(confined(zone.Outline()) and confined(zone.GetFilledPolysList(layer)),
                           f"{board.GetLayerName(layer)} plane extends into a needle")
                self.check(not zone.GetFilledPolysList(layer).IsEmpty(), f"{board.GetLayerName(layer)} plane is not filled")
        self.check(found == set(INNER_NETS), "Both GND and +5V inner-plane zones must exist")
        for track in board.GetTracks():
            if isinstance(track, pcb.PCB_VIA):
                if point(track.GetPosition(), zero)[0] > HEAD_LENGTH:
                    self.check(not any(track.FlashLayer(layer) for layer in INNER_NETS),
                               f"Needle via at {point(track.GetPosition(), zero)} retains unused inner annuli")
            elif track.GetLayer() in INNER_NETS:
                self.check(max(point(track.GetStart(), zero)[0], point(track.GetEnd(), zero)[0]) <= HEAD_LENGTH,
                           "Inner-layer track extends into a needle")
                self.check(track.GetNetname() == INNER_NETS[track.GetLayer()], "Signal routed through an assigned inner power plane")

    def bom(self, path, fps):
        rows, reference = read_bom(path), read_bom(REFERENCE_BOM)
        self.check(set(rows) <= set(fps), "BOM references components absent from board")
        self.check("J1" not in rows, "Bare cable holes must not be ordered as a component")
        expected = {ref for ref, fp in fps.items() if not fp.GetAttributes() & pcb.FP_EXCLUDE_FROM_BOM}
        self.check(set(rows) == expected, f"Assembly BOM/reference mismatch: {sorted(set(rows)^expected)}")
        for ref in sorted(set(rows) & set(reference) - {"D2"}):
            for key in ("LCSC Part #", "Manufacturer Part Number", "Footprint"):
                self.check(rows[ref].get(key) == reference[ref].get(key), f"{ref}: BOM {key} differs from flat-nano")
        self.check("D2" in rows and rows["D2"].get("LCSC Part #") == "C123803" and
                   rows["D2"].get("Manufacturer Part Number") == "SMF15CA",
                   "Hat BOM D2 must use the explicitly selected SMF15CA / C123803")
        self.details["bom"] = str(path)
        self.details["bom_sha256"] = digest(path)

    def solder_openings(self, board):
        # Reuse the independently tested geometry checker without writing a cache
        # alongside the immutable reference project.
        path = ROOT / "flat-nano/checks/check_solder_vias.py"
        spec = importlib.util.spec_from_file_location("solder_via_geometry", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.scan_board(board, .10)
        self.details["solder_vias"] = result
        for violation in result["violations"]:
            self.errors.append(f"{violation['reference']}.{violation['pad']} {violation['layer_name']}: via hole at "
                               f"({violation['via_x_mm']}, {violation['via_y_mm']}) within 0.10 mm of mask opening")

    def fresh_cli(self, cli, board_path, schematic, fps):
        scratch = HERE / "tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="compact-check-", dir=scratch) as folder:
            folder = Path(folder)
            def run(*args):
                return subprocess.run([str(cli), *map(str, args)], capture_output=True, text=True, timeout=300)
            netfile = folder / "fresh.xml"
            result = run("sch", "export", "netlist", "--format", "kicadxml", "-o", netfile, schematic)
            self.check(result.returncode == 0 and netfile.exists(), f"Schematic export failed: {result.stdout} {result.stderr}")
            if netfile.exists():
                self.schematic_parity(ET.parse(netfile).getroot(), fps)
            for kind, source in (("erc", schematic), ("drc", board_path)):
                report = folder / f"{kind}.json"
                options = ["--format", "json", "--severity-all", "--exit-code-violations"]
                if kind == "drc":
                    options += ["--refill-zones", "--all-track-errors"]
                result = run("sch" if kind == "erc" else "pcb", kind, *options, "-o", report, source)
                self.check(result.returncode in (0, 5) and report.exists(), f"{kind.upper()} failed to run: {result.stdout} {result.stderr}")
                if not report.exists():
                    continue
                data = json.loads(report.read_text(encoding="utf8"))
                found = []
                def visit(value):
                    if isinstance(value, dict):
                        if "severity" in value and ("type" in value or "description" in value):
                            found.append(value)
                        for item in value.values():
                            visit(item)
                    elif isinstance(value, list):
                        for item in value:
                            visit(item)
                visit(data)
                for item in found:
                    message = f"{kind.upper()}: {item.get('type', '')}: {item.get('description', '')}"
                    (self.errors if item.get("severity") == "error" else self.warnings).append(message)
                self.details[kind] = {"errors": sum(i.get("severity") == "error" for i in found),
                                      "other_findings": sum(i.get("severity") != "error" for i in found),
                                      "ignored_checks": data.get("ignored_checks", [])}

    def schematic_parity(self, netlist, fps):
        comps = {item.attrib["ref"]: item for item in netlist.findall("./components/comp") if not item.attrib["ref"].startswith("#")}
        self.check(set(comps) == set(fps), "Fresh schematic/PCB reference mismatch")
        for ref in set(comps) & set(fps):
            self.check(comps[ref].findtext("value", "") == fps[ref].GetValue(), f"{ref}: schematic/PCB value mismatch")
            expected, actual = comps[ref].findtext("footprint", ""), fps[ref].GetFPIDAsString()
            self.check(actual == expected or (":" not in actual and actual == expected.split(":")[-1]),
                       f"{ref}: schematic/PCB footprint mismatch")
        expected, actual = {}, {}
        for net in netlist.findall("./nets/net"):
            for node in net.findall("node"):
                if not node.attrib["ref"].startswith("#"):
                    name = net.attrib["name"].lstrip("/")
                    expected[(node.attrib["ref"], node.attrib["pin"])] = "" if name.startswith("unconnected-") else name
        for ref, fp in fps.items():
            for pad in fp.Pads():
                if pad.GetNumber():
                    actual.setdefault((ref, pad.GetNumber()), set()).add(pad.GetNetname().lstrip("/"))
        for key in set(expected) | set(actual):
            self.check(actual.get(key) == {expected.get(key, "")}, f"{key[0]}.{key[1]}: schematic/PCB net mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--board", type=Path, default=HAT / "kicad/hp_hat_routed.kicad_pcb")
    parser.add_argument("--schematic", type=Path, default=HAT / "kicad/hp_hat.kicad_sch")
    parser.add_argument("--bom", type=Path, help="Hat assembly BOM; default is the newest *_BOM.csv in hat/fab")
    parser.add_argument("--skip-bom", action="store_true", help="Placement iteration only; not a release check")
    parser.add_argument("--cli", type=Path, help="kicad-cli executable: also check fresh schematic parity/ERC/DRC")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    audit = Audit()
    protected = {path: digest(path) for path in (args.board, args.schematic, REFERENCE, REFERENCE_BOM) if path.exists()}
    try:
        board, reference = pcb.LoadBoard(str(args.board)), pcb.LoadBoard(str(REFERENCE))
        audit.geometry(board, reference)
        audit.solder_openings(board)
        if not args.skip_bom:
            candidates = sorted((HAT / "fab").glob("*_BOM.csv"), key=lambda path: path.stat().st_mtime, reverse=True)
            bom = args.bom or (candidates[0] if candidates else None)
            if bom is None:
                audit.check(False, "No hat assembly BOM found")
            else:
                protected[bom] = digest(bom)
                audit.bom(bom, footprints(board))
        if args.cli:
            audit.fresh_cli(args.cli, args.board, args.schematic, footprints(board))
        else:
            audit.warnings.append("Fresh schematic parity/ERC/DRC were not run; add --cli for release validation")
    except Exception as exc:
        audit.errors.append(f"Check aborted: {type(exc).__name__}: {exc}")
    for path, before in protected.items():
        audit.check(path.exists() and digest(path) == before, f"Input unexpectedly changed during read-only checks: {path}")
    result = {"passed": not audit.errors, "board": str(args.board), "board_sha256": protected.get(args.board),
              "reference_sha256": protected.get(REFERENCE), "errors": audit.errors,
              "warnings": audit.warnings, "details": audit.details}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Compact hat checks: {'PASS' if result['passed'] else 'FAIL'}; {len(audit.errors)} errors, {len(audit.warnings)} warnings")
        for message in audit.errors:
            print("ERROR:", message)
        for message in audit.warnings:
            print("WARNING:", message)
        print("Board SHA256:", result["board_sha256"])
        print("Reference SHA256:", result["reference_sha256"])
    return int(not result["passed"])


if __name__ == "__main__":
    sys.exit(main())
