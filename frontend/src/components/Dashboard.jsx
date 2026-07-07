/**
 * Dashboard.jsx  –  戰情室主畫面  (Dashboard Mode)
 * ─────────────────────────────────────────────────────────────────────────────
 * COORDINATE CONTRACT
 * ───────────────────
 * All normalised coordinates (0.0–1.0) refer to the VIDEO IMAGE space, i.e.
 * the letterbox-corrected area returned by getVideoContentRect().
 *
 * ANTI-「時空脫節」STRATEGY
 * ─────────────────────────
 * The overlay canvas is driven by a requestAnimationFrame loop — NOT a
 * one-shot useEffect.  Every frame:
 *   1.  Call getVideoContentRect(video) live to get the CURRENT rendered area.
 *   2.  Resize + reposition the canvas to cover that area exactly.
 *   3.  Redraw all lines in [0,1] → pixel space using the fresh rect.
 *
 * This means even if the video element hasn't fired loadedmetadata yet, or the
 * window is resized, or the layout shifts, the overlay self-corrects every RAF
 * tick — zero chance of a stale-rect mismatch.
 *
 * CYBERPUNK NEON FLASH ANIMATION
 * ───────────────────────────────
 * When the backend sends crossing events (wsFrame.events), each triggered
 * line_id is recorded in flashLinesRef with an end-timestamp (now + 1000 ms).
 * The RAF draw loop checks this map every frame and renders the line in a
 * multi-layer neon glow if its flash is still active:
 *   • Outer corona  – wide low-opacity blur (shadowBlur 60)
 *   • Mid halo      – medium blur (shadowBlur 25) + bright colour
 *   • Core line     – thin bright white stroke (shadowBlur 10)
 *   • Animated width pulse — lineWidth oscillates 2.5 → 6 → 2.5 over 1 s
 *
 * Layout
 *  ┌─ Header ───────────────────────────────────────────────────────────────┐
 *  ├─ Left 42% ─────────────────┬─ Right 58% ─────────────────────────────┤
 *  │  [Video + line overlay]    │  [Particle Canvas]                      │
 *  │  [SankeyFlow]              │  [ControlPanel]                         │
 *  ├─ TimeScrubber ─────────────────────────────────────────────────────────┤
 *  └────────────────────────────────────────────────────────────────────────┘
 */

import { useRef, useEffect, useCallback } from 'react';
import ParticleCanvas           from './ParticleCanvas';
import SankeyFlow               from './SankeyFlow';
import ControlPanel             from './ControlPanel';
import TimeScrubber             from './TimeScrubber';
import useVideoRect, { getVideoContentRect } from '../hooks/useVideoRect';

const LINE_COLOR = { A: '#39ff14', B: '#ff6b35', C: '#c84bff', D: '#ffb300' };

// Flash duration in milliseconds (1 second per spec)
const FLASH_DURATION_MS = 1000;

