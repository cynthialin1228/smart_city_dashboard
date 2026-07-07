/**
 * Dashboard.jsx  –  戰情室主畫面  (Dashboard Mode)
 * ─────────────────────────────────────────────────────────────────────────────
 * COORDINATE CONTRACT
 * ───────────────────
 * All normalised coordinates (0.0–1.0) refer to the VIDEO IMAGE space, i.e.
 * the letterbox-corrected area returned by useVideoRect / getVideoContentRect.
 *
 * - The overlay canvas (line overlay on the video) is positioned and sized
 *   to exactly cover the video image area (no black bars).
 * - videoRect is passed to ParticleCanvas so it can mirror the same
 *   coordinate space when rendering particles.
 *
 * Layout
 *  ┌─ Header ───────────────────────────────────────────────────────────────┐
 *  ├─ Left 42% ─────────────────┬─ Right 58% ─────────────────────────────┤
 *  │  [Video + line overlay]    │  [Particle Canvas]                      │
 *  │  [SankeyFlow]              │  [ControlPanel]                         │
 *  ├─ TimeScrubber ─────────────────────────────────────────────────────────┤
 *  └────────────────────────────────────────────────────────────────────────┘
 */

import { useRef, useEffect } from 'react';
import ParticleCanvas from './ParticleCanvas';
import SankeyFlow     from './SankeyFlow';
import ControlPanel   from './ControlPanel';
import TimeScrubber   from './TimeScrubber';
import useVideoRect   from '../hooks/useVideoRect';

const LINE_COLOR = { A: '#39ff14', B: '#ff6b35', C: '#c84bff', D: '#ffb300' };

