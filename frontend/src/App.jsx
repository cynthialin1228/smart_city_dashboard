/**
 * App.jsx  –  Root component & state machine
 * ─────────────────────────────────────────────────────────────────────────────
 * WebSocket synchronisation strategy
 * ────────────────────────────────────
 * OLD (buggy): setInterval(200ms) → blindly send → responses pile up → lag
 *
 * NEW (correct):
 *   1. video.ontimeupdate fires ~25 fps (driven by playbackRate)
 *   2. We send ONE seek message when:
 *        a) we are NOT waiting for a reply (wsReady flag), AND
 *        b) at least MIN_SEEK_GAP_MS has passed since the last send
 *   3. On message received → update wsFrame → set wsReady=true → allow next send
 *
 *   This creates a natural back-pressure loop. The particle renderer always
 *   shows the frame closest to video.currentTime, with zero queue buildup.
 *   At 1× speed a seek fires ~10/s; at 4× speed the same rate is maintained
 *   (the video advances faster but the WS throughput stays the same).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import TrafficCanvas from './components/TrafficCanvas';
import Dashboard     from './components/Dashboard';

const VIDEO_SRC       = '/video/raw_video.mp4';
const API_BASE        = 'http://localhost:8000';
const WS_URL          = 'ws://localhost:8000/ws/stream';
const MIN_SEEK_GAP_MS = 80;   // never send faster than ~12 fps regardless of playback speed

export default function App() {
  // ── mode ──────────────────────────────────────────────────────────────
  const [mode,    setMode]    = useState('config');
  const [error,   setError]   = useState(null);
  const [summary, setSummary] = useState(null);
  const [config,  setConfig]  = useState(null);

  // ── playback state (shared between App and Dashboard/TimeScrubber) ────
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);

  // ── live WS frame ──────────────────────────────────────────────────────
  const [wsFrame, setWsFrame] = useState(null);

  // ── refs ───────────────────────────────────────────────────────────────
  const videoRef    = useRef(null);
  const wsRef       = useRef(null);
  const wsReadyRef  = useRef(true);   // true = may send next seek
  const lastSendRef = useRef(0);      // timestamp of last send (ms)

  // ── POST config → backend ─────────────────────────────────────────────
  const handleConfirm = useCallback(async (payload) => {
    setConfig(payload);
    setMode('launching');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Config failed: ${res.status}`);

      const sumRes  = await fetch(`${API_BASE}/api/summary`);
      const sumData = await sumRes.json();
      setSummary(sumData);
      setMode('dashboard');
    } catch (err) {
      setError(err.message);
      setMode('config');
    }
  }, []);

  // ── open WebSocket once dashboard mode is entered ─────────────────────
  useEffect(() => {
    if (mode !== 'dashboard') return;

    const ws = new WebSocket(WS_URL);
    wsRef.current   = ws;
    wsReadyRef.current = true;

    ws.onopen = () => console.log('[ws] connected');

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'frame') {
          setWsFrame(data);
        }
      } catch (_) {}
      // Mark as ready for next seek — back-pressure release
      wsReadyRef.current = true;
    };

    ws.onerror = (e) => console.warn('[ws] error', e);
    ws.onclose = ()  => console.log('[ws] closed');

    return () => ws.close();
  }, [mode]);

  // ── wire video events once video element exists ───────────────────────
  useEffect(() => {
    if (mode !== 'dashboard') return;

    const attachWhenReady = () => {
      const video = videoRef.current;
      if (!video) { setTimeout(attachWhenReady, 50); return; }

      // timeupdate: ~25/s, drives WS sends
      const onTimeUpdate = () => {
        setCurrentTime(video.currentTime);

        const ws  = wsRef.current;
        const now = performance.now();

        if (
          ws?.readyState === WebSocket.OPEN &&
          wsReadyRef.current &&
          (now - lastSendRef.current) >= MIN_SEEK_GAP_MS
        ) {
          wsReadyRef.current = false;
          lastSendRef.current = now;
          ws.send(JSON.stringify({ type: 'seek', t: video.currentTime }));
        }
      };

      const onMetadata = () => setDuration(video.duration || 0);
      const onEnded    = () => { video.currentTime = 0; video.play(); };

      video.addEventListener('timeupdate',     onTimeUpdate);
      video.addEventListener('loadedmetadata', onMetadata);
      video.addEventListener('ended',          onEnded);

      // kick off if already loaded
      if (video.readyState >= 1) setDuration(video.duration || 0);

      return () => {
        video.removeEventListener('timeupdate',     onTimeUpdate);
        video.removeEventListener('loadedmetadata', onMetadata);
        video.removeEventListener('ended',          onEnded);
      };
    };

    const cleanup = attachWhenReady();
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, [mode]);

  // ── reset everything ──────────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    if (wsRef.current) wsRef.current.close();
    await fetch(`${API_BASE}/api/reset`).catch(() => {});
    setWsFrame(null);
    setSummary(null);
    setConfig(null);
    setCurrentTime(0);
    setDuration(0);
    setMode('config');
  }, []);

  // ── render ────────────────────────────────────────────────────────────
  if (mode === 'config') {
    return (
      <div className="relative">
        {error && (
          <div className="absolute top-0 inset-x-0 z-50 bg-red-900/90 text-red-200
                          text-xs font-mono px-4 py-2 text-center">
            ⚠ {error} — check that the backend is running on port 8000
          </div>
        )}
        <TrafficCanvas videoSrc={VIDEO_SRC} onConfirm={handleConfirm} />
      </div>
    );
  }

  if (mode === 'launching') {
    return (
      <div className="flex flex-col items-center justify-center h-screen
                      bg-[#050a14] text-cyan-400 font-mono gap-6">
        <div className="text-4xl animate-pulse">◈</div>
        <p className="text-lg tracking-widest">INITIALISING AI ENGINE</p>
        <p className="text-xs text-slate-500">
          Computing spatial intersections over {' '}
          <span className="text-cyan-500">1501 trajectory frames</span>…
        </p>
        <div className="w-64 h-1 bg-slate-800 rounded overflow-hidden">
          <div className="h-full bg-cyan-400 rounded"
               style={{ width: '40%', animation: 'scan 1.4s ease-in-out infinite' }} />
        </div>
        <style>{`
          @keyframes scan {
            0%   { margin-left:0%  }
            50%  { margin-left:60% }
            100% { margin-left:0%  }
          }
        `}</style>
      </div>
    );
  }

  return (
    <Dashboard
      videoSrc    = {VIDEO_SRC}
      videoRef    = {videoRef}
      wsFrame     = {wsFrame}
      summary     = {summary}
      config      = {config}
      currentTime = {currentTime}
      duration    = {duration}
      onReset     = {handleReset}
    />
  );
}
