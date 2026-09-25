"""Simplify two audited, redundant front-copper contacts in the compact board.

Run with KiCad's Python. ``finalize_copper(board)`` changes only matching 0.2 mm
track patterns in memory; it does not move pads/vias, refill zones, or save files.
The caller must refill and run DRC, physical Kelvin, and solder-via checks before
release. These local repairs replace detours with full-width connections where
the original via/trace also grazed its own pad with a narrower redundant contact.

Coordinates are absolute KiCad millimetres. A different route with neither
pattern is left alone. Partial or unexpected matches raise before either repair
is applied. Repeating the function on a repaired board makes no changes.
"""
from __future__ import annotations

import pcbnew as pcb


REPAIRS = (
    {
        "reference": "R24", "pin": "1", "net": "VREF",
        "pad": (130.175, 78.25), "via": (130.875, 78.0),
        "old": (
            ((130.175, 78.25), (130.125, 78.25)),
            ((130.125, 78.25), (130.375, 78.5)),
            ((130.375, 78.5), (130.5, 78.5)),
            ((130.5, 78.5), (130.875, 78.125)),
            ((130.875, 78.125), (130.875, 78.0)),
        ),
        "new": (
            ((130.175, 78.25), (130.175, 78.0)),
            ((130.175, 78.0), (130.875, 78.0)),
        ),
    },
    {
        "reference": "U4", "pin": "6", "net": "+5V",
        "pad": (135.1, 86.5), "via": (136.0, 86.875),
        "old": (
            ((135.1, 86.5), (136.25, 86.5)),
            ((136.25, 86.5), (136.0, 86.75)),
            ((136.0, 86.75), (136.0, 86.875)),
        ),
        "new": (
            ((135.1, 86.5), (135.625, 86.5)),
            ((135.625, 86.5), (136.0, 86.875)),
        ),
    },
)


def _point(xy):
    return tuple(pcb.FromMM(value) for value in xy)


def _key(a, b):
    return tuple(sorted((tuple(a), tuple(b))))


def finalize_copper(board):
    """Return per-pad status and track counts; modify only fully matched repairs.

    Status is ``applied``, ``already_finalized``, or ``not_applicable``. The latter
    is not a DRC exemption: other routing results still need independent checks.
    All matching geometry is validated before the first mutation.
    """
    tracks = list(board.GetTracks())
    by_endpoints = {}
    for track in tracks:
        if track.GetClass() == "PCB_TRACK" and track.GetLayer() == pcb.F_Cu:
            by_endpoints.setdefault(_key(track.GetStart(), track.GetEnd()), []).append(track)

    plans, report = [], []
    for repair in REPAIRS:
        name = f"{repair['reference']}.{repair['pin']}"
        old = [by_endpoints.get(_key(_point(a), _point(b)), []) for a, b in repair["old"]]
        new = [by_endpoints.get(_key(_point(a), _point(b)), []) for a, b in repair["new"]]
        if not any(old) and not any(new):
            report.append({"pad": name, "status": "not_applicable"})
            continue
        if any(old):
            if not all(len(items) == 1 for items in old) or any(new):
                raise ValueError(f"{name}: incomplete or ambiguous original copper pattern")
            matched, status = [items[0] for items in old], "applied"
        else:
            if not all(len(items) == 1 for items in new):
                raise ValueError(f"{name}: incomplete or ambiguous finalized copper pattern")
            matched, status = [items[0] for items in new], "already_finalized"
        if any(track.GetNetname() != repair["net"] or track.GetWidth() != pcb.FromMM(0.2)
               for track in matched):
            raise ValueError(f"{name}: expected {repair['net']} tracks of width 0.2 mm")
        pads = [pad for fp in board.GetFootprints() if fp.GetReference() == repair["reference"]
                for pad in fp.Pads() if pad.GetNumber() == repair["pin"]]
        if (len(pads) != 1 or tuple(pads[0].GetPosition()) != _point(repair["pad"])
                or pads[0].GetNetname() != repair["net"] or not pads[0].IsOnLayer(pcb.F_Cu)):
            raise ValueError(f"{name}: pad position, layer, or net differs from audited geometry")
        vias = [track for track in tracks if track.GetClass() == "PCB_VIA"
                and tuple(track.GetPosition()) == _point(repair["via"])]
        if (len(vias) != 1 or vias[0].GetNetname() != repair["net"]
                or vias[0].GetWidth(pcb.F_Cu) != pcb.FromMM(0.6)
                or vias[0].GetDrillValue() != pcb.FromMM(0.35)
                or not vias[0].IsOnLayer(pcb.F_Cu)):
            raise ValueError(f"{name}: via geometry or net differs from audited geometry")
        report.append({"pad": name, "status": status})
        if status == "applied":
            plans.append((repair, matched, pads[0].GetNetCode()))

    removed_count = 0
    added_count = 0
    for repair, matched, netcode in plans:
        for track in matched:
            # KiCad's Delete removes the item without transferring C++ ownership
            # to its Python wrapper (Remove has a SWIG lifetime issue in 10.0.6).
            board.Delete(track)
            removed_count += 1
        for a, b in repair["new"]:
            track = pcb.PCB_TRACK(board)
            track.SetStart(pcb.VECTOR2I(*_point(a)))
            track.SetEnd(pcb.VECTOR2I(*_point(b)))
            track.SetLayer(pcb.F_Cu)
            track.SetWidth(pcb.FromMM(0.2))
            track.SetNetCode(netcode)
            board.Add(track)
            added_count += 1
    if plans:
        board.BuildConnectivity()
    return {"repairs": report, "removed_tracks": removed_count, "added_tracks": added_count}
