"""One-command release: build the board, check it, and only then write the order files.
    D:\\KiCAD\\bin\\python.exe flat-nano/kicad/release.py
    Add --verify-existing to validate and export the existing routed board without rebuilding it.
Every trace and via of the body is drawn by preroute.py (no auto-router), so a build is fully deterministic:
generate -> hand-planned copper -> fabrication setup -> checks. It exports the order files FROM THAT EXACT BOARD and
writes RELEASE_MANIFEST.txt (checksums of the board and every order file). Never upload files that were not produced
by this script."""
import hashlib, os, shutil, subprocess, sys, tempfile, time
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
ROUTED = "hp_sensor_routed.kicad_pcb"
SCH = "hp_sensor.kicad_sch"
FAB = VARIANT / "fab"
VERIFY_EXISTING = "--verify-existing" in sys.argv
if sys.argv[1:] not in ([], ["--verify-existing"]):
    raise SystemExit("Use release.py [--verify-existing]")
MANIFEST = FAB / "RELEASE_MANIFEST.txt"
# A failed rebuild must never leave an old success certificate beside changed files.
if FAB.is_symlink() or FAB.resolve() != VARIANT / "fab" or MANIFEST.is_symlink():
    raise SystemExit("Unexpected release destination")
FAB.mkdir(parents=True, exist_ok=True)
MANIFEST.write_text("NOT RELEASED: HP-SDI12-NANO validation in progress.\n", encoding="utf8")


def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def must(label, ok, out=""):
    print(f"  {label}: {'ok' if ok else 'FAILED'}", flush=True)
    if not ok:
        print(out[-2500:])
        sys.exit("release stopped - nothing exported")


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
    must("gen_pcb (outline, placement, prong wiring)", code == 0, out)
    if os.path.exists(ROUTED): os.remove(ROUTED)
    code, out = run(PY, "preroute.py")
    must("hand-planned copper (preroute.py)", code == 0 and os.path.exists(ROUTED), out)
# Use the same strict project rules for the routed and source board names.
shutil.copyfile("hp_sensor.kicad_pro", ROUTED.replace(".kicad_pcb", ".kicad_pro"))
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
must("layout quality (power widths, mirrored needles, left/right balance, heat on axis, routing style, USB pair)", code == 0 and "QUALITY OK" in out, out)
QUALITY_NOTES = [l for l in out.splitlines() if l.startswith(("USB lengths", "BALANCE"))]


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# Freeze source inputs before exporting. A background edit or a stale generator
# cannot silently change the checked board, schematic or part selection midway.
inputs = [Path(ROUTED), Path(SCH), Path(NET), Path("netlist.json"),
          Path("hp_sensor_routed.kicad_pro"), Path("hp_sensor.kicad_pro")]
inputs += sorted(Path(HERE).glob("*.py"))
inputs += sorted(Path(HERE).glob("*.pretty/*.kicad_mod"))
inputs += sorted((VARIANT / "checks").glob("*.py"))
inputs += [VARIANT / "HEATER.md"]
input_hashes = {path.resolve(): sha(path) for path in inputs}

from export_fab import build_package, publish, PREFIX, EXPECTED_CAM, EXPECTED_OUTPUTS
with tempfile.TemporaryDirectory(prefix="flat-nano-release-", dir=SCRATCH) as directory:
    stage = Path(directory)
    count, groups = build_package(stage)
    print(f"  staged {PREFIX}: {count} assembled components, {groups} BOM rows", flush=True)
    for path, expected_hash in input_hashes.items():
        if sha(path) != expected_hash: sys.exit(f"Release input changed during export: {path}")
    staged_files = [stage / name for name in EXPECTED_OUTPUTS]
    staged_files += [stage / "gerbers" / name for name in EXPECTED_CAM]
    staged_hashes = {path.relative_to(stage): sha(path) for path in staged_files}
    # Published over the previous package in place, only after all board checks pass.
    publish(stage)
    for relative, expected_hash in staged_hashes.items():
        if sha(FAB / relative) != expected_hash:
            sys.exit(f"Published payload differs from the validated staging file: {relative}")
    for path, expected_hash in input_hashes.items():
        if sha(path) != expected_hash: sys.exit(f"Release input changed while publishing: {path}")

import pcbnew
board = pcbnew.LoadBoard(ROUTED)
edge = board.GetBoardEdgesBoundingBox()
stroke = max(pcbnew.ToMM(d.GetWidth()) for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts)
overall_l, overall_w = pcbnew.ToMM(edge.GetWidth()) - stroke, pcbnew.ToMM(edge.GetHeight()) - stroke   # outline, not its drawn stroke
files = list(input_hashes) + [Path("erc.rpt").resolve(), Path("drc_routed.rpt").resolve()]
files += [FAB / name for name in sorted(EXPECTED_OUTPUTS)]
files += [FAB / "gerbers" / name for name in sorted(EXPECTED_CAM)]
manifest_text = f"HP-SDI12-NANO released {time.strftime('%Y-%m-%d %H:%M')} by release.py.\n"
manifest_text += "Every order file was staged from the checked routed board, then published over the previous package.\n"
manifest_text += ("ERC 0 | DRC 0 violations, 0 unconnected (all severities) | schematic parity OK | physical Kelvin OK (3 sense pins) | "
                  "exterior solder openings clear of via holes | layout quality gate passed (heater/battery copper >= 0.5 mm outer, "
                  ">= 1.2 mm inner; mirrored needles; left/right copper within 10% on every layer; heat sources on the axis; routing style; USB pair) | four-layer stackup verified\n")
manifest_text += "; ".join(QUALITY_NOTES) + "\n"
manifest_text += f"43.18 x 17.78 mm body (Arduino Nano R4 outline); {overall_l:.2f} x {overall_w:.2f} mm overall; 0.8 mm four-layer PCB; lead-free HASL.\n"
manifest_text += "Manufacturing checks do not constitute physical thermal-response or firmware validation.\n\nSHA-256 (paths relative to flat-nano/)\n"
for path in files:
    manifest_text += f"{sha(path)}  {path.resolve().relative_to(VARIANT).as_posix()}\n"
temporary_manifest = MANIFEST.with_suffix(".txt.tmp")
if temporary_manifest.exists(): sys.exit("Unexpected temporary release-manifest file")
temporary_manifest.write_text(manifest_text, encoding="utf8")
os.replace(temporary_manifest, MANIFEST)
print("RELEASED - see flat-nano/fab/RELEASE_MANIFEST.txt")
