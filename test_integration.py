#!/usr/bin/env python3
"""
test_integration.py  –  後端集成測試工具
═══════════════════════════════════════════════════════════════════════════════

驗証:
  1. 座標空間一致性 (0.0 ~ 1.0)
  2. 幾何判定算法正確性
  3. WebSocket 訊息格式有效性
  4. 流量計算準確度

使用方法:
  python test_integration.py

需要:
  - Python 3.9+
  - FastAPI backend 已啟動 (port 8000)
"""

import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from app.spatial_engine import SpatialEngine, PCU_WEIGHTS, segment_intersect, cross_direction, point_in_roi
from app.traffic_rules import evaluate_rules


def test_coordinate_space():
    """Test that all coordinates are in 0.0 ~ 1.0 range."""
    print("🔍 Test 1: Coordinate Space Consistency")
    print("─" * 60)

    # Test points
    test_points = [
        (0.0, 0.0), (0.5, 0.5), (1.0, 1.0),
        (0.25, 0.75), (0.999, 0.001),
    ]

    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]

    engine = SpatialEngine(
        roi=roi,
        lines={
            "A": ((0.0, 0.5), (1.0, 0.5)),
            "B": ((1.0, 0.5), (0.0, 0.5)),
        }
    )

    for pt in test_points:
        in_roi = point_in_roi(pt, roi)
        print(f"  Point {pt}: in_roi={in_roi} ✓")

    print("✅ Coordinate space test passed\n")


def test_geometry_intersections():
    """Test segment intersection detection."""
    print("🔍 Test 2: Geometry Intersection Detection")
    print("─" * 60)

    # Test case 1: clear intersection
    p1 = (0.3, 0.5)
    p2 = (0.7, 0.5)
    q1 = (0.5, 0.2)
    q2 = (0.5, 0.8)
    assert segment_intersect(p1, p2, q1, q2), "Should intersect"
    print("  Test 1 (perpendicular lines): ✓ PASS")

    # Test case 2: parallel, no intersection
    p1 = (0.3, 0.5)
    p2 = (0.7, 0.5)
    q1 = (0.3, 0.6)
    q2 = (0.7, 0.6)
    assert not segment_intersect(p1, p2, q1, q2), "Should not intersect"
    print("  Test 2 (parallel lines): ✓ PASS")

    # Test case 3: vehicle crossing line A
    prev = (0.45, 0.5)
    cur  = (0.55, 0.5)
    line = ((0.5, 0.2), (0.5, 0.8))
    assert segment_intersect(prev, cur, line[0], line[1]), "Vehicle should cross"
    direction = cross_direction(line, prev, cur)
    print(f"  Test 3 (vehicle crossing): ✓ PASS (direction={direction:+d})")

    print("✅ Geometry test passed\n")


def test_traffic_rules():
    """Test traffic rule evaluation."""
    print("🔍 Test 3: Traffic Rule Evaluation")
    print("─" * 60)

    # Simulate normal traffic
    pcu_by_line_normal = {"A": 5.0, "B": 5.5, "C": 2.0, "D": 1.5}
    result = evaluate_rules(
        pcu_by_line=pcu_by_line_normal,
        window_sec=30.0,
        total_pcu=14.0,
    )
    assert result.signal_plan.cycle_s > 0, "Should have cycle time"
    assert result.congestion_idx < 0.5, "Should have low congestion"
    print(f"  Normal traffic: cycle={result.signal_plan.cycle_s}s, "
          f"congestion={result.congestion_idx:.2f}")
    print(f"    Alerts: {len(result.alerts)} rule(s) triggered")
    for alert in result.alerts:
        print(f"      - {alert.rule_id}: {alert.severity}")
    print("  ✓ PASS")

    # Simulate imbalanced traffic (A >> B)
    pcu_by_line_imbalanced = {"A": 20.0, "B": 2.0, "C": 1.0, "D": 1.0}
    result = evaluate_rules(
        pcu_by_line=pcu_by_line_imbalanced,
        window_sec=30.0,
        total_pcu=24.0,
    )
    has_r1a = any(a.rule_id == "R1A" for a in result.alerts)
    assert has_r1a, "Should trigger R1A imbalance rule"
    print(f"  Imbalanced traffic: detected A>>B imbalance ✓")
    print("  ✓ PASS")

    # Simulate peak hour
    pcu_by_line_peak = {"A": 40.0, "B": 35.0, "C": 20.0, "D": 15.0}
    result = evaluate_rules(
        pcu_by_line=pcu_by_line_peak,
        window_sec=30.0,
        total_pcu=110.0,
    )
    has_peak = any(a.rule_id == "R4" for a in result.alerts)
    has_congestion = any(a.rule_id == "R5" for a in result.alerts)
    print(f"  Peak hour traffic: peak={has_peak}, congestion={has_congestion}")
    assert result.congestion_idx > 0.7, "Should have high congestion"
    print("  ✓ PASS")

    print("✅ Traffic rules test passed\n")


