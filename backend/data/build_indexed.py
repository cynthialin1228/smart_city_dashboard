"""
build_indexed.py  ·  Compact traffic_indexed.json builder (v2, real detections)

Reads the real YOLO + BoT-SORT output in backend/data/new_data/ and produces a
SMALL per-second index for the frontend:

  live_tracks[sec] : real detection boxes (centre x,y + real w,h) at ~1 snapshot/sec
  live_counts[sec] : correct per-frame visible counts (from frame_vehicle_counts.csv)
  paths[track_id]  : downsampled trajectory (for tails) — stored ONCE, not per frame
  trends           : PCU trend (counts_by_bucket.csv)
  cluster_matrix   : ML flow clusters (trajectory_cluster_summary.csv)
  live_events[sec] : line-crossing events (events.csv)

Coordinates are the raw 1280x720 image space (same as the video / detections).
"""
import csv, json, os, math, ast

BASE = os.path.dirname(__file__)
SRC  = os.path.join(BASE, "new_data")            # canonical new data lives here
OUT  = os.path.join(os.path.dirname(BASE), "static", "traffic_indexed.json")

FPS = 23.75
DURATION_S = 1200
RAW_W, RAW_H = 1280, 720

def src(name): return os.path.join(SRC, name)

# second -> representative frame_idx, and reverse lookup
sec_to_frame = {s: round(s * FPS) for s in range(DURATION_S)}
frame_to_sec = {f: s for s, f in sec_to_frame.items()}

# ── 1. live_tracks from detections.csv (real boxes at snapshot frames) ──────
live_tracks = {str(s): [] for s in range(DURATION_S)}
needed_ids = set()
with open(src("detections.csv"), newline="") as f:
    for row in csv.DictReader(f):
        fr = int(row["frame_idx"])
        s = frame_to_sec.get(fr)
        if s is None:
            continue
        try:
            x1, y1, x2, y2 = float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])
        except ValueError:
            continue
        w, h = x2 - x1, y2 - y1
        if w <= 0 or h <= 0:
            continue
        tid = row["track_id"]
        needed_ids.add(tid)
        live_tracks[str(s)].append({
            "id": tid,
            "class": row["class"].strip().lower(),
            "x": round((x1 + x2) / 2, 1),
            "y": round((y1 + y2) / 2, 1),
            "w": round(w, 1),
            "h": round(h, 1),
            "src": "roi" if row["source"] == "roi_backup" else "main",
        })

# ── 2. live_counts from frame_vehicle_counts.csv (authoritative per-frame) ──
live_counts = {}
with open(src("frame_vehicle_counts.csv"), newline="") as f:
    for row in csv.DictReader(f):
        fr = int(row["frame_idx"])
        s = frame_to_sec.get(fr)
        if s is None:
            continue
        live_counts[str(s)] = {
            "car": int(row["car"]), "motorcycle": int(row["motorcycle"]),
            "truck": int(row["truck"]), "bus": int(row["bus"]),
            "total": int(row["total_visible"]),
        }

# ── 3. trends from counts_by_bucket.csv ────────────────────────────────────
trends = []
with open(src("counts_by_bucket.csv"), newline="") as f:
    for row in csv.DictReader(f):
        trends.append({
            "bucket": int(float(row["bucket"])),
            "car": int(float(row["car"])), "motorcycle": int(float(row["motorcycle"])),
            "truck": int(float(row["truck"])), "bus": int(float(row["bus"])),
            "total": int(float(row["total"])), "pcu": round(float(row["pcu"]), 2),
        })

# ── 4. clusters: per-cluster compass direction + cumulative-over-time series ─
#    cluster_dirs   : {cluster_id: "E"/"NE"/.../"NW"}  (language-neutral)
#    cluster_series : {cluster_id: [cumulative vehicles completed by each sec]}
#    The frontend indexes cluster_series by the current second, so the ranking
#    grows and re-ranks as the video plays (ends at the full totals).
DIRS = [(0, "E"), (45, "NE"), (90, "N"), (135, "NW"),
        (180, "W"), (-135, "SW"), (-90, "S"), (-45, "SE")]
