import React from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function LiveMetricCounters() {
  const { masterData, currentTime, activeFilter } = useTrafficStore();
  const currentVehicles = masterData?.live_tracks?.[String(currentTime)] || [];

  // 過濾當前車種
  const filtered = currentVehicles.filter(v => activeFilter === 'all' || v.type === activeFilter);

  const typeCounts = filtered.reduce((acc, cur) => {
    acc[cur.type] = (acc[cur.type] || 0) + 1;
    return acc;
  }, { car: 0, motorcycle: 0, truck: 0, bus: 0 });

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700">
        <p className="text-[10px] text-slate-400">🚗 小型車 (當前畫面)</p>
        <p className="text-xl font-bold text-blue-400 font-mono mt-0.5">{typeCounts.car}</p>
      </div>
      <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700">
        <p className="text-[10px] text-slate-400">🛵 機車 (當前畫面)</p>
        <p className="text-xl font-bold text-orange-400 font-mono mt-0.5">{typeCounts.motorcycle}</p>
      </div>
      <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700">
        <p className="text-[10px] text-slate-400">🚚 大型客貨車</p>
        <p className="text-xl font-bold text-emerald-400 font-mono mt-0.5">{typeCounts.truck + typeCounts.bus}</p>
      </div>
      <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900">
        <p className="text-[10px] text-slate-400">📊 當前畫面總計</p>
        <p className="text-xl font-bold text-purple-400 font-mono mt-0.5">{filtered.length}</p>
      </div>
    </div>
  );
}

export default LiveMetricCounters;