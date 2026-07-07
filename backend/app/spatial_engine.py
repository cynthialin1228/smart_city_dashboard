"""
spatial_engine.py
═══════════════════════════════════════════════════════════════════════════════
Geometry engine for traffic counting.

Core logic
──────────
Given a user-drawn counting line  L = (P1, P2)  and a vehicle trajectory
(a sequence of normalised (x, y) positions over time), determine:

  1. Whether the vehicle's movement segment prev→cur  crosses  L
  2. Which direction it crossed  (+1 or -1)
  3. Whether the vehicle's current position is inside the ROI polygon

All coordinates are **normalised** (0.0 – 1.0) so the engine is completely
decoupled from any specific video resolution.

Public API
──────────
  segment_intersect(p1, p2, q1, q2)  → bool
  cross_direction(line, prev, cur)    → int  (+1 or -1)
  point_in_polygon(pt, polygon)       → bool
  point_in_roi(pt, roi_points)        → bool
  check_crossings(prev, cur, lines)   → dict[line_id → direction]
  process_frame(timestamp, tracks, lines, roi) → FrameResult
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

# ── type aliases ─────────────────────────────────────────────────────────────
Point  = tuple[float, float]       # (x, y) normalised 0–1
Segment = tuple[Point, Point]      # (start, end)
Polygon = list[Point]


# ─────────────────────────────────────────────────────────────────────────────
# Low-level geometry primitives
# ─────────────────────────────────────────────────────────────────────────────

def _cross(o: Point, a: Point, b: Point) -> float:
    """2-D cross product of vectors OA and OB (signed area × 2)."""
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def segment_intersect(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    """
    True iff segment p1→p2 properly intersects segment q1→q2.

    Uses the classic CCW (counter-clockwise) test:
      Two segments intersect iff the endpoints of each segment lie on
      opposite sides of the other segment's supporting line.

    Collinear / endpoint-touching cases are treated as non-intersecting
    to avoid double-counting when a vehicle pauses exactly on a line.
    """
    d1 = _cross(q1, q2, p1)
    d2 = _cross(q1, q2, p2)
    d3 = _cross(p1, p2, q1)
    d4 = _cross(p1, p2, q2)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True

    # Collinear cases — skip (avoid double-count)
    return False


def cross_direction(line: Segment, prev: Point, cur: Point) -> int:
    """
    Determine the crossing direction of movement prev→cur across `line`.

    Returns
    ───────
    +1  if the vehicle crossed left-to-right  (positive side)
    -1  if the vehicle crossed right-to-left  (negative side)

    The sign is the z-component of  (line_vec) × (motion_vec):

        line_vec  = q2 − q1
        motion_vec = cur − prev
        sign = line_vec.x * motion_vec.y − line_vec.y * motion_vec.x
    """
    (q1, q2) = line
    lx = q2[0] - q1[0]
    ly = q2[1] - q1[1]
    mx = cur[0] - prev[0]
    my = cur[1] - prev[1]
    return 1 if (lx * my - ly * mx) > 0 else -1


def point_in_polygon(pt: Point, polygon: Polygon) -> bool:
    """
    Ray-casting algorithm: returns True if `pt` is inside `polygon`.

    The polygon is assumed to be a simple (non-self-intersecting) closed
    polygon defined by an ordered list of vertices.  The closing edge
    (last → first vertex) is implicit.
    """
    x, y = pt
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and \
           (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def point_in_roi(pt: Point, roi_points: Polygon) -> bool:
    """Convenience wrapper — alias for point_in_polygon."""
    if not roi_points or len(roi_points) < 3:
        return True   # no ROI defined → treat everything as inside
    return point_in_polygon(pt, roi_points)


# ─────────────────────────────────────────────────────────────────────────────
# Per-frame crossing detection
# ─────────────────────────────────────────────────────────────────────────────

def check_crossings(
    prev: Point,
    cur:  Point,
    lines: dict[str, Segment],
) -> dict[str, int]:
    """
    Check all counting lines for a single vehicle movement step.

    Parameters
    ──────────
    prev    : previous position (normalised)
    cur     : current  position (normalised)
    lines   : { line_id: ((x1,y1),(x2,y2)) }

    Returns
    ───────
    { line_id: direction }  for every line that was crossed in this step.
    Empty dict if no crossings.
    """
    crossings: dict[str, int] = {}
    for line_id, seg in lines.items():
        if segment_intersect(prev, cur, seg[0], seg[1]):
            crossings[line_id] = cross_direction(seg, prev, cur)
    return crossings


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────

PCU_WEIGHTS: dict[str, float] = {
    "motorcycle": 0.5,
    "car":        1.0,
    "bus":        2.5,
    "truck":      2.5,
}


@dataclass
class CrossingEvent:
    """Emitted each time a vehicle crosses a counting line."""
    timestamp:  float   # video seconds
    track_id:   int
    vehicle_cls: str
    line_id:    str
    direction:  int     # +1 or -1
    pcu:        float   # PCU contribution

    def to_dict(self) -> dict:
        return {
            "t":          round(self.timestamp, 3),
            "track_id":   self.track_id,
            "class":      self.vehicle_cls,
            "line":       self.line_id,
            "direction":  self.direction,
            "pcu":        self.pcu,
        }


@dataclass
class FrameResult:
    """Aggregated output for a single video timestamp."""
    timestamp:  float
    events:     list[CrossingEvent]            = field(default_factory=list)
    # live positions of vehicles in this frame (for particle renderer)
    positions:  list[dict]                     = field(default_factory=list)
    # running totals per line per direction
    line_counts: dict[str, dict[str, int]]     = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "t":           round(self.timestamp, 3),
            "events":      [e.to_dict() for e in self.events],
            "positions":   self.positions,
            "line_counts": self.line_counts,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Main per-frame processor
# ─────────────────────────────────────────────────────────────────────────────

class SpatialEngine:
    """
    Stateful engine that replays pre-computed trajectories frame-by-frame.

    Usage
    ─────
    engine = SpatialEngine(roi, lines)
    for frame in trajectory_frames:
        result = engine.process_frame(frame["t"], frame["tracks"])
        send_to_websocket(result.to_dict())
    """

    def __init__(
        self,
        roi:   Polygon,
        lines: dict[str, Segment],
    ) -> None:
        self.roi   = roi
        self.lines = lines

        # per-track state: last known position  { track_id → Point }
        self._last_pos:  dict[int, Point] = {}
        # per-track: which lines have already been counted (avoids re-count)
        self._counted:   set[tuple[int, str]] = set()
        # running cumulative crossing counts  { line_id → { "+1"|"-1" → int } }
        self.line_counts: dict[str, dict[str, int]] = {
            lid: {"+1": 0, "-1": 0} for lid in lines
        }

    def reset(self) -> None:
        """Clear state (call when user resets the config)."""
        self._last_pos.clear()
        self._counted.clear()
        for lid in self.line_counts:
            self.line_counts[lid] = {"+1": 0, "-1": 0}

    def process_frame(
        self,
        timestamp: float,
        tracks: list[dict],
    ) -> FrameResult:
        """
        Process one frame's worth of track positions.

        Each track dict must have:
            track_id  : int
            class     : str   ("car" | "motorcycle" | "bus" | "truck")
            x         : float  (normalised centre-x)
            y         : float  (normalised centre-y)

        Returns a FrameResult with any crossing events + live positions.
        """
        result = FrameResult(timestamp=timestamp)

        for trk in tracks:
            tid  = int(trk["track_id"])
            cls  = trk.get("class", "car")
            cur  = (float(trk["x"]), float(trk["y"]))

            # ROI filter — skip vehicles outside the user-drawn mask
            if not point_in_roi(cur, self.roi):
                continue

            # Emit position for particle renderer
            result.positions.append({
                "track_id": tid,
                "class":    cls,
                "x":        round(cur[0], 4),
                "y":        round(cur[1], 4),
            })

            prev = self._last_pos.get(tid)
            if prev is not None:
                crossings = check_crossings(prev, cur, self.lines)
                for line_id, direction in crossings.items():
                    key = (tid, line_id)
                    if key not in self._counted:
                        self._counted.add(key)
                        pcu = PCU_WEIGHTS.get(cls, 1.0)
                        event = CrossingEvent(
                            timestamp=timestamp,
                            track_id=tid,
                            vehicle_cls=cls,
                            line_id=line_id,
                            direction=direction,
                            pcu=pcu,
                        )
                        result.events.append(event)
                        dir_key = f"{direction:+d}"
                        self.line_counts[line_id][dir_key] = \
                            self.line_counts[line_id].get(dir_key, 0) + 1

            self._last_pos[tid] = cur

        # snapshot of cumulative counts
        result.line_counts = {
            lid: dict(counts)
            for lid, counts in self.line_counts.items()
        }
        return result
