/**
 * Dashboard.jsx  –  戰情室主畫面  (Dashboard Mode)
 * ─────────────────────────────────────────────────────────────────────────────
 * Layout
 *
 *  ┌─ Header ──────────────────────────────────────────────────────────────┐
 *  ├─ Left (42%) ──────────────────┬─ Right (58%) ────────────────────────┤
 *  │  [Video + line overlay]       │  [Particle Canvas]                   │
 *  │  [SankeyFlow]                 │  [ControlPanel]                      │
 *  ├─ TimeScrubber (full width) ───────────────────────────────────────────┤
 *  └───────────────────────────────────────────────────────────────────────┘
 *
 * Props
 * ─────
 *   videoSrc    string
 *   videoRef    React ref to <video>
 *   wsFrame     latest WS frame payload
 *   summary     /api/summary
 *   config      { roi, lines }
 *   currentTime number  (seconds, from App.jsx timeupdate)
 *   duration    number  (seconds)
 *   onReset     fn
 */

import { useRef, useEffect } from 'react';
import ParticleCanvas from './ParticleCanvas';
import SankeyFlow     from './SankeyFlow';
import ControlPanel   from './ControlPanel';
import TimeScrubber   from './TimeScrubber';
import CoordinateDebugger from './CoordinateDebugger';

const LINE_COLOR = { A: '#39ff14', B: '#ff6b35', C: '#c84bff', D: '#ffb300' };

export default function Dashboard({
  videoSrc, videoRef, wsFrame, summary, config,
  currentTime, duration, onReset,
}) {
  const overlayCanvasRef = useRef(null);

  // ── size & position overlay canvas over the video IMAGE (no black bars) ─
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const video  = videoRef.current;
    const container = videoRef.current?.parentElement;
    if (!canvas || !video || !container) return;

    // Use the video's actual display bounds (the <video> element's bounding rect)
    const videoElRect = video.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Calculate canvas size based on video's actual display dimensions
    const canvasWidth  = Math.round(videoElRect.width);
    const canvasHeight = Math.round(videoElRect.height);

    // Position canvas relative to its container
    const offsetLeft = videoElRect.left - containerRect.left;
    const offsetTop  = videoElRect.top  - containerRect.top;

    canvas.width  = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.position = 'absolute';
    canvas.style.left     = `${offsetLeft}px`;
    canvas.style.top      = `${offsetTop}px`;
    canvas.style.width    = `${canvasWidth}px`;
    canvas.style.height   = `${canvasHeight}px`;
    canvas.style.pointerEvents = 'none';
  }, [videoRef]);

  // ── draw counting lines on the overlay canvas ─────────────────────────
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
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
      ctx.shadowBlur  = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      [[x1, y1],[x2, y2]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      });

      ctx.shadowBlur  = 5;
      ctx.font        = 'bold 11px monospace';
      ctx.fillStyle   = color;
      ctx.fillText(key, x1 + 6, y1 - 6);
      ctx.shadowBlur  = 0;
    });
  }, [config]);

  // ── derived metrics ───────────────────────────────────────────────────
  const congestion = wsFrame?.congestion_idx ?? 0;
  const trend      = wsFrame?.trend          ?? 'stable';
  const pcu_min    = wsFrame?.pcu_per_min    ?? 0;
  const lineCounts = wsFrame?.line_counts    ?? {};
  const pcuWindow  = wsFrame?.pcu_window     ?? {};

  const TREND_ICON = { rising: '📈', stable: '➡', falling: '📉' };

  // congestion colour helper
  const cColor = congestion > 0.7 ? '#ff2244' : congestion > 0.4 ? '#ffb300' : '#39ff14';

  return (
    <div className="flex flex-col h-screen bg-[#050a14] text-slate-200
                    overflow-hidden font-mono select-none">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2
                         border-b border-cyan-900/50 bg-[#07101f] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 text-lg font-bold tracking-widest">
            ◈ DIGITAL TWIN
          </span>
          <span className="text-[10px] text-slate-500 tracking-widest">
            LIVE ●
          </span>
        </div>

        {/* Congestion gauge */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">
            Congestion
          </span>
          <div className="w-28 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
                 style={{ width: `${congestion * 100}%`, background: cColor,
                          boxShadow: `0 0 5px ${cColor}` }} />
          </div>
          <span className="text-xs font-bold tabular-nums"
                style={{ color: cColor }}>
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

      {/* ── Main grid ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-2 p-2"
           style={{ minHeight: 0, display: 'flex', flexDirection: 'row' }}>

        {/* LEFT column – 42% */}
        <div className="flex flex-col gap-2 overflow-hidden"
             style={{ width: '42%', minHeight: 0, flex: '0 0 42%' }}>

          {/* Video + line overlay – takes 60% of left column */}
          <div className="relative rounded-lg overflow-hidden border border-slate-800
                          bg-black"
               style={{ flex: '6 1 0', minHeight: '200px',
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
              className="absolute pointer-events-none"
              style={{ position: 'absolute' }}
            />
            <div className="absolute top-2 right-2 flex items-center gap-1
                            bg-black/60 px-2 py-0.5 rounded text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block"/>
              LIVE
            </div>
          </div>

          {/* Sankey Flow – takes 40% of left column, fixed minimum height */}
          <div className="rounded-lg border border-slate-800 bg-[#060c1a] overflow-hidden"
               style={{ flex: '4 1 0', minHeight: '140px',
                        boxShadow: '0 0 15px rgba(0,245,255,0.04)' }}>
            <SankeyFlow pcuWindow={pcuWindow} lineCounts={lineCounts} />
          </div>
        </div>

        {/* RIGHT column – 58%, flex:1 */}
        <div className="flex flex-col gap-2 flex-1 overflow-hidden"
             style={{ minHeight: 0 }}>

          {/* Particle Canvas – takes 60% of right column */}
          <div className="relative rounded-lg border border-cyan-900/40
                          bg-[#020810] overflow-hidden"
               style={{ flex: '6 1 0', minHeight: '200px',
                        boxShadow: '0 0 30px rgba(0,245,255,0.08)' }}>
            <div className="absolute top-2 left-3 text-[10px] text-cyan-500/60
                            tracking-widest pointer-events-none z-10">
              DIGITAL TWIN  ·  SPATIAL PARTICLE RENDERER
            </div>
            <ParticleCanvas
              positions = {wsFrame?.positions ?? []}
              events    = {wsFrame?.events    ?? []}
              config    = {config}
            />
          </div>

          {/* Control Panel – takes 40% of right column, fixed minimum height */}
          <div className="rounded-lg border border-slate-800 bg-[#060c1a] overflow-hidden"
               style={{ flex: '4 1 0', minHeight: '140px' }}>
            <ControlPanel
              alerts     = {wsFrame?.alerts     ?? []}
              signalPlan = {wsFrame?.signal_plan ?? null}
              pcuWindow  = {pcuWindow}
              congestion = {congestion}
              trend      = {trend}
              summary    = {summary}
            />
          </div>
        </div>
      </div>

      {/* ── TimeScrubber — full width, pinned to bottom ────────────────── */}
      <TimeScrubber
        videoRef    = {videoRef}
        duration    = {duration}
        currentTime = {currentTime}
        summary     = {summary}
      />

      {/* ── Debug Panel (visible when ?debug=1) ─────────────────────── */}
      <CoordinateDebugger
        videoRef={videoRef}
        canvasRef={overlayCanvasRef}
        config={config}
      />
    </div>
  );
}
