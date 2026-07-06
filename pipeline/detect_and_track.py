"""
Stage 1 + 2: Vehicle Detection & Tracking
Uses YOLOv8 with ByteTrack to detect and track vehicles across frames.
Outputs per-frame tracking results for the counting stage.
"""

import cv2
import numpy as np
from ultralytics import YOLO
from tqdm import tqdm
import json
import argparse
from pathlib import Path

# COCO class IDs → our 5 categories
COCO_CLASS_MAP = {
    0:  "pedestrian",
    1:  "bicycle",        # grouped under motorcycle visually
    2:  "car",
    3:  "motorcycle",
    5:  "bus",
    7:  "truck",
}

CATEGORY_MAP = {
    "pedestrian": "pedestrian",
    "bicycle":    "motorcycle",
    "motorcycle": "motorcycle",
    "car":        "car_suv",
    "bus":        "bus",
    "truck":      "truck",
}

CATEGORY_LABELS = ["car_suv", "motorcycle", "truck", "bus", "pedestrian"]


def load_model(model_size: str = "yolov8s.pt") -> YOLO:
    """Load YOLOv8 model (downloads automatically on first run)."""
    return YOLO(model_size)


def get_video_info(cap: cv2.VideoCapture) -> dict:
    """Extract basic video metadata."""
    return {
        "width":  int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps":    cap.get(cv2.CAP_PROP_FPS),
        "total_frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
    }


def auto_define_counting_lines(width: int, height: int) -> list[dict]:
    """
    Auto-define virtual counting lines based on road geometry.

    The intersection has 4 traffic directions visible from the CCTV angle:
      - North-South straight traffic (vertical lanes)
      - East-West cross traffic (horizontal lanes)
      - Left-turning vehicles cutting diagonally through the intersection

    We place 4 lines:
      L1 (north inbound)  — horizontal line in upper third
      L2 (south inbound)  — horizontal line in lower third
      L3 (west inbound)   — vertical line in left third
      L4 (east inbound)   — vertical line in right third
    """
    lines = [
        {
            "id": "L1",
            "label_en": "North Inbound",
            "label_zh": "北向進入",
            "direction": "north",
            # (x1, y1) → (x2, y2)
            "x1": int(width * 0.15), "y1": int(height * 0.30),
            "x2": int(width * 0.75), "y2": int(height * 0.30),
        },
        {
            "id": "L2",
            "label_en": "South Inbound",
            "label_zh": "南向進入",
            "direction": "south",
            "x1": int(width * 0.25), "y1": int(height * 0.72),
            "x2": int(width * 0.90), "y2": int(height * 0.72),
        },
        {
            "id": "L3",
            "label_en": "West Inbound",
            "label_zh": "西向進入",
            "direction": "west",
            "x1": int(width * 0.20), "y1": int(height * 0.20),
            "x2": int(width * 0.20), "y2": int(height * 0.80),
        },
        {
            "id": "L4",
            "label_en": "East Inbound",
            "label_zh": "東向進入",
            "direction": "east",
            "x1": int(width * 0.80), "y1": int(height * 0.20),
            "x2": int(width * 0.80), "y2": int(height * 0.80),
        },
    ]
    return lines


def point_side_of_line(px, py, x1, y1, x2, y2) -> float:
    """Returns signed distance of point (px,py) from line (x1,y1)→(x2,y2)."""
    return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)


