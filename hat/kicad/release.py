"""One-command release: build the board, check it, and only then write the order files.
    D:\\KiCAD\\bin\\python.exe hat/kicad/release.py
    Add --verify-existing to validate and export an already routed, stitched candidate.
The router uses deterministic seeds. This repeats generate -> route -> check with successive seeds until a run is completely clean,
then exports the order files FROM THAT EXACT BOARD and writes RELEASE_MANIFEST.txt (checksums of the board and every order file).
Never upload files that were not produced by this script."""
import csv, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time, zipfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
HAT = Path(HERE).parent.resolve()
if HAT.name != "hat": raise SystemExit("This release script is restricted to hat")
SCRATCH = HAT / "checks" / "tmp"
SCRATCH.mkdir(parents=True, exist_ok=True)
os.environ["TEMP"] = os.environ["TMP"] = str(SCRATCH)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
tempfile.tempdir = str(SCRATCH)
sys.dont_write_bytecode = True
PY, CLI = sys.executable, os.path.join(os.path.dirname(sys.executable), "kicad-cli.exe")
ROUTED = "hp_hat_routed.kicad_pcb"
SCH = ROUTED.replace("_routed.kicad_pcb", ".kicad_sch")
FAB = os.path.join(HERE, "..", "fab")
MAX_TRIES = 15
if sys.argv[1:] not in ([], ["--verify-existing"]):
    raise SystemExit("Use release.py [--verify-existing]")
VERIFY_EXISTING = "--verify-existing" in sys.argv
os.environ["ROUTE_OUTPUT"] = ROUTED
MANIFEST = os.path.join(FAB, "RELEASE_MANIFEST.txt")
# A failed rebuild must never leave an old success certificate beside changed files.
manifest_path = Path(MANIFEST)
if manifest_path.resolve().parent != HAT / "fab" or manifest_path.is_symlink():
    raise SystemExit("Unexpected release manifest path")
manifest_path.parent.mkdir(exist_ok=True)
manifest_path.write_text("NOT RELEASED: compact HP-HAT r4 validation in progress. Earlier r3 files are superseded design files, not this release.\n", encoding="utf8")


def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def must(label, ok, out=""):
    print(f"  {label}: {'ok' if ok else 'FAILED'}", flush=True)
    if not ok: print(out[-1500:])
    return ok


def fresh(path, *cmd):
    """delete the old output, run the tool, and insist that it succeeded AND wrote a new file - an old clean report can never be reused"""
    if os.path.exists(path): os.remove(path)
    code, out = run(*cmd)
    ok = code == 0 and os.path.exists(path) and os.path.getsize(path) > 0
    if not ok: print(f"  {os.path.basename(cmd[0])} {cmd[1] if len(cmd) > 1 else ''} did not run properly (exit {code}): {out[-800:]}")
    return ok


def items(report):
    return sum(1 for line in open(report, encoding="utf8", errors="ignore") if line.startswith("["))


code, out = run(PY, "check_kelvin.py", "--self-test")
if not must("physical Kelvin checker regression checks", code == 0, out): sys.exit(1)
for script, label in (("../checks/check_solder_vias.py", "exterior solder-opening regression checks"),
                      ("../mechanical/check_assembly.py", "assembly envelope and mirrored pinout regression checks"),
                      ("export_fab.py", "fresh manufacturing export regression checks")):
    code, out = run(PY, script, "--self-test")
    if not must(label, code == 0, out): sys.exit(1)

for step in ("make_lib.py", "gen_schematic.py"):
    code, out = run(PY, step)
    if not must(step, code == 0, out): sys.exit(1)
NET = SCH.replace(".kicad_sch", ".net")                                                   # check_parity.py reads this
if not fresh(NET, CLI, "sch", "export", "netlist", "-o", NET, SCH): sys.exit("netlist export failed")
if not fresh("erc.rpt", CLI, "sch", "erc", "--severity-all", "-o", "erc.rpt", SCH): sys.exit("ERC did not run")
if not must("electrical check (ERC)", items("erc.rpt") == 0, open("erc.rpt").read()): sys.exit(1)

