"""Small routing regressions; no KiCad import, board loading, or file writes.

Run with ordinary Python: python flat-nano/checks/test_router.py
Only function definitions are extracted from the actual router. Synthetic grids
exercise its search and rollback behavior; these tests do not replace PCB DRC.
"""
import ast
import contextlib
import copy
import functools
import heapq
import io
import math
from pathlib import Path
import unittest


ROUTER = Path(__file__).resolve().parents[1] / "kicad" / "route_body.py"
TREE = ast.parse(ROUTER.read_text())
FUNCTIONS = {
    "cells_rect", "cells_disc", "cells_seg", "ok_static", "foreign", "search",
    "walk", "commit", "rip", "blockers", "route_unit", "_route_unit",
}
FUNCTION_CODE = compile(ast.Module(
    body=[node for node in TREE.body
          if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS],
    type_ignores=[]), str(ROUTER), "exec")


class Grid:
    def __init__(self, nx=24, ny=24):
        grid = 0.125
        self.ns = {
            "math": math, "heapq": heapq, "functools": functools,
            "F": 0, "B": 1, "G": grid, "NX": nx, "NY": ny,
            "gx": lambda x: int(round(x / grid)),
            "gy": lambda y: int(round(y / grid)),
            "mm": lambda ix, iy: (ix * grid, iy * grid),
            "idx": lambda ix, iy: ix * ny + iy,
            "W_SIG": 0.2, "W_PWR": 0.25, "CLR": 0.16,
            "VIA_D": 0.6, "VIA_DRILL": 0.35, "HOLE_R": 0.65,
            "FOREIGN_COST": 60.0, "HIST_W": 0.6, "VIA_COST": 12.0,
            "LAYER_COST": {0: 1.0, 1: 3.0},
            "MOVES": [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
                      (1, 1, 1.4142), (1, -1, 1.4142),
                      (-1, 1, 1.4142), (-1, -1, 1.4142)],
            "N4": ((1, 0), (-1, 0), (0, 1), (0, -1)),
            "S": {"trk": [[0] * (nx * ny) for _ in range(2)],
                  "via": [[0] * (nx * ny) for _ in range(2)],
                  "hole": [0] * (nx * ny)},
            "D": {"trk": [{}, {}], "via": [{}, {}], "hole": [{}]},
            "HIST": [{}, {}], "VIA_AT": {}, "routed": {},
            "units": {}, "unit_net": {}, "netname": {}, "termcells": {},
            "KELVIN": {}, "DIRECT_PAIRS": {}, "PROTECTED_NETS": set(),
        }
        exec(FUNCTION_CODE, self.ns)

    def call(self, name, *args, **kwargs):
        return self.ns[name](*args, **kwargs)

    def index(self, x, y):
        return self.ns["idx"](x, y)

    def unit(self, uid, net, points):
        terms = [dict(layers=(layer,), cell=(x, y),
                      x=x * self.ns["G"], y=y * self.ns["G"],
                      label=f"{uid}.{i}", fp=uid, pad=None)
                 for i, (layer, x, y) in enumerate(points)]
        self.ns["unit_net"][uid] = net
        self.ns["netname"][net] = f"net-{net}"
        self.ns["units"][uid] = dict(net=net, kind="net", terms=terms, wide=False)
        self.ns["termcells"].setdefault(net, set()).update(points)

    def state(self):
        return copy.deepcopy({name: self.ns[name]
                              for name in ("D", "HIST", "VIA_AT", "routed")})


class SearchRegressions(unittest.TestCase):
    def test_via_cannot_enter_either_kind_of_kelvin_exclusion(self):
        for exclusion in ("avoid", "avoid_via"):
            for reuse in (False, True):
                with self.subTest(exclusion=exclusion, reuse=reuse):
                    g = Grid(1, 1)
                    g.ns["MOVES"] = []
                    if reuse:
                        g.ns["VIA_AT"][0] = 1
                    positive, _ = g.call("search", 1, {(1, 0, 0)}, {(0, 0, 0)}, False, False)
                    self.assertEqual(positive, (0, 0, 0))
                    blocked, _ = g.call("search", 1, {(1, 0, 0)}, {(0, 0, 0)},
                                        False, False, **{exclusion: {(0, 0, 0)}})
                    self.assertIsNone(blocked)

    def test_ground_via_goal_accounts_for_foreign_cost(self):
        g = Grid(3, 1)
        g.ns["S"]["hole"][0] = 1
        g.ns["unit_net"]["X"] = 2
        g.ns["D"]["via"][0][1] = {"X"}
        goal, _ = g.call("search", 1, {(0, 0, 0)}, set(), False, True, plane=True)
        self.assertEqual(goal, (0, 2, 0), "Free landing at cost 2 should beat occupied landing at cost 61")
        g.ns["S"]["hole"][2] = 1
        expensive, _ = g.call("search", 1, {(0, 0, 0)}, set(), False, True, plane=True)
        self.assertEqual(expensive, (0, 1, 0), "Keep an expensive goal when it is the only possible landing")

    def test_diagonal_guards_are_reported_as_blockers(self):
        g = Grid(2, 2)
        g.ns["S"]["hole"] = [1] * 4
        g.ns["unit_net"]["X"] = 2
        for cell in ((1, 0), (0, 1)):
            g.ns["D"]["trk"][0][g.index(*cell)] = {"X"}
        source, target = {(0, 0, 0)}, {(0, 1, 1)}
        hard, _ = g.call("search", 1, source, target, False, False)
        self.assertIsNone(hard)
        self.assertEqual(g.call("blockers", [(0, 0, 0), (0, 1, 1)], 1, False), {"X"})
        goal, previous = g.call("search", 1, source, target, False, True)
        self.assertEqual(goal, (0, 1, 1))
        path = g.call("walk", goal, previous, source)
        self.assertEqual(g.call("blockers", path, 1, False), {"X"})
        g.ns["D"]["trk"][0].clear()
        repaired, _ = g.call("search", 1, source, target, False, False)
        self.assertEqual(repaired, (0, 1, 1))


