"""Independent compact-variant checks; never rewrites a design or an original file.

Run with KiCad's Python, e.g. D:\\KiCAD\\bin\\python.exe flat-nano/checks/check_variant.py
Use --skip-cli for placement iteration (not a release check), --board for an
unrouted candidate, and --require-fab to require and compare the upload package.
All fresh CLI reports, netlists and comparison exports live in a temporary folder.
"""
from __future__ import annotations

import argparse
from collections import Counter
import copy
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

import pcbnew


HERE = Path(__file__).resolve().parent
VARIANT = HERE.parent
ROOT = VARIANT.parent
TMP = HERE / "tmp"
TMP.mkdir(exist_ok=True)
os.environ["TEMP"] = os.environ["TMP"] = str(TMP)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
tempfile.tempdir = str(TMP)
sys.dont_write_bytecode = True
ORIGINAL = ROOT / "flat/kicad/hp_sensor_routed.kicad_pcb"
PREFIX = "HP-SDI12-NANO_r2"
# r2: an explicitly reviewed 17-part 0603 chain replaces the original 22-part
# 0402 chain. All unaffected parts, thermistors and needle copper stay checked.
HEATER_COUNT, HEATER_VALUE = 17, "3.3"
HEATER_MPN, HEATER_LCSC = "CRCW06033R30FKEAHP", "C313752"
HEATER_FOOTPRINT = "hp_sensor:R_0603_Vishay_HP"
HEATER_FIRST_MM, HEATER_PITCH_MM, HEATER_RETURN_MM = 8.8, 2.6, 51.95
HEATER_REFS = {f"RH{i}" for i in range(1, HEATER_COUNT + 1)}
GATE_REFS = {"R9", "R12"}
GATE_VALUE, GATE_MPN, GATE_LCSC = "1.5k", "0402WGF1501TCE", "C25867"
FITTED_COUNT = 69
CAM_SUFFIXES = {"-F_Cu.gtl", "-In1_Cu.g1", "-In2_Cu.g2", "-B_Cu.gbl", "-F_Paste.gtp",
                "-F_Silkscreen.gto", "-B_Silkscreen.gbo", "-F_Mask.gts", "-B_Mask.gbs",
                "-Edge_Cuts.gm1", "-PTH.drl", "-NPTH.drl", "-job.gbrjob"}
HEAD_L, HEAD_W, OLD_L = 43.18, 17.78, 60.0
OX, OY = 100.0, 80.0
INNER_PLANES = {pcbnew.In1_Cu: "GND", pcbnew.In2_Cu: "+5V"}
CAM_LAYERS = "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"
COPPER_ORDER = ("F.Cu", "In1.Cu", "In2.Cu", "B.Cu")
# JLC04081H-7628, published nominal 0.8 mm / 1 oz outer / 0.5 oz inner.
# JLC's stated inner copper is 0.0152 mm, not an inferred 0.0175 mm.
# https://jlcpcb.com/impedance (template 20211110050413)
EXPECTED_COPPER_MM = (.035, .0152, .0152, .035)
EXPECTED_DIELECTRIC_MM = (.21040, .250, .21040)
FINISHED_SIZE_MM = (99.86, 17.78)
# The generators' mm-to-integer conversion can differ by one KiCad nanometre
# after translation. Compare positions on a 0.0001 mm (0.1 micrometre) grid;
# retain exact identities, counts, layer/net assignments and copper dimensions.
POSITION_DIGITS = 4
BARE = {"J1", "J2", "J5"}
JLC_ROT = {"LQFP-64": 270, "MSOP-10": 270, "SOT-89": 180, "SOT-23": 180}
errors, warnings = [], []


def check(condition, message):
    if not condition:
        errors.append(message)


def mm(value):
    return pcbnew.ToMM(value)


def xy(point, root=0.0):
    return (round(mm(point.x) - OX - root, POSITION_DIGITS),
            round(mm(point.y) - OY, POSITION_DIGITS))


def near(a, b, tol=0.00001):
    return abs(a - b) <= tol


def parse_board_setup(text):
    """Read only the setup S-expression; no dependence on a generator module."""
    match = re.search(r"\(setup(?=\s|\))", text)
    if not match:
        raise ValueError("Board setup block is missing")
    tokens = re.finditer(r'"(?:\\.|[^"\\])*"|[()]|[^()\s]+', text[match.start():])
    stack, result = [], None
    for match in tokens:
        token = match.group()
        if token == "(":
            node = []
            if stack: stack[-1].append(node)
            stack.append(node)
        elif token == ")":
            result = stack.pop()
            if not stack: return result
        else:
            stack[-1].append(json.loads(token) if token.startswith('"') else token)
    raise ValueError("Board setup block is not closed")


def children(node, name):
    return [item for item in node[1:] if isinstance(item, list) and item and item[0] == name]


def field(node, name, default=None):
    matches = children(node, name)
    return matches[0][1] if matches and len(matches[0]) > 1 else default


def board_stackup(text):
    setup = parse_board_setup(text)
    stacks = children(setup, "stackup")
    if len(stacks) != 1:
        raise ValueError("Board must contain exactly one explicit stackup")
    stack = stacks[0]
    layers = []
    for node in children(stack, "layer"):
        layers.append({"name": node[1], "type": field(node, "type", ""),
                       "thickness": float(field(node, "thickness", 0)),
                       "material": field(node, "material"), "color": field(node, "color"),
                       "epsilon_r": float(field(node, "epsilon_r", 0))})
    tents = children(setup, "tenting")
    return {"layers": layers, "finish": field(stack, "copper_finish", ""),
            "dielectric_constraints": field(stack, "dielectric_constraints"),
            "tented_front": bool(tents) and field(tents[0], "front") == "yes",
            "tented_back": bool(tents) and field(tents[0], "back") == "yes"}


def stackup_issues(stack):
    issues = []
    copper = [item for item in stack["layers"] if item["name"] in COPPER_ORDER]
    dielectric = [item for item in stack["layers"] if item["type"].lower() in ("core", "prepreg")]
    if tuple(item["name"] for item in copper) != COPPER_ORDER:
        issues.append("Explicit copper-layer order must be F.Cu / In1.Cu / In2.Cu / B.Cu")
    if len(copper) != 4 or any(not near(item["thickness"], expected, .000001)
                               for item, expected in zip(copper, EXPECTED_COPPER_MM)):
        issues.append("Explicit copper thickness differs from JLC04081H-7628: 0.035 / 0.0152 / 0.0152 / 0.035 mm")
    if len(dielectric) != 3 or any(not near(item["thickness"], expected, .000001)
                                   for item, expected in zip(dielectric, EXPECTED_DIELECTRIC_MM)):
        issues.append("Explicit dielectric thickness differs from JLC04081H-7628: 0.21040 / 0.250 / 0.21040 mm")
    if tuple(item["type"].lower() for item in dielectric) != ("prepreg", "core", "prepreg"):
        issues.append("Expected prepreg / core / prepreg construction")
    if tuple(item["material"] for item in dielectric) != ("7628", "FR4", "7628"):
        issues.append("Expected published 7628 prepreg / FR4 core / 7628 prepreg materials")
    if len(dielectric) != 3 or any(not near(item["epsilon_r"], expected)
                                   for item, expected in zip(dielectric, (4.4, 4.6, 4.4))):
        issues.append("Explicit dielectric constants differ from the selected published stack")
    if stack["finish"].upper() != "HASL LEAD FREE": issues.append("Board finish must be lead-free HASL")
    masks = [item for item in stack["layers"] if item["name"] in ("F.Mask", "B.Mask")]
    if len(masks) != 2 or any((item["color"] or "").lower() != "green" for item in masks):
        issues.append("Both solder-mask layers must be specified Green")
    if any(not near(item["thickness"], .01524, .000001) or not near(item["epsilon_r"], 3.8) for item in masks):
        issues.append("Expected the selected mask model: 0.01524 mm above copper, Dk 3.8")
    if stack["dielectric_constraints"] != "no":
        issues.append("The board must not claim controlled impedance")
    if not (stack["tented_front"] and stack["tented_back"]):
        issues.append("Ordinary vias must be tented on both exterior sides")
    return issues


