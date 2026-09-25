"""Independent factory stackup metadata checks shared with the submitted reference.
Copied into hat to keep the released flat-nano files immutable.
"""
import copy, json, re
COPPER_ORDER = ("F.Cu", "In1.Cu", "In2.Cu", "B.Cu")
EXPECTED_COPPER_MM = (.035, .0152, .0152, .035)
EXPECTED_DIELECTRIC_MM = (.21040, .250, .21040)
FINISHED_SIZE_MM = (99.86, 17.78)
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


