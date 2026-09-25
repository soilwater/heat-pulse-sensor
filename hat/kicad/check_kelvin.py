"""Check that INA226 sense copper joins load copper only within its R5 pad.

Run with KiCad Python: check_kelvin.py BOARD, or check_kelvin.py --self-test.
Read-only. Uses actual finite-width copper polygons, mid-segment crossings,
via annuli, filled zones and plated interlayer connections. Polygon tolerance
is 0.0001 mm, also applied to the removed shunt-pad boundary to eliminate
integer-rounding slivers. This is not a current-density or error simulation.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
import sys
import pcbnew as pcb

CHECKS = [("VIN_P", "U4", "10", "R5", "1"),
          ("HEAT_P", "U4", "9", "R5", "2"),
          ("HEAT_P", "U4", "8", "R5", "2")]
ERROR = pcb.FromMM(0.0001)


def shape_polygon(item, layer):
    polygon = pcb.SHAPE_POLY_SET()
    item.TransformShapeToPolygon(polygon, layer, 0, ERROR, pcb.ERROR_OUTSIDE)
    return polygon


def hole_polygon(item):
    polygon = pcb.SHAPE_POLY_SET()
    item.GetEffectiveHoleShape().TransformToPolygon(polygon, ERROR, pcb.ERROR_INSIDE)
    return polygon


def outlines(polygon):
    """Individual connected islands, retaining their internal holes."""
    result = []
    for index in range(polygon.OutlineCount()):
        piece = pcb.SHAPE_POLY_SET()
        piece.AddOutline(polygon.Outline(index))
        for hole in range(polygon.HoleCount(index)):
            piece.AddHole(polygon.Hole(index, hole), 0)
        result.append(piece)
    return result


def copper_for_net(board, netname):
    layers = tuple(board.GetEnabledLayers().CuStack())
    copper = {layer: pcb.SHAPE_POLY_SET() for layer in layers}
    holes = {layer: pcb.SHAPE_POLY_SET() for layer in layers}
    plated = []
    pads = defaultdict(list)
    for footprint in board.GetFootprints():
        for pad in footprint.Pads():
            if pad.GetNetname() != netname:
                continue
            identity = (footprint.GetReference(), pad.GetNumber())
            shapes = {}
            for layer in layers:
                if pad.IsOnLayer(layer) and pad.FlashLayer(layer):
                    polygon = shape_polygon(pad, layer)
                    copper[layer].BooleanAdd(polygon)
                    pads[identity].append((layer, polygon))
                    shapes[layer] = pcb.SHAPE_POLY_SET(polygon)
            if pad.HasDrilledHole():
                hole = hole_polygon(pad)
                for layer in layers:
                    if pad.IsOnLayer(layer):
                        holes[layer].BooleanAdd(hole)
                for layer in shapes:
                    shapes[layer].BooleanSubtract(hole)
                if pad.GetAttribute() == pcb.PAD_ATTRIB_PTH:
                    plated.append(shapes)
    for track in board.GetTracks():
        if track.GetNetname() != netname:
            continue
        shapes = {}
        for layer in layers:
            if track.IsOnLayer(layer) and (track.GetClass() != "PCB_VIA" or track.FlashLayer(layer)):
                polygon = shape_polygon(track, layer)
                copper[layer].BooleanAdd(polygon)
                shapes[layer] = pcb.SHAPE_POLY_SET(polygon)
        if track.GetClass() == "PCB_VIA":
            hole = hole_polygon(track)
            for layer in layers:
                if track.IsOnLayer(layer):
                    holes[layer].BooleanAdd(hole)
            for layer in shapes:
                shapes[layer].BooleanSubtract(hole)
            plated.append(shapes)
    for zone in board.Zones():
        if zone.GetNetname() != netname:
            continue
        for layer in layers:
            if zone.IsOnLayer(layer) and zone.HasFilledPolysForLayer(layer):
                copper[layer].BooleanAdd(zone.GetFilledPolysList(layer))
    # Drill holes remove copper from tracks too. Keep actual annuli separately
    # to connect layers only where remaining copper touches a plated barrel.
    for layer in layers:
        copper[layer].BooleanSubtract(holes[layer])
    return copper, plated, pads


def connected_components(copper, plated, removed=()):
    # Boolean union/subtraction of rotated roundrect pads can retain a 1 nm
    # rim where a previously collinear edge was simplified. That rim can join
    # independent sense/load entries after the shunt pad is removed. Expand
    # the cut by the established 0.1 um polygon tolerance, far below trace
    # manufacturing dimensions, so quantization cannot invent a bypass.
    cuts = []
    for layer, cut in removed:
        expanded = pcb.SHAPE_POLY_SET(cut)
        expanded.Inflate(ERROR, pcb.CORNER_STRATEGY_ROUND_ALL_CORNERS, ERROR)
        cuts.append((layer, expanded))
    pieces = []
    for layer in copper:
        polygon = pcb.SHAPE_POLY_SET(copper[layer])
        for cut_layer, cut in cuts:
            if cut_layer == layer:
                polygon.BooleanSubtract(cut)
        pieces.extend((layer, part) for part in outlines(polygon))
    parent = list(range(len(pieces)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for shapes in plated:
        contacts = [index for index, (layer, polygon) in enumerate(pieces)
                    if layer in shapes and polygon.Collide(shapes[layer])]
        for index in contacts[1:]:
            parent[find(index)] = find(contacts[0])

    def contacts(shapes):
        return {find(index) for index, (layer, polygon) in enumerate(pieces)
                if any(layer == pad_layer and polygon.Collide(pad_polygon)
                       for pad_layer, pad_polygon in shapes)}
    return contacts


def check_kelvin(board, checks=CHECKS):
    # Resolve conditional inner annuli from the current board connectivity.
    # This only builds KiCad's in-memory cache; no design is saved.
    board.BuildConnectivity()
    cache = {}
    result = []
    for netname, sense_ref, sense_pin, shunt_ref, shunt_pin in checks:
        if netname not in cache:
            cache[netname] = copper_for_net(board, netname)
        copper, plated, pads = cache[netname]
        sense = (sense_ref, sense_pin)
        shunt = (shunt_ref, shunt_pin)
        before = connected_components(copper, plated)
        reaches_shunt = bool(before(pads[sense]) & before(pads[shunt]))
        after = connected_components(copper, plated, pads[shunt])
        sense_components = after(pads[sense])
        allowed = {shunt} | {(u, p) for nn, u, p, _, _ in checks if nn == netname}
        touched = [".".join(identity) for identity, shapes in pads.items()
                   if identity not in allowed and sense_components & after(shapes)]
        result.append({
            "net": netname, "sense": ".".join(sense), "shunt": ".".join(shunt),
            "reaches_shunt": reaches_shunt, "load_pads": sorted(touched),
            "good": reaches_shunt and bool(sense_components) and not touched,
        })
    return result


def self_test():
    # A simplified copper union can have an exactly horizontal edge while the
    # subtracted rotated-pad polygon differs by one integer nanometre. Test
    # that boundary case directly, independent of Boolean-union ordering.
    def polygon(points):
        result = pcb.SHAPE_POLY_SET()
        result.NewOutline()
        for x, y in points:
            result.Append(pcb.FromMM(x), pcb.FromMM(y))
        return result

    copper = polygon([(-2, -.5), (2, -.5), (2, .5), (-2, .5)])
    shunt = polygon([(-.5, -.5 + .000001), (.5, -.5), (.5, .5), (-.5, .5)])
    left = polygon([(-2, -.5), (-1, -.5), (-1, .5), (-2, .5)])
    right = polygon([(1, -.5), (2, -.5), (2, .5), (1, .5)])
    contacts = connected_components({pcb.F_Cu: copper}, [], [(pcb.F_Cu, shunt)])
    assert not contacts([(pcb.F_Cu, left)]) & contacts([(pcb.F_Cu, right)]), "one-nanometre subtraction rim created a false bypass"
    print("PASS one_nanometre_boolean_rim")

    def fixture(mode):
        board = pcb.BOARD()
        if mode in ("clean_four_layer", "inner_layer_annulus"):
            board.SetCopperLayerCount(4)
        net = pcb.NETINFO_ITEM(board, "SENSE", 1)
        board.Add(net)

        def pad(ref, number, x, y, size):
            footprint = pcb.FOOTPRINT(board)
            footprint.SetReference(ref)
            board.Add(footprint)
            item = pcb.PAD(footprint)
            item.SetNumber(number)
            item.SetAttribute(pcb.PAD_ATTRIB_SMD)
            item.SetShape(pcb.PAD_SHAPE_RECT)
            item.SetSize(pcb.VECTOR2I(pcb.FromMM(size), pcb.FromMM(size)))
            item.SetPosition(pcb.VECTOR2I(pcb.FromMM(x), pcb.FromMM(y)))
            layers = pcb.LSET()
            layers.AddLayer(pcb.F_Cu)
            item.SetLayerSet(layers)
            item.SetNet(net)
            footprint.Add(item)

        def line(a, z, layer=pcb.F_Cu, width=0.2):
            track = pcb.PCB_TRACK(board)
            track.SetStart(pcb.VECTOR2I(pcb.FromMM(a[0]), pcb.FromMM(a[1])))
            track.SetEnd(pcb.VECTOR2I(pcb.FromMM(z[0]), pcb.FromMM(z[1])))
            track.SetLayer(layer)
            track.SetWidth(pcb.FromMM(width))
            track.SetNet(net)
            board.Add(track)

        def via(x, y):
            item = pcb.PCB_VIA(board)
            item.SetPosition(pcb.VECTOR2I(pcb.FromMM(x), pcb.FromMM(y)))
            item.SetWidth(pcb.F_Cu, pcb.FromMM(0.6))
            item.SetDrill(pcb.FromMM(0.3))
            item.SetViaType(pcb.VIATYPE_THROUGH)
            item.SetLayerPair(pcb.F_Cu, pcb.B_Cu)
            if mode == "inner_layer_annulus":
                item.SetRemoveUnconnected(True)
            item.SetNet(net)
            board.Add(item)

        if mode in ("quantized_roundrect", "quantized_roundrect_with_bypass"):
            # Regression for the actual hat shunt geometry: the two routes
            # enter different places on the same edge. Unexpanded subtraction
            # retained a 1 nm line along y=80.400000..80.400001 and falsely
            # connected the sense route to the main via.
            pad("U4", "10", 122.1, 79.5, 0.3)
            pad("R5", "1", 124.75, 80.9125, 1.0)
            shunt = next(iter(board.FindFootprintByReference("R5").Pads()))
            shunt.SetShape(pcb.PAD_SHAPE_ROUNDRECT)
            shunt.SetSize(pcb.VECTOR2I(pcb.FromMM(1.025), pcb.FromMM(1.4)))
            shunt.SetRoundRectRadiusRatio(.243902)
            shunt.SetOrientationDegrees(270)
            pad("LOAD", "1", 127.0, 79.875, 0.3)
            for a, z in [((122.1, 79.5), (123.375, 79.5)),
                         ((123.375, 79.5), (123.375, 80.0)),
                         ((123.375, 80.0), (123.5, 80.125)),
                         ((123.5, 80.125), (123.75, 80.125)),
                         ((123.75, 80.125), (124.0, 80.375)),
                         ((124.0, 80.375), (124.25, 80.375)),
                         ((124.25, 80.375), (124.75, 80.875)),
                         ((124.75, 80.875), (124.75, 80.9125))]:
                line(a, z)
            for a, z in [((124.75, 80.875), (125.125, 80.5)),
                         ((125.125, 80.5), (125.125, 80.125)),
                         ((125.125, 80.125), (127.0, 79.875))]:
                line(a, z, width=.25)
            via(125.125, 80.125)
            if mode.endswith("with_bypass"):
                line((124.25, 80.375), (125.125, 80.125), width=.2)
            return check_kelvin(board, [("SENSE", "U4", "10", "R5", "1")])[0]

        pad("U4", "10", -3, 0, 0.3)
        pad("R5", "1", 0, 0, 1.0)
        pad("LOAD", "1", 3, 0, 0.3)
        if mode != "disconnected":
            line((-3, 0), (0, 0))
        line((0, 0), (3, 0))
        if mode in ("cross", "opposite_layer_cross"):
            layer = pcb.F_Cu if mode == "cross" else pcb.B_Cu
            for a, z in [((0, 0), (0, 2)), ((0, 2), (-2, 2)),
                         ((-2, 2), (-2, -2)), ((-2, -2), (3, -2)),
                         ((3, -2), (3, 0))]:
                line(a, z, layer)
        if mode in ("annulus", "inner_layer_annulus"):
            line((1, 0), (1, 1))
            via(1, 1)
            via_y = 0 if mode == "inner_layer_annulus" else 0.35
            line((1, 1), (-2, via_y), pcb.In2_Cu if mode == "inner_layer_annulus" else pcb.B_Cu)
            via(-2, via_y)
        if mode == "parallel_width_overlap":
            line((1, 0), (1, 0.3))
            line((1, 0.3), (-2, 0.3), width=0.5)
        return check_kelvin(board, [("SENSE", "U4", "10", "R5", "1")])[0]

    for mode, expected in [("clean", True), ("cross", False),
                           ("opposite_layer_cross", True), ("annulus", False),
                           ("parallel_width_overlap", False), ("disconnected", False),
                           ("clean_four_layer", True), ("inner_layer_annulus", False),
                           ("quantized_roundrect", True), ("quantized_roundrect_with_bypass", False)]:
        result = fixture(mode)
        assert result["good"] == expected, (mode, result)
        if mode in ("cross", "annulus", "parallel_width_overlap", "inner_layer_annulus", "quantized_roundrect_with_bypass"):
            assert result["load_pads"] == ["LOAD.1"], (mode, result)
        print(f"PASS {mode}")
    print("Eleven physical-copper Kelvin regression fixtures passed.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("board", nargs="?")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    if not args.board:
        parser.error("a routed board path or --self-test is required")
    results = check_kelvin(pcb.LoadBoard(args.board))
    for result in results:
        print(f"{result['sense']} -> {result['shunt']} on {result['net']}: "
              f"{'KELVIN OK' if result['good'] else 'NOT KELVIN'} "
              f"(reaches shunt pad: {result['reaches_shunt']}; "
              f"load pads on the sense copper: {result['load_pads'] or 'none'})")
    return 0 if all(result["good"] for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