def bearing_code(dx, dy):
    ang = math.degrees(math.atan2(-dy, dx))  # screen y is down
    return min(DIRS, key=lambda d: abs((ang - d[0] + 180) % 360 - 180))[1]

cluster_dirs = {}
with open(src("trajectory_cluster_summary.csv"), newline="") as f:
    for row in csv.DictReader(f):
        c = int(row["trajectory_cluster"])
        if c == -1 or int(row["count"]) < 3:
            continue
        dx = float(row["avg_last_x"]) - float(row["avg_first_x"])
        dy = float(row["avg_last_y"]) - float(row["avg_first_y"])
        cluster_dirs[str(c)] = bearing_code(dx, dy)

# cumulative completions per second from trajectories.csv (by last_t).
# We also capture cluster-0's tracks so we can sub-split it (see below).
SPLIT_CLUSTER = "0"     # over-merged cluster to sub-classify
SPLIT_K = 3
per_sec = {c: [0] * DURATION_S for c in cluster_dirs}
c0_rows = []            # (fx,fy,lx,ly, sec) for the cluster being split
with open(src("trajectories.csv"), newline="") as f:
    for row in csv.DictReader(f):
        c = str(int(row["trajectory_cluster"])) if row["trajectory_cluster"] not in ("", "-1") else None
        if c not in cluster_dirs:
            continue
        try:
            sec = min(int(float(row["last_t"])), DURATION_S - 1)
        except ValueError:
            continue
        per_sec[c][sec] += 1
        if c == SPLIT_CLUSTER:
            try:
                c0_rows.append((float(row["first_x"]), float(row["first_y"]),
                                float(row["last_x"]), float(row["last_y"]), sec))
            except ValueError:
                pass

# ── sub-split the over-merged cluster (non-destructive; only affects ranking) ─
import random
def _kmeans(data, k, iters=60, restarts=8, seed=0):
    rnd = random.Random(seed); dim = len(data[0]); best = None
    def d2(x, c): return sum((x[i] - c[i]) ** 2 for i in range(dim))
    for _ in range(restarts):
        centers = [data[rnd.randrange(len(data))]]
        for _ in range(k - 1):
            dd = [min(d2(x, c) for c in centers) for x in data]
            tot = sum(dd) or 1.0; r = rnd.random() * tot; acc = 0; pick = 0
            for j, v in enumerate(dd):
                acc += v
                if acc >= r: pick = j; break
            centers.append(data[pick])
        labels = [0] * len(data)
        for _ in range(iters):
            labels = [min(range(k), key=lambda j: d2(x, centers[j])) for x in data]
            new = []
            for j in range(k):
                pts = [data[t] for t in range(len(data)) if labels[t] == j]
                new.append([sum(p[i] for p in pts) / len(pts) for i in range(dim)] if pts else centers[j])
            if new == centers: break
            centers = new
        inertia = sum(min(d2(x, centers[j]) for j in range(k)) for x in data)
        if best is None or inertia < best[0]: best = (inertia, labels)
    return best[1]