def normalize_job(job, stack):
    """Complete native KiCad job metadata from the explicit board construction.

    Used when exporting and when creating the FRESH comparison. Never apply
    this to a released job before validation: doing that could hide stale data.
    KiCad suppresses thicknesses when impedance control is off, and otherwise
    supplies an unverified default loss tangent. The chosen factory stack does
    not imply controlled impedance; the supplier did not publish loss tangent.
    """
    result = copy.deepcopy(job)
    result.setdefault("GeneralSpecs", {})["ImpedanceControlled"] = False
    result["GeneralSpecs"]["Finish"] = stack["finish"]
    # Native KiCad job bounds include the 0.1 mm outline pen width. Factory
    # dimensions follow Edge.Cuts centre lines, independently checked below.
    result["GeneralSpecs"]["Size"] = dict(zip(("X", "Y"), FINISHED_SIZE_MM))
    copper = {item["name"]: item for item in stack["layers"] if item["name"] in COPPER_ORDER}
    dielectric = iter(item for item in stack["layers"] if item["type"].lower() in ("core", "prepreg"))
    masks = {"Top Solder Mask": "F.Mask", "Bottom Solder Mask": "B.Mask"}
    byname = {item["name"]: item for item in stack["layers"]}
    for item in result.get("MaterialStackup", []):
        kind = item.get("Type")
        if kind == "Copper" and item.get("Name") in copper:
            item["Thickness"] = copper[item["Name"]]["thickness"]
        elif kind == "Dielectric":
            source = next(dielectric, None)
            if source is None: raise ValueError("Native Gerber job has an unexpected dielectric layer")
            item["Thickness"] = source["thickness"]
            item["Material"] = source["material"]
            item["DielectricConstant"] = str(source["epsilon_r"])
            item.pop("LossTangent", None)
        elif kind == "SolderMask" and item.get("Name") in masks:
            source = byname[masks[item["Name"]]]
            item["Color"] = source["color"]
            item["Thickness"] = source["thickness"]
    return result


def job_stackup_issues(job, stack, nominal_thickness=.8):
    """Compare exported manufacturing metadata to the board's explicit values."""
    issues = []
    general = job.get("GeneralSpecs", {})
    if general.get("LayerNumber") != 4: issues.append("Gerber job does not specify four copper layers")
    if any(not near(float(general.get("Size", {}).get(axis, -1)), expected)
           for axis, expected in zip(("X", "Y"), FINISHED_SIZE_MM)):
        issues.append("Gerber job size must match the finished outline, excluding outline stroke width")
    if not near(float(general.get("BoardThickness", -1)), nominal_thickness):
        issues.append("Gerber job nominal board thickness differs from the board")
    if general.get("Finish", "").upper() != stack["finish"].upper():
        issues.append("Gerber job surface finish differs from the board")
    if general.get("ImpedanceControlled") is not False:
        issues.append("Gerber job must explicitly state that impedance is not controlled")
    job_layers = job.get("MaterialStackup", [])
    copper = [item for item in job_layers if item.get("Type") == "Copper"]
    expected_copper = [item for item in stack["layers"] if item["name"] in COPPER_ORDER]
    if [item.get("Name") for item in copper] != [item["name"] for item in expected_copper]:
        issues.append("Gerber job copper order differs from the board")
    for item, expected in zip(copper, expected_copper):
        if not near(float(item.get("Thickness", -1)), expected["thickness"], .000001):
            issues.append(f"Gerber job {expected['name']} copper thickness is missing or differs from the board")
    dielectric = [item for item in job_layers if item.get("Type") == "Dielectric"]
    expected_dielectric = [item for item in stack["layers"] if item["type"].lower() in ("core", "prepreg")]
    if len(dielectric) != len(expected_dielectric): issues.append("Gerber job dielectric count differs from the board")
    for index, (item, expected) in enumerate(zip(dielectric, expected_dielectric)):
        if item.get("Name") != f"{COPPER_ORDER[index]}/{COPPER_ORDER[index + 1]}":
            issues.append("Gerber job dielectric ordering differs from the board")
        if not near(float(item.get("Thickness", -1)), expected["thickness"], .000001):
            issues.append(f"Gerber job dielectric {index + 1} thickness is missing or differs from the board")
        if expected["material"] and item.get("Material") != expected["material"]:
            issues.append(f"Gerber job dielectric {index + 1} material differs from the board")
        if not near(float(item.get("DielectricConstant", -1)), expected["epsilon_r"]):
            issues.append(f"Gerber job dielectric {index + 1} Dk differs from the board")
        if "LossTangent" in item:
            issues.append("Gerber job must omit unpublished dielectric loss tangent")
    masks = [item for item in job_layers if item.get("Type") == "SolderMask"]
    if len(masks) != 2 or any(item.get("Color", "").lower() != "green" for item in masks):
        issues.append("Gerber job must specify two Green solder-mask layers")
    if any(not near(float(item.get("Thickness", -1)), .01524, .00005) for item in masks):
        issues.append("Gerber job mask thickness differs from the explicit board model")
    attributes = [item.get("FileFunction") for item in job.get("FilesAttributes", [])
                  if item.get("FileFunction", "").startswith("Copper,")]
    if attributes != ["Copper,L1,Top", "Copper,L2,Inr", "Copper,L3,Inr", "Copper,L4,Bot"]:
        issues.append("Gerber job file functions do not describe the four copper layers in order")
    return issues


def original_hashes():
    historical = HERE / "original-files.sha256.json"
    snapshot_path = HERE / "r2-preserved-projects.sha256.json"
    check(snapshot_path.is_file(), "Missing immutable r2 preservation boundary")
    if not snapshot_path.is_file():
        return
    snapshot = json.loads(snapshot_path.read_text(encoding="utf8"))
    check(hashlib.sha256(historical.read_bytes()).hexdigest() == snapshot["historical_manifest_sha256"],
          "Historical preservation manifest was rewritten")
    original = json.loads(historical.read_text(encoding="utf8"))
    # The historical hat was intentionally replaced by the authorized compact
    # r4 project. Do not overwrite that history to conceal its prior changes.
    # Enforce the old flat hashes plus a separately dated r2 work-boundary
    # snapshot of the current hat and the submitted r1 manufacturing payload.
    manifest = {name: digest for name, digest in original.items()
                if name.replace("\\", "/").startswith("flat/")}
    manifest.update(snapshot["files"])
    for name, expected in manifest.items():
        path = ROOT.joinpath(*name.replace("\\", "/").split("/"))
        check(path.is_file(), f"Protected original missing: {name}")
        if path.is_file():
            check(hashlib.sha256(path.read_bytes()).hexdigest() == expected,
                  f"Protected original changed: {name}")
    print(f"Checked {len(manifest)} preserved original-flat/current-hat/submitted-r1 hashes; historical manifest unchanged")


def footprints(board):
    items = list(board.GetFootprints())
    refs = [f.GetReference() for f in items]
    check(len(set(refs)) == len(refs), "Duplicate footprint references")
    return {f.GetReference(): f for f in items}


def pad_nets(fps):
    result = {}
    for ref, fp in fps.items():
        for pad in fp.Pads():
            if pad.GetNumber():
                result.setdefault((ref, pad.GetNumber()), set()).add(pad.GetNetname().lstrip("/"))
    return result


def schematic_footprint_matches(expected, actual):
    # KiCad FootprintLoad(path, name) embeds only `name` in these generated
    # boards. If the PCB retains a library qualification, require it to match;
    # otherwise compare the full footprint basename, not a partial substring.
    return actual == expected or (":" not in actual and actual == expected.rsplit(":", 1)[-1])


def board_parity(new, old):
    old_heaters = {ref for ref in old if re.fullmatch(r"RH\d+", ref)}
    expected_refs = (set(old) - old_heaters) | HEATER_REFS
    check(set(new) == expected_refs, f"Reference set differs from the reviewed r2 selection: {set(new) ^ expected_refs}")
    expected_nets = {key: nets for key, nets in pad_nets(old).items() if key[0] not in old_heaters}
    for i in range(1, HEATER_COUNT + 1):
        expected_nets[(f"RH{i}", "1")] = {"HEAT_P" if i == 1 else f"H_{i - 1}"}
        expected_nets[(f"RH{i}", "2")] = {"HEAT_RTN" if i == HEATER_COUNT else f"H_{i}"}
    check(pad_nets(new) == expected_nets, "Board pin-to-net mapping differs from original plus the explicit 17-part heater chain")
    for ref in sorted(set(new) & set(old)):
        a, b = new[ref], old[ref]
        if ref != "J1":
            expected_value = HEATER_VALUE if ref in HEATER_REFS else GATE_VALUE if ref in GATE_REFS else b.GetValue()
            check(a.GetValue() == expected_value, f"{ref}: value differs from the reviewed r2 selection")
            if ref in HEATER_REFS:
                check(schematic_footprint_matches(HEATER_FOOTPRINT, a.GetFPIDAsString()), f"{ref}: incorrect reviewed Vishay heater footprint")
            else:
                check(a.GetFPIDAsString() == b.GetFPIDAsString(), f"{ref}: footprint changed")
        check(a.GetLayer() == pcbnew.F_Cu, f"{ref}: footprint is not on the top side")
        attr = a.GetAttributes()
        for bit, label in [(pcbnew.FP_EXCLUDE_FROM_BOM, "BOM"),
                           (pcbnew.FP_EXCLUDE_FROM_POS_FILES, "placement")]:
            check(bool(attr & bit) == (ref in BARE), f"{ref}: incorrect {label} exclusion")
    check(len([r for r in new if r.startswith("RH")]) == HEATER_COUNT, "Expected 17 heater resistors")
    check(all(new.get(ref) and new[ref].GetValue() == HEATER_VALUE for ref in HEATER_REFS),
          "Heater chain must contain exactly the 17 reviewed r2 resistor values")
    check(len(new) - len(BARE) == FITTED_COUNT, "Expected 69 factory-placed components")


