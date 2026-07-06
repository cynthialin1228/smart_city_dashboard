"""
Stage 3: Decision-Making Transformation
Rule-based congestion scoring and actionable traffic recommendations.
Reads tracking_raw.json and produces enriched traffic_data.json for the dashboard.
"""

import json
import argparse
from pathlib import Path

# ── Congestion scoring weights ────────────────────────────────────────────────
# Heavier vehicles contribute more to congestion than motorcycles/pedestrians
VEHICLE_WEIGHT = {
    "car_suv":    1.0,
    "motorcycle": 0.3,
    "truck":      2.5,
    "bus":        2.0,
    "pedestrian": 0.1,
}

# Thresholds for congestion index (0–100 scale, per minute per lane)
CONGESTION_THRESHOLDS = {
    "free_flow":   (0,  25),
    "moderate":    (25, 50),
    "heavy":       (50, 75),
    "severe":      (75, 101),
}

# Peak-hour classification (minutes into the recording)
# Adjust if the recording has a known real-world start time
def classify_time_period(minute: int) -> dict:
    """Map recording minute → time period label."""
    # We treat the video as starting at 07:30 for demo purposes
    real_hour = 7 + (minute + 30) // 60
    real_min  = (minute + 30) % 60
    label_en = "Off-Peak"
    label_zh = "離峰"
    if 7 <= real_hour < 9:
        label_en, label_zh = "Morning Peak", "早峰"
    elif 11 <= real_hour < 13:
        label_en, label_zh = "Lunch Rush", "午峰"
    elif 17 <= real_hour < 19:
        label_en, label_zh = "Evening Peak", "晚峰"
    return {
        "label_en": label_en,
        "label_zh": label_zh,
        "real_time": f"{real_hour:02d}:{real_min:02d}",
    }


def weighted_volume(counts: dict) -> float:
    """Convert category counts to a congestion-weighted volume."""
    return sum(counts.get(cat, 0) * w for cat, w in VEHICLE_WEIGHT.items())


def compute_congestion_index(weighted_vol: float, max_observed: float) -> float:
    """
    Normalize weighted volume to 0–100 congestion index.
    Uses the observed maximum as the reference ceiling (adaptive scaling).
    """
    if max_observed == 0:
        return 0.0
    raw = (weighted_vol / max_observed) * 100
    return min(round(raw, 1), 100.0)


def congestion_level(index: float) -> dict:
    for level, (lo, hi) in CONGESTION_THRESHOLDS.items():
        if lo <= index < hi:
            labels = {
                "free_flow": ("Free Flow",  "順暢"),
                "moderate":  ("Moderate",   "稍塞"),
                "heavy":     ("Heavy",      "壅塞"),
                "severe":    ("Severe",     "嚴重壅塞"),
            }
            en, zh = labels[level]
            return {"level": level, "label_en": en, "label_zh": zh}
    return {"level": "severe", "label_en": "Severe", "label_zh": "嚴重壅塞"}


# ── Rule-based recommendation engine ─────────────────────────────────────────

