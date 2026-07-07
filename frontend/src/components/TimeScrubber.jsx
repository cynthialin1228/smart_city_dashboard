/**
 * TimeScrubber.jsx  –  底部時間軸拉桿 + 播放控制
 * ─────────────────────────────────────────────────────────────────────────────
 * Controls
 *   ▶/⏸  play / pause
 *   ◀◀   rewind 5 s
 *   ──────────────────── scrubber ────────────────────── timeline bar
 *   1×  2×  4×           playback speed buttons
 *   00:00 / 01:00        current / total time
 *
 * The scrubber is the single source of truth for video position.
 * It reads from videoRef.current directly and drives video.currentTime
 * on user drag — the WebSocket seek follows automatically via the
 * parent's timeupdate listener.
 *
 * Props
 * ─────
 *   videoRef     React ref to the <video> element
 *   duration     number  – total video duration in seconds (from video metadata)
 *   currentTime  number  – current playback position in seconds (updated by parent)
 *   summary      object  – /api/summary for timeline background sparkline
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef, useEffect } from 'react';

const SPEEDS = [0.5, 1, 2, 4];

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

export default function TimeScrubber({ videoRef, duration = 0, currentTime = 0, summary }) {
  const [speed,     setSpeed]     = useState(1);
  const [dragging,  setDragging]  = useState(false);
  const [dragTime,  setDragTime]  = useState(0);
  const trackRef = useRef(null);

  // ── apply speed to video ─────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed, videoRef]);

  // ── scrubber position ─────────────────────────────────────────────────
  const displayTime = dragging ? dragTime : currentTime;
  const pct = duration > 0 ? (displayTime / duration) * 100 : 0;

  // ── convert pointer X → time ──────────────────────────────────────────
  const xToTime = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return 0;
    const t = ((clientX - rect.left) / rect.width) * duration;
    return Math.max(0, Math.min(duration, t));
  }, [duration]);

  const seekTo = useCallback((t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    // if paused, keep paused at new position
  }, [videoRef]);

  // ── pointer events on the track bar ──────────────────────────────────
  const handlePointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    const t = xToTime(e.clientX);
    setDragTime(t);
  }, [xToTime]);

  const handlePointerMove = useCallback((e) => {
    if (!dragging) return;
    const t = xToTime(e.clientX);
    setDragTime(t);
  }, [dragging, xToTime]);

  const handlePointerUp = useCallback((e) => {
    if (!dragging) return;
    const t = xToTime(e.clientX);
    setDragging(false);
    seekTo(t);
  }, [dragging, xToTime, seekTo]);

  // ── play / pause toggle ───────────────────────────────────────────────
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('play',  onPlay);
    v.addEventListener('pause', onPause);
    return () => { v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); };
  }, [videoRef]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    playing ? v.pause() : v.play();
  }, [playing, videoRef]);

  const rewind = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - 5);
  }, [videoRef]);

  // ── timeline sparkline from summary ──────────────────────────────────
  // Build a simple array of total_rate per second for a background sparkline
  const sparkData = summary?.timeline?.map(pt => pt.total_rate ?? 0) ?? [];
  const sparkMax  = Math.max(1, ...sparkData);

  return (
    <div className="shrink-0 bg-[#060c1a] border-t border-cyan-900/30 px-4 py-2
                    flex flex-col gap-1.5 select-none">

      {/* ── Track bar ──────────────────────────────────────────────────── */}
      <div className="relative h-8 flex items-center">

        {/* Background sparkline (PCU rate history) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
        >
          {sparkData.length > 1 && (
            <polyline
              points={sparkData
                .map((v, i) => `${(i / (sparkData.length - 1)) * 100},${100 - (v / sparkMax) * 85}`)
                .join(' ')}
              fill="none"
              stroke="rgba(0,245,255,0.15)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Clickable track */}
        <div
          ref={trackRef}
          className="relative w-full h-2 bg-slate-800 rounded-full cursor-pointer
                     overflow-visible"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* filled portion */}
          <div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #00c6ff, #00f5ff)',
              boxShadow:  '0 0 6px #00f5ff88',
              transition: dragging ? 'none' : 'width 0.1s linear',
            }}
          />

          {/* thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full
                       border-2 border-cyan-400 bg-[#050a14]
                       shadow-[0_0_8px_#00f5ff]"
            style={{
              left: `calc(${pct}% - 7px)`,
              transition: dragging ? 'none' : 'left 0.1s linear',
            }}
          />
        </div>
      </div>

      {/* ── Controls row ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">

        {/* Rewind 5s */}
        <button
          onClick={rewind}
          className="text-slate-400 hover:text-cyan-400 transition-colors text-sm"
          title="Rewind 5s"
        >
          ◀◀
        </button>

        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          className="w-7 h-7 rounded-full border border-cyan-700 bg-cyan-950/60
                     flex items-center justify-center text-cyan-400
                     hover:bg-cyan-900/80 hover:border-cyan-400 transition-all
                     shadow-[0_0_8px_rgba(0,245,255,0.25)]"
        >
          {playing ? '⏸' : '▶'}
        </button>

        {/* Timestamp */}
        <span className="text-[11px] font-mono text-cyan-400 tabular-nums w-24">
          {fmt(displayTime)}
          <span className="text-slate-600"> / {fmt(duration)}</span>
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Speed buttons */}
        <span className="text-[10px] text-slate-600 mr-1">SPEED</span>
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`
              px-2 py-0.5 rounded text-[11px] font-bold font-mono
              border transition-all
              ${speed === s
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/60 shadow-[0_0_6px_rgba(0,245,255,0.4)]'
                : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}
            `}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