def prong_edges(board, root):
    result = Counter()
    for item in board.GetDrawings():
        if item.GetLayer() != pcbnew.Edge_Cuts or not isinstance(item, pcbnew.PCB_SHAPE):
            continue
        check(item.GetShape() == pcbnew.SHAPE_T_SEGMENT, "Outline includes an unexpected non-segment")
        a, b = xy(item.GetStart(), root), xy(item.GetEnd(), root)
        if min(a[0], b[0]) >= -0.00001 and max(a[0], b[0]) > 0.00001:
            result[tuple(sorted((a, b)))] += 1
    return result


def prong_tracks(board, root):
    """Clip all traces at the prong roots; head-side routing is free to change."""
    result = Counter()
    for t in board.GetTracks():
        if isinstance(t, pcbnew.PCB_VIA):
            p = xy(t.GetPosition(), root)
            if p[0] >= 0:
                result[("via", p, t.GetNetname(), round(mm(t.GetWidth(pcbnew.F_Cu)), 6),
                        round(mm(t.GetDrillValue()), 6))] += 1
            continue
        a, b = xy(t.GetStart(), root), xy(t.GetEnd(), root)
        if max(a[0], b[0]) <= 0:
            continue
        if min(a[0], b[0]) < 0:
            fraction = -a[0] / (b[0] - a[0])
            cross = (0.0, round(a[1] + fraction * (b[1] - a[1]), POSITION_DIGITS))
            if a[0] < 0:
                a = cross
            else:
                b = cross
        result[("track", tuple(sorted((a, b))), t.GetNetname(), t.GetLayer(),
                round(mm(t.GetWidth()), 6))] += 1
    return result


def expected_prong_tracks(original):
    """Explicit r2 heater geometry; retain every unaffected needle trace/via."""
    original_tracks = prong_tracks(original, OLD_L)
    heater_net = lambda net: net in {"HEAT_P", "HEAT_RTN"} or bool(re.fullmatch(r"H_\d+", net))
    expected = Counter({key: count for key, count in original_tracks.items() if not heater_net(key[2])})
    # Exact TH2 lane/via exceptions permit the uniform 1.4 mm center prong.
    lane_changes = 0
    for key, count in list(expected.items()):
        if key[0] != "track" or key[3] != pcbnew.B_Cu or key[2] not in {"A1_TH2", "TH_RTN"}:
            continue
        if not any(near(abs(y), .55) for x, y in key[1]):
            continue
        check(count == 1 and near(key[4], .127), "Unexpected original TH2 lane multiplicity/width")
        del expected[key]
        lane_changes += count
    check(lane_changes == 4, "Expected exactly four original TH2 lane segments")
    for net, z in (("A1_TH2", 52.72), ("TH_RTN", 55.44)):
        original_via = ("via", (z, 0.0), net, .6, .35)
        check(expected[original_via] == 1, f"Missing exact original TH2 via: {net}")
        if expected[original_via] == 1:
            del expected[original_via]
        expected[("via", (z, 0.0), net, .5, .3)] += 1
    def trace(a, b, net, layer=pcbnew.F_Cu, width=.3):
        points = tuple(sorted((tuple(round(v, POSITION_DIGITS) for v in a),
                               tuple(round(v, POSITION_DIGITS) for v in b))))
        expected[("track", points, net, layer, width)] += 1
    for net, sign, via_z in (("A1_TH2", -1, 52.72), ("TH_RTN", 1, 55.44)):
        points = [(0, sign * .43), (via_z, sign * .43), (via_z, 0)]
        for a, b in zip(points, points[1:]):
            trace(a, b, net, pcbnew.B_Cu, .10)
    trace((0, 0), (HEATER_FIRST_MM - .75, 0), "HEAT_P")
    for i in range(1, HEATER_COUNT):
        center = HEATER_FIRST_MM + (i - 1) * HEATER_PITCH_MM
        trace((center + .75, 0), (center + HEATER_PITCH_MM - .75, 0), f"H_{i}")
    last_pad = HEATER_FIRST_MM + (HEATER_COUNT - 1) * HEATER_PITCH_MM + .75
    trace((last_pad, 0), (HEATER_RETURN_MM, 0), "HEAT_RTN")
    trace((0, 0), (HEATER_RETURN_MM, 0), "HEAT_RTN", pcbnew.B_Cu)
    expected[("via", (HEATER_RETURN_MM, 0.0), "HEAT_RTN", .5, .3)] += 1
    return expected


def needle_component_clearance(bore_mm, prong_width_mm, pcb_thickness_mm, component_width_mm, assembled_height_mm):
    """Vertical room above a centered part when the PCB corners rest in a bore.

    The caller must supply actual minimum bore and maximum manufactured board
    and component dimensions. This checks a stepped cross-section, not the
    overly pessimistic rectangle enclosing both the PCB and narrower part.
    """
    from math import sqrt
    radius = bore_mm / 2
    if max(prong_width_mm, component_width_mm) >= bore_mm:
        return float("-inf")
    board_bottom = -sqrt(radius * radius - (prong_width_mm / 2) ** 2)
    body_top = board_bottom + pcb_thickness_mm + assembled_height_mm
    available = sqrt(radius * radius - (component_width_mm / 2) ** 2)
    return available - body_top


def heater_geometry(fps):
    for i in range(1, HEATER_COUNT + 1):
        ref = f"RH{i}"
        if ref not in fps:
            continue
        fp = fps[ref]
        expected_center = round(HEATER_FIRST_MM + (i - 1) * HEATER_PITCH_MM, POSITION_DIGITS)
        check(xy(fp.GetPosition(), HEAD_L) == (expected_center, 0.0), f"{ref}: incorrect 2.6 mm pitch/first-center placement")
        check(near(fp.GetOrientationDegrees(), 0), f"{ref}: heater footprint must have zero rotation")
        pads = list(fp.Pads())
        check(len(pads) == 2 and {pad.GetNumber() for pad in pads} == {"1", "2"}, f"{ref}: expected exactly two heater pads")
        for pad in pads:
            offset = -.75 if pad.GetNumber() == "1" else .75
            check(xy(pad.GetPosition(), HEAD_L) == (round(expected_center + offset, POSITION_DIGITS), 0.0),
                  f"{ref}.{pad.GetNumber()}: manufacturer-land position differs")
            check(pad.GetShape() == pcbnew.PAD_SHAPE_RECT and pad.GetAttribute() == pcbnew.PAD_ATTRIB_SMD,
                  f"{ref}.{pad.GetNumber()}: Vishay land must be rectangular SMD")
            check(near(mm(pad.GetSize().x), .75) and near(mm(pad.GetSize().y), 1.0),
                  f"{ref}.{pad.GetNumber()}: required land size is 0.75 x 1.00 mm")
            check(set(pad.GetLayerSet().Seq()) == {pcbnew.F_Cu, pcbnew.F_Paste, pcbnew.F_Mask},
                  f"{ref}.{pad.GetNumber()}: unexpected heater pad layers")
            check(near(mm(pad.GetSolderMaskExpansion(pcbnew.F_Cu)), 0),
                  f"{ref}.{pad.GetNumber()}: heater solder-mask expansion must preserve the zero-expansion board setting")
        courts = [item for item in fp.GraphicalItems() if isinstance(item, pcbnew.PCB_SHAPE)
                  and item.GetLayer() == pcbnew.F_CrtYd]
        check(len(courts) == 1 and courts[0].GetShape() == pcbnew.SHAPE_T_RECT,
              f"{ref}: heater courtyard must be one explicit rectangle")
        if len(courts) == 1:
            a, b = sorted((xy(courts[0].GetStart(), HEAD_L), xy(courts[0].GetEnd(), HEAD_L)))
            check(a == (round(expected_center - 1.225, POSITION_DIGITS), -.6) and
                  b == (round(expected_center + 1.225, POSITION_DIGITS), .6),
                  f"{ref}: actual heater courtyard rectangle must be 2.45 x 1.20 mm")
    # The installed liner/adhesive consumes 0.025 mm radially on EACH wall.
    # It is separate from the 0.55 mm body + 0.10 mm solder height allowance.
    usable_bore = 2.16 - 2 * .025
    clearance = needle_component_clearance(usable_bore, 1.4 + .2, .9, .95, .55 + .10)
    check(clearance > .05, "Heater cross-section does not fit the explicitly specified lined-bore envelope")
    print(f"Heater envelope: {clearance:.4f} mm vertical room with board corners resting in the lined bore. Assumptions: measured bore >=2.16 mm; installed liner/adhesive <=0.025 mm per wall without overlap; maximum 1.60 mm routed prong / 0.90 mm PCB / 0.95 x 0.65 mm assembled component. First-lot bore measurement and a dry fit remain required; the bore tolerance is not manufacturer-verified.")


