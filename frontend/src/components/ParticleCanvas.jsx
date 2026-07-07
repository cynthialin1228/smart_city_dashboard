/**
 * ParticleCanvas.jsx  –  Digital Twin Particle Renderer
 * ─────────────────────────────────────────────────────────────────────────────
 * SPATIAL ALIGNMENT DESIGN
 * ────────────────────────
 * The backend sends vehicle positions as normalised (x, y) ∈ [0,1] × [0,1]
 * in the VIDEO IMAGE coordinate space (same space TrafficCanvas uses).
 *
 * The canvas fills its container (the right panel), but particles must be
 * drawn in a sub-rectangle that mirrors the video's aspect ratio — so that
 * the same (x=0.5, y=0.5) maps to the visual centre on BOTH the left video
 * and the right particle panel.
 *
 * We achieve this by:
 *   1. Computing a "render rect" inside the canvas that has the same aspect
 *      ratio as the video image (videoRect.width / videoRect.height).
 *   2. Drawing particles at:  px = renderRect.x + nx * renderRect.w
 *                             py = renderRect.y + ny * renderRect.h
 *   3. Drawing ghost counting lines using the same render rect.
 *
 * If videoRect is not yet available, fall back to filling the full canvas
 * (best-effort, slightly off until first resize fires).
 *
 * Visual language
 * ───────────────
 *   motorcycle  → small blue circle  (r=4)
 *   car         → green rectangle   (9×5)
 *   bus         → amber wide bar    (15×7)
 *   truck       → red wide bar      (15×7)
 *
 * Crossing flash: particle flashes white for 400 ms on crossing event.
 * Trail effect:   semi-transparent dark rect drawn each frame (no clear).
 */

import { useRef, useEffect, useCallback } from 'react';

const VEH_STYLE = {
  motorcycle: { color: '#00aaff', glow: '#0066ff', shape: 'circle', r: 4,  w: 0,  h: 0  },
  car:        { color: '#39ff14', glow: '#1aaa00', shape: 'rect',   r: 0,  w: 9,  h: 5  },
  bus:        { color: '#ffb300', glow: '#cc8800', shape: 'rect',   r: 0,  w: 15, h: 7  },
  truck:      { color: '#ff4444', glow: '#aa1111', shape: 'rect',   r: 0,  w: 15, h: 7  },
};
const DEFAULT_STYLE = VEH_STYLE.car;
const LINE_COLOR    = { A: '#39ff14', B: '#ff6b35', C: '#c84bff', D: '#ffb300' };

/**
 * Given a canvas size (W×H) and the video's aspect ratio (ar = w/h),
 * return the largest object-contain rect { x, y, w, h } centred in the canvas.
 */
function containRect(canvasW, canvasH, videoAR) {
  if (!videoAR || canvasW === 0 || canvasH === 0) {
    return { x: 0, y: 0, w: canvasW, h: canvasH };
  }
  const canvasAR = canvasW / canvasH;
  let rw, rh;
  if (canvasAR > videoAR) {
    // canvas is wider → constrained by height
    rh = canvasH;
    rw = rh * videoAR;
  } else {
    // canvas is taller → constrained by width
    rw = canvasW;
    rh = rw / videoAR;
  }
  return {
    x: (canvasW - rw) / 2,
    y: (canvasH - rh) / 2,
    w: rw,
    h: rh,
  };
}

export default function ParticleCanvas({ positions, events, config, videoRect }) {
  const canvasRef  = useRef(null);
  const rafRef     = useRef(null);
  const flashMap   = useRef({});   // trackId → flash_end_ms
  const posRef     = useRef([]);
  // store videoRect in a ref so the RAF closure always reads the latest value
  const videoRectRef = useRef(videoRect);
  useEffect(() => { videoRectRef.current = videoRect; }, [videoRect]);

  // ── update flash map when crossing events arrive ──────────────────────
  useEffect(() => {
    const now = performance.now();
    (events ?? []).forEach(ev => {
      flashMap.current[ev.track_id] = now + 400;
    });
  }, [events]);

  // ── keep posRef fresh for the RAF loop ────────────────────────────────
  useEffect(() => {
    posRef.current = positions ?? [];
  }, [positions]);

  // ── RAF draw loop ─────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const now  = performance.now();

    // Compute render rect (object-contain, mirrors left video panel)
    const vr  = videoRectRef.current;
    const ar  = vr ? vr.width / vr.height : null;
    const rr  = containRect(W, H, ar);   // { x, y, w, h }

    // ── trail overlay ──────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(2, 8, 16, 0.20)';
    ctx.fillRect(0, 0, W, H);

    // ── subtle grid (inside render rect only) ─────────────────────────
    ctx.strokeStyle = 'rgba(0,245,255,0.04)';
    ctx.lineWidth   = 0.5;
    const gridStep  = Math.min(rr.w, rr.h) / 10;
    for (let x = rr.x; x <= rr.x + rr.w; x += gridStep) {
      ctx.beginPath(); ctx.moveTo(x, rr.y); ctx.lineTo(x, rr.y + rr.h); ctx.stroke();
    }
    for (let y = rr.y; y <= rr.y + rr.h; y += gridStep) {
      ctx.beginPath(); ctx.moveTo(rr.x, y); ctx.lineTo(rr.x + rr.w, y); ctx.stroke();
    }

    // ── render rect border (faint, shows alignment) ───────────────────
    ctx.strokeStyle = 'rgba(0,245,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(rr.x, rr.y, rr.w, rr.h);

    // ── ghost counting lines ──────────────────────────────────────────
    if (config?.lines) {
      Object.entries(config.lines).forEach(([key, pts]) => {
        if (!pts) return;
        const color = LINE_COLOR[key] ?? '#ffffff';
        // map normalised → render rect
        const x1 = rr.x + pts[0][0] * rr.w;
        const y1 = rr.y + pts[0][1] * rr.h;
        const x2 = rr.x + pts[1][0] * rr.w;
        const y2 = rr.y + pts[1][1] * rr.h;

        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.strokeStyle = color + '66';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur  = 0;

        ctx.font        = '10px monospace';
        ctx.fillStyle   = color + '99';
        ctx.fillText(key, x1 + 4, y1 - 4);
      });
    }

    // ── particles ─────────────────────────────────────────────────────
    posRef.current.forEach(p => {
      // map normalised → render rect  (same transform as lines above)
      const px  = rr.x + p.x * rr.w;
      const py  = rr.y + p.y * rr.h;
      const st  = VEH_STYLE[p.class] ?? DEFAULT_STYLE;
      const tid = p.track_id;

      const isFlashing = flashMap.current[tid] && now < flashMap.current[tid];
      const color = isFlashing ? '#ffffff' : st.color;
      const glow  = isFlashing ? '#ffffff' : st.glow;

      ctx.shadowColor = glow;
      ctx.shadowBlur  = isFlashing ? 22 : 10;
      ctx.fillStyle   = color;

      if (st.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(px, py, st.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px - st.w / 2, py - st.h / 2, st.w, st.h);
      }

      // inner highlight
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#ffffff55';
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.shadowBlur = 0;
    rafRef.current = requestAnimationFrame(draw);
  }, [config]);   // videoRect changes propagate via videoRectRef, no re-bind needed

  // ── start / stop RAF loop ─────────────────────────────────────────────
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ── size canvas to fill container ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width  = Math.round(r.width);
      canvas.height = Math.round(r.height);
    });
    obs.observe(canvas.parentElement);
    return () => obs.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
    />
  );
}
