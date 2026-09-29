"""One-command release: build the board, check it, and only then write the order files.
    D:\\KiCAD\\bin\\python.exe hat/kicad/release.py
    Add --verify-existing to validate and export the existing routed board without rebuilding it.
Every trace and via of the body is drawn by preroute.py (no auto-router), so a build is fully deterministic:
generate -> hand-planned copper -> fabrication setup -> checks. It exports the order files FROM THAT EXACT BOARD and
writes RELEASE_MANIFEST.txt (checksums of the board and every order file). Never upload files that were not produced
by this script."""
import csv, hashlib, json, os, shutil, subprocess, sys, tempfile, time, zipfile
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
SCH = "hp_hat.kicad_sch"
FAB = HAT / "fab"
if sys.argv[1:] not in ([], ["--verify-existing"]):
    raise SystemExit("Use release.py [--verify-existing]")
VERIFY_EXISTING = "--verify-existing" in sys.argv
MANIFEST = FAB / "RELEASE_MANIFEST.txt"
# A failed rebuild must never leave an old success certificate beside changed files.
if FAB.is_symlink() or FAB.resolve() != HAT / "fab" or MANIFEST.is_symlink():
    raise SystemExit("Unexpected release destination")
FAB.mkdir(exist_ok=True)
MANIFEST.write_text("NOT RELEASED: compact HP-HAT validation in progress.\n", encoding="utf8")


def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def must(label, ok, out=""):
    print(f"  {label}: {'ok' if ok else 'FAILED'}", flush=True)
    if not ok:
        print(out[-2500:])
        sys.exit("release stopped - nothing released")


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
must("physical Kelvin checker regression checks", code == 0, out)
for script, label in (("../checks/check_solder_vias.py", "exterior solder-opening regression checks"),
                      ("../mechanical/check_assembly.py", "assembly envelope and mirrored pinout regression checks"),
                      ("export_fab.py", "fresh manufacturing export regression checks")):
    code, out = run(PY, script, "--self-test")
    must(label, code == 0, out)

for step in ("make_lib.py", "gen_schematic.py"):
    code, out = run(PY, step)
    must(step, code == 0, out)
NET = SCH.replace(".kicad_sch", ".net")                                                   # check_parity.py reads this
must("schematic netlist export", fresh(NET, CLI, "sch", "export", "netlist", "-o", NET, SCH))
must("ERC ran", fresh("erc.rpt", CLI, "sch", "erc", "--severity-all", "-o", "erc.rpt", SCH))
must("electrical check (ERC)", items("erc.rpt") == 0, open("erc.rpt").read())

if VERIFY_EXISTING:
    if not os.path.isfile(ROUTED): sys.exit("No routed board exists.")
else:
    code, out = run(PY, "gen_pcb.py", "12G")
    must("gen_pcb (outline, two-sided placement, prong wiring)", code == 0, out)
    if os.path.exists(ROUTED): os.remove(ROUTED)
    code, out = run(PY, "preroute.py")
    must("hand-planned copper (preroute.py)", code == 0 and os.path.exists(ROUTED), out)
