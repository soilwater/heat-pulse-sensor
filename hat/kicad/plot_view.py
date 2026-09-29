"""Draw a layout review picture of one board side from export_view.py JSON (runs in the Anaconda Python, which has matplotlib).
    D:\\anaconda3\\python.exe plot_view.py view.json out.png SIDE [xmin xmax]
SIDE is F or B: that side's parts (courtyards dotted), its pads (through-hole pads on both), its copper (F red, B blue),
the inner-layer strips (In2 orange, faint), vias black, and dashed straight lines for connections not yet drawn.
The picture is always seen from the top (bottom-side parts appear mirrored, exactly as on the board)."""
import json, sys, math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle, Circle

d = json.load(open(sys.argv[1]))
SIDE = sys.argv[3]
xmin, xmax = (float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else (-0.5, 45)
LAYER = {"F": "F.Cu", "B": "B.Cu"}[SIDE]
FIGW = max(8, (xmax - xmin) * 0.55)
fig, ax = plt.subplots(figsize=(FIGW, 10.5))
PT_PER_MM = FIGW * 72 * 0.9 / (xmax - xmin)
for (a, b) in d["edges"]:
    ax.plot([a[0], b[0]], [a[1], b[1]], color="k", lw=0.8)
palette = {}
def color(net):
    if net == "GND": return "#6b8e23"
    if net == "+5V": return "#ff8c00"
    if net not in palette: palette[net] = plt.cm.tab20(len(palette) % 20)
    return palette[net]
for p in d["parts"]:
    x0, y0, x1, y1 = p["cy"]
    if x0 > 46 or p["side"] != SIDE: continue
    ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fill=False, ec="0.5", lw=0.6, ls=":"))
    ax.text(p["x"], p["y"], p["ref"], fontsize=6, ha="center", va="center", color="0.1", zorder=6, fontweight="bold", clip_on=True)
for t in d["tracks"]:
    if t["layer"] == LAYER:
        col, alpha = ("#d62728" if SIDE == "F" else "#1f77b4"), 0.75
    elif t["layer"] == "In2.Cu":
        col, alpha = "#ff7f0e", 0.25
    else:
        continue
    ax.plot([t["a"][0], t["b"][0]], [t["a"][1], t["b"][1]], color=col, lw=max(0.4, t["w"] * PT_PER_MM), alpha=alpha, solid_capstyle="round", zorder=3)
for v in d["vias"]:
    ax.add_patch(Circle((v["x"], v["y"]), v["d"] / 2, color="k", zorder=5))
for p in d["pads"]:
    if p["x"] > 46 or SIDE not in p["side"]: continue
    ax.add_patch(Polygon(p["poly"], closed=True, fc=color(p["net"]), ec="k", lw=0.2, alpha=0.8, zorder=4))
    if p["net"] and p["net"] not in ("GND", "+5V"):
        ax.text(p["x"], p["y"], p["net"][:9], fontsize=3.2, ha="center", va="center", zorder=7, rotation=30, clip_on=True)
nets = {}
for p in d["pads"]:
    if p["net"] and p["net"] not in ("GND", "+5V") and not p["net"].startswith("H_") and p["x"] < 46:
        nets.setdefault(p["net"], []).append((p["x"], p["y"]))
for net, pts in nets.items():
    used, rest = [pts[0]], pts[1:]
    while rest:
        a, b = min(((u, r) for u in used for r in rest), key=lambda ur: math.dist(*ur))
        ax.plot([a[0], b[0]], [a[1], b[1]], color=color(net), lw=0.4, ls="--", zorder=2, alpha=0.6)
        used.append(b); rest.remove(b)
ax.axhline(0, color="m", lw=0.4, ls="-.")
ax.axvline(35.18, color="m", lw=0.4, ls="-.")
ax.set_xlim(xmin, xmax); ax.set_ylim(9.5, -9.5); ax.set_aspect("equal"); ax.grid(True, lw=0.2)
ax.set_xticks(range(int(xmin), int(xmax) + 1, 1)); ax.set_yticks(range(-9, 10, 1)); ax.tick_params(labelsize=5)
ax.set_title(f"{SIDE} side (seen from the top)", fontsize=8)
fig.subplots_adjust(left=0.03, right=0.99, top=0.97, bottom=0.04); fig.savefig(sys.argv[2], dpi=130)
print("wrote", sys.argv[2])