def reviewed_small_geometry(board):
    """Only the explicit center-needle exceptions may use reduced dimensions."""
    small_vias = {(HEATER_RETURN_MM, "HEAT_RTN"), (52.72, "A1_TH2"), (55.44, "TH_RTN")}
    found_vias = set()
    expected_thin, actual_thin = Counter(), Counter()
    for net, sign, via_z in (("A1_TH2", -1, 52.72), ("TH_RTN", 1, 55.44)):
        points = [(-1.0, sign * .55), (-.88, sign * .43),
                  (via_z, sign * .43), (via_z, 0.0)]
        for a, b in zip(points, points[1:]):
            expected_thin[(net, pcbnew.B_Cu, tuple(sorted((a, b))))] += 1
    for item in board.GetTracks():
        if isinstance(item, pcbnew.PCB_VIA):
            x, y = xy(item.GetPosition(), HEAD_L)
            key = (x, item.GetNetname())
            small = near(y, 0) and key in small_vias
            if small:
                found_vias.add(key)
            expected_diameter, expected_drill = (.5, .3) if small else (.6, .35)
            check(near(mm(item.GetWidth(pcbnew.F_Cu)), expected_diameter) and
                  near(mm(item.GetDrillValue()), expected_drill),
                  f"Via {item.GetNetname()} at {x},{y}: dimensions differ from the reviewed center-via exception or standard 0.60/0.35 mm")
        elif mm(item.GetWidth()) < .126999:
            check(near(mm(item.GetWidth()), .10), "Reduced trace width must be exactly 0.10 mm")
            actual_thin[(item.GetNetname(), item.GetLayer(),
                         tuple(sorted((xy(item.GetStart(), HEAD_L), xy(item.GetEnd(), HEAD_L)))))] += 1
    check(found_vias == small_vias, "Expected exactly the three reviewed 0.50/0.30 mm center-needle vias")
    check(actual_thin == expected_thin, "Only the six exact TH2 bottom-lane segments may use 0.10 mm copper")
    print("Checked three specific reduced center vias and six specific 0.10 mm TH2 traces; other vias and trace widths retain the original minima")


def check_ic_assembly_spacing(fps):
    """JLCPCB QFP-to-SOP recommended minimum: 1.25 mm between actual shapes.

    A single footprint bounding rectangle incorrectly fills the MCU's empty
    corners. Use the individual pad polygons plus the fabrication body instead.
    https://jlcpcb.com/help/article/minimum-spacing-for-smd-components
    """
    if not {"U1", "U4"} <= set(fps):
        check(False, "U1/U4 missing for the QFP-to-SOP assembly-spacing check")
        return
    envelopes = {}
    for ref in ("U1", "U4"):
        envelope = pcbnew.SHAPE_POLY_SET()
        for pad in fps[ref].Pads():
            polygon = pcbnew.SHAPE_POLY_SET()
            pad.TransformShapeToPolygon(polygon, pcbnew.F_Cu, 0, pcbnew.FromMM(.0001), pcbnew.ERROR_OUTSIDE)
            envelope.BooleanAdd(polygon)
        bodies = [s for s in fps[ref].GraphicalItems()
                  if isinstance(s, pcbnew.PCB_SHAPE) and s.GetLayer() == pcbnew.F_Fab]
        check(bool(bodies), f"{ref}: missing fabrication body for assembly-spacing validation")
        for body in bodies:
            check(body.GetShape() == pcbnew.SHAPE_T_POLY,
                  f"{ref}: unexpected fabrication-body shape; review the assembly-spacing check")
            if body.GetShape() == pcbnew.SHAPE_T_POLY:
                envelope.BooleanAdd(body.GetPolyShape())
        envelopes[ref] = envelope
    check(not envelopes["U1"].Collide(envelopes["U4"], pcbnew.FromMM(1.25 - .0001)),
          "U1 (QFP) / U4 (SOP): actual pads/bodies are less than the recommended 1.25 mm apart")
    print("Checked actual QFP-to-SOP pad/body spacing against the 1.25 mm assembly requirement")


