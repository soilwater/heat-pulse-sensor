"""Generate the compact HP-HAT r4 package from one checked four-layer board.
All CAM, assembly data and previews are staged under hat/checks/tmp on D:.
Only after generation and validation succeed is the package published to hat/fab.
Use release.py for a checked release and manifest; this exporter alone is not a release.
"""
import csv, json, os, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HAT = HERE.parent
if HAT.name != "hat":
    raise SystemExit("This exporter is restricted to the hat project")
os.chdir(HERE)
TMP = HAT / "checks" / "tmp"
TMP.mkdir(parents=True, exist_ok=True)
os.environ["TEMP"] = os.environ["TMP"] = str(TMP)
tempfile.tempdir = str(TMP)
sys.dont_write_bytecode = True
sys.path.insert(0, str(HAT / "checks"))
from fabrication_helpers import board_stackup, stackup_issues, normalize_job, job_stackup_issues

PREFIX = "HP-HAT"
EXCLUDED = {"J1", "J3", "J4"}  # Cable pads and manually fitted HTSW solder-stack headers.
JLC_ROT = {"MSOP-10": 270, "SOT-23": 180}
CLI = str(Path(sys.executable).with_name("kicad-cli.exe"))
PCB = HERE / "hp_hat_routed.kicad_pcb"
SCH = HERE / "hp_hat.kicad_sch"
FAB = HAT / "fab"
CAM_LAYERS = "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"
CAM_SUFFIXES = {"-F_Cu.gtl", "-In1_Cu.g1", "-In2_Cu.g2", "-B_Cu.gbl", "-F_Paste.gtp",
                "-F_Silkscreen.gto", "-B_Silkscreen.gbo", "-F_Mask.gts", "-B_Mask.gbs",
                "-Edge_Cuts.gm1", "-PTH.drl", "-NPTH.drl", "-job.gbrjob"}
EXPECTED_CAM = {PCB.stem + suffix for suffix in CAM_SUFFIXES}
EXPECTED_OUTPUTS = {PREFIX + suffix for suffix in ("_gerbers.zip", "_BOM.csv", "_CPL.csv", "_schematic.pdf")} | {"render_top.png", "render_bottom.png"}


def staged_cam_files(directory):
    files = list(Path(directory).iterdir())
    if any(not p.is_file() or p.is_symlink() for p in files):
        raise ValueError("CAM staging must contain regular files only")
    actual = {p.name for p in files}
    if actual != EXPECTED_CAM:
        raise ValueError(f"Invalid CAM set; missing={sorted(EXPECTED_CAM - actual)}, stale={sorted(actual - EXPECTED_CAM)}")
    if any(p.stat().st_size == 0 for p in files):
        raise ValueError("Empty CAM file")
    return sorted(files, key=lambda p: p.name)


def self_test():
    with tempfile.TemporaryDirectory(prefix="hat-cam-test-", dir=TMP) as directory:
        root = Path(directory)
        for name in EXPECTED_CAM: (root / name).write_text("fixture", encoding="utf8")
        assert len(staged_cam_files(root)) == 13
        for name, make, remove in (
            ("stale file", lambda: (root / "old.gbr").write_text("stale"), lambda: (root / "old.gbr").unlink()),
            ("missing layer", lambda: (root / (PCB.stem + "-In2_Cu.g2")).unlink(), lambda: (root / (PCB.stem + "-In2_Cu.g2")).write_text("fixture")),
            ("unexpected directory", lambda: (root / "extra").mkdir(), lambda: (root / "extra").rmdir()),
        ):
            make()
            try: staged_cam_files(root)
            except ValueError: pass
            else: raise AssertionError(f"Accepted {name}")
            remove()
    print("PASS: four fresh-CAM staging regression fixtures")


