"""
traffic_rules.py
═══════════════════════════════════════════════════════════════════════════════
Rule-based traffic signal optimisation advisor.

Input
─────
  pcu_by_line   { line_id → PCU count in the sliding window }
  window_sec    length of the window in seconds
  total_pcu     sum of all PCU in the window
  pcu_history   optional list of (timestamp, total_pcu) tuples for trend analysis

Output
──────
  RuleResult dataclass containing:
    alerts          list[Alert]   – ordered highest → lowest severity
    signal_plan     SignalPlan    – Webster-optimised cycle + green splits
    congestion_idx  float 0–1    – normalised congestion score
    trend           str          – "rising" | "stable" | "falling"

Rules
─────
  R0  All-clear
  R1  A/B directional imbalance  → extend dominant direction green
  R2  C/D cross-direction imbalance  → extend dominant cross green
  R3  Left-turn surge  → add exclusive left-turn phase
  R4  Peak-hour / near-peak advisory
  R5  Congestion threshold breach
  R6  Rising trend warning  (based on recent PCU history slope)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

# ── severity ──────────────────────────────────────────────────────────────────
INFO    = "info"
WARNING = "warning"
ALERT   = "alert"

_SEVERITY_RANK = {INFO: 0, WARNING: 1, ALERT: 2}

# Webster saturation flow (PCU/hr per lane) and lost-time constant
_SAT_FLOW  = 1800.0
_LOST_TIME = 12.0      # total lost time per cycle (seconds)
_MIN_CYCLE = 40.0
_MAX_CYCLE = 120.0
_MIN_GREEN = 7.0


# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Alert:
    rule_id:    str
    severity:   str           # INFO | WARNING | ALERT
    message:    str           # English
    message_zh: str           # 繁中
    delta_s:    Optional[int] = None   # suggested Δ green seconds
    line_id:    Optional[str] = None   # which line triggered this

    def to_dict(self) -> dict:
        d = {
            "rule_id":    self.rule_id,
            "severity":   self.severity,
            "message":    self.message,
            "message_zh": self.message_zh,
        }
        if self.delta_s is not None:
            d["delta_s"] = self.delta_s
        if self.line_id is not None:
            d["line_id"] = self.line_id
        return d


@dataclass
class SignalPlan:
    """Webster-optimised signal timing."""
    cycle_s:      float               # optimal cycle length (s)
    green_splits: dict[str, float]    # { phase_name → green seconds }
    flow_ratio_Y: float               # sum of critical flow ratios
    oversaturated: bool               # Y ≥ 0.95

    def to_dict(self) -> dict:
        return {
            "cycle_s":       round(self.cycle_s, 1),
            "green_splits":  {k: round(v, 1) for k, v in self.green_splits.items()},
            "flow_ratio_Y":  round(self.flow_ratio_Y, 3),
            "oversaturated": self.oversaturated,
        }


@dataclass
class RuleResult:
    alerts:         list[Alert]
    signal_plan:    SignalPlan
    congestion_idx: float         # 0.0 – 1.0
    trend:          str           # "rising" | "stable" | "falling"
    pcu_per_min:    float

    def to_dict(self) -> dict:
        return {
            "alerts":         [a.to_dict() for a in self.alerts],
            "signal_plan":    self.signal_plan.to_dict(),
            "congestion_idx": round(self.congestion_idx, 3),
            "trend":          self.trend,
            "pcu_per_min":    round(self.pcu_per_min, 1),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Webster optimal cycle
# ─────────────────────────────────────────────────────────────────────────────

def _webster(
    critical_flows_pcu_hr: list[float],
    phase_names: list[str],
) -> SignalPlan:
    """
    Webster (1958) formula for optimal signal cycle.

    critical_flows_pcu_hr: peak flow for each phase in PCU/hr
    Returns a SignalPlan; sets oversaturated=True if Y ≥ 0.95.
    """
    Y = sum(f / _SAT_FLOW for f in critical_flows_pcu_hr)
    oversaturated = Y >= 0.95

    if oversaturated:
        # use max cycle as fallback, split equally
        cycle = _MAX_CYCLE
        g_each = (_MAX_CYCLE - _LOST_TIME) / max(len(phase_names), 1)
        splits = {n: round(g_each, 1) for n in phase_names}
        return SignalPlan(cycle_s=cycle, green_splits=splits,
                         flow_ratio_Y=round(Y, 3), oversaturated=True)

    # Webster: C = (1.5L + 5) / (1 − Y)
    C = (1.5 * _LOST_TIME + 5) / (1 - Y)
    C = max(_MIN_CYCLE, min(_MAX_CYCLE, C))

    g_total = C - _LOST_TIME
    splits: dict[str, float] = {}
    for name, flow in zip(phase_names, critical_flows_pcu_hr):
        yi = flow / _SAT_FLOW
        g = g_total * (yi / Y) if Y > 0 else g_total / len(phase_names)
        splits[name] = max(_MIN_GREEN, round(g, 1))

    return SignalPlan(
        cycle_s=round(C, 1),
        green_splits=splits,
        flow_ratio_Y=round(Y, 3),
        oversaturated=False,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Trend detection
# ─────────────────────────────────────────────────────────────────────────────

def _detect_trend(
    history: list[tuple[float, float]],   # [(t_sec, total_pcu_in_window)]
    lookback: int = 5,
) -> str:
    """
    Simple linear regression slope over the last `lookback` snapshots.
    Returns "rising" | "stable" | "falling".
    """
    if len(history) < 3:
        return "stable"
    recent = history[-lookback:]
    n = len(recent)
    xs = [h[0] for h in recent]
    ys = [h[1] for h in recent]
    x_mean = sum(xs) / n
    y_mean = sum(ys) / n
    num = sum((xs[i] - x_mean) * (ys[i] - y_mean) for i in range(n))
    den = sum((xs[i] - x_mean) ** 2 for i in range(n))
    if den < 1e-9:
        return "stable"
    slope = num / den   # PCU per second
    if slope > 0.08:
        return "rising"
    if slope < -0.08:
        return "falling"
    return "stable"


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_rules(
    pcu_by_line: dict[str, float],
    window_sec:  float = 30.0,
    total_pcu:   float = 0.0,
    pcu_history: Optional[list[tuple[float, float]]] = None,
) -> RuleResult:
    """
    Evaluate all rules and return a RuleResult.

    Parameters
    ──────────
    pcu_by_line  { line_id → accumulated PCU in the window }
    window_sec   window duration in seconds
    total_pcu    sum of all PCU in the window
    pcu_history  [(timestamp, total_pcu), ...] for trend analysis
    """
    alerts: list[Alert] = []

    # ── derived metrics ───────────────────────────────────────────────────
    pcu_per_min = (total_pcu / window_sec) * 60.0 if window_sec > 0 else 0.0
    congestion_idx = min(1.0, total_pcu / 100.0)   # normalised: saturated at 100 PCU/30 s

    a_pcu = pcu_by_line.get("A", 0.0)
    b_pcu = pcu_by_line.get("B", 0.0)
    c_pcu = pcu_by_line.get("C", 0.0)
    d_pcu = pcu_by_line.get("D", 0.0)

    # convert window PCU → PCU/hr for Webster (scale: 3600 / window_sec)
    scale = 3600.0 / window_sec if window_sec > 0 else 120.0
    a_hr = a_pcu * scale
    b_hr = b_pcu * scale
    c_hr = c_pcu * scale
    d_hr = d_pcu * scale

    # ── R1 A/B imbalance ─────────────────────────────────────────────────
    if a_pcu > 1 or b_pcu > 1:
        if a_pcu >= 2.0 * max(b_pcu, 0.1):
            delta = min(12, max(4, int((a_pcu / max(b_pcu, 0.5)) * 3)))
            alerts.append(Alert(
                rule_id="R1A", severity=WARNING, line_id="A",
                message=f"Straight flow A ({a_pcu:.1f} PCU) is "
                        f"{a_pcu/max(b_pcu,0.1):.1f}× Opposite B "
                        f"({b_pcu:.1f} PCU).  → Extend A green +{delta}s",
                message_zh=f"直行(A) {a_pcu:.1f} PCU 是對向(B) "
                           f"{b_pcu:.1f} PCU 的 {a_pcu/max(b_pcu,0.1):.1f} 倍，"
                           f"建議延長 A 相位綠燈 +{delta} 秒。",
                delta_s=delta,
            ))
        elif b_pcu >= 2.0 * max(a_pcu, 0.1):
            delta = min(12, max(4, int((b_pcu / max(a_pcu, 0.5)) * 3)))
            alerts.append(Alert(
                rule_id="R1B", severity=WARNING, line_id="B",
                message=f"Opposite flow B ({b_pcu:.1f} PCU) is "
                        f"{b_pcu/max(a_pcu,0.1):.1f}× Straight A "
                        f"({a_pcu:.1f} PCU).  → Extend B green +{delta}s",
                message_zh=f"對向(B) {b_pcu:.1f} PCU 是直行(A) "
                           f"{a_pcu:.1f} PCU 的 {b_pcu/max(a_pcu,0.1):.1f} 倍，"
                           f"建議延長 B 相位綠燈 +{delta} 秒。",
                delta_s=delta,
            ))

    # ── R2 C/D imbalance ─────────────────────────────────────────────────
    if c_pcu > 1 or d_pcu > 1:
        if c_pcu >= 2.0 * max(d_pcu, 0.1):
            delta = min(10, max(3, int(c_pcu / 2.5)))
            alerts.append(Alert(
                rule_id="R2C", severity=WARNING, line_id="C",
                message=f"Cross Dir C ({c_pcu:.1f} PCU) >> D "
                        f"({d_pcu:.1f} PCU).  → Add {delta}s to C-phase",
                message_zh=f"C 方向 ({c_pcu:.1f} PCU) 遠高於 D "
                           f"({d_pcu:.1f} PCU)，建議 C 相位增加 {delta} 秒。",
                delta_s=delta,
            ))
        elif d_pcu >= 2.0 * max(c_pcu, 0.1):
            delta = min(10, max(3, int(d_pcu / 2.5)))
            alerts.append(Alert(
                rule_id="R2D", severity=WARNING, line_id="D",
                message=f"Cross Dir D ({d_pcu:.1f} PCU) >> C "
                        f"({c_pcu:.1f} PCU).  → Add {delta}s to D-phase",
                message_zh=f"D 方向 ({d_pcu:.1f} PCU) 遠高於 C "
                           f"({c_pcu:.1f} PCU)，建議 D 相位增加 {delta} 秒。",
                delta_s=delta,
            ))

    # ── R3 Left-turn surge ───────────────────────────────────────────────
    lateral = c_pcu + d_pcu
    straight = a_pcu + b_pcu
    if lateral > 0 and (lateral + straight) > 0:
        ratio = lateral / (lateral + straight)
        if ratio > 0.45:
            alerts.append(Alert(
                rule_id="R3", severity=ALERT,
                message=f"Left/cross turns = {ratio:.0%} of total flow "
                        f"({lateral:.1f} vs {straight:.1f} PCU).  "
                        "→ Add exclusive 8s left-turn phase",
                message_zh=f"左轉／橫向流量佔 {ratio:.0%} "
                           f"({lateral:.1f} vs {straight:.1f} PCU)，"
                           "建議增加 8 秒專用左轉相位。",
                delta_s=8,
            ))

    # ── R4 Peak-hour ─────────────────────────────────────────────────────
    if pcu_per_min >= 60:
        alerts.append(Alert(
            rule_id="R4", severity=ALERT,
            message=f"⚠ Peak hour detected: {pcu_per_min:.0f} PCU/min.  "
                    "Activate adaptive signal control.",
            message_zh=f"⚠ 尖峰時段：{pcu_per_min:.0f} PCU/分鐘，"
                       "建議啟動自適應號誌控制。",
        ))
    elif pcu_per_min >= 40:
        alerts.append(Alert(
            rule_id="R4b", severity=WARNING,
            message=f"Near-peak traffic: {pcu_per_min:.0f} PCU/min.  "
                    "Monitor for further increase.",
            message_zh=f"流量接近尖峰：{pcu_per_min:.0f} PCU/分鐘，請持續監控。",
        ))

    # ── R5 Congestion ────────────────────────────────────────────────────
    if total_pcu >= 80:
        alerts.append(Alert(
            rule_id="R5", severity=ALERT,
            message=f"🔴 High congestion: {total_pcu:.1f} PCU / "
                    f"{window_sec:.0f}s window.  "
                    "Immediate signal adjustment required.",
            message_zh=f"🔴 嚴重壅塞：{window_sec:.0f} 秒內累計 "
                       f"{total_pcu:.1f} PCU，建議立即調整號誌時制。",
        ))

    # ── R6 Rising trend ──────────────────────────────────────────────────
    trend = _detect_trend(pcu_history or [])
    if trend == "rising" and pcu_per_min > 20:
        alerts.append(Alert(
            rule_id="R6", severity=WARNING,
            message="📈 Traffic volume trending upward.  "
                    "Prepare for peak-hour protocol.",
            message_zh="📈 車流量持續上升，建議預備尖峰時段號誌方案。",
        ))

    # ── sort by severity desc ─────────────────────────────────────────────
    alerts.sort(key=lambda a: _SEVERITY_RANK[a.severity], reverse=True)

    # ── R0 all-clear (only if nothing else fired) ─────────────────────────
    if not alerts:
        alerts.append(Alert(
            rule_id="R0", severity=INFO,
            message="✅ Traffic flow nominal.  No adjustments required.",
            message_zh="✅ 交通流量正常，無需調整。",
        ))

    # ── Webster signal plan ───────────────────────────────────────────────
    # Treat A+B as phase 1 (straight), C+D as phase 2 (cross)
    phase_flows = [max(a_hr, b_hr), max(c_hr, d_hr)]
    signal_plan = _webster(phase_flows, ["Straight (A/B)", "Cross (C/D)"])

    return RuleResult(
        alerts=alerts,
        signal_plan=signal_plan,
        congestion_idx=congestion_idx,
        trend=trend,
        pcu_per_min=pcu_per_min,
    )
