import React from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function LiveMetricCounters() {
  const { masterData, currentTime, activeFilter } = useTrafficStore();
  
  if (!masterData?.live_tracks) return <div className="text-slate-500 text-xs">加載計數中...</div>;

  const currentSecInt = Math.floor(currentTime);
  const windowTracks = [];
  const seenIds = new Set();

  // 真實對齊 20 分鐘：直接讀取當前秒數前後 2 秒的滑動觀測窗口
  for (let offset = -2; offset <= 2; offset++) {
    const checkSec = String(currentSecInt + offset);
    
    // 防禦性讀取：直接抓取 20 分鐘資料庫裡該秒數的活躍車輛陣列
    const tracksAtSec = masterData.live_tracks[checkSec] || [];
    tracksAtSec.forEach(v => {
      if (!seenIds.has(v.id)) {
        seenIds.add(v.id);
        windowTracks.push(v);
      }
    });
  }

  // 車種過濾
  const filtered = windowTracks.filter(v => activeFilter === 'all' || v.class === activeFilter);

  // 嚴格對齊原始小寫 CSV 欄位名稱進行歸類統計
  const stats = filtered.reduce((acc, cur) => {
    const cls = cur.class.toLowerCase();
    if (cls === 'car') acc.car += 1;
    else if (cls === 'motorcycle') acc.motorcycle += 1;
    else if (cls === 'truck' || cls === 'bus') acc.heavy += 1;
    return acc;
  }, { car: 0, motorcycle: 0, heavy: 0 });

  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
        <p className="text-slate-400 font-medium">🚗 小型車 (即時觀測)</p>
        <p className="text-xl font-extrabold text-blue-400 font-mono mt-0.5">{stats.car} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
        <p className="text-slate-400 font-medium">🛵 機車 (即時觀測)</p>
        <p className="text-xl font-bold text-orange-400 font-mono mt-0.5">{stats.motorcycle} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
        <p className="text-slate-400 font-medium">🚛 重型卡車 / 公車</p>
        <p className="text-xl font-bold text-emerald-400 font-mono mt-0.5">{stats.heavy} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
      <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-950 shadow-md">
        <p className="text-emerald-400 font-semibold">✨ 當前秒數活躍總量</p>
        <p className="text-xl font-black text-purple-400 font-mono mt-0.5">{filtered.length} <span className="text-[10px] text-slate-500 font-normal">輛</span></p>
      </div>
    </div>
  );
}

export default LiveMetricCounters;