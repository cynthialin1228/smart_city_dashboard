/**
 * TrafficCanvas.jsx  –  Config Mode
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a <video> with a precisely-aligned <canvas> overlay.
 *
 * KEY FIX: The canvas is positioned and sized to match ONLY the rendered video
 * image area (letterbox-corrected), NOT the full <video> element bounding box.
 * This means the black bars from object-contain are excluded, and all
 * normalised coordinates [0,1] correspond exactly to the video frame.
 *
 * Coordinate contract
 * ───────────────────
 *   All stored points are normalised to the VIDEO IMAGE rect:
 *     nx = (clientX - videoImageRect.left) / videoImageRect.width
 *     ny = (clientY - videoImageRect.top)  / videoImageRect.height
 *   These same values are sent to the backend, which compares them against
 *   traffic_base.json trajectories that are also in [0,1] video space.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import useVideoRect from '../hooks/useVideoRect';

// ── visual style per drawing tool ──────────────────────────────────────────
const TOOL_STYLE = {
  roi: {
    stroke:      '#00f5ff',   // neon cyan
    fill:        'rgba(0,245,255,0.08)',
    shadow:      '#00f5ff',
    label:       'ROI Mask',
    labelColor:  '#00f5ff',
  },
  A: {
    stroke:      '#39ff14',   // neon green  – Straight
    shadow:      '#39ff14',
    label:       'A  Straight →',
    labelColor:  '#39ff14',
  },
  B: {
    stroke:      '#ff6b35',   // neon orange – Opposite
    shadow:      '#ff6b35',
    label:       'B  Opposite ←',
    labelColor:  '#ff6b35',
  },
  C: {
    stroke:      '#c84bff',   // neon purple – Cross Dir 1
    shadow:      '#c84bff',
    label:       'C  Cross ↑',
    labelColor:  '#c84bff',
  },
  D: {
    stroke:      '#ffb300',   // neon amber  – Cross Dir 2
    shadow:      '#ffb300',
    label:       'D  Cross ↓',
    labelColor:  '#ffb300',
  },
};

const LINE_TOOLS = ['A', 'B', 'C', 'D'];
const TOOL_ORDER = ['roi', ...LINE_TOOLS];

// ── helpers ────────────────────────────────────────────────────────────────
/** Convert normalised → canvas pixel */
function toPx(nx, ny, w, h) {
  return [nx * w, ny * h];
}