def run(*args):
    result = subprocess.run([CLI, *map(str, args)], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("kicad-cli failed: " + " ".join(map(str, args)) + "\n" + result.stdout + result.stderr)


def build_cam(stage):
    stack = board_stackup(PCB.read_text(encoding="utf8"))
    issues = stackup_issues(stack)
    if issues: raise ValueError("Invalid fabrication setup: " + "; ".join(issues))
    gerbers = stage / "gerbers"
    gerbers.mkdir()
    run("pcb", "export", "gerbers", "-o", str(gerbers) + os.sep, "--layers", CAM_LAYERS, "--subtract-soldermask", PCB)
    run("pcb", "export", "drill", "-o", str(gerbers) + os.sep, "--format", "excellon", "--excellon-units", "mm", "--excellon-separate-th", PCB)
    jobpath = gerbers / (PCB.stem + "-job.gbrjob")
    job = normalize_job(json.loads(jobpath.read_text(encoding="utf8")), stack)
    issues = job_stackup_issues(job, stack)
    if issues: raise ValueError("Invalid Gerber-job metadata: " + "; ".join(issues))
    jobpath.write_text(json.dumps(job, indent=2) + "\n", encoding="utf8")
    files = staged_cam_files(gerbers)
    with zipfile.ZipFile(stage / (PREFIX + "_gerbers.zip"), "w", zipfile.ZIP_DEFLATED) as archive:
        for source in files: archive.write(source, source.name)


MPN = {  # value -> (description, manufacturer part number, JLCPCB/LCSC number if verified by the Sept-2026 audit, else "")
    "R7FA4M1AB3CFM": ("Renesas RA4M1 MCU, LQFP-64", "R7FA4M1AB3CFM#AA0", "C1340737"),
    "INA226": ("TI INA226 power monitor, VSSOP-10", "INA226AIDGSR", "C49851"),
    "HT7550-1": ("Holtek 5 V LDO, SOT-89 (must be the Holtek part)", "HT7550-1", "C16106"),
    "AO3400A": ("N-MOSFET 30 V logic level, SOT-23", "AO3400A", "C20917"),
    "WAGO 2060-453 push-in": ("WAGO SMD push-in terminal, 3-pole, 4 mm", "2060-453/998-404", "C2765056"),
    "1A 40V Schottky (SOD-123F)": ("Schottky 1 A 40 V, SOD-123FL", "DSK14", "C37049"),
    "SMF16CA 16V bidir TVS": ("TVS 16 V standoff, bidirectional, SOD-123FL (clamp about 26 V)", "SMF16CA", "C123805"),
    "SMF15CA 15V bidir TVS": ("TVS 15 V standoff, bidirectional, SOD-123FL (clamp about 24 V)", "SMF15CA", "C123803"),
    "bidir ESD diode 6-7V (SOD-323)": ("ESD diode bidirectional 5 V, SOD-323", "PESD5V0S1BA,115", "C19224"),
    "32.768kHz 12.5pF 3215": ("Crystal 32.768 kHz 12.5 pF, 3.2x1.5 mm (Epson FC-135)", "Q13FC13500004", "C32346"),
    "10k NTC 1%": ("NTC thermistor 10 k 1 % B3380, 0402 - no substitutes", "NCP15XH103F03RC", "C77131"),
    "10k 0.1%": ("Resistor 10 k 0.1 % 25 ppm, 0603 - no substitutes", "CRF0603Q103BN", "C54973934"),
    "0.1 1%": ("Current-sense resistor 0.1 ohm 1 %, 0805 - no substitutes", "WSL0805R1000FEA", "C2094615"),
    "3.3": ("HEATER: Vishay high-power 0603 3.3 ohm 1%, 0.33 W at 70 C, derates above 70 C. Exact CRCW-HP part required; no ordinary 0.1 W/0.125 W substitutes", "CRCW06033R30FKEAHP", "C313752"),
    "4.7u 50V": ("MLCC 4.7 uF 50 V X5R 0805", "CL21A475KBQNNNE", "C98192"),
    "10u 10V": ("MLCC 10 uF 25 V X5R 0805", "CL21A106KAYNNNE", "C15850"),
    "4.7u": ("MLCC 4.7 uF 16 V X5R 0603", "CL10A475KO8NNNC", "C19666"),
    "1.5k 1%": ("Resistor 1.5 k 1 % 0603 (SDI-12 transmit resistance)", "0603WAF1501T5E", "C22843"),
    # plain 0402 parts: exact JLCPCB numbers are REQUIRED - left blank, JLCPCB's matcher reads "0402_1005Metric" as the far smaller 01005 size
    "100n": ("MLCC 100 nF 16 V X7R 0402", "CL05B104KO5NNNC", "C1525"),
    "1u": ("MLCC 1 uF 25 V X5R 0402", "CL05A105KA5NQNC", "C52923"),
    "18p": ("MLCC 18 pF 50 V C0G 0402", "0402CG180J500NT", "C1549"),
    "3.3n": ("MLCC 3.3 nF 50 V X7R 0402", "CC0402KRX7R9BB332", "C107028"),
    "22": ("Resistor 22 ohm 1 % 0603", "0603WAF220JT5E", "C23345"),
    "10": ("Resistor 10 ohm 1 % 0402", "0402WGF100JTCE", "C25077"),
    "1k": ("Resistor 1 k 1 % 0402", "0402WGF1001TCE", "C11702"),
    "1.5k": ("Gate resistor 1.5 k ohm 1%, 0402", "0402WGF1501TCE", "C25867"),
    "4.7k": ("Resistor 4.7 k 1 % 0402", "0402WGF4701TCE", "C25900"),
    "5.1k": ("Resistor 5.1 k 1 % 0402", "0402WGF5101TCE", "C25905"),
    "10k": ("Resistor 10 k 1 % 0402", "0402WGF1002TCE", "C25744"),
    "100k": ("Resistor 100 k 1 % 0402", "0402WGF1003TCE", "C25741"),
    "220k": ("Resistor 220 k 1 % 0402", "0402WGF2203TCE", "C25767"),
    "socket row D12..TX (pin 1 at the USB end)": ("Female header socket 1x15, 2.54 mm, through-hole, 8.5 mm tall", "HX PM2.54-1x15P ZC", "C41417327"),
    "socket row D13..VIN (pin 1 at the USB end)": ("Female header socket 1x15, 2.54 mm, through-hole, 8.5 mm tall", "HX PM2.54-1x15P ZC", "C41417327"),
}

def build_assembly(stage):
    import pcbnew
    board = pcbnew.LoadBoard(str(PCB))
    if board.GetCopperLayerCount() != 4:
        raise ValueError("The compact hat requires four copper layers")
    parts = json.loads((HERE / "netlist.json").read_text(encoding="utf8"))["parts"]
    expected = set(parts) - EXCLUDED
    actual = {fp.GetReference(): fp for fp in board.GetFootprints()}
    if set(parts) != set(actual): raise ValueError("Board and assembly source reference sets differ")
    for ref, part in parts.items():
        fp = actual[ref]
        if fp.GetValue() != part["value"] or fp.GetFPIDAsString() != part["footprint"]:
            raise ValueError(f"Board/source value or footprint differs at {ref}")
    pos = stage / "_pos.csv"
    run("pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "front", "--exclude-dnp", "-o", pos, PCB)
    with pos.open(encoding="utf8") as stream:
        rows = [r for r in csv.DictReader(stream) if r["Ref"] not in EXCLUDED]
    pos.unlink()
    if len(rows) != len(expected) or {r["Ref"] for r in rows} != expected:
        raise ValueError("Front-side placement list must include every fitted hat component exactly once")
    with (stage / (PREFIX + "_CPL.csv")).open("w", newline="", encoding="utf8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
        for row in rows:
            offset = next((v for k, v in JLC_ROT.items() if k in row["Package"]), 0)
            writer.writerow([row["Ref"], f'{float(row["PosX"]):.4f}mm', f'{float(row["PosY"]):.4f}mm', "Top", f'{(float(row["Rot"]) + offset) % 360:.0f}'])
    groups = {}
    for ref in sorted(expected):
        part = parts[ref]
        value, footprint = part["value"], part["footprint"].split(":", 1)[1]
        if value not in MPN or not all(MPN[value]):
            raise ValueError(f"Exact assembly part mapping missing for {ref}: {value}")
        description, mpn, lcsc = MPN[value]
        if lcsc in groups:
            if groups[lcsc][2] != footprint: raise ValueError(f"Inconsistent footprint for {lcsc}")
            groups[lcsc][1].append(ref)
        else: groups[lcsc] = [value, [ref], footprint, lcsc, mpn, description]
    key = lambda r: (r.rstrip("0123456789"), int("".join(c for c in r if c.isdigit()) or 0))
    with (stage / (PREFIX + "_BOM.csv")).open("w", newline="", encoding="utf8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["Comment", "Designator", "Footprint", "LCSC Part #", "Manufacturer Part Number", "Qty", "Description"])
        for value, refs, footprint, lcsc, mpn, description in sorted(groups.values(), key=lambda r: key(min(r[1], key=key))):
            writer.writerow([value, ",".join(sorted(refs, key=key)), footprint, lcsc, mpn, len(refs), description])
    return len(expected), len(groups)


def publish(stage):
    # Validate resolved absolute paths before replacing/removing generated files.
    destination = FAB.resolve()
    if destination != HAT.resolve() / "fab" or FAB.is_symlink():
        raise ValueError("Unexpected manufacturing output path")
    destination.mkdir(exist_ok=True)
    gerbers = destination / "gerbers"
    if gerbers.is_symlink() or gerbers.resolve() != destination / "gerbers":
        raise ValueError("Redirected loose-CAM directory")
    gerbers.mkdir(exist_ok=True)
    old_cam = list(gerbers.iterdir())
    for old in old_cam:
        if old.is_symlink() or not old.is_file() or old.resolve().parent != gerbers:
            raise ValueError("Unexpected non-file/redirect in loose-CAM directory")
    for name in EXPECTED_OUTPUTS | {"RELEASE_MANIFEST.txt"}:
        path = destination / name
        if path.is_symlink() or (path.exists() and not path.is_file()) or path.resolve().parent != destination:
            raise ValueError(f"Unexpected fabrication output target: {name}")
    (destination / "RELEASE_MANIFEST.txt").write_text(
        "NOT RELEASED: HP-HAT r4 package generation is complete; release.py must finish independent checks.\n", encoding="utf8")
    for source in staged_cam_files(stage / "gerbers"):
        temporary = gerbers / (source.name + ".tmp")
        if temporary.exists(): raise ValueError(f"Unexpected temporary output: {temporary}")
        shutil.copyfile(source, temporary)
        os.replace(temporary, gerbers / source.name)
    for old in old_cam:
        if old.name not in EXPECTED_CAM: old.unlink()
    for name in sorted(EXPECTED_OUTPUTS):
        temporary = destination / (name + ".tmp")
        if temporary.exists(): raise ValueError(f"Unexpected temporary output: {temporary}")
        shutil.copyfile(stage / name, temporary)
        os.replace(temporary, destination / name)


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    if sys.argv[1:]: raise SystemExit("Use export_fab.py or export_fab.py --self-test; BOM-only edits are not release-safe")
    with tempfile.TemporaryDirectory(prefix="hat-fab-stage-", dir=TMP) as directory:
        stage = Path(directory)
        build_cam(stage)
        count, groups = build_assembly(stage)
        for side in ("top", "bottom"):
            run("pcb", "render", "--side", side, "-w", "2600", "-h", "760", "--zoom", "3", "--background", "opaque", "-o", stage / f"render_{side}.png", PCB)
        run("sch", "export", "pdf", "-o", stage / (PREFIX + "_schematic.pdf"), SCH)
        files = {p.name for p in stage.iterdir() if p.is_file()}
        if files != EXPECTED_OUTPUTS or any((stage / name).stat().st_size == 0 for name in files):
            raise ValueError("Incomplete/extra manufacturing package output")
        publish(stage)
    print(f"Generated {PREFIX}: {count} fitted parts, {groups} BOM lines; four copper layers")
    print(f"Package: {FAB}")
    print("J1/J3/J4 and Nano excluded from factory assembly; run release.py to certify the checked package")


if __name__ == "__main__":
    main()