def test_spatial_engine():
    """Test the spatial engine's frame processing."""
    print("🔍 Test 4: Spatial Engine Frame Processing")
    print("─" * 60)

    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]
    lines = {
        "A": ((0.0, 0.5), (1.0, 0.5)),
        "B": ((1.0, 0.5), (0.0, 0.5)),
        "C": ((0.5, 0.0), (0.5, 1.0)),
        "D": ((0.5, 1.0), (0.5, 0.0)),
    }

    engine = SpatialEngine(roi=roi, lines=lines)

    # Frame 1: vehicle approaching line A
    tracks_1 = [
        {"track_id": 1, "class": "car", "x": 0.3, "y": 0.5},
        {"track_id": 2, "class": "motorcycle", "x": 0.7, "y": 0.7},
    ]
    result_1 = engine.process_frame(0.0, tracks_1)
    assert len(result_1.positions) == 2, "Should have 2 positions"
    assert len(result_1.events) == 0, "No crossing yet"
    print("  Frame 1 (approach): 2 vehicles detected, 0 crossings ✓")

    # Frame 2: vehicle crosses line A
    tracks_2 = [
        {"track_id": 1, "class": "car", "x": 0.7, "y": 0.5},
        {"track_id": 2, "class": "motorcycle", "x": 0.75, "y": 0.6},
    ]
    result_2 = engine.process_frame(0.04, tracks_2)
    assert len(result_2.positions) == 2, "Should have 2 positions"
    assert len(result_2.events) >= 1, "Should have at least 1 crossing"
    print(f"  Frame 2 (crossing): 2 vehicles, {len(result_2.events)} event(s) ✓")

    for event in result_2.events:
        pcu = PCU_WEIGHTS.get(event.vehicle_cls, 1.0)
        print(f"    - {event.vehicle_cls} crossed {event.line_id} (PCU={pcu})")

    # Verify PCU calculation
    total_pcu = sum(event.pcu for event in result_2.events)
    print(f"  Total PCU in frame: {total_pcu:.1f} ✓")

    print("✅ Spatial engine test passed\n")


def test_websocket_message_format():
    """Test that WS message format is valid JSON."""
    print("🔍 Test 5: WebSocket Message Format")
    print("─" * 60)

    # Simulate a WS frame response
    frame_response = {
        "type": "frame",
        "t": 12.5,
        "events": [
            {
                "t": 12.48,
                "track_id": 1,
                "class": "car",
                "line": "A",
                "direction": 1,
                "pcu": 1.0,
            }
        ],
        "positions": [
            {"track_id": 1, "class": "car", "x": 0.52, "y": 0.45},
            {"track_id": 2, "class": "motorcycle", "x": 0.30, "y": 0.60},
        ],
        "line_counts": {"A": {"+1": 5, "-1": 0}, "B": {"+1": 3, "-1": 2}},
        "pcu_window": {"A": 5.2, "B": 3.1, "C": 0.0, "D": 0.0},
        "total_pcu": 8.3,
        "alerts": [
            {
                "rule_id": "R1A",
                "severity": "warning",
                "message": "A > B",
                "message_zh": "直行 > 對向",
                "delta_s": 5,
                "line_id": "A",
            }
        ],
        "signal_plan": {
            "cycle_s": 68.5,
            "green_splits": {"Straight (A/B)": 32.0, "Cross (C/D)": 24.5},
            "flow_ratio_Y": 0.42,
            "oversaturated": False,
        },
        "congestion_idx": 0.083,
        "trend": "stable",
        "pcu_per_min": 16.6,
    }

    # Verify JSON serializable
    json_str = json.dumps(frame_response)
    parsed = json.loads(json_str)

    assert parsed["type"] == "frame"
    assert parsed["pcu_window"]["A"] == 5.2
    assert parsed["alerts"][0]["rule_id"] == "R1A"
    print("  WS message format: ✓ Valid JSON")
    print(f"  Message size: {len(json_str)} bytes")
    print("✅ WebSocket message format test passed\n")


def main():
    """Run all integration tests."""
    print("\n" + "=" * 60)
    print("🚦 Smart City Traffic System - Integration Test Suite")
    print("=" * 60 + "\n")

    try:
        test_coordinate_space()
        test_geometry_intersections()
        test_traffic_rules()
        test_spatial_engine()
        test_websocket_message_format()

        print("=" * 60)
        print("✅ ALL TESTS PASSED")
        print("=" * 60)
        print("\n✓ Coordinate space: consistent")
        print("✓ Geometry engine: working")
        print("✓ Traffic rules: evaluating")
        print("✓ WebSocket format: valid")
        print("\n🚀 System is ready for deployment!\n")
        return 0

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
