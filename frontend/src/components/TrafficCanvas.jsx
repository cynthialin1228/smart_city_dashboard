import React, { useRef, useEffect } from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

export default function TrafficCanvas() {
  const canvasRef = useRef(null);
  const { masterData, currentTime, activeFilter } = useTrafficStore();
  
  const currentVehicles = masterData?.live_tracks?.[String(Math.floor(currentTime))] || [];

  // 統一色彩語意學
  const getColorByClass = (cls) => {
    if (cls === 'car') return '#60a5fa';       // 藍色 🟦
    if (cls === 'motorcycle') return '#fb923c'; // 橘色 🟧
    return '#34d399';                           // 大貨車/公車 🟩
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // 清空上一影格的畫布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 依據車種過濾器進行分層繪製
    const filtered = currentVehicles.filter(v => activeFilter === 'all' || v.class === activeFilter);

    filtered.forEach(v => {
      const color = getColorByClass(v.class);
      const [x, y] = v.pos;
      
      // 幾何縮放對齊調整 (將演算法 1920 座標平滑映射至 HTML 畫布寬高)
      const scaleX = canvas.width / 1280; 
      const scaleY = canvas.height / 720;
      const canvasX = x * scaleX;
      const canvasY = y * scaleY;

      // 創新功能 1：用精緻的霓虹線框（Bounding Box）把移動物體匡住
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(canvasX - 18, canvasY - 18, 36, 36);

      // 附加物件智慧標籤
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(canvasX - 18, canvasY - 32, 45, 14);
      ctx.fillStyle = color;
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`ID:${v.id}`, canvasX - 15, canvasY - 22);

      // 創新功能 2：渲染歷史尾跡流線 (Trajectory Tails) 代表車流方向
      if (v.history && v.history.length > 1) {
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]); // 虛線光流感
        v.history.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt[0] * scaleX, pt[1] * scaleY);
          else ctx.lineTo(pt[0] * scaleX, pt[1] * scaleY);
        });
        ctx.strokeStyle = `${color}88`; // 帶有透明度的尾跡
        ctx.stroke();
        ctx.setLineDash([]); // 還原實線
      }
    });
  }, [currentVehicles, activeFilter]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={450}
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-10 rounded-lg"
    />
  );
}