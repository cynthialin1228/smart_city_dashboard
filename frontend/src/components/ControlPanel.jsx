/**
 * ControlPanel.jsx  –  號誌專家控制面板
 * ─────────────────────────────────────────────────────────────────────────────
 * Sections
 *   1. Alert Cards  — Rule-based recommendations, sorted highest severity first
 *   2. Signal Plan  — Webster-optimised cycle + green-time bar chart
 *   3. Stats Row    — Total PCU, congestion %, trend, PCU/min
 *   4. Timeline     — Sparkline of per-line PCU rate (from /api/summary)
 *
 * Props
 * ─────
 *   alerts      list[Alert]    from WS frame
 *   signalPlan  SignalPlan     from WS frame
 *   pcuWindow   { A,B,C,D }   PCU in 30 s window
 *   congestion  float 0-1
 *   trend       "rising"|"stable"|"falling"
 *   summary     /api/summary  response (timeline + totals)
 */

import { useMemo, useRef, useEffect } from 'react';

// severity → visual style
const SEV = {
  alert:   { bg: 'bg-red-950/60',   border: 'border-red-700/60',   dot: 'bg-red-500',   text: 'text-red-300'   },
  warning: { bg: 'bg-amber-950/60', border: 'border-amber-700/60', dot: 'bg-amber-400',  text: 'text-amber-300' },
  info:    { bg: 'bg-slate-900/60', border: 'border-slate-700/60', dot: 'bg-cyan-400',   text: 'text-slate-300' },
};

const LINE_COLOR = { A: '#39ff14', B: '#ff6b35', C: '#c84bff', D: '#ffb300' };

// ── Mini sparkline ────────────────────────────────────────────────────────────
function Sparkline({ data, color, height = 32, width = 80 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const max = Math.max(1, ...data);
    const pts = data.map((v, i) => [
      (i / (data.length - 1)) * width,
      height - (v / max) * (height - 2) - 1,
    ]);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    // fill under line
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = color + '22';
    ctx.fill();
  }, [data, color, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} />;
}

// ── Signal plan phase bar ─────────────────────────────────────────────────────
function PhaseBar({ label, greenS, cycleS, color }) {
  const pct = cycleS > 0 ? (greenS / cycleS) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-20 text-right text-slate-500 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden relative">
        <div
          className="h-full rounded transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}99, ${color})`,
            boxShadow:  `0 0 6px ${color}66`,
          }}
        />
        <span className="absolute inset-0 flex items-center justify-center
                         text-[9px] font-bold text-white/80">
          {greenS.toFixed(0)}s
        </span>
      </div>
      <span style={{ color }} className="w-8 text-right shrink-0 font-bold">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ControlPanel({
  alerts     = [],
  signalPlan = null,
  pcuWindow  = {},
  congestion = 0,
  trend      = 'stable',
  summary    = null,
}) {
  // Build sparkline data from summary timeline
  const sparklines = useMemo(() => {
    if (!summary?.timeline) return {};
    const out = {};
    ['A', 'B', 'C', 'D'].forEach(key => {
      out[key] = summary.timeline.map(pt => pt.pcu_rate?.[key] ?? 0);
    });
    return out;
  }, [summary]);

  const TREND_STYLE = {
    rising:  'text-red-400',
    stable:  'text-green-400',
    falling: 'text-blue-400',
  };
  const TREND_LABEL = { rising: '↑ Rising', stable: '→ Stable', falling: '↓ Falling' };

  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-300 font-mono">

      {/* ── Section title ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0
                      border-b border-slate-800">
        <span className="text-[10px] text-slate-500 uppercase tracking-widest">
          Signal Optimisation Console
        </span>
        <span className={`text-[10px] font-bold ${TREND_STYLE[trend]}`}>
          {TREND_LABEL[trend]}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden gap-2 p-2">

        {/* ── LEFT: Alerts ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5 w-[52%] overflow-y-auto pr-1">
          <p className="text-[9px] text-slate-600 uppercase tracking-widest shrink-0 mb-0.5">
            Rule Engine Alerts
          </p>

          {alerts.length === 0 && (
            <div className="text-[10px] text-slate-600 italic p-2">
              Awaiting data…
            </div>
          )}

          {alerts.map((alert, i) => {
            const s = SEV[alert.severity] ?? SEV.info;
            return (
              <div
                key={`${alert.rule_id}-${i}`}
                className={`rounded border px-2 py-1.5 ${s.bg} ${s.border}
                            transition-all duration-300`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${s.text}`}>
                    {alert.severity}  ·  {alert.rule_id}
                  </span>
                  {alert.delta_s != null && (
                    <span className="ml-auto text-[9px] text-cyan-400 font-bold">
                      Δ {alert.delta_s > 0 ? '+' : ''}{alert.delta_s}s
                    </span>
                  )}
                </div>
                {/* Chinese message */}
                <p className="text-[10px] text-slate-300 leading-relaxed">
                  {alert.message_zh}
                </p>
              </div>
            );
          })}
        </div>

        {/* ── RIGHT: Signal plan + sparklines ───────────────────────── */}
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto min-w-0">

          {/* Signal plan */}
          {signalPlan && (
            <div className="rounded border border-slate-800 bg-[#050a14] p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] text-slate-500 uppercase tracking-widest">
                  Webster Optimal Cycle
                </span>
                <span className={`text-[10px] font-bold ${
                  signalPlan.oversaturated ? 'text-red-400' : 'text-cyan-400'
                }`}>
                  {signalPlan.oversaturated ? '⚠ OVERSATURATED' : `${signalPlan.cycle_s}s`}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {Object.entries(signalPlan.green_splits).map(([phase, g]) => (
                  <PhaseBar
                    key={phase}
                    label={phase.length > 10 ? phase.slice(0, 10) + '…' : phase}
                    greenS={g}
                    cycleS={signalPlan.cycle_s}
                    color={phase.includes('Straight') ? LINE_COLOR.A : LINE_COLOR.C}
                  />
                ))}
              </div>
              <div className="mt-1.5 text-[9px] text-slate-600 text-right">
                Y = {signalPlan.flow_ratio_Y.toFixed(3)}
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: 'A  PCU/30s', val: (pcuWindow.A ?? 0).toFixed(1), color: LINE_COLOR.A },
              { label: 'B  PCU/30s', val: (pcuWindow.B ?? 0).toFixed(1), color: LINE_COLOR.B },
              { label: 'C  PCU/30s', val: (pcuWindow.C ?? 0).toFixed(1), color: LINE_COLOR.C },
              { label: 'D  PCU/30s', val: (pcuWindow.D ?? 0).toFixed(1), color: LINE_COLOR.D },
            ].map(({ label, val, color }) => (
              <div key={label}
                   className="rounded border border-slate-800 bg-[#050a14] px-2 py-1">
                <p className="text-[8px] text-slate-600 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-bold" style={{ color }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Sparklines */}
          {Object.keys(sparklines).length > 0 && (
            <div className="rounded border border-slate-800 bg-[#050a14] p-2">
              <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-1.5">
                60-s PCU Rate History
              </p>
              <div className="grid grid-cols-2 gap-2">
                {['A', 'B', 'C', 'D'].map(key => (
                  sparklines[key]?.length > 1 && (
                    <div key={key} className="flex flex-col gap-0.5">
                      <span className="text-[8px]" style={{ color: LINE_COLOR[key] }}>
                        Line {key}
                      </span>
                      <Sparkline
                        data={sparklines[key]}
                        color={LINE_COLOR[key]}
                        width={90} height={28}
                      />
                    </div>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
