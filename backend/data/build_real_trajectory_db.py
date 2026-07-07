"""
build_real_trajectory_db.py
═══════════════════════════════════════════════════════════════════════════════
Converts archive/try_pipeline/tracking_raw.json (real YOLO+ByteTrack output)
into backend/data/traffic_base.json — the frame-level trajectory database
consumed by main.py / SpatialEngine.

Why this step is needed
───────────────────────
tracking_raw.json records REAL vehicle counts per minute per line (from
YOLO v8 + ByteTrack running on the actual video).  It does NOT store
per-frame (x, y) positions because ByteTrack was run in counting-only mode.

This script reconstructs geometrically-consistent per-frame trajectories
that are **faithful to the real counts**:

  1. For each minute bucket M and each line L, the real count for each
     vehicle class (car_suv, motorcycle, truck, bus) is read.
  2. That exact number of vehicles is spawned on a realistic entry path
     for line L, spread across minute M with a realistic distribution.
  3. Each vehicle travels at a realistic speed perpendicular to its line,
     producing a natural (x, y) path frame-by-frame.

The result honours the ground-truth counts exactly, and every vehicle
has a plausible trajectory for the particle renderer.

Video geometry (from tracking_raw.json / video_info)
─────────────────────────────────────────────────────
  Resolution : 1280 × 720
  FPS        : 23.75
  Lines (pixel coords → normalised):
    L1  North  : y = 216/720 ≈ 0.300   (horizontal)
    L2  South  : y = 518/720 ≈ 0.719   (horizontal)
    L3  West   : x = 256/1280 ≈ 0.200  (vertical)
    L4  East   : x = 1024/1280 ≈ 0.800 (vertical)

Output
──────
  backend/data/traffic_base.json
  { "meta": {...}, "frames": [ {"t":0.0, "tracks":[...]}, ... ] }

Usage
─────
  cd backend
  python data/build_real_trajectory_db.py
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent.parent.parent
RAW_PATH    = ROOT / "archive" / "try_pipeline" / "tracking_raw.json"
OUT_PATH    = Path(__file__).resolve().parent / "traffic_base.json"

# ── Video constants ───────────────────────────────────────────────────────────
VIDEO_W   = 1280
VIDEO_H   = 720
FPS       = 23.75
FRAME_DT  = 1.0 / FPS

# ── PCU weights (must mirror spatial_engine.py) ───────────────────────────────
PCU_WEIGHTS = {"motorcycle": 0.5, "car": 1.0, "bus": 2.5, "truck": 2.5}

# ── Map tracking_raw class names → spatial_engine class names ─────────────────
CLASS_MAP = {
    "car_suv":    "car",
    "motorcycle": "motorcycle",
    "truck":      "truck",
    "bus":        "bus",
    # pedestrian is excluded (no PCU weight)
}

# ── Real counting-line geometry (normalised) ──────────────────────────────────
# Each entry: (x1, y1, x2, y2, travel_axis, travel_direction)
#   travel_axis:      'y' = vehicles move vertically, 'x' = horizontally
#   travel_direction: +1 = increasing axis value, -1 = decreasing
LINE_DEFS = {
    "L1": {
        "x1": 192/1280,  "y1": 216/720,
        "x2": 960/1280,  "y2": 216/720,
        "axis": "y", "dir": +1,   # traffic crosses going downward (south)
        "lat_min": 192/1280, "lat_max": 960/1280,  # lateral spread along X
    },
    "L2": {
        "x1": 320/1280,  "y1": 518/720,
        "x2": 1152/1280, "y2": 518/720,
        "axis": "y", "dir": -1,   # traffic crosses going upward (north)
        "lat_min": 320/1280, "lat_max": 1152/1280,
    },
    "L3": {
        "x1": 256/1280,  "y1": 144/720,
        "x2": 256/1280,  "y2": 576/720,
        "axis": "x", "dir": +1,   # traffic crosses going rightward (east)
        "lat_min": 144/720,  "lat_max": 576/720,
    },
    "L4": {
        "x1": 1024/1280, "y1": 144/720,
        "x2": 1024/1280, "y2": 576/720,
        "axis": "x", "dir": -1,   # traffic crosses going leftward (west)
        "lat_min": 144/720,  "lat_max": 576/720,
    },
}

# Speed in normalised-units / second, per class
SPEED_RANGE = {
    "car":        (0.22, 0.36),
    "motorcycle": (0.26, 0.44),
    "bus":        (0.14, 0.22),
    "truck":      (0.12, 0.20),
}

# How far off-screen a vehicle spawns before reaching the counting line
SPAWN_MARGIN = 0.18   # normalised units


def _line_pos(ld: dict) -> float:
    """The fixed coordinate of the counting line (x or y value)."""
    if ld["axis"] == "y":
        return ld["y1"]   # horizontal line → fixed y
    return ld["x1"]       # vertical line   → fixed x


def _spawn_pos(ld: dict) -> float:
    """Starting position on the travel axis (upstream of the counting line)."""
    line_val = _line_pos(ld)
    # travel_direction +1 → vehicle comes from below the line value
    # travel_direction -1 → vehicle comes from above the line value
    return line_val - ld["dir"] * SPAWN_MARGIN


def _vehicle_pos_at(ld: dict, spawn_travel: float, lat: float,
                    speed: float, dt: float):
    """
    Return (x, y) at time `dt` seconds after spawn.
    spawn_travel: starting value on the travel axis.
    lat: fixed lateral position.
    """
    travel_val = spawn_travel + ld["dir"] * speed * dt
    if ld["axis"] == "y":
        return lat, travel_val
    return travel_val, lat


def _is_offscreen(x: float, y: float) -> bool:
    return x < -0.15 or x > 1.15 or y < -0.15 or y > 1.15


def generate_from_real_counts(
    minute_counts: dict,
    duration_s: float,
    fps: float,
    seed: int = 0,
) -> tuple[list[dict], dict]:
    """
    Build frame-by-frame trajectory data from real minute-level counts.

    minute_counts: { "0": { "L1": {"car_suv": N, ...}, ... }, "1": {...}, ... }
    Returns (frames_list, meta_dict).
    """
    rng = random.Random(seed)

    # ── Step 1: collect all vehicle spawn events ──────────────────────────────
    # Each event: { line_id, cls, spawn_t, speed, lat, spawn_travel }
    all_vehicles: list[dict] = []
    tid = 1

    for minute_str, line_data in sorted(minute_counts.items(),
                                         key=lambda x: int(x[0])):
        minute = int(minute_str)
        minute_start = minute * 60.0
        minute_end   = (minute + 1) * 60.0

        for line_id, class_counts in line_data.items():
            if line_id not in LINE_DEFS:
                continue
            ld = LINE_DEFS[line_id]

            for raw_cls, count in class_counts.items():
                cls = CLASS_MAP.get(raw_cls)
                if cls is None or count <= 0:
                    continue

                lo, hi = SPEED_RANGE[cls]

                for _ in range(count):
                    # Spread arrivals across the minute with slight clustering
                    base_t = rng.uniform(minute_start, minute_end - 0.5)
                    # jitter by ±1 s for realism
                    spawn_t = max(0.0, base_t + rng.gauss(0, 0.5))

                    speed      = rng.uniform(lo, hi)
                    lat        = rng.uniform(ld["lat_min"], ld["lat_max"])
                    spawn_trav = _spawn_pos(ld)

                    all_vehicles.append({
                        "track_id":    tid,
                        "line_id":     line_id,
                        "cls":         cls,
                        "spawn_t":     spawn_t,
                        "speed":       speed,
                        "lat":         lat,
                        "spawn_trav":  spawn_trav,
                        "ld":          ld,
                    })
                    tid += 1

    print(f"  [build] {len(all_vehicles)} vehicles from real counts")

    # Sort by spawn time for slightly better cache locality
    all_vehicles.sort(key=lambda v: v["spawn_t"])

    # ── Step 2: build frame list ──────────────────────────────────────────────
    total_frames = int(math.ceil(duration_s * fps)) + 1
    frame_step   = 1.0 / fps

    frames: list[dict] = []
    t = 0.0
    for _ in range(total_frames):
        tracks = []
        for veh in all_vehicles:
            dt = t - veh["spawn_t"]
            if dt < 0:
                continue   # not spawned yet
            x, y = _vehicle_pos_at(
                veh["ld"], veh["spawn_trav"], veh["lat"], veh["speed"], dt
            )
            if not _is_offscreen(x, y):
                tracks.append({
                    "track_id": veh["track_id"],
                    "class":    veh["cls"],
                    "x":        round(x, 4),
                    "y":        round(y, 4),
                })
        frames.append({"t": round(t, 3), "tracks": tracks})
        t = round(t + frame_step, 5)
        if t > duration_s + frame_step:
            break

    meta = {
        "description":    "Real YOLO+ByteTrack counts → reconstructed per-frame trajectories",
        "source":         "archive/try_pipeline/tracking_raw.json",
        "fps":            fps,
        "duration_s":     duration_s,
        "total_frames":   len(frames),
        "vehicle_count":  len(all_vehicles),
        "coord_system":   "normalised 0.0–1.0 (x right, y down)",
        "pcu_weights":    dict(PCU_WEIGHTS),
        "lines":          list(LINE_DEFS.keys()),
    }
    return frames, meta


def main():
    if not RAW_PATH.exists():
        raise FileNotFoundError(f"Real trajectory data not found: {RAW_PATH}")

    print(f"Loading real data from {RAW_PATH} …")
    with open(RAW_PATH) as f:
        raw = json.load(f)

    video_info     = raw.get("video_info", {})
    minute_counts  = raw.get("minute_counts", {})
    duration_min   = raw.get("duration_minutes", 20)
    # Last minute (index 20) is zero — use only minutes 0-19
    active_minutes = {k: v for k, v in minute_counts.items()
                      if int(k) < duration_min - 1}

    fps        = float(video_info.get("fps", FPS))
    duration_s = (duration_min - 1) * 60.0   # 19 × 60 = 1140 s of real data

    print(f"  Video: {video_info.get('width')}×{video_info.get('height')} "
          f"@ {fps} fps | {duration_min} min recorded")
    print(f"  Active minutes: {len(active_minutes)} "
          f"({duration_s:.0f}s trajectory database)")

    frames, meta = generate_from_real_counts(
        minute_counts = active_minutes,
        duration_s    = duration_s,
        fps           = fps,
    )

    output = {"meta": meta, "frames": frames}
    with open(OUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"\n✓ Written {len(frames)} frames | "
          f"{meta['vehicle_count']} vehicles | "
          f"{duration_s:.0f}s | "
          f"{OUT_PATH} ({size_mb:.1f} MB)")
    print(f"  Source: {RAW_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