# Use the same strict project rules for the routed and source board names.
shutil.copyfile("hp_hat.kicad_pro", ROUTED.replace(".kicad_pcb", ".kicad_pro"))
code, out = run(PY, "configure_fabrication.py", ROUTED, "--finalize-copper")
must("selected factory stackup and copper cleanup", code == 0, out)
must("DRC ran", fresh("drc_routed.rpt", CLI, "pcb", "drc", "--severity-all", "--all-track-errors", "--refill-zones", "-o", "drc_routed.rpt", ROUTED))
must("design-rule check (DRC, all severities)", items("drc_routed.rpt") == 0, open("drc_routed.rpt").read())
code, out = run(PY, "check_parity.py")
must("board matches schematic", code == 0 and "PARITY OK" in out, out)
code, out = run(PY, "check_kelvin.py", ROUTED)
must("Kelvin current sensing", code == 0 and out.count("KELVIN OK") == 3 and "FAIL" not in out.upper().replace("KELVIN OK", ""), out)
code, out = run(PY, "../checks/check_solder_vias.py", "--board", ROUTED)
must("via holes clear of all exterior solder openings", code == 0, out)
code, out = run(PY, "../checks/check_quality.py", ROUTED)
must("layout quality (power widths, mirrored needles, left/right balance, heat on axis, routing style)", code == 0 and "QUALITY OK" in out, out)
QUALITY_NOTES = [l for l in out.splitlines() if l.startswith("BALANCE")]
code, out = run(PY, "../checks/check_compact.py", "--skip-bom", "--board", ROUTED)
must("Nano outline, needles identical to flat-nano, placement and inner planes", code == 0, out)
code, out = run(PY, "../mechanical/check_assembly.py", "--board", ROUTED, "--gap-mm", "4.00", "--minimum-clearance-mm", "0.40")
must("face-down Nano pinout and conservative 4 mm assembly envelope", code == 0, out)
ASSEMBLY_NOTES = [l for l in out.splitlines() if l.startswith(("Minimum opposing", "Outward"))]


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# Freeze source inputs before exporting. A background edit or a stale generator
# cannot silently change the checked board, schematic or part selection midway.
inputs = [Path(ROUTED), Path(SCH), Path(NET), Path("netlist.json"), Path("placement.json"),
          Path("hp_hat_routed.kicad_pro"), Path("hp_hat.kicad_pro")]
inputs += sorted(Path(HERE).glob("*.py"))
inputs += sorted(Path(HERE).glob("*.pretty/*.kicad_mod"))
inputs += sorted((HAT / "checks").glob("*.py"))
inputs += [HAT / "mechanical/nano-r4-envelope.json", HAT / "mechanical/check_assembly.py", HAT / "mechanical/ASSEMBLY.md"]
input_hashes = {path.resolve(): sha(path) for path in inputs}

code, out = run(PY, "export_fab.py")
must("export order files", code == 0, out)
for path, expected_hash in input_hashes.items():
    if sha(path) != expected_hash: sys.exit(f"Release input changed during export: {path}")
code, out = run(PY, "../checks/check_compact.py", "--board", ROUTED, "--bom", str(FAB / "HP-HAT_BOM.csv"), "--cli", CLI)
must("independent fabrication-package verification (BOM, fresh parity/ERC/DRC)", code == 0, out)

# Independent assembly/ZIP consistency checks against the unchanged checked board.
import pcbnew
from export_fab import PREFIX, EXPECTED_CAM, EXPECTED_OUTPUTS, EXCLUDED, jlc_rotation
from fabrication_helpers import board_stackup, stackup_issues, job_stackup_issues

board = pcbnew.LoadBoard(ROUTED)
fps = {fp.GetReference(): fp for fp in board.GetFootprints()}
expected = set(fps) - EXCLUDED
with (FAB / (PREFIX + "_CPL.csv")).open(encoding="utf8") as stream:
    cpl = list(csv.DictReader(stream))
if len(cpl) != len(expected) or {r["Designator"] for r in cpl} != expected:
    sys.exit("CPL reference mismatch or duplicate")
sides = {"Top": 0, "Bottom": 0}
for row in cpl:
    fp = fps[row["Designator"]]
    bottom = fp.GetLayer() == pcbnew.B_Cu
    x, y = pcbnew.ToMM(fp.GetPosition().x), -pcbnew.ToMM(fp.GetPosition().y)
    rotation = jlc_rotation(fp.GetOrientationDegrees(), fp.GetFPIDAsString(), bottom)
    if (row["Layer"] != ("Bottom" if bottom else "Top") or
        abs(float(row["Mid X"].removesuffix("mm")) - x) > .00011 or
        abs(float(row["Mid Y"].removesuffix("mm")) - y) > .00011 or
        abs((float(row["Rotation"]) - rotation + 180) % 360 - 180) > .01):
        sys.exit(f"CPL position, side or rotation differs at {row['Designator']}")
    sides[row["Layer"]] += 1
with (FAB / (PREFIX + "_BOM.csv")).open(encoding="utf8") as stream:
    bom = list(csv.DictReader(stream))
refs = [ref.strip() for row in bom for ref in row["Designator"].split(",")]
if len(refs) != len(expected) or set(refs) != expected:
    sys.exit("BOM reference mismatch or duplicate")
