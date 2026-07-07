"""
gen_traffic_base.py
═══════════════════════════════════════════════════════════════════════════════
Generates backend/data/traffic_base.json — a 20-minute (1200 s) realistic
synthetic trajectory database that matches the video's timeline.

Design principles
─────────────────
• Each vehicle belongs to one *stream* (one counting-line direction).
• Streams correspond to A/B/C/D but use GENERIC default positions.
  When called from main.py with user-drawn lines, the positions are replaced.
• Vehicles follow the normal to their counting line (perpendicular travel).
• Poisson arrival with realistic peak/off-peak variation across 20 min.
• Speed, vehicle class, lateral wobble are randomised per vehicle.
• Output schema identical to previous version — main.py is unchanged.

JSON schema
───────────
{
  "meta": { ... },
  "frames": [
    { "t": 0.0,   "tracks": [ {"track_id":1,"class":"car","x":0.12,"y":0.55} ] },
    { "t": 0.042, "tracks": [ … ] },
    …
  ]
}

Usage
─────
  python gen_traffic_base.py          # write backend/data/traffic_base.json
  python gen_traffic_base.py --quick  # 60 s demo for fast testing
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Optional


# ── PCU weights (must mirror spatial_engine.py) ───────────────────────────────
PCU_WEIGHTS = {"motorcycle": 0.5, "car": 1.0, "bus": 2.5, "truck": 2.5}

# ── Vehicle class mix ─────────────────────────────────────────────────────────
CLASS_MIX = [("car", 0.58), ("motorcycle", 0.22), ("bus", 0.11), ("truck", 0.09)]
CLASSES, CLASS_WEIGHTS = zip(*CLASS_MIX)

# Speed range in normalised units / second  (1.0 = full frame width per second)
SPEED_RANGE = {
    "car":        (0.22, 0.36),
    "motorcycle": (0.26, 0.44),
    "bus":        (0.14, 0.22),
    "truck":      (0.12, 0.20),
}

# Minimum time gap between consecutive vehicles on the same stream (seconds)
MIN_HEADWAY = 1.5


# ─────────────────────────────────────────────────────────────────────────────
# Geometry helpers
# ─────────────────────────────────────────────────────────────────────────────

def _midpoint(p1, p2):
    return ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)

def _unit_normal(p1, p2):
    """Unit vector 90° CCW from p1→p2."""
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy) or 1e-9
    return (-dy / L, dx / L)

def _unit_along(p1, p2):
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy) or 1e-9
    return (dx / L, dy / L)


# ─────────────────────────────────────────────────────────────────────────────
# Time-varying arrival rate  (vehicles / minute)
# ─────────────────────────────────────────────────────────────────────────────

def _rate_at(t_sec: float, base_veh_per_min: float) -> float:
    """
    Sinusoidal day-pattern over the 20-minute clip:
    • 0–4 min  : ramp-up  (morning build-up)
    • 4–10 min : peak     (~1.4× base)
    • 10–16 min: moderate (~1.0× base)
    • 16–20 min: decline  (0.7× base)
    """
    t_min = t_sec / 60.0
    if t_min < 4:
        factor = 0.6 + 0.2 * (t_min / 4)
    elif t_min < 10:
        factor = 0.8 + 0.6 * math.sin(math.pi * (t_min - 4) / 6)
    elif t_min < 16:
        factor = 1.0
    else:
        factor = 1.0 - 0.3 * ((t_min - 16) / 4)
    return max(0.3, base_veh_per_min * factor)


def _poisson_arrivals(base_veh_per_min: float, duration: float,
                      rng: random.Random) -> list[float]:
    """
    Non-homogeneous Poisson process — thinning method.
    Returns a list of spawn timestamps in [0, duration).
    """
    max_rate = base_veh_per_min * 1.5 / 60.0   # vehicles/second (upper bound)
    times = []
    t = 0.0
    while t < duration:
        # draw inter-arrival from homogeneous Poisson with rate = max_rate
        u = rng.random()
        if u == 0:
            u = 1e-12
        gap = -math.log(u) / max_rate
        t += gap
        if t >= duration:
            break
        # thin: accept with probability rate(t) / max_rate
        actual_rate = _rate_at(t, base_veh_per_min) / 60.0
        if rng.random() < actual_rate / max_rate:
            # enforce minimum headway
            if not times or (t - times[-1]) >= MIN_HEADWAY:
                times.append(round(t, 3))
    return times


# ─────────────────────────────────────────────────────────────────────────────
# Stream  (one per counting line)
# ─────────────────────────────────────────────────────────────────────────────

class Stream:
    """
    Vehicles in this stream travel perpendicular to their counting line,
    entering off-screen on one side and exiting on the other.
    """

    MARGIN = 1.6   # how far off-screen the spawn/despawn point is

    def __init__(self, line_id: str, p1, p2,
                 base_veh_per_min: float, rng: random.Random):
        self.line_id = line_id
        self.p1, self.p2 = p1, p2
        self.mid  = _midpoint(p1, p2)
        self.base = base_veh_per_min

        nx, ny = _unit_normal(p1, p2)
        self.dx, self.dy = nx, ny
        # spawn point: upstream of mid by MARGIN in the travel direction
        self.x0 = self.mid[0] - nx * self.MARGIN
        self.y0 = self.mid[1] - ny * self.MARGIN
        self.rng = rng

    def spawn_vehicles(self, duration: float) -> list[dict]:
        times = _poisson_arrivals(self.base, duration, self.rng)
        ldx, ldy = _unit_along(self.p1, self.p2)
        vehicles = []
        for i, spawn_t in enumerate(times):
            cls   = self.rng.choices(CLASSES, weights=CLASS_WEIGHTS)[0]
            lo, hi = SPEED_RANGE[cls]
            speed = self.rng.uniform(lo, hi)
            # small lateral offset so vehicles don't all stack on one line
            wobble = self.rng.uniform(-0.04, 0.04)
            vehicles.append({
                "track_id": None,          # assigned later
                "spawn_t":  spawn_t,
                "cls":      cls,
                "speed":    speed,
                "wobble":   wobble,
                "ldx":      ldx,
                "ldy":      ldy,
            })
        return vehicles

    def position_at(self, veh: dict, t: float):
        dt = t - veh["spawn_t"]
        if dt < 0:
            return None
        x = self.x0 + self.dx * veh["speed"] * dt + veh["ldx"] * veh["wobble"]
        y = self.y0 + self.dy * veh["speed"] * dt + veh["ldy"] * veh["wobble"]
        # off-screen check (with margin so partial visibility is included)
        if x < -0.2 or x > 1.2 or y < -0.2 or y > 1.2:
            return None
        return (round(x, 4), round(y, 4))


# ─────────────────────────────────────────────────────────────────────────────
# Default line positions  (used when running standalone)
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_LINES = {
    "A": [[0.0, 0.40], [1.0, 0.40]],   # horizontal, upper
    "B": [[1.0, 0.60], [0.0, 0.60]],   # horizontal, lower (reverse)
    "C": [[0.30, 0.0], [0.30, 1.0]],   # vertical, left
    "D": [[0.70, 1.0], [0.70, 0.0]],   # vertical, right (reverse)
}

# Base arrival rates (vehicles / minute) per stream
DEFAULT_RATES = {"A": 14, "B": 12, "C": 10, "D": 9}


# ─────────────────────────────────────────────────────────────────────────────
# Core generator
# ─────────────────────────────────────────────────────────────────────────────

def generate_frames(
    lines: dict,                        # { "A": [[x1,y1],[x2,y2]], … }
    duration_s: float = 1200.0,         # full video duration
    fps: float = 23.75,                 # match the real video
    seed: int = 42,
    veh_rates: Optional[dict] = None,
) -> tuple[list[dict], dict]:
    """
    Generate frame-by-frame trajectory data for the given counting lines.
    Returns (frames_list, meta_dict).
    """
    rng = random.Random(seed)
    if veh_rates is None:
        veh_rates = DEFAULT_RATES

    frame_step = 1.0 / fps

    # Build streams
    all_vehicles: list[tuple[Stream, list[dict]]] = []
    for lid, pts in lines.items():
        p1 = tuple(pts[0])
        p2 = tuple(pts[1])
        s    = Stream(lid, p1, p2, veh_rates.get(lid, 10), rng)
        vehs = s.spawn_vehicles(duration_s)
        all_vehicles.append((s, vehs))

    # Assign unique track IDs globally
    tid = 1
    flat: list[tuple[Stream, dict]] = []
    for s, vehs in all_vehicles:
        for v in vehs:
            v["track_id"] = tid
            tid += 1
            flat.append((s, v))

    total_vehicles = len(flat)
    print(f"  [gen] {total_vehicles} vehicles across {len(lines)} streams")

    # Build frame list
    frames = []
    t = 0.0
    while t <= duration_s + 1e-6:
        tracks = []
        for (s, v) in flat:
            pos = s.position_at(v, t)
            if pos is not None:
                tracks.append({
                    "track_id": v["track_id"],
                    "class":    v["cls"],
                    "x":        pos[0],
                    "y":        pos[1],
                })
        frames.append({"t": round(t, 3), "tracks": tracks})
        t = round(t + frame_step, 5)

    meta = {
        "description":    "20-minute realistic synthetic trajectories (non-homogeneous Poisson)",
        "fps":            fps,
        "duration_s":     duration_s,
        "total_frames":   len(frames),
        "vehicle_count":  total_vehicles,
        "streams":        list(lines.keys()),
        "coord_system":   "normalised 0.0–1.0 (x right, y down)",
        "pcu_weights":    dict(PCU_WEIGHTS),
    }
    return frames, meta


def generate_from_config(
    roi: list,
    lines: dict,
    duration_s: float = 1200.0,
    fps: float = 23.75,
    out_path: Optional[Path] = None,
) -> list[dict]:
    """
    Called by main.py after the user submits their config.
    Regenerates trajectory database with trajectories aligned to the user's lines.
    Returns the frames list (also writes to out_path if provided).
    """
    print(f"  [gen] Generating {duration_s:.0f}s trajectories for lines: {list(lines.keys())}")
    frames, meta = generate_frames(lines, duration_s=duration_s, fps=fps)

    if out_path is not None:
        output = {"meta": meta, "frames": frames}
        with open(out_path, "w") as f:
            json.dump(output, f, separators=(",", ":"))
        size_kb = out_path.stat().st_size / 1024
        print(f"  [gen] Wrote {len(frames)} frames → {out_path} ({size_kb:.0f} KB)")

    return frames


# ─────────────────────────────────────────────────────────────────────────────
# Standalone entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate traffic_base.json")
    parser.add_argument("--quick", action="store_true",
                        help="Generate 60s demo instead of full 20min")
    parser.add_argument("--fps",   type=float, default=23.75)
    args = parser.parse_args()

    duration = 60.0 if args.quick else 1200.0
    fps      = args.fps

    print(f"Generating {duration:.0f}s @ {fps} fps …")
    frames, meta = generate_frames(DEFAULT_LINES, duration_s=duration, fps=fps)

    out = Path(__file__).parent / "traffic_base.json"
    with open(out, "w") as f:
        json.dump({"meta": meta, "frames": frames}, f, separators=(",", ":"))

    size_kb = out.stat().st_size / 1024
    print(f"Done: {meta['vehicle_count']} vehicles | "
          f"{meta['total_frames']} frames | "
          f"{out} ({size_kb:.0f} KB)")