def geometry(board, old, fps, oldfps):
    check(any(isinstance(item, pcbnew.PCB_TEXT) and item.GetText() == "HP-NANO r2"
              for item in board.GetDrawings()), "Board must carry the reviewed HP-NANO r2 revision label")
    check(board.GetCopperLayerCount() == 4, "Compact board must have exactly four copper layers")
    check(all(board.IsLayerEnabled(layer) for layer in (pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu)),
          "Expected the F.Cu / In1.Cu / In2.Cu / B.Cu copper stack")
    check(near(mm(board.GetDesignSettings().GetBoardThickness()), 0.8), "Board thickness must be 0.8 mm")
    outline = pcbnew.SHAPE_POLY_SET()
    check(board.GetBoardPolygonOutlines(outline, False), "Board outline is not closed and valid")
    check(outline.OutlineCount() == 1, "Expected one board outline")
    edges = [s for s in board.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    edgepairs = {tuple(sorted((xy(s.GetStart()), xy(s.GetEnd())))) for s in edges}
    for a, b in [((0, -HEAD_W / 2), (HEAD_L, -HEAD_W / 2)),
                 ((0, HEAD_W / 2), (HEAD_L, HEAD_W / 2)),
                 ((0, -HEAD_W / 2), (0, HEAD_W / 2))]:
        check(tuple(sorted((a, b))) in edgepairs, f"Missing exact 43.18 x 17.78 mm head edge: {a} to {b}")
    expected_edges = Counter()
    def transform_edge_point(point):
        x, y = xy(point)
        if x >= OLD_L:
            x = round(x - (OLD_L - HEAD_L), POSITION_DIGITS)
            center = min((-8.0, 0.0, 8.0), key=lambda c: abs(y - c))
            offset = y - center
            if 0 < abs(offset) <= .85001:
                y = round(y - (.15 if offset > 0 else -.15), POSITION_DIGITS)
        if near(abs(y), 9.0):
            y = HEAD_W / 2 if y > 0 else -HEAD_W / 2
        return x, y
    for edge in old.GetDrawings():
        if edge.GetLayer() == pcbnew.Edge_Cuts:
            expected_edges[tuple(sorted((transform_edge_point(edge.GetStart()), transform_edge_point(edge.GetEnd()))))] += 1
    check(Counter(tuple(sorted((xy(s.GetStart()), xy(s.GetEnd())))) for s in edges) == expected_edges,
          "Complete board outline differs from the original plus the exact Nano head and three 1.4 mm prong changes")
    expected_needle_edges = Counter()
    for points, count in expected_edges.items():
        a, b = points
        if min(a[0], b[0]) >= HEAD_L - .00001 and max(a[0], b[0]) > HEAD_L + .00001:
            expected_needle_edges[tuple(sorted(((round(a[0] - HEAD_L, POSITION_DIGITS), a[1]),
                                               (round(b[0] - HEAD_L, POSITION_DIGITS), b[1]))))] += count
    check(prong_edges(board, HEAD_L) == expected_needle_edges,
          "Needle outline differs from the exact original lengths with all three prongs narrowed to 1.4 mm")
    check(prong_tracks(board, HEAD_L) == expected_prong_tracks(old),
          "Needle copper differs from the original plus the explicitly reviewed heater chain/return and TH2 lane changes")
    for ref, original in oldfps.items():
        if xy(original.GetPosition())[0] <= OLD_L or ref not in fps or ref in HEATER_REFS:
            continue
        current = fps[ref]
        check(xy(current.GetPosition(), HEAD_L) == xy(original.GetPosition(), OLD_L),
              f"{ref}: prong component moved relative to its root")
        check(near(current.GetOrientationDegrees(), original.GetOrientationDegrees()), f"{ref}: prong component rotated")
    # Physical pads and fabrication-body drawings, not visible text, must fit the PCB.
    for ref, fp in fps.items():
        objects = list(fp.Pads()) + [s for s in fp.GraphicalItems()
                                    if isinstance(s, pcbnew.PCB_SHAPE) and s.GetLayer() == pcbnew.F_Fab]
        for item in objects:
            box = item.GetBoundingBox()
            corners = [(box.GetLeft(), box.GetTop()), (box.GetRight(), box.GetTop()),
                       (box.GetRight(), box.GetBottom()), (box.GetLeft(), box.GetBottom())]
            check(all(outline.Contains(pcbnew.VECTOR2I(x, y), -1, pcbnew.FromMM(0.001)) for x, y in corners),
                  f"{ref}: a physical pad/body extends beyond the board outline")
            if xy(fp.GetPosition())[0] <= HEAD_L:
                check(all(OX - .001 <= mm(x) <= OX + HEAD_L + .001 and
                          OY - HEAD_W / 2 - .001 <= mm(y) <= OY + HEAD_W / 2 + .001 for x, y in corners),
                      f"{ref}: a head component extends outside the exact head rectangle")
    # Use the actual concave courtyard polygons; bounding rectangles alone reject
    # valid placements around the MCU's corners.
    courts = {}
    for ref, fp in fps.items():
        court = fp.GetCourtyard(pcbnew.F_Cu)
        check(not court.IsEmpty(), f"{ref}: missing top courtyard")
        if not court.IsEmpty():
            courts[ref] = court
    refs = sorted(courts)
    for i, a in enumerate(refs):
        for b in refs[i + 1:]:
            overlap = pcbnew.SHAPE_POLY_SET(courts[a])
            overlap.BooleanIntersection(courts[b])
            check(overlap.Area() < 1e7, f"Courtyard overlap: {a} / {b}")  # 0.00001 mm2 tolerance
    reserve = pcbnew.SHAPE_POLY_SET()
    reserve.NewOutline()
    for x, y in [(0, -5.5), (4.5, -5.5), (4.5, 5.5), (0, 5.5)]:
        reserve.Append(pcbnew.FromMM(OX + x), pcbnew.FromMM(OY + y))
    for ref, court in courts.items():
        if ref == "J1":
            continue
        overlap = pcbnew.SHAPE_POLY_SET(court)
        overlap.BooleanIntersection(reserve)
        check(overlap.Area() < 1e7, f"{ref}: courtyard enters the cable soldering/strain-relief reserve")
    check_ic_assembly_spacing(fps)
    heater_geometry(fps)
    reviewed_small_geometry(board)
    print("Checked exact head, translated prongs, physical bodies and courtyard polygons")


def inner_plane_checks(board, fps, require_filled):
    """Keep both new power planes out of the original two-sided needle layout."""
    head = (OX, OY - HEAD_W / 2, OX + HEAD_L, OY + HEAD_W / 2)
    plane_region = (OX + .3, OY - HEAD_W / 2 + .3, OX + HEAD_L - .3, OY + HEAD_W / 2 - .3)
    def box_inside(box, bounds):
        return (mm(box.GetLeft()) >= bounds[0] - .0001 and mm(box.GetTop()) >= bounds[1] - .0001
                and mm(box.GetRight()) <= bounds[2] + .0001 and mm(box.GetBottom()) <= bounds[3] + .0001)
    def polygon_inside(polygon, bounds):
        return polygon.IsEmpty() or box_inside(polygon.BBox(), bounds)
    found, filled = set(), set()
    for zone in board.Zones():
        if zone.GetIsRuleArea():
            continue
        for layer, net in INNER_PLANES.items():
            if not zone.IsOnLayer(layer):
                continue
            found.add(layer)
            check(zone.GetNetname() == net, f"{board.GetLayerName(layer)} plane must use {net}, got {zone.GetNetname()}")
            check(polygon_inside(zone.Outline(), plane_region),
                  f"{board.GetLayerName(layer)} zone boundary extends outside the inset electronics head")
            copper = zone.GetFilledPolysList(layer)
            check(polygon_inside(copper, plane_region),
                  f"{board.GetLayerName(layer)} filled plane extends outside the inset electronics head")
            if not copper.IsEmpty():
                filled.add(layer)
    if require_filled:
        check(found == set(INNER_PLANES), "Final board must include both GND and +5V inner-plane zones")
        check(filled == set(INNER_PLANES), "Final board must contain filled GND and +5V inner planes")
    for item in board.GetTracks():
        if isinstance(item, pcbnew.PCB_VIA):
            for layer in INNER_PLANES:
                if item.FlashLayer(layer):
                    radius = mm(item.GetWidth(layer)) / 2
                    x, y = mm(item.GetPosition().x), mm(item.GetPosition().y)
                    check(head[0] - .0001 <= x - radius and x + radius <= head[2] + .0001
                          and head[1] - .0001 <= y - radius and y + radius <= head[3] + .0001,
                          f"Via at {x:.4f}, {y:.4f}: unused inner annulus extends beyond the head into a needle")
        elif item.GetLayer() in INNER_PLANES:
            check(item.GetNetname() == INNER_PLANES[item.GetLayer()],
                  f"Unexpected {item.GetNetname()} routing on the {board.GetLayerName(item.GetLayer())} power plane")
            check(box_inside(item.GetBoundingBox(), head), "Inner-layer trace extends beyond the electronics head")
    for ref, fp in fps.items():
        for pad in fp.Pads():
            for layer in INNER_PLANES:
                if pad.IsOnLayer(layer) and pad.FlashLayer(layer):
                    check(polygon_inside(pad.GetEffectivePolygon(layer), head),
                          f"{ref}.{pad.GetNumber()}: inner pad copper extends beyond the electronics head")
        for item in fp.GraphicalItems():
            if item.GetLayer() in INNER_PLANES:
                check(box_inside(item.GetBoundingBox(), head), f"{ref}: inner-layer footprint graphic extends into a needle")
    for item in board.GetDrawings():
        if item.GetLayer() in INNER_PLANES:
            check(box_inside(item.GetBoundingBox(), head), "Inner-layer copper drawing extends beyond the head")
    print("Checked four-layer power-plane nets, filled copper and confinement to the electronics head"
          + (" (unfilled placement stage allowed)" if not require_filled else ""))


def cable_and_rules(board, fps):
    if "J1" not in fps:
        return
    pads = list(fps["J1"].Pads())
    check(len(pads) == 3, "J1 must have exactly three plated cable pads")
    bynumber = {p.GetNumber(): p for p in pads}
    for pin, y, net in [("1", -4, "VIN"), ("2", 0, "SDI_LINE"), ("3", 4, "GND")]:
        check(pin in bynumber, f"J1.{pin} is missing")
        if pin not in bynumber:
            continue
        pad = bynumber[pin]
        check(xy(pad.GetPosition()) == (2.0, y), f"J1.{pin}: expected local position (2, {y}) mm")
        check(pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH, f"J1.{pin}: must be plated through-hole")
        check(all(near(mm(v), 1.2) for v in (pad.GetDrillSize().x, pad.GetDrillSize().y)), f"J1.{pin}: hole must be 1.2 mm")
        check(all(near(mm(v), 2.4) for v in (pad.GetSize().x, pad.GetSize().y)), f"J1.{pin}: pad must be 2.4 mm")
        check(pad.GetNetname() == net, f"J1.{pin}: expected {net}")
        for layer in (pcbnew.F_Cu, pcbnew.B_Cu, pcbnew.F_Mask, pcbnew.B_Mask):
            check(pad.IsOnLayer(layer), f"J1.{pin}: missing {board.GetLayerName(layer)}")
        check(not pad.IsOnLayer(pcbnew.F_Paste) and not pad.IsOnLayer(pcbnew.B_Paste),
              f"J1.{pin}: cable solder hole must not have a stencil aperture")
        check(pad.GetShape() == (pcbnew.PAD_SHAPE_RECT if pin == "1" else pcbnew.PAD_SHAPE_CIRCLE),
              f"J1.{pin}: expected square pin 1 and round pins 2/3")
    texts = [s for s in board.GetDrawings() if isinstance(s, pcbnew.PCB_TEXT)]
    texts += [s for fp in fps.values() for s in fp.GraphicalItems() if isinstance(s, pcbnew.PCB_TEXT)]
    for label in ("12V", "SDI", "GND"):
        matching = [t for t in texts if t.GetText() == label and t.GetLayer() in (pcbnew.F_SilkS, pcbnew.B_SilkS)
                    and xy(t.GetPosition())[0] < 10]
        check(bool(matching), f"Cable label {label} missing near J1")
        for t in matching:
            check(mm(t.GetTextSize().y) >= .999 and mm(t.GetTextThickness()) >= .149,
                  f"Cable label {label}: needs >=1.0 mm height and >=0.15 mm stroke")
            check(t.IsMirrored() == (t.GetLayer() == pcbnew.B_SilkS), f"Cable label {label}: wrong mirroring")
    settings = board.GetDesignSettings()
    check(mm(settings.m_CopperEdgeClearance) >= .199, "Copper-to-edge rule must be at least 0.2 mm")
    check(mm(settings.m_SolderMaskMinWidth) >= .099999, "Minimum solder-mask web rule must be at least 0.10 mm")
    for ref, fp in fps.items():
        for pad in fp.Pads():
            if pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:
                ring = min(mm(pad.GetSize().x - pad.GetDrillSize().x),
                           mm(pad.GetSize().y - pad.GetDrillSize().y)) / 2
                check(ring >= .249, f"{ref}.{pad.GetNumber()}: PTH annulus below the recommended 0.25 mm")
    for track in board.GetTracks():
        if isinstance(track, pcbnew.PCB_VIA):
            check(track.IsTented(pcbnew.F_Cu) and track.IsTented(pcbnew.B_Cu),
                  "Every ordinary via must remain tented on both exterior sides")
            check(mm(track.GetDrillValue()) >= .299, "Via drill smaller than 0.3 mm")
            check(mm(track.GetWidth(pcbnew.F_Cu) - track.GetDrillValue()) / 2 >= .099,
                  "Via annulus smaller than 0.1 mm")
        else:
            check(mm(track.GetWidth()) >= .099, "Copper trace narrower than 0.1 mm")
    print("Checked cable holes, no paste apertures, labels and basic fabrication dimensions")


def run_cli(cli, *args):
    process = subprocess.run([str(cli), *map(str, args)], capture_output=True, text=True, timeout=240)
    return process


def report_violations(path, label):
    data = json.loads(path.read_text(encoding="utf8"))
    found = []
    def visit(value):
        if isinstance(value, dict):
            if "severity" in value and ("description" in value or "type" in value):
                found.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(data)
    ignored = data.get("ignored_checks", [])
    if ignored:
        print(f"{label} inherited ignored checks: " + ", ".join(item.get("key", str(item)) for item in ignored))
    for item in found:
        msg = f"{label}: {item.get('type', '')}: {item.get('description', '')}"
        if item.get("items"):
            msg += " [" + "; ".join(x.get("description", "") for x in item["items"]) + "]"
        if item.get("severity") == "error":
            errors.append(msg)
        else:
            warnings.append(msg)
    print(f"Fresh {label}: {sum(i.get('severity') == 'error' for i in found)} errors, "
          f"{sum(i.get('severity') != 'error' for i in found)} other findings")


def fresh_checks(cli, board_path, fps, temporary):
    schematic = VARIANT / "kicad/hp_sensor.kicad_sch"
    check(schematic.is_file(), "Variant schematic missing")
    if not schematic.is_file():
        return
    netfile = temporary / "fresh.net.xml"
    result = run_cli(cli, "sch", "export", "netlist", "--format", "kicadxml", "-o", netfile, schematic)
    check(result.returncode == 0 and netfile.is_file(), f"Fresh schematic netlist export failed: {result.stdout} {result.stderr}")
    if netfile.is_file():
        net = ET.parse(netfile).getroot()
        components = {c.attrib["ref"]: c for c in net.findall("./components/comp") if not c.attrib["ref"].startswith("#")}
        check(set(components) == set(fps), "Fresh schematic / PCB reference mismatch")
        for ref, comp in components.items():
            if ref in fps:
                check(comp.findtext("value", "") == fps[ref].GetValue(), f"{ref}: schematic / PCB value mismatch")
                check(schematic_footprint_matches(comp.findtext("footprint", ""), fps[ref].GetFPIDAsString()),
                      f"{ref}: schematic / PCB footprint mismatch")
        schpins = {}
        for n in net.findall("./nets/net"):
            for node in n.findall("node"):
                if not node.attrib["ref"].startswith("#"):
                    schpins[(node.attrib["ref"], node.attrib["pin"])] = n.attrib["name"].lstrip("/")
        pcbpins = pad_nets(fps)
        for key in set(schpins) | set(pcbpins):
            expected, actual = schpins.get(key, ""), pcbpins.get(key, set())
            if expected.startswith("unconnected-"):
                expected = ""
            check(actual == {expected}, f"{key[0]}.{key[1]}: schematic net {expected!r} / PCB nets {actual}")
        print("Compared fresh schematic references, footprints, values and every pad net")
    for kind, source in [("erc", schematic), ("drc", board_path)]:
        report = temporary / f"{kind}.json"
        options = ["--format", "json", "--severity-all", "--exit-code-violations"]
        if kind == "drc": options += ["--refill-zones", "--all-track-errors"]
        result = run_cli(cli, "sch" if kind == "erc" else "pcb", kind, *options, "-o", report, source)
        check(result.returncode in (0, 5) and report.is_file(), f"{kind.upper()} did not complete: {result.stdout} {result.stderr}")
        if report.is_file():
            report_violations(report, kind.upper())
    project = board_path.with_suffix(".kicad_pro")
    if not project.exists():
        project = VARIANT / "kicad/hp_sensor.kicad_pro"
    check(project.exists(), "Companion project containing the fabrication rules is missing")
    if project.exists():
        data = json.loads(project.read_text(encoding="utf8"))
        severities = data.get("board", {}).get("design_settings", {}).get("rule_severities", {})
        for rule in ("clearance", "courtyards_overlap", "invalid_outline", "copper_edge_clearance",
                     "unconnected_items", "shorting_items", "hole_clearance", "solder_mask_bridge", "connection_width"):
            check(severities.get(rule, "error") == "error", f"Critical DRC rule {rule} disabled/downgraded")
        rules = data.get("board", {}).get("design_settings", {}).get("rules", {})
        check(near(float(rules.get("min_connection", 0)), .10),
              "Production connection-width rule must be 0.10 mm; the separate strict audit retains 0.127 mm everywhere else")
        check(float(rules.get("solder_mask_to_copper_clearance", 0)) >= .089999,
              "Mask opening to neighboring foreign copper rule must be at least 0.09 mm")
    kelvin = VARIANT / "kicad/check_kelvin.py"
    if kelvin.is_file():
        result = subprocess.run([sys.executable, str(kelvin), str(board_path)], capture_output=True, text=True, timeout=120)
        check(result.returncode == 0, f"Kelvin routing check failed: {result.stdout} {result.stderr}")
        print(result.stdout.strip())
    solder_vias = HERE / "check_solder_vias.py"
    check(solder_vias.is_file(), "Required solder-via manufacturing checker is missing")
    if solder_vias.is_file():
        result = subprocess.run([sys.executable, str(solder_vias), "--board", str(board_path)],
                                capture_output=True, text=True, timeout=120)
        check(result.returncode == 0, f"Solder-via manufacturing check failed: {result.stdout} {result.stderr}")
        print(result.stdout.strip())


def strict_connection_checks(cli, board_path, temporary):
    """Retain the old 0.127 mm copper-neck audit outside six exact thin traces.

    The production project permits the reviewed 0.10 mm sensing traces. A
    second fresh DRC on a temporary board/project copy restores 0.127 mm and
    accepts only neck findings involving those exact traces, never plane/pad
    necks or another circuit. The source board and project remain untouched.
    """
    stage = temporary / "strict-connections"
    stage.mkdir()
    candidate = stage / board_path.name
    shutil.copyfile(board_path, candidate)
    project = json.loads(board_path.with_suffix(".kicad_pro").read_text(encoding="utf8"))
    project["board"]["design_settings"]["rules"]["min_connection"] = .127
    candidate.with_suffix(".kicad_pro").write_text(json.dumps(project, indent=2), encoding="utf8")
    report = stage / "drc.json"
    result = run_cli(cli, "pcb", "drc", "--format", "json", "--severity-all", "--exit-code-violations",
                     "--refill-zones", "--all-track-errors", "-o", report, candidate)
    check(result.returncode in (0, 5) and report.is_file(), "Strict 0.127 mm connection audit did not complete")
    if not report.is_file():
        return
    board = pcbnew.LoadBoard(str(board_path))
    items = {item.m_Uuid.AsString(): item for item in board.GetTracks()}
    thin_ids = {uid for uid, item in items.items() if not isinstance(item, pcbnew.PCB_VIA)
                and near(mm(item.GetWidth()), .1)}
    check(len(thin_ids) == 6, "Strict connection audit requires the six geometry-checked thin traces")
    # KiCad's polygon-neck detector may name the pre-existing short adapter
    # rather than the new thin trace touching it. Admit those two exact entry
    # adapters as well; no general net-wide waiver is applied.
    entry_ids = set()
    for net, sign in (("A1_TH2", -1), ("TH_RTN", 1)):
        expected = tuple(sorted(((-1.0, sign * .55), (-1.055, sign * .50))))
        for uid, item in items.items():
            if isinstance(item, pcbnew.PCB_VIA) or item.GetNetname() != net or item.GetLayer() != pcbnew.B_Cu:
                continue
            points = tuple(sorted((xy(item.GetStart(), HEAD_L), xy(item.GetEnd(), HEAD_L))))
            if points == expected and near(mm(item.GetWidth()), .127):
                entry_ids.add(uid)
    check(len(entry_ids) == 2, "Strict connection audit requires both unchanged 0.127 mm entry adapters")
    data = json.loads(report.read_text(encoding="utf8"))
    check(not data.get("unconnected_items") and not data.get("schematic_parity"), "Strict connection audit found unrelated connectivity/parity issues")
    allowed = 0
    for violation in data.get("violations", []):
        ids = {item.get("uuid") for item in violation.get("items", [])}
        identified = [items[uid] for uid in ids if uid in items]
        nets = {item.GetNetname() for item in identified}
        exception = (violation.get("type") == "connection_width" and bool(ids & (thin_ids | entry_ids))
                     and len(identified) == len(ids) and len(nets) == 1
                     and nets <= {"A1_TH2", "TH_RTN"}
                     and all(isinstance(item, pcbnew.PCB_VIA) or item.GetLayer() == pcbnew.B_Cu for item in identified))
        check(exception, "Strict 0.127 mm audit found an unapproved narrow copper connection: " + violation.get("description", ""))
        allowed += bool(exception)
    print(f"Strict 0.127 mm copper-neck audit passed outside {allowed} connections involving the six reviewed 0.10 mm TH2 traces and their two exact original entry adapters")


def normalize_cam(path):
    return "\n".join(line for line in path.read_text(encoding="utf8").splitlines()
                     if "CreationDate" not in line and not line.startswith("G04 Created by KiCad")
                     and not line.startswith("; DRILL file KiCad"))


def comparable_job(job):
    result = copy.deepcopy(job)
    result.get("Header", {}).pop("CreationDate", None)
    return result


def fab_checks(cli, board_path, fps, temporary, require, skip_cli, fab=None):
    fab = (fab or VARIANT / "fab/r2").resolve()
    boms, cpls = list(fab.glob("*_BOM.csv")), list(fab.glob("*_CPL.csv"))
    if not boms and not cpls and not require:
        print("Manufacturing outputs not yet present; upload-package checks deferred")
        return
    check(len(boms) == len(cpls) == 1, "Expected exactly one variant BOM and CPL")
    if len(boms) != 1 or len(cpls) != 1:
        return
    check(boms[0].name == PREFIX + "_BOM.csv" and cpls[0].name == PREFIX + "_CPL.csv",
          "Manufacturing BOM/CPL names must identify the r2 revision")
    try:
        stack = board_stackup(board_path.read_text(encoding="utf8"))
    except ValueError as error:
        check(False, str(error))
        return
    expected = set(fps) - BARE
    bom = list(csv.DictReader(boms[0].open(encoding="utf-8-sig", newline="")))
    cpl = list(csv.DictReader(cpls[0].open(encoding="utf-8-sig", newline="")))
    bomrefs = [ref.strip() for row in bom for ref in row["Designator"].split(",")]
    cplrefs = [r["Designator"] for r in cpl]
    check(set(bomrefs) == expected and len(bomrefs) == len(expected), "BOM references do not equal the 69 assembled parts")
    check(set(cplrefs) == expected and len(cplrefs) == len(expected), "CPL references do not equal the 69 assembled parts")
    original_bom = next((ROOT / "flat/fab").glob("*_BOM.csv"))
    original_parts = {ref.strip(): row for row in csv.DictReader(original_bom.open(encoding="utf-8-sig", newline=""))
                      for ref in row["Designator"].split(",")}
    check(len({row["LCSC Part #"] for row in bom}) == len(bom), "BOM repeats a supplier part across rows")
    for row in bom:
        refs = [r.strip() for r in row["Designator"].split(",")]
        check(int(row["Qty"]) == len(refs), f"BOM quantity mismatch: {row['Designator']}")
        check(bool(row["LCSC Part #"] and row["Manufacturer Part Number"]),
              f"BOM lacks an exact supplier/manufacturer part: {row['Designator']}")
        for ref in refs:
            if ref in fps:
                check(row["Comment"] == fps[ref].GetValue(), f"{ref}: BOM value differs from the checked board")
                check(row["Footprint"] == fps[ref].GetFPIDAsString().rsplit(":", 1)[-1],
                      f"{ref}: BOM package differs from the checked board")
            if ref in original_parts:
                for field in ("Comment", "Footprint", "LCSC Part #", "Manufacturer Part Number"):
                    approved = {"Comment": HEATER_VALUE, "LCSC Part #": HEATER_LCSC,
                                "Manufacturer Part Number": HEATER_MPN, "Footprint": HEATER_FOOTPRINT.rsplit(":", 1)[-1]} if ref in HEATER_REFS else {
                                "Comment": GATE_VALUE, "LCSC Part #": GATE_LCSC,
                                "Manufacturer Part Number": GATE_MPN} if ref in GATE_REFS else {}
                    expected_field = approved.get(field, original_parts[ref][field])
                    check(row[field] == expected_field, f"{ref}: BOM {field} differs from the reviewed component selection")
    for row in cpl:
        ref = row["Designator"]
        if ref not in fps:
            continue
        fp = fps[ref]
        parse = lambda value: float(value.lower().replace("mm", "").strip())
        check(near(parse(row["Mid X"]), mm(fp.GetPosition().x), .00011) and
              near(parse(row["Mid Y"]), -mm(fp.GetPosition().y), .00011), f"{ref}: stale CPL position")
        correction = next((v for k, v in JLC_ROT.items() if k in fp.GetFPIDAsString()), 0)
        check(near(float(row["Rotation"]) % 360, (fp.GetOrientationDegrees() + correction) % 360), f"{ref}: incorrect CPL rotation")
        check(row["Layer"].lower() == "top", f"{ref}: CPL layer is not Top")
    archives = list(fab.glob("*_gerbers.zip"))
    check(len(archives) == 1, "Expected exactly one variant Gerber ZIP")
    gerbers = fab / "gerbers"
    expected_cam = {board_path.stem + suffix for suffix in CAM_SUFFIXES}
    loose_names = {p.name for p in gerbers.iterdir()} if gerbers.is_dir() else set()
    check(loose_names == expected_cam, "Expected exactly 13 four-layer CAM, drill and job files")
    if len(archives) == 1:
        check(archives[0].name == PREFIX + "_gerbers.zip", "Gerber ZIP name must identify r2")
        with zipfile.ZipFile(archives[0]) as archive:
            names = archive.namelist()
            check(all(name == Path(name).name for name in names), "Gerber ZIP must contain only flat file names")
            check(len(names) == len(set(names)), "Gerber ZIP contains duplicate names")
            check(set(names) == expected_cam, "Gerber ZIP file set differs from the 13 required CAM outputs")
            contents = {Path(n).name: archive.read(n) for n in names if not n.endswith("/")}
        loose = {p.name: p.read_bytes() for p in gerbers.iterdir() if p.is_file()} if gerbers.is_dir() else {}
        check(contents == loose, "ZIP differs from the loose Gerber/drill files")
    jobs = list(gerbers.glob("*.gbrjob"))
    check(len(jobs) == 1, "Expected exactly one released Gerber-job metadata file")
    if len(jobs) == 1:
        released_job = json.loads(jobs[0].read_text(encoding="utf8"))
        for issue in job_stackup_issues(released_job, stack): check(False, issue)
    if not skip_cli:
        generated = temporary / "gerbers"
        generated.mkdir()
        result = run_cli(cli, "pcb", "export", "gerbers", "-o", str(generated) + "/", "--layers",
                         CAM_LAYERS, "--subtract-soldermask", board_path)
        check(result.returncode == 0, "Fresh comparison Gerber export failed")
        result = run_cli(cli, "pcb", "export", "drill", "-o", str(generated) + "/", "--format", "excellon",
                         "--excellon-units", "mm", "--excellon-separate-th", board_path)
        check(result.returncode == 0, "Fresh comparison drill export failed")
        check({path.name for path in gerbers.iterdir() if path.is_file()} ==
              {path.name for path in generated.iterdir() if path.is_file()},
              "Released CAM directory contains missing or stale extra files")
        for fresh in generated.iterdir():
            if fresh.suffix == ".gbrjob":
                released = gerbers / fresh.name
                check(released.is_file(), "Missing released Gerber-job metadata")
                if released.is_file():
                    expected = normalize_job(json.loads(fresh.read_text(encoding="utf8")), stack)
                    actual = json.loads(released.read_text(encoding="utf8"))
                    check(comparable_job(expected) == comparable_job(actual),
                          "Stale Gerber-job construction, finish, layer ordering, or general metadata")
                continue
            released = gerbers / fresh.name
            check(released.is_file(), f"Missing released layer/drill file: {fresh.name}")
            if released.is_file():
                check(normalize_cam(fresh) == normalize_cam(released), f"Stale Gerber/drill payload: {fresh.name}")
    print("Checked factory BOM/CPL and manufacturing ZIP" + (" against fresh exports" if not skip_cli else " (fresh exports skipped)"))


def self_test():
    """Manufacturing-metadata regression fixtures; no workspace files written."""
    lined = needle_component_clearance(2.16 - 2 * .025, 1.6, .9, .95, .65)
    assert lined > .05, "Reviewed r2 heater stack does not fit the minimum lined bore"
    assert needle_component_clearance(2.16, 1.9, .9, .95, .65) < 0, "Original 1.7 mm prong plus routing tolerance was incorrectly accepted"
    assert needle_component_clearance(2.16 - 2 * .10, 1.6, .9, .95, .65) < 0, "Excess liner thickness was incorrectly accepted"
    assert needle_component_clearance(1.6, 1.6, .9, .95, .65) < 0, "Impossible board/bore geometry was accepted"
    print(f"PASS lined needle-envelope fixtures; reviewed vertical clearance {lined:.4f} mm")
    source = '''(kicad_pcb (setup (stackup
      (layer "F.Mask" (type "Top Solder Mask") (color "Green") (thickness .01524) (epsilon_r 3.8))
      (layer "F.Cu" (type "copper") (thickness .035))
      (layer "dielectric 1" (type "prepreg") (thickness .2104) (material "7628") (epsilon_r 4.4))
      (layer "In1.Cu" (type "copper") (thickness .0152))
      (layer "dielectric 2" (type "core") (thickness .250) (material "FR4") (epsilon_r 4.6))
      (layer "In2.Cu" (type "copper") (thickness .0152))
      (layer "dielectric 3" (type "prepreg") (thickness .2104) (material "7628") (epsilon_r 4.4))
      (layer "B.Cu" (type "copper") (thickness .035))
      (layer "B.Mask" (type "Bottom Solder Mask") (color "Green") (thickness .01524) (epsilon_r 3.8))
      (copper_finish "HASL lead free") (dielectric_constraints no)) (tenting (front yes) (back yes))))'''
    stack = board_stackup(source)
    assert not stackup_issues(stack)
    assert stackup_issues(board_stackup(source.replace('(copper_finish "HASL lead free")', '(copper_finish "ENIG")')))
    assert stackup_issues(board_stackup(source.replace('(thickness .0152)', '(thickness .0175)', 1)))
    assert stackup_issues(board_stackup(source.replace('(back yes)', '(back no)')))
    assert stackup_issues(board_stackup(source.replace('(dielectric_constraints no)', '(dielectric_constraints yes)')))
    native = {"Header": {"CreationDate": "earlier"},
              "GeneralSpecs": {"LayerNumber": 4, "BoardThickness": .8, "Finish": "HASL lead free"},
              "FilesAttributes": [{"FileFunction": function} for function in
                                  ["Copper,L1,Top", "Copper,L2,Inr", "Copper,L3,Inr", "Copper,L4,Bot"]],
              "MaterialStackup": []}
    for index, name in enumerate(COPPER_ORDER):
        native["MaterialStackup"].append({"Type": "Copper", "Name": name})
        if index < 3:
            native["MaterialStackup"].append({"Type": "Dielectric", "Name": f"{name}/{COPPER_ORDER[index + 1]}", "LossTangent": "0.02"})
    for side in ("Top", "Bottom"):
        native["MaterialStackup"].append({"Type": "SolderMask", "Name": side + " Solder Mask"})
    good = normalize_job(native, stack)
    assert not job_stackup_issues(good, stack)
    assert "Thickness" not in native["MaterialStackup"][0], "Normalizer mutated its input"
    mutations = [
        ("stale inner copper", lambda job: job["MaterialStackup"][2].update(Thickness=.035)),
        ("missing copper thickness", lambda job: job["MaterialStackup"][0].pop("Thickness")),
        ("stale dielectric", lambda job: job["MaterialStackup"][1].update(Thickness=.2133)),
        ("wrong layer order", lambda job: job["MaterialStackup"][0].update(Name="B.Cu")),
        ("wrong board thickness", lambda job: job["GeneralSpecs"].update(BoardThickness=1.6)),
        ("stroke-expanded board size", lambda job: job["GeneralSpecs"].update(Size={"X":99.96,"Y":17.88})),
        ("wrong layer count", lambda job: job["GeneralSpecs"].update(LayerNumber=2)),
        ("wrong finish", lambda job: job["GeneralSpecs"].update(Finish="HASL")),
        ("stale ENIG finish", lambda job: job["GeneralSpecs"].update(Finish="ENIG")),
        ("wrong mask color", lambda job: job["MaterialStackup"][-1].update(Color="Red")),
        ("false impedance claim", lambda job: job["GeneralSpecs"].update(ImpedanceControlled=True)),
        ("unpublished loss tangent", lambda job: job["MaterialStackup"][1].update(LossTangent="0.02")),
        ("wrong copper file order", lambda job: job["FilesAttributes"][1].update(FileFunction="Copper,L3,Inr")),
    ]
    for label, mutate in mutations:
        changed = copy.deepcopy(good); mutate(changed)
        assert job_stackup_issues(changed, stack), label
        print("PASS rejected", label)
    later = copy.deepcopy(good); later["Header"]["CreationDate"] = "later"
    assert comparable_job(later) == comparable_job(good)
    rounded = copy.deepcopy(good)
    for item in rounded["MaterialStackup"]:
        if item["Type"] == "SolderMask": item["Thickness"] = .0152
    assert not job_stackup_issues(rounded, stack), "Valid KiCad mask rounding rejected"
    print("PASS explicit board construction, native-job completion, immutable input, timestamp filtering, and mask rounding")
    print("Manufacturing stackup and stale-job regression fixtures passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board", type=Path, default=VARIANT / "kicad/hp_sensor_routed.kicad_pcb")
    parser.add_argument("--cli", type=Path, default=Path(r"D:\KiCAD\bin\kicad-cli.exe"))
    parser.add_argument("--skip-cli", action="store_true")
    parser.add_argument("--require-fab", action="store_true")
    parser.add_argument("--fab-dir", type=Path, default=VARIANT / "fab/r2",
                        help="Exact r2 package directory, or the fresh D: staging directory during release")
    parser.add_argument("--skip-fab", action="store_true", help="Explicit pre-export check; do not inspect the previous package")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return False
    if args.skip_fab and args.require_fab:
        parser.error("--skip-fab and --require-fab are mutually exclusive")
    original_hashes()
    if not args.board.is_file():
        errors.append(f"Candidate board not present: {args.board}")
    else:
        board, old = pcbnew.LoadBoard(str(args.board)), pcbnew.LoadBoard(str(ORIGINAL))
        fps, oldfps = footprints(board), footprints(old)
        board_parity(fps, oldfps)
        geometry(board, old, fps, oldfps)
        try:
            for issue in stackup_issues(board_stackup(args.board.read_text(encoding="utf8"))):
                check(False, issue)
            print("Checked explicit JLC04081H-7628 construction, green mask, lead-free HASL and via tenting")
        except ValueError as error:
            check(False, str(error))
        inner_plane_checks(board, fps, require_filled=not args.skip_cli)
        cable_and_rules(board, fps)
        with tempfile.TemporaryDirectory(prefix="flat-nano-check-") as temp:
            temporary = Path(temp)
            if args.skip_cli:
                print("SKIPPED fresh ERC/DRC/netlist/Kelvin: this is a placement-only check")
            else:
                fresh_checks(args.cli, args.board.resolve(), fps, temporary)
                strict_connection_checks(args.cli, args.board.resolve(), temporary)
            if args.skip_fab:
                print("SKIPPED existing fabrication package explicitly for the pre-export check")
            else:
                fab_checks(args.cli, args.board.resolve(), fps, temporary, args.require_fab, args.skip_cli, args.fab_dir)
    for message in warnings[:20]:
        print("WARN:", message)
    if len(warnings) > 20:
        print(f"... {len(warnings) - 20} further non-error rule findings")
    for message in errors:
        print("FAIL:", message)
    print(f"{'FAIL' if errors else 'PASS'}: {len(errors)} failures, {len(warnings)} rule warnings"
          + ("; CLI checks skipped" if args.skip_cli else ""))
    return bool(errors)


if __name__ == "__main__":
    raise SystemExit(main())