def generate_recommendations(
    overall_index: float,
    peak_minute: int,
    peak_counts: dict,
    line_totals: dict,
    total_by_category: dict,
    duration_minutes: int,
) -> list[dict]:
    """
    Generate concrete, actionable traffic management recommendations.
    Each recommendation has: id, priority (high/medium/low), icon,
    title_en, title_zh, detail_en, detail_zh.
    """
    recs = []
    total_vehicles = sum(total_by_category.values())
    avg_per_min = total_vehicles / max(duration_minutes, 1)
    truck_ratio = total_by_category.get("truck", 0) / max(total_vehicles, 1)
    bus_ratio   = total_by_category.get("bus",   0) / max(total_vehicles, 1)
    moto_ratio  = total_by_category.get("motorcycle", 0) / max(total_vehicles, 1)

    # Rule 1: High overall congestion → extend green light cycle
    if overall_index >= 60:
        recs.append({
            "id": "R1",
            "priority": "high",
            "icon": "🚦",
            "title_en": "Extend Green Light Duration",
            "title_zh": "延長綠燈時間",
            "detail_en": (
                f"Overall congestion index is {overall_index:.0f}/100. "
                "Recommend increasing the main-direction green phase by 15–20 seconds "
                "during peak periods to improve throughput."
            ),
            "detail_zh": (
                f"整體壅塞指數達 {overall_index:.0f}/100，"
                "建議尖峰時段主要方向綠燈時長延長 15–20 秒，以提升通行效率。"
            ),
        })

    # Rule 2: High truck ratio → restrict heavy vehicles during peak
    if truck_ratio >= 0.15:
        recs.append({
            "id": "R2",
            "priority": "high",
            "icon": "🚛",
            "title_en": "Restrict Heavy Trucks During Peak Hours",
            "title_zh": "尖峰時段限制大型車輛",
            "detail_en": (
                f"Heavy trucks account for {truck_ratio*100:.1f}% of traffic. "
                "Consider restricting large truck entry to this corridor "
                "between 07:00–09:00 and 17:00–19:00."
            ),
            "detail_zh": (
                f"大型卡車佔車流 {truck_ratio*100:.1f}%，"
                "建議限制大型車輛於 07:00–09:00 及 17:00–19:00 進入本路廊。"
            ),
        })

    # Rule 3: High motorcycle ratio → dedicated motorcycle lane
    if moto_ratio >= 0.35:
        recs.append({
            "id": "R3",
            "priority": "medium",
            "icon": "🏍️",
            "title_en": "Designate Motorcycle Waiting Zone",
            "title_zh": "設置機車待轉區",
            "detail_en": (
                f"Motorcycles represent {moto_ratio*100:.1f}% of all traffic. "
                "A dedicated motorcycle advance stop line or waiting box "
                "would reduce mixed-traffic conflicts at the intersection."
            ),
            "detail_zh": (
                f"機車佔所有車流 {moto_ratio*100:.1f}%，"
                "建議於路口設置機車待轉區或停等區，減少人車混流衝突。"
            ),
        })

    # Rule 4: Bus ratio present → optimize bus priority signal
    if bus_ratio >= 0.05:
        recs.append({
            "id": "R4",
            "priority": "medium",
            "icon": "🚌",
            "title_en": "Implement Bus Signal Priority",
            "title_zh": "實施公車號誌優先",
            "detail_en": (
                f"Buses detected account for {bus_ratio*100:.1f}% of flow. "
                "Transit Signal Priority (TSP) can reduce bus delay by up to 20% "
                "and improve schedule reliability."
            ),
            "detail_zh": (
                f"公車佔車流 {bus_ratio*100:.1f}%，"
                "建議導入公車號誌優先系統（TSP），可降低公車延誤達 20%，提升班次準點率。"
            ),
        })

    # Rule 5: Find the busiest direction and recommend adaptive signal
    if line_totals:
        busiest_line = max(
            line_totals.items(),
            key=lambda x: sum(x[1].values())
        )
        lid, lcounts = busiest_line
        total_on_line = sum(lcounts.values())
        recs.append({
            "id": "R5",
            "priority": "medium",
            "icon": "📊",
            "title_en": f"Adaptive Signal for Busiest Approach ({lid})",
            "title_zh": f"最繁忙方向（{lid}）適應性號誌控制",
            "detail_en": (
                f"Line {lid} recorded the highest crossing count ({total_on_line} vehicles). "
                "Deploying an adaptive traffic control system (ATCS) on this approach "
                "can dynamically balance green time allocation."
            ),
            "detail_zh": (
                f"{lid} 方向記錄最高通過車輛數（{total_on_line} 輛），"
                "建議於此方向部署適應性號誌控制系統（ATCS），動態分配綠燈時間。"
            ),
        })

    # Rule 6: Low congestion → no immediate action
    if overall_index < 30:
        recs.append({
            "id": "R6",
            "priority": "low",
            "icon": "✅",
            "title_en": "Traffic Flow is Normal",
            "title_zh": "車流狀況正常",
            "detail_en": (
                "Current congestion index is low. No immediate intervention required. "
                "Continue routine monitoring."
            ),
            "detail_zh": (
                "目前壅塞指數偏低，無需立即介入，維持例行監控即可。"
            ),
        })

    return recs


