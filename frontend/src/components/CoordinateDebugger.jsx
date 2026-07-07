/**
 * CoordinateDebugger.jsx  –  Spatial coordinate verification tool
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Hidden debug panel (visible on F12 when URL has ?debug=1)
 * Shows:
 *   - Video element actual dimensions
 *   - Canvas dimensions
 *   - Normalized coordinate examples
 *   - Alignment status
 *
 * Usage: Add to Dashboard and trigger with URL query param
 */

import { useRef, useEffect, useState } from 'react';

export default function CoordinateDebugger({ videoRef, canvasRef, config }) {
  const [visible, setVisible] = useState(false);
  const [info, setInfo] = useState({});

  // ── listen for debug URL param ─────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setVisible(params.get('debug') === '1');
  }, []);

  // ── update debug info ──────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    const updateInfo = () => {
      const video = videoRef?.current;
      const canvas = canvasRef?.current;

      if (!video || !canvas) {
        setInfo({ error: 'Video or canvas not ready' });
        return;
      }

      const videoRect = video.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      // Check if sizes match
      const sizeMatch = Math.abs(videoRect.width - canvasRect.width) < 1 &&
                        Math.abs(videoRect.height - canvasRect.height) < 1;

      setInfo({
        video: {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          displayWidth: Math.round(videoRect.width),
          displayHeight: Math.round(videoRect.height),
        },
        canvas: {
          width: canvas.width,
          height: canvas.height,
          displayWidth: Math.round(canvasRect.width),
          displayHeight: Math.round(canvasRect.height),
        },
        alignment: {
          sizeMatch,
          pixelRatio: (video.videoWidth / videoRect.width).toFixed(3),
          status: sizeMatch ? '✅ ALIGNED' : '❌ MISMATCH',
        },
        lines: config?.lines ? Object.entries(config.lines).map(([key, pts]) => ({
          key,
          start: `(${pts[0][0].toFixed(3)}, ${pts[0][1].toFixed(3)})`,
          end: `(${pts[1][0].toFixed(3)}, ${pts[1][1].toFixed(3)})`,
        })) : [],
      });
    };

    const timer = setInterval(updateInfo, 500);
    updateInfo();
    return () => clearInterval(timer);
  }, [visible, videoRef, canvasRef, config]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95
                    border-t border-cyan-500 text-[11px] font-mono
                    text-cyan-300 p-2 max-h-64 overflow-y-auto">

      <div className="grid grid-cols-3 gap-3">

        {/* Video Info */}
        <div className="border border-cyan-700 p-2 rounded">
          <p className="font-bold text-cyan-400 mb-1">VIDEO</p>
          <p>Native: {info.video?.videoWidth}×{info.video?.videoHeight}</p>
          <p>Display: {info.video?.displayWidth}×{info.video?.displayHeight}</p>
        </div>

        {/* Canvas Info */}
        <div className="border border-cyan-700 p-2 rounded">
          <p className="font-bold text-cyan-400 mb-1">CANVAS</p>
          <p>DOM: {info.canvas?.width}×{info.canvas?.height}</p>
          <p>Display: {info.canvas?.displayWidth}×{info.canvas?.displayHeight}</p>
        </div>

        {/* Alignment Status */}
        <div className="border border-cyan-700 p-2 rounded">
          <p className="font-bold text-cyan-400 mb-1">ALIGNMENT</p>
          <p className={info.alignment?.sizeMatch ? 'text-green-400' : 'text-red-400'}>
            {info.alignment?.status}
          </p>
          <p>Pixel Ratio: {info.alignment?.pixelRatio}</p>
        </div>
      </div>

      {/* Lines Info */}
      {info.lines?.length > 0 && (
        <div className="mt-2 border border-cyan-700 p-2 rounded">
          <p className="font-bold text-cyan-400 mb-1">COUNTING LINES</p>
          <div className="grid grid-cols-4 gap-2">
            {info.lines.map(line => (
              <div key={line.key} className="border border-cyan-600/50 p-1">
                <p className="text-yellow-400 font-bold">{line.key}</p>
                <p className="text-[10px]">Start: {line.start}</p>
                <p className="text-[10px]">End: {line.end}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-slate-500 text-[10px] mt-2">
        💡 Add <code>?debug=1</code> to URL to see this panel
      </p>
    </div>
  );
}