def run_detection(
    video_path: str,
    model_size: str = "yolov8s.pt",
    skip_frames: int = 2,
    conf_threshold: float = 0.35,
) -> dict:
    """
    Run YOLOv8 + ByteTrack on the video.
    Returns structured tracking results including per-frame detections
    and per-minute bucket counts for each line and category.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video: {video_path}")

    info = get_video_info(cap)
    fps = info["fps"] if info["fps"] > 0 else 25.0
    total_frames = info["total_frames"]
    width, height = info["width"], info["height"]

    model = load_model(model_size)
    lines = auto_define_counting_lines(width, height)

    # Track last known side for each object ID per line
    # {track_id: {line_id: side_sign}}
    prev_sides: dict[int, dict[str, float]] = {}

    # Counts: {minute_bucket: {line_id: {category: count}}}
    minute_counts: dict[int, dict[str, dict[str, int]]] = {}

    # Overall totals: {line_id: {category: int}}
    line_totals: dict[str, dict[str, int]] = {
        l["id"]: {c: 0 for c in CATEGORY_LABELS} for l in lines
    }
    total_by_category: dict[str, int] = {c: 0 for c in CATEGORY_LABELS}

    # Per-minute category totals (for timeline chart)
    timeline: dict[int, dict[str, int]] = {}

    frame_idx = 0
    pbar = tqdm(total=total_frames, desc="Processing video", unit="frame")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        pbar.update(1)
        frame_idx += 1

        # Skip frames for speed — tracking still uses IDs across skipped frames
        if frame_idx % (skip_frames + 1) != 0:
            continue

        minute_bucket = int((frame_idx / fps) / 60)

        # Init minute bucket
        if minute_bucket not in minute_counts:
            minute_counts[minute_bucket] = {
                l["id"]: {c: 0 for c in CATEGORY_LABELS} for l in lines
            }
        if minute_bucket not in timeline:
            timeline[minute_bucket] = {c: 0 for c in CATEGORY_LABELS}

        # Run YOLOv8 with ByteTrack
        results = model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            conf=conf_threshold,
            classes=list(COCO_CLASS_MAP.keys()),
            verbose=False,
        )

        if results[0].boxes is None:
            continue

        boxes = results[0].boxes
        if boxes.id is None:
            continue

        track_ids = boxes.id.int().cpu().tolist()
        cls_ids   = boxes.cls.int().cpu().tolist()
        xyxy      = boxes.xyxy.cpu().tolist()

        for tid, cls_id, box in zip(track_ids, cls_ids, xyxy):
            coco_name = COCO_CLASS_MAP.get(cls_id)
            if coco_name is None:
                continue
            category = CATEGORY_MAP[coco_name]

            # Centroid of bounding box
            cx = (box[0] + box[2]) / 2
            cy = (box[1] + box[3]) / 2

            if tid not in prev_sides:
                prev_sides[tid] = {}

            for line in lines:
                lid = line["id"]
                side = point_side_of_line(
                    cx, cy,
                    line["x1"], line["y1"],
                    line["x2"], line["y2"]
                )
                prev = prev_sides[tid].get(lid)

                if prev is not None and prev * side < 0:
                    # Object crossed the line
                    minute_counts[minute_bucket][lid][category] += 1
                    line_totals[lid][category] += 1
                    total_by_category[category] += 1
                    timeline[minute_bucket][category] += 1

                prev_sides[tid][lid] = side

    pbar.close()
    cap.release()

    # Convert minute_counts keys to sorted list for JSON serialization
    sorted_minutes = sorted(minute_counts.keys())

    return {
        "video_info": info,
        "counting_lines": lines,
        "minute_counts": {str(m): minute_counts[m] for m in sorted_minutes},
        "line_totals": line_totals,
        "total_by_category": total_by_category,
        "timeline": {str(m): timeline[m] for m in sorted(timeline.keys())},
        "duration_minutes": int(total_frames / fps / 60) + 1,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YOLOv8 vehicle detection & tracking")
    parser.add_argument("--video",  required=True, help="Path to input video file")
    parser.add_argument("--model",  default="yolov8s.pt", help="YOLOv8 model variant")
    parser.add_argument("--skip",   type=int, default=2,  help="Frames to skip between detections")
    parser.add_argument("--conf",   type=float, default=0.35, help="Detection confidence threshold")
    parser.add_argument("--output", default="pipeline/tracking_raw.json", help="Output JSON path")
    args = parser.parse_args()

    results = run_detection(args.video, args.model, args.skip, args.conf)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Tracking complete. Results saved to {out_path}")
    print(f"   Total vehicles detected: {sum(results['total_by_category'].values())}")
    for cat, count in results["total_by_category"].items():
        print(f"   {cat:15s}: {count}")
