"""One-command release: build the board, check it, and only then write the order files.
    D:\\KiCAD\\bin\\python.exe flat-nano/kicad/release.py
    Add --verify-existing to validate and export an already routed, stitched candidate.
The router uses deterministic seeds. This repeats generate -> route -> check with successive seeds until a run is completely clean,
then exports the order files FROM THAT EXACT BOARD and writes RELEASE_MANIFEST.txt (checksums of the board and every order file).
Never upload files that were not produced by this script."""
import hashlib, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
VARIANT = Path(HERE).parent.resolve()
if VARIANT.name != "flat-nano": raise SystemExit("This release is restricted to flat-nano")
SCRATCH = VARIANT / "checks/tmp"
SCRATCH.mkdir(parents=True, exist_ok=True)
os.environ["TEMP"] = os.environ["TMP"] = str(SCRATCH)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
tempfile.tempdir = str(SCRATCH)
sys.dont_write_bytecode = True
PY, CLI = sys.executable, os.path.join(os.path.dirname(sys.executable), "kicad-cli.exe")
ROUTED = re.search(r'OUT = "[^"]+", "([^"]+)"', open("route_body.py", encoding="utf8").read()).group(1)
SCH = ROUTED.replace("_routed.kicad_pcb", ".kicad_sch")
FAB = VARIANT / "fab/r2"
MAX_TRIES = 15
VERIFY_EXISTING = "--verify-existing" in sys.argv
if sys.argv[1:] not in ([], ["--verify-existing"]):
    raise SystemExit("Use release.py [--verify-existing]")
os.environ["ROUTE_OUTPUT"] = ROUTED
MANIFEST = FAB / "RELEASE_MANIFEST.txt"
# A failed rebuild must never leave an old success certificate beside changed files.
if FAB.is_symlink() or FAB.resolve() != VARIANT / "fab/r2" or MANIFEST.is_symlink():
    raise SystemExit("Unexpected r2 release destination")
FAB.mkdir(parents=True, exist_ok=True)
MANIFEST.write_text("NOT RELEASED: HP-SDI12-NANO r2 validation in progress. Submitted r1 files remain unchanged in the parent fab directory.\n", encoding="utf8")


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


code, out = run(PY, "../checks/test_router.py")
if not must("routing regression checks", code == 0, out): sys.exit(1)
code, out = run(PY, "check_kelvin.py", "--self-test")
if not must("physical Kelvin checker regression checks", code == 0, out): sys.exit(1)
for script, label in (("../checks/check_solder_vias.py", "exterior solder-opening regression checks"),
                      ("../checks/check_variant.py", "fabrication metadata regression checks"),
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
    shutil.copyfile("hp_sensor.kicad_pro", ROUTED.replace(".kicad_pcb", ".kicad_pro"))
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
    code, out = run(PY, "../checks/check_variant.py", "--skip-cli", "--skip-fab")
    if not must("independent dimensions, placement and source preservation", code == 0, out): continue
    break
else:
    sys.exit("no clean run - nothing exported")

def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# Freeze source inputs before exporting. A background edit or a stale generator
# cannot silently change the checked board, schematic or part selection midway.
inputs = [Path(ROUTED), Path(SCH), Path(NET), Path("netlist.json"),
          Path("hp_sensor_routed.kicad_pro"), Path("hp_sensor.kicad_pro")]
inputs += sorted(Path(HERE).glob("*.py"))
inputs += sorted(Path(HERE).glob("*.pretty/*.kicad_mod"))
inputs += sorted((VARIANT / "checks").glob("*.py"))
inputs += [VARIANT / "HEATER_R2.md"]
inputs += [VARIANT / "checks/original-files.sha256.json", VARIANT / "checks/r2-preserved-projects.sha256.json"]
input_hashes = {path.resolve(): sha(path) for path in inputs}

from export_fab import build_package, publish, PREFIX, EXPECTED_CAM, EXPECTED_OUTPUTS
with tempfile.TemporaryDirectory(prefix="flat-nano-r2-release-", dir=SCRATCH) as directory:
    stage = Path(directory)
    count, groups = build_package(stage)
    print(f"  staged {PREFIX}: {count} assembled components, {groups} BOM rows", flush=True)
    code, out = run(PY, "../checks/check_variant.py", "--board", ROUTED,
                    "--require-fab", "--fab-dir", str(stage), "--cli", CLI)
    if not must("independent staged fabrication-package verification", code == 0, out): sys.exit(1)
    for path, expected_hash in input_hashes.items():
        if sha(path) != expected_hash: sys.exit(f"Release input changed during export: {path}")
    staged_files = [stage / name for name in EXPECTED_OUTPUTS]
    staged_files += [stage / "gerbers" / name for name in EXPECTED_CAM]
    staged_hashes = {path.relative_to(stage): sha(path) for path in staged_files}
    # The r1 package is not moved, modified or deleted. Only the separate r2
    # folder is published after all board and independent CAM checks pass.
    publish(stage)
    for relative, expected_hash in staged_hashes.items():
        if sha(FAB / relative) != expected_hash:
            sys.exit(f"Published payload differs from the validated staging file: {relative}")
    for path, expected_hash in input_hashes.items():
        if sha(path) != expected_hash: sys.exit(f"Release input changed while publishing: {path}")

files = list(input_hashes) + [Path("erc.rpt").resolve(), Path("drc_routed.rpt").resolve()]
files += [FAB / name for name in sorted(EXPECTED_OUTPUTS)]
files += [FAB / "gerbers" / name for name in sorted(EXPECTED_CAM)]
manifest_text = f"HP-SDI12-NANO r2 released {time.strftime('%Y-%m-%d %H:%M')} by release.py.\n"
manifest_text += "Every r2 order file was staged, independently checked against the unchanged routed board, then published. Submitted r1 payload remains unchanged in fab/ for traceability.\n"
manifest_text += "ERC 0 | DRC 0 violations, 0 unconnected | schematic parity OK | physical Kelvin OK (3 sense pins) | exterior solder openings clear of via holes | explicit four-layer stackup verified | exact BOM/CPL and fresh CAM comparison OK\n"
manifest_text += "43.18 x 17.78 mm body; 99.86 x 17.78 mm overall; 0.8 mm four-layer PCB; lead-free HASL.\n"
manifest_text += "Manufacturing checks do not constitute physical thermal-response or firmware validation.\n\nSHA-256 (paths relative to flat-nano/)\n"
for path in files:
    manifest_text += f"{sha(path)}  {path.resolve().relative_to(VARIANT).as_posix()}\n"
temporary_manifest = MANIFEST.with_suffix(".txt.tmp")
if temporary_manifest.exists(): sys.exit("Unexpected temporary release-manifest file")
temporary_manifest.write_text(manifest_text, encoding="utf8")
os.replace(temporary_manifest, MANIFEST)
print("RELEASED - see flat-nano/fab/r2/RELEASE_MANIFEST.txt")
