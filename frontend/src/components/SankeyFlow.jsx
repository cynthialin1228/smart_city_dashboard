/**
 * SankeyFlow.jsx  –  Cross-shaped Water-Pipe Flow Chart
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure SVG, no D3 dependency.
 *
 * Layout (十字形 cross)
 *
 *              ┌── C (↓) ──┐
 *              │  cyan     │
 *   ┌─ A (→) ──┼───────────┼── B (←) ─┐
 *   │  green   │   cross   │  orange   │
 *   └──────────┼───────────┼───────────┘
 *              │  D (↑)    │
 *              │  amber    │
 *              └───────────┘
 *
 * Pipe width scales proportionally to PCU in the 30-second window.
 * Min width = 6px, max width = 48px.
 * Animated flow dots travel along each pipe.
 *
 * Props
 * ─────
 *   pcuWindow   { A, B, C, D }  PCU in sliding window
 *   lineCounts  { A: {"+1": n, "-1": m}, … }  cumulative counts
 */

import { useMemo } from 'react';

const W = 340;   // SVG viewport width
const H = 260;   // SVG viewport height
const CX = W / 2;
const CY = H / 2;

// intersection box half-size
const BOX = 28;

// color per line
const LINE_CFG = {
  A: { color: '#39ff14', label: 'A  Straight',  icon: '→' },
  B: { color: '#ff6b35', label: 'B  Opposite',  icon: '←' },
  C: { color: '#c84bff', label: 'C  Cross ↓',   icon: '↓' },
  D: { color: '#ffb300', label: 'D  Cross ↑',   icon: '↑' },
};

// normalise PCU to pipe width
function pipeW(pcu, maxPcu) {
  const t = maxPcu > 0 ? pcu / maxPcu : 0;
  return 6 + t * 42;  // 6 – 48 px
}

