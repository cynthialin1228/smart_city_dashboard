import React from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function LiveMetricCounters() {
  const { masterData, currentTime, activeFilter } = useTrafficStore();
  
  // 安全防禦：如果尚未讀取到資料，顯示骨架屏
  if (!masterData?.live_tracks) return <div className="text-slate-500 text-xs">加載計數中...</div>;

  const currentSecInt = Math.floor(currentTime);
  const windowTracks = [];
  const seenIds = new Set();

  // 採用前後 2 秒的滑動觀測視窗，平衡辨識突發性斷訊的問題
  for (let offset = -2; offset <= 2; offset++) {
    const checkSec = String((currentSecInt + offset + 180) % 180); // 確保在 3 分鐘影片內循環
    const tracksAtSec = masterData.live_tracks[checkSec] || [];
    tracksAtSec.forEach(v => {
      if (!seenIds.has(v.id)) {
        seenIds.add(v.id);
        windowTracks.push(v);
      }
    });
  }

  // 車種篩選過濾
  const filtered = windowTracks.filter(v => activeFilter === 'all' || v.class === activeFilter);

  // 初始化統計變數
  const stats = filtered.reduce((acc, cur) => {
    const cls = cur.class.toLowerCase().strip ? cur.class.toLowerCase().strip() : cur.class.toLowerCase();
    if (cls === 'car') acc.car += 1;
    else if (cls === 'motorcycle') acc.motorcycle += 1;
    else if (cls === 'truck' || cls === 'bus') acc.heavy += 1;
    return acc;
  }, { car: 0, motorcycle: 0, heavy: 0 });

  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
        <p className="text-slate-400 font-medium">🚗 小型車 (即時)</p>
        <p className="text-xl font-extrabold text-blue-400 font-mono mt-0.5">{stats.car} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
        <p className="text-slate-400 font-medium">🛵 機車 (即時)</p>
        <p className="text-xl font-bold text-orange-400 font-mono mt-0.5">{stats.motorcycle} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
        <p className="text-slate-400 font-medium">🚛 大型客貨車</p>
        <p className="text-xl font-bold text-emerald-400 font-mono mt-0.5">{stats.heavy} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 shadow-md">
        <p className="text-emerald-400 font-semibold">✨ 畫面活跃總計</p>
        <p className="text-xl font-black text-purple-400 font-mono mt-0.5">{filtered.length} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
    </div>
  );
}

export default LiveMetricCounters;