for attempt in range(1, MAX_TRIES + 1):
    print(f"try {attempt}", flush=True)
    if VERIFY_EXISTING:
        if attempt > 1: sys.exit("Existing routed candidate failed checks; no manufacturing files exported.")
        if not os.path.isfile(ROUTED): sys.exit("No routed candidate exists.")
    else:
        code, out = run(PY, "gen_pcb.py", "12G")
        if not must("gen_pcb", code == 0, out): sys.exit(1)
        if os.path.exists(ROUTED): os.remove(ROUTED)
        os.environ["ROUTE_SEED"] = str(attempt - 1)
        code, out = run(PY, "route_body.py")
        if not must("router ran", code == 0 and os.path.exists(ROUTED), out): continue
        line = next((l for l in out.splitlines() if l.startswith("routed")), "")
        n, m = re.search(r"routed (\d+)/(\d+)", line).groups() if line else ("0", "1")
        if not must(f"routing {n}/{m}", n == m): continue
        code, out = run(PY, "stitch_gnd.py", ROUTED)
        if not must((out.strip().splitlines() or ["ground stitching"])[-1], code == 0, out): continue
    # Use the same strict project rules for the routed and source board names.
    shutil.copyfile("hp_hat.kicad_pro", ROUTED.replace(".kicad_pcb", ".kicad_pro"))
    code, out = run(PY, "configure_fabrication.py", ROUTED, "--finalize-copper")
    if not must("selected factory stackup and copper cleanup", code == 0, out): continue
    if not fresh("drc_routed.rpt", CLI, "pcb", "drc", "--severity-all", "--all-track-errors", "--refill-zones", "-o", "drc_routed.rpt", ROUTED): continue
    if not must("design-rule check (DRC)", items("drc_routed.rpt") == 0): continue
    code, out = run(PY, "check_parity.py")
    if not must("board matches schematic", code == 0 and "PARITY OK" in out, out): continue
    code, out = run(PY, "check_kelvin.py", ROUTED)
    if not must("Kelvin current sensing", code == 0 and out.count("KELVIN OK") == 3 and "FAIL" not in out.upper().replace("KELVIN OK", ""), out): continue
    code, out = run(PY, "../checks/check_solder_vias.py", "--board", ROUTED)
    if not must("via holes clear of all exterior solder openings", code == 0, out): continue
    code, out = run(PY, "../checks/check_compact.py", "--skip-bom", "--board", ROUTED)
    if not must("independent dimensions, placement and source preservation", code == 0, out): continue
    code, out = run(PY, "../mechanical/check_assembly.py", "--board", ROUTED,
                    "--gap-mm", "4.00", "--minimum-clearance-mm", "0.40")
    if not must("face-down Nano pinout and conservative 4 mm assembly envelope", code == 0, out): continue
    break
else:
    sys.exit("no clean run - nothing exported")

inputs = [Path(ROUTED), Path(SCH), Path("netlist.json"),
          HAT / "mechanical/nano-r4-envelope.json", HAT / "mechanical/check_assembly.py",
          HAT / "mechanical/ASSEMBLY.md"]
input_hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
code, out = run(PY, "export_fab.py")
if not must("export order files", code == 0, out): sys.exit(1)
code, out = run(PY, "../checks/check_compact.py", "--board", ROUTED, "--bom", str(HAT / "fab/HP-HAT_BOM.csv"), "--cli", CLI)
if not must("independent fabrication-package verification", code == 0, out): sys.exit(1)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# Independent assembly/ZIP consistency checks against the unchanged checked board.
import pcbnew
from export_fab import PREFIX, EXPECTED_CAM, EXPECTED_OUTPUTS, JLC_ROT, EXCLUDED
from fabrication_helpers import board_stackup, stackup_issues, job_stackup_issues

for path, old_hash in input_hashes.items():
    if sha(path) != old_hash: sys.exit(f"Release input changed during export: {path}")
board = pcbnew.LoadBoard(ROUTED)
fps = {fp.GetReference(): fp for fp in board.GetFootprints()}
expected = set(fps) - EXCLUDED
with (HAT / "fab" / (PREFIX + "_CPL.csv")).open(encoding="utf8") as stream:
    cpl = list(csv.DictReader(stream))
if len(cpl) != len(expected) or {r["Designator"] for r in cpl} != expected:
    sys.exit("CPL reference mismatch or duplicate")