// animated flow dots definition
function FlowDots({ x1, y1, x2, y2, color, pipeWidth, id }) {
  const dur  = Math.max(0.8, 2.5 - pipeWidth / 25);  // faster = busier
  const dots = [0, 0.33, 0.66];
  return (
    <>
      {dots.map((offset, i) => (
        <circle key={i} r={Math.max(2, pipeWidth / 8)} fill="#ffffffcc">
          <animateMotion
            dur={`${dur}s`}
            repeatCount="indefinite"
            begin={`${-offset * dur}s`}
          >
            <mpath href={`#pipe-${id}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

export default function SankeyFlow({ pcuWindow = {}, lineCounts = {} }) {
  const maxPcu = useMemo(
    () => Math.max(1, ...Object.values(pcuWindow)),
    [pcuWindow]
  );

  // pipe widths
  const pw = {
    A: pipeW(pcuWindow.A ?? 0, maxPcu),
    B: pipeW(pcuWindow.B ?? 0, maxPcu),
    C: pipeW(pcuWindow.C ?? 0, maxPcu),
    D: pipeW(pcuWindow.D ?? 0, maxPcu),
  };

  // pipe paths (from edge → intersection box)
  const pipes = {
    A: { x1: 8,       y1: CY,     x2: CX - BOX, y2: CY      },   // left → centre
    B: { x1: W - 8,   y1: CY,     x2: CX + BOX, y2: CY      },   // right → centre
    C: { x1: CX,      y1: 8,      x2: CX,       y2: CY - BOX },  // top → centre
    D: { x1: CX,      y1: H - 8,  x2: CX,       y2: CY + BOX },  // bottom → centre
  };

  // cumulative totals text
  const total = (key) => {
    const c = lineCounts[key];
    if (!c) return '0';
    return String((c['+1'] ?? 0) + (c['-1'] ?? 0));
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Title */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
        <span className="text-[10px] text-slate-500 uppercase tracking-widest">
          Cross-Intersection Flow
        </span>
        <span className="text-[10px] text-slate-600">30 s window</span>
      </div>

      {/* SVG */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="flex-1 w-full"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* pipe path definitions (referenced by animateMotion) */}
          {Object.entries(pipes).map(([key, p]) => (
            <path
              key={key}
              id={`pipe-${key}`}
              d={`M ${p.x1} ${p.y1} L ${p.x2} ${p.y2}`}
            />
          ))}

          {/* glow filters */}
          {Object.entries(LINE_CFG).map(([key, cfg]) => (
            <filter key={key} id={`glow-${key}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
        </defs>

        {/* ── pipes ───────────────────────────────────────────────────── */}
        {Object.entries(pipes).map(([key, p]) => {
          const cfg   = LINE_CFG[key];
          const width = pw[key];
          return (
            <g key={key}>
              {/* pipe body */}
              <line
                x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
                stroke={cfg.color + '33'}
                strokeWidth={width + 4}
                strokeLinecap="round"
              />
              <line
                x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
                stroke={cfg.color}
                strokeWidth={width}
                strokeLinecap="round"
                filter={`url(#glow-${key})`}
                style={{ transition: 'stroke-width 0.6s ease' }}
              />
              {/* animated flow dots */}
              {width > 8 && (
                <FlowDots {...p} color={cfg.color} pipeWidth={width} id={key} />
              )}
            </g>
          );
        })}

        {/* ── intersection box ────────────────────────────────────────── */}
        <rect
          x={CX - BOX} y={CY - BOX}
          width={BOX * 2} height={BOX * 2}
          rx={6}
          fill="#0a1628"
          stroke="#00f5ff33"
          strokeWidth={1.5}
        />
        <text x={CX} y={CY + 5} textAnchor="middle"
              fill="#00f5ff66" fontSize={10} fontFamily="monospace">
          ✦
        </text>

        {/* ── labels & PCU badges ─────────────────────────────────────── */}

        {/* A — left */}
        <g>
          <text x={16} y={CY - pw.A / 2 - 5}
                fill={LINE_CFG.A.color} fontSize={11} fontFamily="monospace" fontWeight="bold">
            {LINE_CFG.A.icon} A
          </text>
          <text x={16} y={CY + pw.A / 2 + 14}
                fill={LINE_CFG.A.color + 'aa'} fontSize={9} fontFamily="monospace">
            {(pcuWindow.A ?? 0).toFixed(1)} PCU · {total('A')} veh
          </text>
        </g>

        {/* B — right */}
        <g>
          <text x={W - 16} y={CY - pw.B / 2 - 5}
                fill={LINE_CFG.B.color} fontSize={11} fontFamily="monospace" fontWeight="bold"
                textAnchor="end">
            B {LINE_CFG.B.icon}
          </text>
          <text x={W - 16} y={CY + pw.B / 2 + 14}
                fill={LINE_CFG.B.color + 'aa'} fontSize={9} fontFamily="monospace"
                textAnchor="end">
            {(pcuWindow.B ?? 0).toFixed(1)} PCU · {total('B')} veh
          </text>
        </g>

        {/* C — top */}
        <g>
          <text x={CX + pw.C / 2 + 5} y={20}
                fill={LINE_CFG.C.color} fontSize={11} fontFamily="monospace" fontWeight="bold">
            C {LINE_CFG.C.icon}
          </text>
          <text x={CX + pw.C / 2 + 5} y={34}
                fill={LINE_CFG.C.color + 'aa'} fontSize={9} fontFamily="monospace">
            {(pcuWindow.C ?? 0).toFixed(1)} · {total('C')}
          </text>
        </g>

        {/* D — bottom */}
        <g>
          <text x={CX + pw.D / 2 + 5} y={H - 20}
                fill={LINE_CFG.D.color} fontSize={11} fontFamily="monospace" fontWeight="bold">
            D {LINE_CFG.D.icon}
          </text>
          <text x={CX + pw.D / 2 + 5} y={H - 7}
                fill={LINE_CFG.D.color + 'aa'} fontSize={9} fontFamily="monospace">
            {(pcuWindow.D ?? 0).toFixed(1)} · {total('D')}
          </text>
        </g>
      </svg>

      {/* ── Bottom legend row ──────────────────────────────────────────── */}
      <div className="flex justify-around px-3 pb-2 shrink-0">
        {Object.entries(LINE_CFG).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1 text-[10px]"
               style={{ color: cfg.color }}>
            <span className="w-2 h-2 rounded-full inline-block"
                  style={{ background: cfg.color, boxShadow: `0 0 4px ${cfg.color}` }} />
            {key}: {(pcuWindow[key] ?? 0).toFixed(1)}
          </div>
        ))}
      </div>
    </div>
  );
}