export default function Dashboard({
  videoSrc, videoRef, wsFrame, summary, config,
  currentTime, duration, onReset,
}) {
  const overlayCanvasRef = useRef(null);

  // ── letterbox-corrected video image rect (same hook as TrafficCanvas) ─
  const { rect: videoRect } = useVideoRect(videoRef);

  // ── size + position overlay canvas over the VIDEO IMAGE (no black bars)
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !videoRect || !video) return;

    // Canvas internal resolution = image pixel size
    canvas.width  = Math.round(videoRect.width);
    canvas.height = Math.round(videoRect.height);

    // Position relative to the <video> element's bounding rect
    const elRect = video.getBoundingClientRect();
    canvas.style.position     = 'absolute';
    canvas.style.left         = `${videoRect.left - elRect.left}px`;
    canvas.style.top          = `${videoRect.top  - elRect.top}px`;
    canvas.style.width        = `${videoRect.width}px`;
    canvas.style.height       = `${videoRect.height}px`;
    canvas.style.pointerEvents = 'none';
  }, [videoRect, videoRef]);

  // ── draw counting lines on the overlay canvas ─────────────────────────
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !videoRect) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!config?.lines) return;

    Object.entries(config.lines).forEach(([key, pts]) => {
      if (!pts) return;
      const color = LINE_COLOR[key] ?? '#ffffff';
      const x1 = pts[0][0] * W,  y1 = pts[0][1] * H;
      const x2 = pts[1][0] * W,  y2 = pts[1][1] * H;

      ctx.shadowColor = color;
      ctx.shadowBlur  = 12;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      [[x1, y1], [x2, y2]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      });

      ctx.shadowBlur  = 6;
      ctx.font        = 'bold 12px monospace';
      ctx.fillStyle   = color;
      ctx.fillText(key, x1 + 7, y1 - 7);
      ctx.shadowBlur  = 0;
    });
  }, [videoRect, config]);

  // ── derived metrics ───────────────────────────────────────────────────
  const congestion = wsFrame?.congestion_idx ?? 0;
  const trend      = wsFrame?.trend          ?? 'stable';
  const pcu_min    = wsFrame?.pcu_per_min    ?? 0;
  // Backend sends: line_counts  { A: {"+1": n, "-1": m}, … }
  const lineCounts = wsFrame?.line_counts    ?? {};
  // Backend sends: pcu_window   { A: float, B: float, … }
  const pcuWindow  = wsFrame?.pcu_window     ?? {};

  const TREND_ICON = { rising: '📈', stable: '➡', falling: '📉' };
  const cColor = congestion > 0.7 ? '#ff2244' : congestion > 0.4 ? '#ffb300' : '#39ff14';

  return (
    <div className="flex flex-col h-screen bg-[#050a14] text-slate-200
                    overflow-hidden font-mono select-none">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2
                         border-b border-cyan-900/50 bg-[#07101f] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 text-lg font-bold tracking-widest">◈ DIGITAL TWIN</span>
          <span className="text-[10px] text-slate-500 tracking-widest">LIVE ●</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">Congestion</span>
          <div className="w-28 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
                 style={{ width: `${congestion * 100}%`, background: cColor,
                          boxShadow: `0 0 5px ${cColor}` }} />
          </div>
          <span className="text-xs font-bold tabular-nums" style={{ color: cColor }}>
            {(congestion * 100).toFixed(0)}%
          </span>
          <span className="text-[10px] text-slate-500 ml-3">
            {TREND_ICON[trend]} {pcu_min.toFixed(1)} PCU/min
          </span>
        </div>

        <button onClick={onReset}
                className="px-3 py-1 text-xs border border-slate-700
                           text-slate-400 hover:text-red-400 hover:border-red-700
                           rounded transition-all">
          ← RECONFIGURE
        </button>
      </header>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-2 p-2" style={{ minHeight: 0 }}>

        {/* LEFT column 42% */}
        <div className="flex flex-col gap-2 overflow-hidden"
             style={{ width: '42%', flex: '0 0 42%', minHeight: 0 }}>

          {/* Video + overlay */}
          <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-black"
               style={{ flex: '6 1 0', minHeight: '180px',
                        boxShadow: '0 0 20px rgba(0,245,255,0.05)' }}>
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain"
              playsInline
              muted
              autoPlay
            />
            <canvas
              ref={overlayCanvasRef}
              style={{ position: 'absolute', pointerEvents: 'none' }}
            />
            <div className="absolute top-2 right-2 flex items-center gap-1
                            bg-black/60 px-2 py-0.5 rounded text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block"/>
              LIVE
            </div>
          </div>

          {/* Sankey */}
          <div className="rounded-lg border border-slate-800 bg-[#060c1a] overflow-hidden"
               style={{ flex: '4 1 0', minHeight: '140px',
                        boxShadow: '0 0 15px rgba(0,245,255,0.04)' }}>
            <SankeyFlow pcuWindow={pcuWindow} lineCounts={lineCounts} />
          </div>
        </div>

        {/* RIGHT column 58% */}
        <div className="flex flex-col gap-2 flex-1 overflow-hidden" style={{ minHeight: 0 }}>

          {/* Particle Canvas — receives videoRect for spatial alignment */}
          <div className="relative rounded-lg border border-cyan-900/40
                          bg-[#020810] overflow-hidden"
               style={{ flex: '6 1 0', minHeight: '180px',
                        boxShadow: '0 0 30px rgba(0,245,255,0.08)' }}>
            <div className="absolute top-2 left-3 text-[10px] text-cyan-500/60
                            tracking-widest pointer-events-none z-10">
              DIGITAL TWIN · SPATIAL PARTICLE RENDERER
            </div>
            <ParticleCanvas
              positions  = {wsFrame?.positions ?? []}
              events     = {wsFrame?.events    ?? []}
              config     = {config}
              videoRect  = {videoRect}
            />
          </div>

          {/* Control Panel */}
          <div className="rounded-lg border border-slate-800 bg-[#060c1a] overflow-hidden"
               style={{ flex: '4 1 0', minHeight: '140px' }}>
            <ControlPanel
              alerts     = {wsFrame?.alerts      ?? []}
              signalPlan = {wsFrame?.signal_plan  ?? null}
              pcuWindow  = {pcuWindow}
              congestion = {congestion}
              trend      = {trend}
              summary    = {summary}
            />
          </div>
        </div>
      </div>

      {/* ── TimeScrubber ────────────────────────────────────────────────── */}
      <TimeScrubber
        videoRef    = {videoRef}
        duration    = {duration}
        currentTime = {currentTime}
        summary     = {summary}
      />
    </div>
  );
}
