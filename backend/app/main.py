"""
main.py  –  FastAPI backend · Smart City Digital Twin Traffic Control Room
═══════════════════════════════════════════════════════════════════════════════

Architecture
────────────
  traffic_base.json  →  20-minute trajectory database  (28 k frames @ 23.75 fps)
                         Generated once by gen_traffic_base.py and loaded at
                         startup.  Contains normalised (x,y) ∈ [0,1]² paths.

  POST /api/config   →  User draws lines A/B/C/D in the browser.
                         Backend runs SpatialEngine over ALL 28 k frames,
                         pre-computes every crossing event and caches results.
                         This is the ONLY place generate_from_config is called
                         (if traffic_base.json is missing or stale).

  WS /ws/stream      →  Client sends { "type":"seek", "t": 345.6 }.
                         Backend looks up the nearest pre-computed frame and
                         returns positions + 30-second PCU sliding window +
                         signal recommendations.  No geometry is re-done here.

Data contract  (WebSocket frame → JSON)
───────────────────────────────────────
  {
    "type":           "frame",
    "t":              345.6,           // actual frame time (seconds)
    "positions":      [                // live vehicle positions THIS frame
      { "track_id": 7, "class": "car", "x": 0.52, "y": 0.45 }, …
    ],
    "events":         [                // crossing events THIS frame (flash)
      { "t": 345.6, "track_id": 7, "class": "car",
        "line": "A", "direction": 1, "pcu": 1.0 }, …
    ],
    "line_counts":    { "A": {"+1": 23, "-1": 4}, … },   // cumulative
    "pcu_window":     { "A": 11.5, "B": 12.0, "C": 8.5, "D": 7.0 },
    "total_pcu":      39.0,
    "alerts":         [ { "rule_id":"R1A", "severity":"warning",
                          "message_zh":"…", "delta_s": 6 }, … ],
    "signal_plan":    { "cycle_s": 72.0,
                        "green_splits": { "Straight (A/B)": 34.0,
                                          "Cross (C/D)": 26.0 },
                        "flow_ratio_Y": 0.52, "oversaturated": false },
    "congestion_idx": 0.39,
    "trend":          "stable",
    "pcu_per_min":    78.0
  }

REST endpoints
──────────────
  POST /api/config   → set user lines, run precompute, return summary
  GET  /api/status   → is backend ready?
  GET  /api/summary  → full timeline + totals (for sparklines)
  GET  /api/reset    → clear state

Startup
───────
  cd backend
  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import bisect
import json
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys as _sys
_sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.spatial_engine import SpatialEngine, PCU_WEIGHTS
from app.traffic_rules   import evaluate_rules, RuleResult

# Trajectory generator (used only if traffic_base.json needs rebuilding)
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location(
    "gen_traffic_base",
    Path(__file__).resolve().parent.parent / "data" / "gen_traffic_base.py",
)
_gen_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_gen_mod)
_generate_from_config = _gen_mod.generate_from_config

# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Smart City Traffic API", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

DATA_PATH   = Path(__file__).parent.parent / "data" / "traffic_base.json"
WINDOW_SEC  = 30.0    # PCU sliding window


# ─────────────────────────────────────────────────────────────────────────────
# Global state
# ─────────────────────────────────────────────────────────────────────────────

class _State:
    def __init__(self):
        self.config:         Optional[dict]        = None
        # raw trajectory frames loaded from JSON  [{"t":…,"tracks":[…]}, …]
        self.trajectory_db:  list[dict]            = []
        # pre-computed results keyed by frame timestamp
        self.frames:         dict[float, dict]     = {}
        self._frame_keys:    list[float]           = []
        # per-second sparkline timeline
        self.timeline:       list[dict]            = []
        # video duration from the trajectory database
        self.duration_s:     float                 = 0.0

state = _State()


@app.on_event("startup")
async def _startup():
    """Load trajectory database from disk on startup."""
    if DATA_PATH.exists():
        t0 = time.time()
        with open(DATA_PATH) as f:
            db = json.load(f)
        state.trajectory_db = db.get("frames", [])
        meta = db.get("meta", {})
        state.duration_s = float(meta.get("duration_s", 0))
        elapsed = time.time() - t0
        print(f"[startup] Loaded {len(state.trajectory_db)} frames "
              f"({state.duration_s:.0f}s) from {DATA_PATH.name} "
              f"in {elapsed:.2f}s")
    else:
        print(f"[startup] {DATA_PATH} not found — "
              "will generate on first POST /api/config")


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class ConfigPayload(BaseModel):
    roi:   list[list[float]]
    lines: dict[str, list[list[float]]]


# ─────────────────────────────────────────────────────────────────────────────
# Pre-computation
# ─────────────────────────────────────────────────────────────────────────────

def _precompute(config: ConfigPayload, traj_frames: list[dict]) -> None:
    """
    Run SpatialEngine over every trajectory frame and cache results in
    state.frames.  Also builds the 1-second sparkline timeline.

    This is O(n_frames × n_vehicles_per_frame) and runs once per config.
    At 23.75 fps × 1200 s = 28 500 frames it typically finishes in 1–2 s.
    """
    t0 = time.time()

    roi_pts = [tuple(p) for p in config.roi]
    lines   = {lid: (tuple(pts[0]), tuple(pts[1]))
               for lid, pts in config.lines.items()}

    engine = SpatialEngine(roi=roi_pts, lines=lines)

    results: dict[float, dict] = {}
    for frame in traj_frames:
        t      = round(float(frame["t"]), 3)
        result = engine.process_frame(t, frame.get("tracks", []))
        results[t] = result.to_dict()

    state.frames      = results
    state._frame_keys = sorted(results.keys())
    state.duration_s  = state._frame_keys[-1] if state._frame_keys else 0.0

    # ── build per-second sparkline ────────────────────────────────────────
    bucket_pcu: dict[int, dict[str, float]] = {}
    for fd in results.values():
        bkt = int(fd["t"])
        for ev in fd["events"]:
            lid = ev["line"]
            pcu = PCU_WEIGHTS.get(ev["class"], 1.0)
            bucket_pcu.setdefault(bkt, {})
            bucket_pcu[bkt][lid] = bucket_pcu[bkt].get(lid, 0.0) + pcu

    cumulative: dict[str, float] = {}
    timeline = []
    for bkt in sorted(bucket_pcu):
        rates = bucket_pcu[bkt]
        for lid, v in rates.items():
            cumulative[lid] = cumulative.get(lid, 0.0) + v
        timeline.append({
            "t":          bkt,
            "pcu_rate":   {k: round(v, 2) for k, v in rates.items()},
            "cumulative": {k: round(v, 2) for k, v in cumulative.items()},
            "total_rate": round(sum(rates.values()), 2),
        })
    state.timeline = timeline

    total_ev  = sum(len(fd["events"]) for fd in results.values())
    total_pcu = sum(PCU_WEIGHTS.get(ev["class"], 1.0)
                    for fd in results.values() for ev in fd["events"])
    elapsed = time.time() - t0
    print(f"[precompute] {len(results)} frames | "
          f"{total_ev} crossing events | {total_pcu:.1f} total PCU | "
          f"{state.duration_s:.0f}s timeline | {elapsed:.2f}s")


def _nearest_frame(t_req: float) -> dict:
    """Return the pre-computed frame dict closest to t_req."""
    keys = state._frame_keys
    if not keys:
        return {"t": t_req, "events": [], "positions": [], "line_counts": {}}

    # Clamp to [first, last]
    if t_req <= keys[0]:
        return state.frames[keys[0]]
    if t_req >= keys[-1]:
        return state.frames[keys[-1]]

    idx = bisect.bisect_left(keys, t_req)
    before = keys[idx - 1]
    after  = keys[idx]
    key    = before if (t_req - before) <= (after - t_req) else after
    return state.frames[key]


# ─────────────────────────────────────────────────────────────────────────────
# REST endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/config")
async def set_config(payload: ConfigPayload):
    """
    1. Use existing trajectory_db (or regenerate if empty).
    2. Pre-compute all crossing events against the user's lines.
    3. Return summary stats.
    """
    state.config = payload.model_dump()

    # If trajectory database is empty, generate it now
    if not state.trajectory_db:
        print("[config] No trajectory database — generating 1200s data …")
        state.trajectory_db = _generate_from_config(
            roi       = payload.roi,
            lines     = payload.lines,
            duration_s= 1200.0,
            fps       = 23.75,
            out_path  = DATA_PATH,
        )

    _precompute(payload, state.trajectory_db)

    total_ev  = sum(len(f["events"]) for f in state.frames.values())
    total_pcu = sum(PCU_WEIGHTS.get(ev["class"], 1.0)
                    for f in state.frames.values() for ev in f["events"])

    return {
        "ok":           True,
        "frames_ready": len(state.frames),
        "total_events": total_ev,
        "total_pcu":    round(total_pcu, 1),
        "duration_s":   round(state.duration_s, 2),
        "lines":        list(payload.lines.keys()),
    }


@app.get("/api/status")
async def get_status():
    return {
        "configured":   state.config is not None,
        "frames_ready": len(state.frames),
        "duration_s":   round(state.duration_s, 2),
        "traj_frames":  len(state.trajectory_db),
    }


@app.get("/api/summary")
async def get_summary():
    if not state.frames:
        return {"ok": False, "reason": "no config loaded"}

    class_counts: dict[str, int]   = {}
    line_totals:  dict[str, float] = {}
    for f in state.frames.values():
        for ev in f["events"]:
            cls = ev["class"]
            lid = ev["line"]
            pcu = PCU_WEIGHTS.get(cls, 1.0)
            class_counts[cls]  = class_counts.get(cls, 0) + 1
            line_totals[lid]   = line_totals.get(lid, 0.0) + pcu

    return {
        "ok":           True,
        "duration_s":   round(state.duration_s, 2),
        "timeline":     state.timeline,
        "line_totals":  {k: round(v, 1) for k, v in line_totals.items()},
        "class_counts": class_counts,
    }


@app.get("/api/reset")
async def reset():
    state.config      = None
    state.frames      = {}
    state._frame_keys = []
    state.timeline    = []
    # Keep trajectory_db — no need to re-load from disk
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket  /ws/stream
# ─────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket):
    await websocket.accept()

    pcu_history:    list[tuple[float, float]] = []
    last_history_t: float                     = -1.0
    t_req = 0.0

    try:
        while True:
            raw = await websocket.receive_text()

            # ── parse message ──────────────────────────────────────────
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                try:
                    msg = {"type": "seek", "t": float(raw)}
                except ValueError:
                    await websocket.send_json(
                        {"type": "error", "message": f"bad message: {raw}"})
                    continue

            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg.get("type") != "seek":
                await websocket.send_json(
                    {"type": "error", "message": "expected type=seek"})
                continue

            try:
                t_req = float(msg["t"])
            except (KeyError, TypeError, ValueError):
                await websocket.send_json(
                    {"type": "error", "message": "seek requires numeric 't'"})
                continue

            if not state.frames:
                await websocket.send_json({
                    "type":    "error",
                    "message": "Backend not configured — POST /api/config first",
                })
                continue

            # ── look up nearest pre-computed frame ─────────────────────
            frame    = _nearest_frame(t_req)
            t_actual = frame["t"]

            # ── rebuild 30-second PCU sliding window ───────────────────
            # Scan all frame keys in [t_actual − WINDOW_SEC, t_actual].
            # Binary search keeps this O(window_frames) ≈ O(700 frames).
            t_win_start = t_actual - WINDOW_SEC
            pcu_by_line: dict[str, float] = {}

            s_idx = bisect.bisect_left (state._frame_keys, t_win_start)
            e_idx = bisect.bisect_right(state._frame_keys, t_actual)

            for key in state._frame_keys[s_idx:e_idx]:
                for ev in state.frames[key]["events"]:
                    lid = ev["line"]
                    pcu = PCU_WEIGHTS.get(ev["class"], 1.0)
                    pcu_by_line[lid] = pcu_by_line.get(lid, 0.0) + pcu

            total_pcu = sum(pcu_by_line.values())

            # ── trend history (one sample per unique second) ────────────
            t_bucket = round(t_actual, 0)
            if t_bucket > last_history_t:
                last_history_t = t_bucket
                pcu_history.append((t_bucket, total_pcu))
                if len(pcu_history) > 120:
                    pcu_history.pop(0)

            # ── evaluate traffic rules ─────────────────────────────────
            rule_result: RuleResult = evaluate_rules(
                pcu_by_line = pcu_by_line,
                window_sec  = WINDOW_SEC,
                total_pcu   = total_pcu,
                pcu_history = pcu_history,
            )

            # ── send response ──────────────────────────────────────────
            await websocket.send_json({
                "type":           "frame",
                "t":              t_actual,
                "positions":      frame["positions"],
                "events":         frame["events"],
                "line_counts":    frame["line_counts"],
                "pcu_window":     {k: round(v, 2) for k, v in pcu_by_line.items()},
                "total_pcu":      round(total_pcu, 2),
                "alerts":         [a.to_dict() for a in rule_result.alerts],
                "signal_plan":    rule_result.signal_plan.to_dict(),
                "congestion_idx": round(rule_result.congestion_idx, 3),
                "trend":          rule_result.trend,
                "pcu_per_min":    round(rule_result.pcu_per_min, 1),
            })

    except WebSocketDisconnect:
        print(f"[ws] client disconnected (last t={t_req:.2f}s)")
    except Exception as exc:
        import traceback
        print(f"[ws] error: {exc}")
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
