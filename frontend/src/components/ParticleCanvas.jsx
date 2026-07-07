/**
 * ParticleCanvas.jsx  –  Digital Twin Particle Renderer
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders live vehicle positions from WebSocket as glowing sci-fi particles.
 *
 * Visual language
 * ───────────────
 *   motorcycle  → small blue circle  (r=4)  + cyan trail
 *   car         → green rectangle   (8×5)  + green glow
 *   bus         → amber wide bar    (14×7) + amber glow
 *   truck       → red wide bar      (14×7) + red glow
 *
 * Crossing flash
 *   When an event arrives, the particle flashes white for 0.4 s
 *
 * Trail effect
 *   Canvas is NOT cleared each frame — instead a semi-transparent dark rect
 *   is drawn first (alpha = 0.18) creating a motion-blur / comet-tail effect
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useRef, useEffect, useCallback } from 'react';

// ── visual style per vehicle class ───────────────────────────────────────────
const VEH_STYLE = {
  motorcycle: { color: '#00aaff', glow: '#0066ff', shape: 'circle', r: 4,  w: 0,  h: 0  },
  car:        { color: '#39ff14', glow: '#1aaa00', shape: 'rect',   r: 0,  w: 9,  h: 5  },
  bus:        { color: '#ffb300', glow: '#cc8800', shape: 'rect',   r: 0,  w: 15, h: 7  },
  truck:      { color: '#ff4444', glow: '#aa1111', shape: 'rect',   r: 0,  w: 15, h: 7  },
};
const DEFAULT_STYLE = VEH_STYLE.car;

// ── component ─────────────────────────────────────────────────────────────────
export default function ParticleCanvas({ positions, events, config }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  // track flash state: { trackId → flash_end_timestamp }
  const flashMap  = useRef({});
  // previous positions for ghost trail: { trackId → {x,y} }
  const prevPos   = useRef({});
  // last received positions (for render loop)
  const posRef    = useRef([]);

  // ── update flash map from crossing events ────────────────────────────
  useEffect(() => {
    const now = performance.now();
    (events ?? []).forEach(ev => {
      flashMap.current[ev.track_id] = now + 400;  // 400 ms flash
    });
  }, [events]);

  // ── update posRef ─────────────────────────────────────────────────────
  useEffect(() => {
    posRef.current = positions ?? [];
  }, [positions]);

  // ── draw ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    // ── motion-blur overlay (trail effect) ──────────────────────────────
    ctx.fillStyle = 'rgba(2, 8, 16, 0.22)';
    ctx.fillRect(0, 0, W, H);

    const now = performance.now();

    // ── draw grid background (subtle) ────────────────────────────────────
    ctx.strokeStyle = 'rgba(0,245,255,0.04)';
    ctx.lineWidth   = 0.5;
    const gridStep  = Math.min(W, H) / 12;
    for (let x = 0; x <= W; x += gridStep) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ── draw counting lines (ghost, from config) ──────────────────────
    if (config?.lines) {
      const LINE_COLOR = { A: '#39ff14', B: '#ff6b35', C: '#c84bff', D: '#ffb300' };
      Object.entries(config.lines).forEach(([key, pts]) => {
        if (!pts) return;
        const color = LINE_COLOR[key] ?? '#ffffff';
        const x1 = pts[0][0] * W, y1 = pts[0][1] * H;
        const x2 = pts[1][0] * W, y2 = pts[1][1] * H;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.strokeStyle = color + '55';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        // tiny label
        ctx.font      = '10px monospace';
        ctx.fillStyle = color + '99';
        ctx.fillText(key, x1 + 4, y1 - 4);
      });
    }

    // ── draw particles ────────────────────────────────────────────────
    posRef.current.forEach(p => {
      const px  = p.x * W;
      const py  = p.y * H;
      const st  = VEH_STYLE[p.class] ?? DEFAULT_STYLE;
      const tid = p.track_id;

      // flash override: white burst on crossing event
      const isFlashing = flashMap.current[tid] && now < flashMap.current[tid];
      const color = isFlashing ? '#ffffff' : st.color;
      const glow  = isFlashing ? '#ffffff' : st.glow;
      const glowR = isFlashing ? 20 : 10;

      ctx.shadowColor = glow;
      ctx.shadowBlur  = glowR;
      ctx.fillStyle   = color;

      if (st.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(px, py, st.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // rectangle centred at (px, py)
        ctx.fillRect(px - st.w / 2, py - st.h / 2, st.w, st.h);
      }

      // inner highlight dot
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#ffffff55';
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fill();

      prevPos.current[tid] = { x: px, y: py };
    });

    ctx.shadowBlur = 0;
    rafRef.current = requestAnimationFrame(draw);
  }, [config]);

  // ── start/stop render loop ────────────────────────────────────────────
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ── size canvas to fill container ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width  = rect.width;
      canvas.height = rect.height;
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
