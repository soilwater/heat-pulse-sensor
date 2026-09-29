"""Draw a layout review picture from export_view.py JSON (runs in the Anaconda Python, which has matplotlib).
    D:\\anaconda3\\python.exe plot_view.py view.json out.png [xmin xmax]
Courtyards grey, pads colored by net, F.Cu tracks red, B.Cu blue, vias black, unrouted connections as thin dashed lines."""
import json, sys, math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle, Circle

d = json.load(open(sys.argv[1]))
xmin, xmax = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (-0.5, 50)
ONLY = sys.argv[5] if len(sys.argv) > 5 else None          # "F.Cu" or "B.Cu": copper of one layer only, no ratsnest
FIGW = max(8, (xmax - xmin) * 0.55)
fig, ax = plt.subplots(figsize=(FIGW, 10.5))
PT_PER_MM = FIGW * 72 * 0.9 / (xmax - xmin)                # line widths in data millimeters
for (a, b) in d["edges"]:
    ax.plot([a[0], b[0]], [a[1], b[1]], color="k", lw=0.8)
palette = {}
def color(net):
    if net in ("GND",): return "#6b8e23"
    if net in ("+5V",): return "#ff8c00"
    if net not in palette: palette[net] = plt.cm.tab20(len(palette) % 20)
    return palette[net]
for p in d["parts"]:
    x0, y0, x1, y1 = p["cy"]
    if x0 > 52: continue
    ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fill=False, ec="0.6", lw=0.5, ls=":"))
    ax.text(p["x"], p["y"], p["ref"], fontsize=6, ha="center", va="center", color="0.15", zorder=6, fontweight="bold", clip_on=True)
for t in d["tracks"]:
    if ONLY and t["layer"] != ONLY: continue
    col = "#d62728" if t["layer"] == "F.Cu" else "#1f77b4"
    ax.plot([t["a"][0], t["b"][0]], [t["a"][1], t["b"][1]], color=col, lw=max(0.4, t["w"] * PT_PER_MM), alpha=0.8 if ONLY else 0.55, solid_capstyle="round", zorder=3)
for v in d["vias"]:
    ax.add_patch(Circle((v["x"], v["y"]), v["d"] / 2, color="k", zorder=5))
for p in d["pads"]:
    if p["x"] > 52: continue
    if ONLY == "B.Cu" and not p["th"]: continue
    ax.add_patch(Polygon(p["poly"], closed=True, fc=color(p["net"]), ec="k", lw=0.2, alpha=0.8, zorder=4))
    if p["net"] and p["net"] not in ("GND", "+5V"):
        ax.text(p["x"], p["y"], p["net"][:9], fontsize=3.2, ha="center", va="center", zorder=7, rotation=30, clip_on=True)
# unrouted: minimum spanning tree per net over pads (GND/+5V go to planes, not drawn)
nets = {}
for p in d["pads"]:
    if p["net"] and p["net"] not in ("GND", "+5V") and not p["net"].startswith("H_") and p["x"] < 52:
        nets.setdefault(p["net"], []).append((p["x"], p["y"]))
for net, pts in ([] if ONLY else nets.items()):
    used, rest = [pts[0]], pts[1:]
    while rest:
        a, b = min(((u, r) for u in used for r in rest), key=lambda ur: math.dist(*ur))
        ax.plot([a[0], b[0]], [a[1], b[1]], color=color(net), lw=0.5, ls="--", zorder=2)
        used.append(b); rest.remove(b)
ax.axhline(0, color="m", lw=0.4, ls="-.")
ax.set_xlim(xmin, xmax); ax.set_ylim(9.5, -9.5); ax.set_aspect("equal"); ax.grid(True, lw=0.2)
ax.set_xticks(range(int(xmin), int(xmax) + 1, 2)); ax.set_yticks(range(-9, 10, 1)); ax.tick_params(labelsize=6)
fig.subplots_adjust(left=0.03, right=0.99, top=0.99, bottom=0.04); fig.savefig(sys.argv[2], dpi=130)
print("wrote", sys.argv[2])