// ── main component ─────────────────────────────────────────────────────────
export default function TrafficCanvas({ videoSrc, onConfirm }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  // ── state ──────────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState('roi');

  const [roiPoints, setRoiPoints] = useState([]);
  const [roiClosed, setRoiClosed] = useState(false);
  const [mousePos,  setMousePos]  = useState(null);  // canvas-local coords

  const [lines,      setLines]      = useState({ A: null, B: null, C: null, D: null });
  const [linePending, setLinePending] = useState(null);

  // ── letterbox-corrected video image rect ──────────────────────────────
  // rect = { left, top, width, height } in viewport px — excludes black bars
  const { rect: videoRect, ready } = useVideoRect(videoRef);

  // ── position + size the canvas to exactly cover the video image ───────
  useEffect(() => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !videoRect) return;

    // Canvas internal resolution = image pixel size
    canvas.width  = videoRect.width;
    canvas.height = videoRect.height;

    // Position the canvas absolutely over the video image (not the element)
    const elRect = video.getBoundingClientRect();
    canvas.style.left   = `${videoRect.left - elRect.left}px`;
    canvas.style.top    = `${videoRect.top  - elRect.top}px`;
    canvas.style.width  = `${videoRect.width}px`;
    canvas.style.height = `${videoRect.height}px`;
  }, [videoRect]);

  // ── canvas draw loop ───────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // helper: glow effect
    const setGlow = (color, blur = 12) => {
      ctx.shadowColor = color;
      ctx.shadowBlur  = blur;
    };
    const clearGlow = () => { ctx.shadowBlur = 0; };

    // ── draw ROI polygon ─────────────────────────────────────────
    if (roiPoints.length > 0) {
      const style = TOOL_STYLE.roi;
      ctx.lineWidth   = 2;
      ctx.strokeStyle = style.stroke;
      ctx.setLineDash([6, 4]);
      setGlow(style.shadow);

      ctx.beginPath();
      roiPoints.forEach(([nx, ny], i) => {
        const [px, py] = toPx(nx, ny, W, H);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });

      // ghost edge while still drawing
      if (!roiClosed && mousePos) {
        ctx.lineTo(mousePos.x, mousePos.y);
      }

      if (roiClosed) {
        ctx.closePath();
        ctx.fillStyle = style.fill;
        ctx.fill();
      }

      ctx.stroke();
      ctx.setLineDash([]);

      // vertex dots
      roiPoints.forEach(([nx, ny]) => {
        const [px, py] = toPx(nx, ny, W, H);
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = style.stroke;
        ctx.fill();
      });

      // label
      if (roiPoints.length > 0) {
        const [px, py] = toPx(roiPoints[0][0], roiPoints[0][1], W, H);
        ctx.font      = 'bold 13px monospace';
        ctx.fillStyle = style.labelColor;
        setGlow(style.shadow, 6);
        ctx.fillText(style.label, px + 8, py - 8);
      }
      clearGlow();
    }

    // ── draw pending line first endpoint ─────────────────────────
    if (linePending && LINE_TOOLS.includes(activeTool)) {
      const style = TOOL_STYLE[activeTool];
      const [px, py] = toPx(linePending[0], linePending[1], W, H);
      setGlow(style.shadow);
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = style.stroke;
      ctx.fill();

      // ghost line to cursor
      if (mousePos) {
        ctx.lineWidth   = 2;
        ctx.strokeStyle = style.stroke;
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }
      clearGlow();
    }

    // ── draw completed lines ──────────────────────────────────────
    LINE_TOOLS.forEach(key => {
      const pts = lines[key];
      if (!pts) return;
      const style = TOOL_STYLE[key];
      const [x1, y1] = toPx(pts[0][0], pts[0][1], W, H);
      const [x2, y2] = toPx(pts[1][0], pts[1][1], W, H);

      ctx.lineWidth   = 3;
      ctx.strokeStyle = style.stroke;
      setGlow(style.shadow);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // endpoint circles
      [[x1, y1], [x2, y2]].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = style.stroke;
        ctx.fill();
      });

      // directional arrow at midpoint
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const arrowLen = 14;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(
        mx - arrowLen * Math.cos(angle - Math.PI / 7),
        my - arrowLen * Math.sin(angle - Math.PI / 7),
      );
      ctx.moveTo(mx, my);
      ctx.lineTo(
        mx - arrowLen * Math.cos(angle + Math.PI / 7),
        my - arrowLen * Math.sin(angle + Math.PI / 7),
      );
      ctx.stroke();

      // label near start
      ctx.font      = 'bold 14px monospace';
      ctx.fillStyle = style.labelColor;
      setGlow(style.shadow, 6);
      ctx.fillText(style.label, x1 + 10, y1 - 10);
      clearGlow();
    });
  }, [roiPoints, roiClosed, lines, mousePos, linePending, activeTool, videoRect]);

  // Re-draw whenever state changes
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ── pointer helpers ────────────────────────────────────────────────────
  // IMPORTANT: coords are relative to the CANVAS element (= video image area)
  // so they are already in the correct normalisation space.
  const getCanvasXY = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseMove = (e) => {
    setMousePos(getCanvasXY(e));
  };

  const handleMouseLeave = () => setMousePos(null);

  // ── click handler ──────────────────────────────────────────────────────
  const handleClick = (e) => {
    const { x, y } = getCanvasXY(e);
    const canvas   = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    if (W === 0 || H === 0) return;

    // Normalise relative to canvas = video image — no black bar offset needed
    const toNormLocal = (px, py) => [+(px / W).toFixed(4), +(py / H).toFixed(4)];

    // ── ROI mode ─────────────────────────────────────────────────
    if (activeTool === 'roi') {
      if (roiClosed) return;
      const norm = toNormLocal(x, y);

      if (roiPoints.length >= 3) {
        const [fx, fy] = [roiPoints[0][0] * W, roiPoints[0][1] * H];
        const dist = Math.hypot(x - fx, y - fy);
        if (dist < 18) {
          setRoiClosed(true);
          setActiveTool('A');
          return;
        }
      }
      setRoiPoints(prev => [...prev, norm]);
      return;
    }

    // ── Line mode ─────────────────────────────────────────────────
    if (LINE_TOOLS.includes(activeTool)) {
      const norm = toNormLocal(x, y);
      if (!linePending) {
        setLinePending(norm);
      } else {
        setLines(prev => ({ ...prev, [activeTool]: [linePending, norm] }));
        setLinePending(null);
        const idx = LINE_TOOLS.indexOf(activeTool);
        if (idx < LINE_TOOLS.length - 1) setActiveTool(LINE_TOOLS[idx + 1]);
      }
    }
  };

  // double-click: close ROI manually if ≥3 points
  const handleDblClick = () => {
    if (activeTool === 'roi' && roiPoints.length >= 3 && !roiClosed) {
      setRoiClosed(true);
      setActiveTool('A');
    }
  };

  // ── reset / undo helpers ───────────────────────────────────────────────
  const resetTool = (tool) => {
    if (tool === 'roi') {
      setRoiPoints([]);
      setRoiClosed(false);
    } else {
      setLines(prev => ({ ...prev, [tool]: null }));
      setLinePending(null);
    }
    setActiveTool(tool);
  };

  const resetAll = () => {
    setRoiPoints([]);
    setRoiClosed(false);
    setLines({ A: null, B: null, C: null, D: null });
    setLinePending(null);
    setActiveTool('roi');
  };

  // ── confirm / submit ───────────────────────────────────────────────────
  const canConfirm =
    roiClosed &&
    LINE_TOOLS.every(k => lines[k] !== null);

  const handleConfirm = () => {
    if (!canConfirm || !onConfirm) return;
    onConfirm({
      roi:   roiPoints,
      lines: {
        A: lines.A,
        B: lines.B,
        C: lines.C,
        D: lines.D,
      },
    });
  };

  // ── readiness checklist ────────────────────────────────────────────────
  const checklist = [
    { key: 'roi',  done: roiClosed,    label: 'ROI drawn' },
    ...LINE_TOOLS.map(k => ({ key: k, done: !!lines[k], label: `Line ${k}` })),
  ];

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#050a14] text-slate-200 select-none">

      {/* ── Top header bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-cyan-900/60 bg-[#080e1c]">
        <h1 className="text-cyan-400 font-bold text-lg tracking-widest glow-cyan">
          ◈ DIGITAL TWIN · CONFIG MODE
        </h1>
        <span className="text-xs text-slate-500 tracking-wider">
          Draw ROI → set counting lines → confirm
        </span>
      </div>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-3 p-3">

        {/* ── Left toolbar ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 w-48 shrink-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
            Drawing Tools
          </p>

          {TOOL_ORDER.map(tool => {
            const style = TOOL_STYLE[tool];
            const isActive  = activeTool === tool;
            const isDone    = tool === 'roi' ? roiClosed : !!lines[tool];
            return (
              <button
                key={tool}
                onClick={() => { setLinePending(null); setActiveTool(tool); }}
                style={{
                  borderColor: isActive ? style.stroke : 'transparent',
                  color: style.labelColor,
                  boxShadow: isActive
                    ? `0 0 10px ${style.shadow}55, inset 0 0 8px ${style.shadow}22`
                    : 'none',
                }}
                className={`
                  relative flex items-center gap-2 px-3 py-2 rounded
                  border text-xs font-mono font-bold tracking-wide
                  transition-all duration-150
                  ${isActive
                    ? 'bg-[#0d1b2a]'
                    : 'bg-[#0d1020] hover:bg-[#111827]'}
                `}
              >
                {/* done checkmark */}
                {isDone && (
                  <span className="absolute right-2 text-green-400">✓</span>
                )}
                {/* colour swatch */}
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: style.stroke, boxShadow: `0 0 6px ${style.stroke}` }}
                />
                {style.label}
              </button>
            );
          })}

          <hr className="border-slate-700 my-1" />

          {/* reset current tool */}
          <button
            onClick={() => resetTool(activeTool)}
            className="px-3 py-1.5 rounded border border-slate-600 text-xs
                       text-slate-400 hover:text-white hover:border-slate-400
                       font-mono transition-all"
          >
            ↺ Reset {activeTool.toUpperCase()}
          </button>

          {/* reset all */}
          <button
            onClick={resetAll}
            className="px-3 py-1.5 rounded border border-red-900/60 text-xs
                       text-red-400 hover:text-red-200 hover:border-red-500
                       font-mono transition-all"
          >
            ✕ Clear All
          </button>

          {/* checklist */}
          <div className="mt-3 p-2 rounded border border-slate-800 bg-[#080e1c]">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">
              Checklist
            </p>
            {checklist.map(({ key, done, label }) => (
              <div key={key} className="flex items-center gap-2 text-xs mb-1">
                <span className={done ? 'text-green-400' : 'text-slate-600'}>
                  {done ? '●' : '○'}
                </span>
                <span className={done ? 'text-slate-300' : 'text-slate-600'}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Video + canvas area ───────────────────────────────────────── */}
        <div className="flex-1 relative rounded-lg overflow-hidden border border-cyan-900/40"
             style={{ boxShadow: '0 0 30px rgba(0,245,255,0.06)' }}>

          {/* Video */}
          <video
            ref={videoRef}
            src={videoSrc}
            className="w-full h-full object-contain bg-black"
            controls
            muted
          />

          {/* Canvas overlay — positioned to match the video IMAGE (not the element)
              useVideoRect calculates the letterbox-corrected rect and sets
              canvas.style.left/top/width/height accordingly */}
          <canvas
            ref={canvasRef}
            className="absolute cursor-crosshair"
            style={{ position: 'absolute' }}
            onClick={handleClick}
            onDoubleClick={handleDblClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />

          {/* Instruction overlay (top-left of video) */}
          <div className="absolute top-2 left-2 text-[11px] font-mono text-cyan-300/70
                          bg-black/50 px-2 py-1 rounded pointer-events-none">
            {activeTool === 'roi' && !roiClosed &&
              (roiPoints.length === 0
                ? '← Click to place ROI vertices'
                : roiPoints.length < 3
                ? `${roiPoints.length} point(s) — need ≥ 3`
                : 'Click near 1st point or double-click to close')}
            {activeTool === 'roi' && roiClosed && 'ROI set ✓  — select a line tool'}
            {LINE_TOOLS.includes(activeTool) && !linePending &&
              `Click to set start of line ${activeTool}`}
            {LINE_TOOLS.includes(activeTool) && linePending &&
              `Click to set end of line ${activeTool}`}
          </div>
        </div>

        {/* ── Right panel: confirm + data preview ──────────────────────── */}
        <div className="flex flex-col gap-3 w-52 shrink-0">
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`
              w-full py-3 rounded font-bold text-sm font-mono tracking-widest
              transition-all duration-200 border
              ${canConfirm
                ? `border-cyan-400 text-cyan-300 bg-cyan-950/60
                   hover:bg-cyan-900/80 hover:text-white
                   shadow-[0_0_20px_rgba(0,245,255,0.35)]`
                : 'border-slate-700 text-slate-600 cursor-not-allowed bg-transparent'}
            `}
          >
            🚀 LAUNCH AI ANALYSIS
          </button>

          {/* JSON preview */}
          <div className="flex-1 overflow-auto rounded border border-slate-800
                          bg-[#050a14] p-2 text-[10px] font-mono text-slate-500">
            <p className="text-slate-600 uppercase tracking-widest mb-1 text-[9px]">
              Config Payload Preview
            </p>
            <pre className="whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(
                {
                  roi: roiPoints,
                  lines: Object.fromEntries(
                    LINE_TOOLS.map(k => [k, lines[k]])
                  ),
                },
                null, 2
              )}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