if SPLIT_CLUSTER in cluster_dirs and len(c0_rows) >= SPLIT_K * 5:
    # features: origin, destination, unit net-direction (standardised)
    feats = []
    for fx, fy, lx, ly, _ in c0_rows:
        nx, ny = lx - fx, ly - fy
        n = math.hypot(nx, ny) or 1.0
        feats.append([fx, fy, lx, ly, nx / n * 200, ny / n * 200])
    dim = len(feats[0])
    mean = [sum(r[i] for r in feats) / len(feats) for i in range(dim)]
    std = [(sum((r[i] - mean[i]) ** 2 for r in feats) / len(feats)) ** 0.5 or 1.0 for i in range(dim)]
    norm = [[(r[i] - mean[i]) / std[i] for i in range(dim)] for r in feats]
    labels = _kmeans(norm, SPLIT_K, seed=0)

    # per-sub raw stats to name them semantically (stable regardless of kmeans order)
    stats = []
    for j in range(SPLIT_K):
        idx = [t for t in range(len(c0_rows)) if labels[t] == j]
        if not idx:
            stats.append(None); continue
        mfx = sum(c0_rows[t][0] for t in idx) / len(idx)
        mfy = sum(c0_rows[t][1] for t in idx) / len(idx)
        mlx = sum(c0_rows[t][2] for t in idx) / len(idx)
        mly = sum(c0_rows[t][3] for t in idx) / len(idx)
        stats.append({"j": j, "n": len(idx), "mfx": mfx, "mfy": mfy, "mlx": mlx, "mly": mly,
                      "dx": mlx - mfx, "dy": mly - mfy})
    valid = [s for s in stats if s]
    # right-up = most upward (min dy); left-down = destination furthest left; middle = rest
    right = min(valid, key=lambda s: s["dy"])
    rest = [s for s in valid if s is not right]
    left = min(rest, key=lambda s: s["mlx"])
    middle = [s for s in rest if s is not left][0]
    sub_id = {right["j"]: f"{SPLIT_CLUSTER}.0", left["j"]: f"{SPLIT_CLUSTER}.2", middle["j"]: f"{SPLIT_CLUSTER}.1"}

    # replace parent cluster with sub-clusters in per_sec + cluster_dirs
    del cluster_dirs[SPLIT_CLUSTER]
    per_sec.pop(SPLIT_CLUSTER, None)
    for s in valid:
        sid = sub_id[s["j"]]
        cluster_dirs[sid] = bearing_code(s["dx"], s["dy"])
        per_sec[sid] = [0] * DURATION_S
    for t, (_, _, _, _, sec) in enumerate(c0_rows):
        per_sec[sub_id[labels[t]]][sec] += 1
    print(f"   sub-split cluster {SPLIT_CLUSTER}: " +
          ", ".join(f"{sub_id[s['j']]}(n={s['n']},{cluster_dirs[sub_id[s['j']]]})" for s in valid))

cluster_series = {}
for c, arr in per_sec.items():
    run = 0; out = []
    for v in arr:
        run += v; out.append(run)
    cluster_series[c] = out

# ── 5. live_events from events.csv ─────────────────────────────────────────
live_events = {}
with open(src("events.csv"), newline="") as f:
    for row in csv.DictReader(f):
        s = str(int(float(row["t_seconds"])))
        live_events.setdefault(s, []).append({
            "time_str": row["video_time"], "line": row["line"],
            "id": row["track_id"], "class": row["class"].strip().lower(),
        })

# ── 6. paths (downsampled) for tails — one entry per track, not per frame ───
MAX_PTS = 24
def downsample(pts, n=MAX_PTS):
    if len(pts) <= n:
        return pts
    step = len(pts) / n
    return [pts[int(i * step)] for i in range(n)]
paths = {}
with open(src("trajectories.csv"), newline="") as f:
    for row in csv.DictReader(f):
        tid = row["track_id"]
        if tid not in needed_ids:
            continue
        raw = row.get("points_json", "")
        if not raw:
            continue
        try:
            pts = ast.literal_eval(raw)
        except (ValueError, SyntaxError):
            continue
        pts = [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in pts]
        if len(pts) > 1:
            paths[tid] = downsample(pts)

payload = {
    "status": "success",
    "meta": {"fps": FPS, "duration_s": DURATION_S, "coord_space": f"{RAW_W}x{RAW_H}",
             "source": "detections.csv (YOLO + BoT-SORT)"},
    "trends": trends,
    "cluster_dirs": cluster_dirs,
    "cluster_series": cluster_series,
    "live_tracks": live_tracks,
    "live_counts": live_counts,
    "live_events": live_events,
    "paths": paths,
}

tmp = "/tmp/traffic_indexed.json"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

n_tracks = sum(len(v) for v in live_tracks.values())
print(f"✅ built  tracks_entries={n_tracks}  paths={len(paths)}  "
      f"secs_with_counts={len(live_counts)}  clusters={len(cluster_series)}")
print(f"   wrote {tmp}  ({os.path.getsize(tmp)/1e6:.2f} MB)")