export default function Dashboard({
  videoSrc, videoRef, wsFrame, summary, config,
  currentTime, duration, onReset,
}) {
  const overlayCanvasRef = useRef(null);
  const rafRef           = useRef(null);

  // flashLinesRef: { [line_id]: flash_end_timestamp_ms }
  // Written whenever wsFrame.events arrives, read every RAF tick.
  const flashLinesRef  = useRef({});
  // configRef: always mirrors the latest config prop inside the RAF closure
  const configRef      = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  // ── letterbox-corrected video image rect (for ParticleCanvas alignment) ─
  // Still used as a prop for ParticleCanvas; the overlay itself re-computes
  // live via getVideoContentRect() each RAF tick to avoid stale-rect bugs.
  const { rect: videoRect } = useVideoRect(videoRef);

  // ── record flash events from the latest WS frame ──────────────────────
  useEffect(() => {
    const events = wsFrame?.events ?? [];
    if (events.length === 0) return;
    const endTs = performance.now() + FLASH_DURATION_MS;
    events.forEach(ev => {
      if (ev.line) flashLinesRef.current[ev.line] = endTs;
    });
  }, [wsFrame]);

  // ── RAF draw loop — self-correcting coordinate alignment every frame ───
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video) {
      rafRef.current = requestAnimationFrame(drawOverlay);
      return;
    }

    // ── 1. Live rect — NO stale cache, straight from the DOM ────────────
    const liveRect = getVideoContentRect(video);
    if (!liveRect) {
      rafRef.current = requestAnimationFrame(drawOverlay);
      return;
    }

    // ── 2. Resize + reposition canvas to cover video image exactly ───────
    const W = Math.round(liveRect.width);
    const H = Math.round(liveRect.height);

    // Only touch the DOM when dimensions actually changed (avoids layout thrash)
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width  = W;
      canvas.height = H;
    }

    const elRect = video.getBoundingClientRect();
    const newLeft = `${liveRect.left - elRect.left}px`;
    const newTop  = `${liveRect.top  - elRect.top}px`;
    const newW    = `${liveRect.width}px`;
    const newH    = `${liveRect.height}px`;

    if (canvas.style.left   !== newLeft) canvas.style.left   = newLeft;
    if (canvas.style.top    !== newTop)  canvas.style.top    = newTop;
    if (canvas.style.width  !== newW)    canvas.style.width  = newW;
    if (canvas.style.height !== newH)    canvas.style.height = newH;

    // ── 3. Draw ───────────────────────────────────────────────────────────
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const now     = performance.now();
    const cfg     = configRef.current;
    if (!cfg?.lines) {
      rafRef.current = requestAnimationFrame(drawOverlay);
      return;
    }

    Object.entries(cfg.lines).forEach(([key, pts]) => {
      if (!pts) return;
      const color       = LINE_COLOR[key] ?? '#ffffff';
      const x1 = pts[0][0] * W,  y1 = pts[0][1] * H;
      const x2 = pts[1][0] * W,  y2 = pts[1][1] * H;

      const flashEnd = flashLinesRef.current[key] ?? 0;
      const isFlashing = now < flashEnd;

      if (isFlashing) {
        // ── Cyberpunk neon flash: 3-layer glow effect ──────────────────
        // Normalised flash progress [0 → 1] over the 1-second window
        const progress = (flashEnd - now) / FLASH_DURATION_MS;   // 1→0
        // Pulse: lineWidth oscillates 2.5 → 6 → 2.5 using a sine wave
        const pulse    = 2.5 + 3.5 * Math.abs(Math.sin(progress * Math.PI * 4));

        // Layer 1 — outer corona (wide, low opacity)
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth   = pulse + 10;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 60;
        ctx.globalAlpha = 0.25 * progress;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();

        // Layer 2 — mid halo
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth   = pulse + 3;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 25;
        ctx.globalAlpha = 0.6 * progress;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();

        // Layer 3 — bright white core
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = Math.max(1.5, pulse - 1);
        ctx.shadowColor = color;
        ctx.shadowBlur  = 10;
        ctx.globalAlpha = 0.9 * progress + 0.1;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();

        // Endpoint blobs
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur  = 20;
        ctx.fillStyle   = '#ffffff';
        ctx.globalAlpha = 0.85 * progress + 0.15;
        [[x1, y1], [x2, y2]].forEach(([px, py]) => {
          ctx.beginPath();
          ctx.arc(px, py, 5 + 3 * progress, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();

        // Line label — brighter during flash
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur  = 12;
        ctx.font        = 'bold 13px monospace';
        ctx.fillStyle   = '#ffffff';
        ctx.globalAlpha = 0.9 * progress + 0.1;
        ctx.fillText(key, x1 + 7, y1 - 9);
        ctx.restore();

      } else {
        // ── Normal idle state ──────────────────────────────────────────
        ctx.save();
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
        ctx.restore();
      }
    });

    rafRef.current = requestAnimationFrame(drawOverlay);
  }, [videoRef]);  // configRef + flashLinesRef are refs — no re-bind needed

  // ── start RAF loop when component mounts, stop on unmount ─────────────
  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawOverlay);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [drawOverlay]);

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