if any(int(row["Qty"]) != len(row["Designator"].split(",")) or not row["LCSC Part #"] or not row["Manufacturer Part Number"] for row in bom):
    sys.exit("BOM quantity or exact-part mapping invalid")
cam = FAB / "gerbers"
if {p.name for p in cam.iterdir()} != EXPECTED_CAM: sys.exit("Loose CAM set differs from the required four-layer, two-sided package")
with zipfile.ZipFile(FAB / (PREFIX + "_gerbers.zip")) as archive:
    if len(archive.namelist()) != len(EXPECTED_CAM) or set(archive.namelist()) != EXPECTED_CAM:
        sys.exit("Gerber ZIP contains missing, duplicate or unexpected files")
    if any(archive.read(name) != (cam / name).read_bytes() for name in EXPECTED_CAM):
        sys.exit("Gerber ZIP differs from loose CAM outputs")
stack = board_stackup(Path(ROUTED).read_text(encoding="utf8"))
issues = stackup_issues(stack) + job_stackup_issues(json.loads((cam / (Path(ROUTED).stem + "-job.gbrjob")).read_text(encoding="utf8")), stack)
if issues: sys.exit("Fabrication stackup/job verification failed: " + "; ".join(issues))
print(f"  BOM/CPL/ZIP and source consistency: ok ({sides['Top']} top, {sides['Bottom']} bottom parts)", flush=True)
for path, expected_hash in input_hashes.items():
    if sha(path) != expected_hash: sys.exit(f"Release input changed while verifying: {path}")

edge = board.GetBoardEdgesBoundingBox()
stroke = max(pcbnew.ToMM(d.GetWidth()) for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts)
overall_l, overall_w = pcbnew.ToMM(edge.GetWidth()) - stroke, pcbnew.ToMM(edge.GetHeight()) - stroke   # outline, not its drawn stroke
files = list(input_hashes) + [Path("erc.rpt").resolve(), Path("drc_routed.rpt").resolve()]
files += [FAB / name for name in sorted(EXPECTED_OUTPUTS)]
files += [FAB / "gerbers" / name for name in sorted(EXPECTED_CAM)]
text = f"HP-HAT released {time.strftime('%Y-%m-%d %H:%M')} by release.py.\n"
text += "Every order file was generated from the checked routed board, then verified against it.\n"
text += ("ERC 0 | DRC 0 violations, 0 unconnected (all severities) | schematic parity OK | physical Kelvin OK (3 sense pins) | "
         "exterior solder openings clear of via holes | layout quality gate passed (heater/battery/Nano-supply copper >= 0.5 mm "
         "outer, >= 1.2 mm inner; mirrored needles; left/right copper within 10% on every layer; heat sources on the axis; routing style) | "
         "Nano outline and needles identical to flat-nano | four-layer stackup verified | BOM/CPL/ZIP consistency OK\n")
text += "; ".join(QUALITY_NOTES + ASSEMBLY_NOTES) + "\n"
text += (f"43.18 x 17.78 mm body (exact Arduino Nano R4 outline and pins); {overall_l:.2f} x {overall_w:.2f} mm overall; "
         f"0.8 mm four-layer PCB; lead-free HASL; parts on both sides ({sides['Top']} top, {sides['Bottom']} bottom).\n")
text += "30 face-down Nano contact positions/nets verified; conservative opposing-component envelope check passed at 4.00 mm face spacing with 0.40 mm minimum clearance after stated allowances.\n"
text += "Factory assembly excludes J1/J3/J4 and the separately fitted Nano and two HTSW-115-07-T-S strips soldered through both boards.\n"
text += "This validates the electronic layout and manufacturing data; assembled connector fit, height, firmware and potting remain physical verification items.\n\nSHA-256 (paths relative to hat/)\n"
for path in files:
    text += f"{sha(path)}  {path.resolve().relative_to(HAT).as_posix()}\n"
temporary = MANIFEST.with_suffix(".txt.tmp")
if temporary.exists(): sys.exit("Unexpected temporary release-manifest file")
temporary.write_text(text, encoding="utf8")
os.replace(temporary, MANIFEST)
print("RELEASED - see hat/fab/RELEASE_MANIFEST.txt")