for row in cpl:
    fp = fps[row["Designator"]]
    offset = next((value for prefix, value in JLC_ROT.items() if prefix in fp.GetFPIDAsString()), 0)
    x, y = pcbnew.ToMM(fp.GetPosition().x), -pcbnew.ToMM(fp.GetPosition().y)
    rotation = (fp.GetOrientationDegrees() + offset) % 360
    if (row["Layer"] != "Top" or fp.GetLayer() != pcbnew.F_Cu or
        abs(float(row["Mid X"].removesuffix("mm")) - x) > .00011 or
        abs(float(row["Mid Y"].removesuffix("mm")) - y) > .00011 or
        abs((float(row["Rotation"]) - rotation + 180) % 360 - 180) > .01):
        sys.exit(f"CPL position, side or rotation differs at {row['Designator']}")
with (HAT / "fab" / (PREFIX + "_BOM.csv")).open(encoding="utf8") as stream:
    bom = list(csv.DictReader(stream))
refs = [ref.strip() for row in bom for ref in row["Designator"].split(",")]
if len(refs) != len(expected) or set(refs) != expected:
    sys.exit("BOM reference mismatch or duplicate")
if any(int(row["Qty"]) != len(row["Designator"].split(",")) or not row["LCSC Part #"] or not row["Manufacturer Part Number"] for row in bom):
    sys.exit("BOM quantity or exact-part mapping invalid")
cam = HAT / "fab/gerbers"
if {p.name for p in cam.iterdir()} != EXPECTED_CAM: sys.exit("Loose CAM set differs from required four-layer package")
with zipfile.ZipFile(HAT / "fab" / (PREFIX + "_gerbers.zip")) as archive:
    if len(archive.namelist()) != len(EXPECTED_CAM) or set(archive.namelist()) != EXPECTED_CAM:
        sys.exit("Gerber ZIP contains missing, duplicate or unexpected files")
    if any(archive.read(name) != (cam / name).read_bytes() for name in EXPECTED_CAM):
        sys.exit("Gerber ZIP differs from loose CAM outputs")
stack = board_stackup(Path(ROUTED).read_text(encoding="utf8"))
issues = stackup_issues(stack) + job_stackup_issues(json.loads((cam / (Path(ROUTED).stem + "-job.gbrjob")).read_text(encoding="utf8")), stack)
if issues: sys.exit("Fabrication stackup/job verification failed: " + "; ".join(issues))
print("  BOM/CPL/ZIP and source consistency: ok", flush=True)

# Remove only obsolete generated r3 upload files, after this r4 package passes.
# Resolve and validate every exact target; never recursively remove a directory.
for suffix in ("_gerbers.zip", "_BOM.csv", "_CPL.csv", "_schematic.pdf"):
    old = HAT / "fab" / ("HP-HAT_r3" + suffix)
    if old.is_symlink() or old.resolve().parent != HAT / "fab" or (old.exists() and not old.is_file()):
        sys.exit("Unexpected obsolete manufacturing file path")
    if old.exists(): old.unlink()
files = [Path(ROUTED), Path(SCH), Path("netlist.json"), Path("hp_hat_routed.kicad_pro"), Path("erc.rpt"), Path("drc_routed.rpt"),
         HAT / "mechanical/nano-r4-envelope.json", HAT / "mechanical/check_assembly.py",
         HAT / "mechanical/ASSEMBLY.md"] + [HAT / "fab" / name for name in sorted(EXPECTED_OUTPUTS)]
with open(MANIFEST, "w", encoding="utf8") as stream:
    stream.write(f"HP-HAT r4 released {time.strftime('%Y-%m-%d %H:%M')} by release.py; supersedes the former r3 package.\n")
    stream.write("ERC 0 | DRC 0 violations, 0 unconnected | schematic parity OK | physical Kelvin OK (3 sense pins) | exterior solder openings clear of via holes | four-layer stackup verified | BOM/CPL/ZIP consistency OK\n")
    stream.write("43.18 x 17.78 mm body; 99.86 x 17.78 mm overall; 0.8 mm four-layer PCB.\n")
    stream.write("30 face-down Nano contact positions/nets verified; conservative opposing-component envelope check passed at 4.00 mm face spacing with 0.40 mm minimum clearance after stated allowances.\n")
    stream.write("Factory assembly excludes J1/J3/J4 and the separately fitted Nano/two HTSW-115-07-T-S strips soldered through both boards.\n")
    stream.write("This validates the electronic layout and manufacturing data; assembled connector fit, height, firmware and potting remain physical verification items.\n\nSHA-256\n")
    for path in files: stream.write(f"{sha(path)}  {path.name}\n")
print("RELEASED - see hat/fab/RELEASE_MANIFEST.txt")