# ── Main analysis function ────────────────────────────────────────────────────

def analyze(raw_path: str, output_path: str):
    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    timeline       = raw["timeline"]           # {minute_str: {category: count}}
    minute_counts  = raw["minute_counts"]      # {minute_str: {line_id: {cat: count}}}
    line_totals    = raw["line_totals"]        # {line_id: {category: count}}
    total_by_cat   = raw["total_by_category"]  # {category: count}
    duration_mins  = raw["duration_minutes"]
    counting_lines = raw["counting_lines"]

    # ── Per-minute weighted volume & congestion index ──────────────────────────
    minute_weighted = {
        m: weighted_volume(counts)
        for m, counts in timeline.items()
    }
    max_weighted = max(minute_weighted.values(), default=1)

    congestion_timeline = []
    peak_minute_str = max(minute_weighted, key=minute_weighted.get, default="0")
    peak_minute_int = int(peak_minute_str)

    for m_str in sorted(timeline.keys(), key=int):
        m = int(m_str)
        wv = minute_weighted[m_str]
        idx = compute_congestion_index(wv, max_weighted)
        period = classify_time_period(m)
        congestion_timeline.append({
            "minute": m,
            "real_time": period["real_time"],
            "period_en": period["label_en"],
            "period_zh": period["label_zh"],
            "congestion_index": idx,
            "congestion_level": congestion_level(idx),
            "counts": timeline[m_str],
            "weighted_volume": round(wv, 2),
        })

    # ── Overall congestion index ───────────────────────────────────────────────
    total_vehicles = sum(total_by_cat.values())
    overall_wv = weighted_volume(total_by_cat)
    # Scale: assume 50 vehicles/min weighted is "100% congested" for full period
    overall_index = compute_congestion_index(
        overall_wv / max(duration_mins, 1),
        max_weighted
    )

    # ── Per-line congestion ────────────────────────────────────────────────────
    line_analysis = []
    for line in counting_lines:
        lid = line["id"]
        lcounts = line_totals.get(lid, {})
        lwv = weighted_volume(lcounts)
        lidx = compute_congestion_index(lwv / max(duration_mins, 1), max_weighted)
        line_analysis.append({
            **line,
            "total_vehicles": sum(lcounts.values()),
            "counts_by_category": lcounts,
            "weighted_volume": round(lwv, 2),
            "congestion_index": lidx,
            "congestion_level": congestion_level(lidx),
        })

    # ── Recommendations ────────────────────────────────────────────────────────
    peak_counts = timeline.get(peak_minute_str, {})
    recommendations = generate_recommendations(
        overall_index,
        peak_minute_int,
        peak_counts,
        line_totals,
        total_by_cat,
        duration_mins,
    )

    # ── Assemble final dashboard data ──────────────────────────────────────────
    dashboard_data = {
        "meta": {
            "duration_minutes": duration_mins,
            "total_vehicles": total_vehicles,
            "overall_congestion_index": round(overall_index, 1),
            "overall_congestion_level": congestion_level(overall_index),
            "peak_minute": peak_minute_int,
            "peak_real_time": classify_time_period(peak_minute_int)["real_time"],
            "peak_vehicles": sum(peak_counts.values()),
        },
        "total_by_category": total_by_cat,
        "counting_lines": line_analysis,
        "congestion_timeline": congestion_timeline,
        "recommendations": recommendations,
        "video_info": raw["video_info"],
    }

    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dashboard_data, f, indent=2, ensure_ascii=False)

    print(f"✅ Analysis complete. Dashboard data saved to {out_path}")
    print(f"   Total vehicles : {total_vehicles}")
    print(f"   Congestion index: {overall_index:.1f}/100  ({congestion_level(overall_index)['label_en']})")
    print(f"   Recommendations : {len(recommendations)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Traffic analysis & recommendation engine")
    parser.add_argument("--input",  default="pipeline/tracking_raw.json", help="Raw tracking JSON")
    parser.add_argument("--output", default="dashboard/data/traffic_data.json", help="Output dashboard JSON")
    args = parser.parse_args()
    analyze(args.input, args.output)
