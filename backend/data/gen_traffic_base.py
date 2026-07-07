"""
gen_traffic_base.py
═══════════════════════════════════════════════════════════════════════════════
Generates backend/data/traffic_base.json

MODE 1 — standalone (no args):
    Generates a default 60-second demo scene.  Vehicles travel in 4 streams
    whose paths are hardcoded to cross the DEFAULT counting lines.

MODE 2 — called from main.py with user config:
    generate_from_config(roi, lines, duration_s, fps)
    Generates trajectories whose paths are guaranteed to cross the
    user-drawn counting lines at their actual normalised positions.
    This is the mode used after the user draws lines in Config Mode.

Both modes produce the same JSON schema:
{
  "meta": { ... },
  "frames": [ {"t": 0.0, "tracks": [ {"track_id":1,"class":"car","x":0.12,"y":0.55} ] }, ... ]
}
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Optional


# ── PCU weights (must match spatial_engine.py) ────────────────────────────────
PCU_WEIGHTS = {"motorcycle": 0.5, "car": 1.0, "bus": 2.5, "truck": 2.5}

# ── vehicle class mix ─────────────────────────────────────────────────────────
CLASS_MIX    = [("car", 0.62), ("motorcycle", 0.20), ("bus", 0.10), ("truck", 0.08)]
CLASSES, CLASS_WEIGHTS = zip(*CLASS_MIX)

SPEED_RANGE  = {"car": (0.28, 0.42), "motorcycle": (0.30, 0.48),
                "bus": (0.18, 0.26), "truck": (0.16, 0.24)}

MIN_HEADWAY  = 1.8
MAX_HEADWAY  = 5.5


# ─────────────────────────────────────────────────────────────────────────────
# Core geometry helpers
# ─────────────────────────────────────────────────────────────────────────────

def _line_midpoint(p1, p2):
    return ((p1[0]+p2[0])/2, (p1[1]+p2[1])/2)

def _line_normal(p1, p2):
    """Unit vector perpendicular to the segment p1→p2 (rotated 90°)."""
    dx, dy = p2[0]-p1[0], p2[1]-p1[1]
    length = math.hypot(dx, dy) or 1e-9
    return (-dy/length, dx/length)   # 90° CCW rotation

def _line_direction(p1, p2):
    """Unit vector along segment p1→p2."""
    dx, dy = p2[0]-p1[0], p2[1]-p1[1]
    length = math.hypot(dx, dy) or 1e-9
    return (dx/length, dy/length)


def _spawn_times(veh_per_min: float, duration: float, rng: random.Random) -> list[float]:
    """Poisson-like spawn schedule with minimum headway."""
    mean_gap = 60.0 / max(veh_per_min, 0.5)
    times, t = [], rng.uniform(0, mean_gap * 0.4)
    while t < duration:
        times.append(t)
        t += rng.uniform(MIN_HEADWAY, max(MIN_HEADWAY + 0.1, mean_gap * 2))
    return times


# ─────────────────────────────────────────────────────────────────────────────
# Stream definition
# ─────────────────────────────────────────────────────────────────────────────

class Stream:
    """
    A traffic stream defined by a counting line it must cross.
    Vehicles spawn off-screen, travel in a straight line through the
    counting-line's midpoint, and exit the opposite side.
    """
    def __init__(self, line_id: str, p1, p2, veh_per_min: float, rng: random.Random):
        self.line_id = line_id
        self.p1      = p1
        self.p2      = p2
        self.mid     = _line_midpoint(p1, p2)
        self.veh_per_min = veh_per_min

        # Travel direction = normal to the counting line
        # (vehicles travel perpendicular to the line they cross)
        nx, ny = _line_normal(p1, p2)

        # Pick the dominant direction (the one going from left/top into the scene)
        # Heuristic: choose the direction that starts from closer to (0,0)
        # Try both directions and pick the one whose start is further off-screen
        # in the "incoming" sense.
        # We always travel from one side of the frame to the other.
        self.dx = nx
        self.dy = ny

        # spawn point: go far enough upstream that vehicle starts off-screen
        # Use 1.5× as margin so it's definitely outside [0,1]
        MARGIN = 1.5
        self.x0 = self.mid[0] - self.dx * MARGIN
        self.y0 = self.mid[1] - self.dy * MARGIN

        self.rng = rng

    def vehicles(self, duration: float) -> list[dict]:
        times = _spawn_times(self.veh_per_min, duration, self.rng)
        vehs  = []
        for spawn_t in times:
            cls  = self.rng.choices(CLASSES, weights=CLASS_WEIGHTS)[0]
            lo, hi = SPEED_RANGE[cls]
            speed = self.rng.uniform(lo, hi)
            # small lateral wobble (along the line direction)
            ldx, ldy = _line_direction(self.p1, self.p2)
            wobble = self.rng.uniform(-0.03, 0.03)
            vehs.append({
                "spawn_t": spawn_t,
                "cls":     cls,
                "speed":   speed,
                "wobble":  wobble,
                "ldx":     ldx, "ldy": ldy,
            })
        return vehs

    def position_at(self, veh: dict, t: float):
        dt = t - veh["spawn_t"]
        if dt < 0: return None
        x = self.x0 + self.dx * veh["speed"] * dt + veh["ldx"] * veh["wobble"]
        y = self.y0 + self.dy * veh["speed"] * dt + veh["ldy"] * veh["wobble"]
        if x < -0.18 or x > 1.18 or y < -0.18 or y > 1.18:
            return None
        return (round(x, 4), round(y, 4))


# ─────────────────────────────────────────────────────────────────────────────
# Main generator
# ─────────────────────────────────────────────────────────────────────────────

def generate_frames(
    lines: dict,          # { "A": [[x1,y1],[x2,y2]], ... }
    duration_s: float = 60.0,
    fps: float = 25.0,
    seed: int = 42,
    veh_rates: Optional[dict] = None,   # override per-line veh/min
) -> tuple[list[dict], dict]:
    """
    Generate frame-by-frame trajectory data guaranteed to cross the given lines.

    Returns (frames_list, meta_dict).
    """
    rng = random.Random(seed)
    if veh_rates is None:
        veh_rates = {"A": 14, "B": 11, "C": 9, "D": 8}

    frame_step = 1.0 / fps

    # Build one stream per counting line
    streams: list[Stream] = []
    all_vehicles: list[tuple[Stream, list[dict]]] = []  # (stream, vehs)

    for lid, pts in lines.items():
        p1 = tuple(pts[0])
        p2 = tuple(pts[1])
        rate = veh_rates.get(lid, 10)
        s    = Stream(lid, p1, p2, rate, rng)
        vehs = s.vehicles(duration_s)
        streams.append(s)
        all_vehicles.append((s, vehs))

    # Assign unique track IDs
    track_id = 1
    flat_vehs = []  # [ (stream, veh_dict_with_id), ... ]
    for s, vehs in all_vehicles:
        for v in vehs:
            v["track_id"] = track_id
            track_id += 1
            flat_vehs.append((s, v))

    # Build frames
    frames = []
    t = 0.0
    while t <= duration_s + 1e-6:
        tracks = []
        for (s, v) in flat_vehs:
            pos = s.position_at(v, t)
            if pos is not None:
                tracks.append({
                    "track_id": v["track_id"],
                    "class":    v["cls"],
                    "x":        pos[0],
                    "y":        pos[1],
                    "stream":   s.line_id,
                })
        frames.append({"t": round(t, 3), "tracks": tracks})
        t = round(t + frame_step, 4)

    meta = {
        "description":  "Generated trajectories aligned to user counting lines",
        "fps":          fps,
        "duration_s":   duration_s,
        "total_frames": len(frames),
        "vehicle_count": len(flat_vehs),
        "streams":      list(lines.keys()),
        "coord_system": "normalised 0.0–1.0 (x right, y down)",
        "pcu_weights":  dict(PCU_WEIGHTS),
    }
    return frames, meta


def generate_from_config(
    roi: list,
    lines: dict,
    duration_s: float = 60.0,
    fps: float = 25.0,
    out_path: Optional[Path] = None,
) -> list[dict]:
    """
    Called by main.py after the user submits their config.
    Regenerates traffic_base.json with trajectories aligned to the user's lines.
    Returns the frames list (also writes to out_path if provided).
    """
    frames, meta = generate_frames(lines, duration_s, fps)

    if out_path is not None:
        output = {"meta": meta, "frames": frames}
        with open(out_path, "w") as f:
            json.dump(output, f, separators=(",", ":"))
        print(f"[gen] Wrote {len(frames)} frames → {out_path}")

    return frames


# ─────────────────────────────────────────────────────────────────────────────
# Standalone: run directly to regenerate the default demo data
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Default lines for demo (horizontal/vertical through the frame centre)
    DEFAULT_LINES = {
        "A": [[0.05, 0.55], [0.45, 0.55]],
        "B": [[0.55, 0.45], [0.95, 0.45]],
        "C": [[0.45, 0.05], [0.45, 0.45]],
        "D": [[0.55, 0.55], [0.55, 0.95]],
    }
    frames, meta = generate_frames(DEFAULT_LINES)
    out = Path(__file__).parent / "traffic_base.json"
    with open(out, "w") as f:
        json.dump({"meta": meta, "frames": frames}, f, separators=(",", ":"))
    size_kb = out.stat().st_size / 1024
    print(f"[standalone] {meta['vehicle_count']} vehicles, "
          f"{meta['total_frames']} frames → {out} ({size_kb:.0f} KB)")
