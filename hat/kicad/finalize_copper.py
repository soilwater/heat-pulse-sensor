"""Copper-finalization hook for the compact hat.

The 1.4 mm heater prong carries two 0.10 mm thermistor lanes 0.43 mm either side of
the 0.3 mm HEAT_RTN trace. Where the router joins those lanes at the prong root it can
leave short, redundant 0.2 mm stubs that sit 0.125 mm from HEAT_RTN. Remove any bottom
copper stub on a lane net that violates clearance to HEAT_RTN, then drop the dangling
pieces that leaves behind. The caller's DRC reports unconnected pads, so a stub that was
actually needed fails the release instead of passing silently.
"""
import pcbnew

LANE_NETS = {"A1_TH2", "TH_RTN"}
CLEARANCE = pcbnew.FromMM(0.127)


def _tracks(board, names):
    return [t for t in board.GetTracks() if t.GetClass() == "PCB_TRACK" and t.GetLayer() == pcbnew.B_Cu and t.GetNetname() in names]


def _dangling(board, t):
    """True if either end of t touches no pad, via or other same-net copper."""
    xy = lambda p: (p.x, p.y)
    uid = t.m_Uuid.AsString()      # SWIG wrappers are never identical objects: compare UUIDs and coordinates
    for end in (t.GetStart(), t.GetEnd()):
        touched = False
        for o in board.GetTracks():
            if o.m_Uuid.AsString() == uid or o.GetNetCode() != t.GetNetCode(): continue
            if o.GetClass() == "PCB_VIA" and o.HitTest(end): touched = True; break
            if o.GetClass() == "PCB_TRACK" and o.IsOnLayer(t.GetLayer()) and xy(end) in (xy(o.GetStart()), xy(o.GetEnd())): touched = True; break
        if not touched:
            for pad in board.GetPads():
                if pad.GetNetCode() == t.GetNetCode() and pad.IsOnLayer(t.GetLayer()) and pad.HitTest(end): touched = True; break
        if not touched: return True
    return False


def finalize_copper(board):
    removed = 0   # board.Delete, not Remove: Remove has a SWIG lifetime issue in KiCad 10.0.6
    returns = _tracks(board, {"HEAT_RTN"})
    for t in _tracks(board, LANE_NETS):
        shape = t.GetEffectiveShape(pcbnew.B_Cu)
        if not any(shape.Collide(r.GetEffectiveShape(pcbnew.B_Cu), CLEARANCE - 1) for r in returns): continue
        board.Delete(t); removed += 1
    changed = True
    while changed and removed:
        changed = False
        for t in _tracks(board, LANE_NETS):
            if _dangling(board, t):
                board.Delete(t); removed += 1; changed = True
    board.BuildConnectivity()
    return {"repairs": ["heater-prong lane stubs"] if removed else [], "removed_tracks": removed, "added_tracks": 0}