class ViaOwnershipRegressions(unittest.TestCase):
    def test_ripping_one_owner_preserves_shared_via(self):
        g = Grid()
        for uid in ("A", "B"):
            g.unit(uid, 1, [(0, 10, 10), (1, 10, 10)])
            g.call("commit", uid, [(0, 10, 10), (1, 10, 10)], 0.2)
        key = g.index(10, 10)
        g.call("rip", "A")
        self.assertEqual(g.ns["VIA_AT"][key], 1)
        self.assertEqual(g.ns["D"]["hole"][0][key], {"B"})
        self.assertIn("B", g.ns["routed"])
        g.call("rip", "B")
        self.assertFalse(g.ns["VIA_AT"])
        self.assertTrue(all(not layer for layers in g.ns["D"].values() for layer in layers))

    def test_exact_same_net_reuse_does_not_rip_its_owner(self):
        g = Grid()
        g.unit("existing", 1, [(0, 10, 10), (1, 10, 10)])
        g.call("commit", "existing", [(0, 10, 10), (1, 10, 10)], 0.2)
        self.assertEqual(g.call("blockers", [(0, 10, 10), (1, 10, 10)], 1, False), set())
        self.assertEqual(g.call("blockers", [(0, 9, 10), (0, 10, 10)], 1, False, plane_via=True), set())

    def test_nearby_distinct_hole_still_reports_its_owner(self):
        g = Grid()
        g.unit("existing", 1, [(0, 10, 10), (1, 10, 10)])
        g.call("commit", "existing", [(0, 10, 10), (1, 10, 10)], 0.2)
        self.assertEqual(g.call("blockers", [(0, 11, 10), (1, 11, 10)], 1, False), {"existing"})


class SoftRollbackRegressions(unittest.TestCase):
    def test_success_restores_overwritten_foreign_via_and_all_marks(self):
        g = Grid()
        point = [(0, 10, 10), (1, 10, 10)]
        g.unit("X", 2, point)
        g.call("commit", "X", point, 0.2)
        g.unit("A", 1, point)
        g.ns["MOVES"] = []
        g.ns["HIST"][0][0] = 7
        before = g.state()
        ok, blocked = g.call("route_unit", "A", soft=True)
        self.assertTrue(ok)
        self.assertEqual(blocked, {"X"})
        self.assertEqual(g.state(), before)

    def test_success_restores_existing_same_net_shared_via(self):
        g = Grid()
        point = [(0, 10, 10), (1, 10, 10)]
        for uid in ("B", "A"):
            g.unit(uid, 1, point)
        g.call("commit", "B", point, 0.2)
        g.ns["MOVES"] = []
        before = g.state()
        self.assertEqual(g.call("route_unit", "A", soft=True), (True, set()))
        self.assertEqual(g.state(), before)

    def failing_branch_grid(self):
        g = Grid()
        g.unit("A", 1, [(0, 10, 10), (1, 10, 10), (0, 20, 10)])
        g.ns["MOVES"] = []
        g.ns["HIST"][0][0] = 7
        return g

    def test_failed_later_branch_restores_provisional_holes_without_history(self):
        g = self.failing_branch_grid()
        original = g.ns["search"]
        calls = []

        def inspect(*args, **kwargs):
            calls.append(True)
            if len(calls) == 2:
                self.assertEqual(g.ns["VIA_AT"][g.index(10, 10)], 1)
                self.assertIn("A", g.ns["D"]["hole"][0][g.index(11, 10)])
            return original(*args, **kwargs)

        g.ns["search"] = inspect
        before = g.state()
        with contextlib.redirect_stdout(io.StringIO()):
            ok, blocked = g.call("route_unit", "A", soft=True)
        self.assertFalse(ok)
        self.assertEqual(blocked, set())
        self.assertEqual(len(calls), 2)
        self.assertEqual(g.state(), before)

    def test_exception_in_later_branch_also_rolls_back(self):
        g = self.failing_branch_grid()
        original = g.ns["search"]
        calls = []

        def fail_second(*args, **kwargs):
            calls.append(True)
            if len(calls) == 2:
                self.assertIn("A", g.ns["routed"])
                raise RuntimeError("synthetic search failure")
            return original(*args, **kwargs)

        g.ns["search"] = fail_second
        before = g.state()
        with self.assertRaisesRegex(RuntimeError, "synthetic search failure"):
            g.call("route_unit", "A", soft=True)
        self.assertEqual(g.state(), before)

    def test_soft_plan_refuses_to_destroy_an_existing_route(self):
        g = Grid()
        path = [(0, 10, 10), (1, 10, 10)]
        g.unit("A", 1, path)
        g.call("commit", "A", path, 0.2)
        before = g.state()
        with self.assertRaisesRegex(RuntimeError, "previous routing"):
            g.call("route_unit", "A", soft=True)
        self.assertEqual(g.state(), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
