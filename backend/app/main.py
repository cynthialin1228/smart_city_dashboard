"""
main.py  –  FastAPI backend · Smart City Digital Twin Traffic Control Room
═══════════════════════════════════════════════════════════════════════════════

KEY DESIGN DECISION
───────────────────
  traffic_base.json contains SYNTHETIC trajectories whose paths are hardcoded.
  When the user draws counting lines in Config Mode, those lines are in the
  coordinate space of the REAL video, not the synthetic data.

  FIX: after receiving POST /api/config, we call generate_from_config() which
  regenerates the trajectory database on-the-fly so that vehicle paths are
  guaranteed to cross the user-drawn counting lines.  The new frames are stored
  in memory (state.trajectory_db) and pre-computed immediately.

  The JSON file is also updated so restarts are consistent.

REST
────
  POST /api/config
  GET  /api/status
  GET  /api/summary
  GET  /api/reset

WebSocket
─────────
  WS /ws/stream
    Client → { "type": "seek", "t": 12.45 }
    Client → { "type": "ping" }
    Server → { "type": "frame", … }

  SLIDING WINDOW FIX:
    The per-connection window is keyed by FRAME TIMESTAMP, not by receive time.
    We track which frame timestamps have already been added to the window so
    that re-seeking to the same second doesn't re-add events.

Startup
───────
  cd backend
  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import bisect
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))

from app.spatial_engine import SpatialEngine, PCU_WEIGHTS    # noqa: E402
from app.traffic_rules   import evaluate_rules, RuleResult   # noqa: E402

# Import the trajectory generator directly via path
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location(
    "gen_traffic_base",
    _Path(__file__).resolve().parent.parent / "data" / "gen_traffic_base.py"
)
_gen_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_gen_mod)
generate_from_config = _gen_mod.generate_from_config

# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Smart City Traffic API", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

DATA_PATH    = Path(__file__).parent.parent / "data" / "traffic_base.json"
WINDOW_SEC   = 30.0
SIM_FPS      = 25.0      # frames per second in synthetic data
SIM_DURATION = 60.0      # seconds of synthetic data


# ─────────────────────────────────────────────────────────────────────────────
# Global state
# ─────────────────────────────────────────────────────────────────────────────

class _State:
    def __init__(self):
        self.config:         Optional[dict]        = None
        self.trajectory_db:  list[dict]            = []
        self.frames:         dict[float, dict]     = {}
        self._frame_keys:    list[float]           = []
        self.timeline:       list[dict]            = []

state = _State()


@app.on_event("startup")
async def _load_db():
    if DATA_PATH.exists():
        with open(DATA_PATH) as f:
            state.trajectory_db = json.load(f).get("frames", [])
        print(f"[startup] Loaded {len(state.trajectory_db)} frames from {DATA_PATH.name}")
    else:
        print(f"[startup] {DATA_PATH} not found — will generate on first /api/config")


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────

class ConfigPayload(BaseModel):
    roi:   list[list[float]]
    lines: dict[str, list[list[float]]]


# ─────────────────────────────────────────────────────────────────────────────
# Pre-computation
# ─────────────────────────────────────────────────────────────────────────────

def _precompute(config: ConfigPayload, frames: list[dict]) -> None:
    """
    Run the SpatialEngine over every frame and cache results.
    Also builds the 1-second timeline for the sparkline chart.
    """
    roi_pts = [tuple(p) for p in config.roi]
    lines   = {lid: (tuple(pts[0]), tuple(pts[1]))
               for lid, pts in config.lines.items()}

    engine = SpatialEngine(roi=roi_pts, lines=lines)  # type: ignore

    results: dict[float, dict] = {}
    for frame in frames:
        t      = round(float(frame["t"]), 3)
        result = engine.process_frame(t, frame.get("tracks", []))
        results[t] = result.to_dict()

    state.frames      = results
    state._frame_keys = sorted(results.keys())

    # ── 1-second timeline for sparkline ──────────────────────────────────
    bucket_pcu: dict[int, dict[str, float]] = {}
    for fd in results.values():
        bkt = int(fd["t"])
        if bkt not in bucket_pcu:
            bucket_pcu[bkt] = {}
        for ev in fd["events"]:
            lid = ev["line"]
            pcu = PCU_WEIGHTS.get(ev["class"], 1.0)
            bucket_pcu[bkt][lid] = bucket_pcu[bkt].get(lid, 0.0) + pcu

    cumulative: dict[str, float] = {}
    timeline = []
    for bkt in sorted(bucket_pcu.keys()):
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
    print(f"[precompute] {len(results)} frames | "
          f"{total_ev} crossing events | {total_pcu:.1f} total PCU")


def _nearest_frame(t_req: float) -> dict:
    keys = state._frame_keys
    if not keys:
        return {"t": t_req, "events": [], "positions": [], "line_counts": {}}
    idx = bisect.bisect_left(keys, t_req)
    if idx == 0:           return state.frames[keys[0]]
    if idx >= len(keys):   return state.frames[keys[-1]]
    before, after = keys[idx-1], keys[idx]
    key = before if (t_req - before) <= (after - t_req) else after
    return state.frames[key]


# ─────────────────────────────────────────────────────────────────────────────
# REST endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/config")
async def set_config(payload: ConfigPayload):
    """
    1. Regenerate trajectory database aligned to user-drawn counting lines
    2. Pre-compute all crossing events
    3. Return summary stats
    """
    state.config = payload.model_dump()

    # ── Generate trajectories that cross the user's lines ─────────────────
    print(f"[config] Generating trajectories for lines: {list(payload.lines.keys())}")
    frames = generate_from_config(
        roi       = payload.roi,
        lines     = payload.lines,
        duration_s= SIM_DURATION,
        fps       = SIM_FPS,
        out_path  = DATA_PATH,
    )
    state.trajectory_db = frames

    # ── Pre-compute ──────────────────────────────────────────────────────
    _precompute(payload, frames)

    total_ev  = sum(len(f["events"]) for f in state.frames.values())
    total_pcu = sum(PCU_WEIGHTS.get(ev["class"], 1.0)
                    for f in state.frames.values() for ev in f["events"])

    return {
        "ok":           True,
        "frames_ready": len(state.frames),
        "total_events": total_ev,
        "total_pcu":    round(total_pcu, 1),
        "lines":        list(payload.lines.keys()),
        "duration_s":   state._frame_keys[-1] if state._frame_keys else 0,
    }


@app.get("/api/status")
async def get_status():
    return {
        "configured":   state.config is not None,
        "frames_ready": len(state.frames),
        "duration_s":   state._frame_keys[-1] if state._frame_keys else 0,
    }


@app.get("/api/summary")
async def get_summary():
    if not state.frames:
        return {"ok": False, "reason": "no config loaded"}
    class_counts: dict[str, int]   = {}
    line_totals:  dict[str, float] = {}
    for f in state.frames.values():
        for ev in f["events"]:
            cls = ev["class"];  lid = ev["line"]
            pcu = PCU_WEIGHTS.get(cls, 1.0)
            class_counts[cls] = class_counts.get(cls, 0) + 1
            line_totals[lid]  = line_totals.get(lid, 0.0) + pcu
    return {
        "ok":           True,
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
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket
# ─────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket):
    await websocket.accept()

    # ── Per-connection state ───────────────────────────────────────────────
    # Sliding window: dict of frame_t → { line_id → pcu_sum }
    # We rebuild the window fresh every seek from the pre-computed frames,
    # so seeking forward/backward always gives the correct 30-second aggregate.
    pcu_history: list[tuple[float, float]] = []
    last_history_t: float = -1.0

    t_req = 0.0  # for error message

    try:
        while True:
            raw = await websocket.receive_text()

            # ── parse ──────────────────────────────────────────────────────
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                try:
                    msg = {"type": "seek", "t": float(raw)}
                except ValueError:
                    await websocket.send_json({"type": "error", "message": f"bad msg: {raw}"})
                    continue

            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg.get("type") != "seek":
                await websocket.send_json({"type": "error", "message": "unknown type"})
                continue

            try:
                t_req = float(msg["t"])
            except (KeyError, TypeError, ValueError):
                await websocket.send_json({"type": "error", "message": "seek needs 't'"})
                continue

            if not state.frames:
                await websocket.send_json({
                    "type": "error",
                    "message": "No config — POST /api/config first",
                })
                continue

            # ── look up nearest frame ──────────────────────────────────────
            frame    = _nearest_frame(t_req)
            t_actual = frame["t"]

            # ── rebuild PCU sliding window from pre-computed frames ────────
            # Scan ALL frames in [t_actual - WINDOW_SEC, t_actual] and sum PCU.
            # This is O(window_frames) per seek but is correct for any seek
            # position (forward, backward, or scrub).
            t_window_start = t_actual - WINDOW_SEC
            pcu_by_line: dict[str, float] = {}

            # Binary search for the start of the window
            start_idx = bisect.bisect_left(state._frame_keys, t_window_start)
            end_idx   = bisect.bisect_right(state._frame_keys, t_actual)

            for key in state._frame_keys[start_idx:end_idx]:
                for ev in state.frames[key]["events"]:
                    lid = ev["line"]
                    pcu = PCU_WEIGHTS.get(ev["class"], 1.0)
                    pcu_by_line[lid] = pcu_by_line.get(lid, 0.0) + pcu

            total_pcu = sum(pcu_by_line.values())

            # ── trend history (one point per unique second) ────────────────
            t_bucket = round(t_actual, 0)
            if t_bucket > last_history_t:
                last_history_t = t_bucket
                pcu_history.append((t_bucket, total_pcu))
                if len(pcu_history) > 120:
                    pcu_history.pop(0)

            # ── evaluate rules ─────────────────────────────────────────────
            rule_result: RuleResult = evaluate_rules(
                pcu_by_line = pcu_by_line,
                window_sec  = WINDOW_SEC,
                total_pcu   = total_pcu,
                pcu_history = pcu_history,
            )

            # ── build response ─────────────────────────────────────────────
            await websocket.send_json({
                "type":           "frame",
                "t":              t_actual,
                "events":         frame["events"],
                "positions":      frame["positions"],
                "line_counts":    frame["line_counts"],
                "pcu_window":     {k: round(v, 2) for k, v in pcu_by_line.items()},
                "total_pcu":      round(total_pcu, 2),
                "alerts":         [a.to_dict() for a in rule_result.alerts],
                "signal_plan":    rule_result.signal_plan.to_dict(),
                "congestion_idx": rule_result.congestion_idx,
                "trend":          rule_result.trend,
                "pcu_per_min":    rule_result.pcu_per_min,
            })

    except WebSocketDisconnect:
        print(f"[ws] disconnected at t={t_req:.2f}")
    except Exception as exc:
        print(f"[ws] error: {exc}")
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
