import React from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function DirectionFlowMap() {
  const { masterData } = useTrafficStore();
  const odMatrix = masterData?.od_matrix || {};

  const flowItems = Object.entries(odMatrix).map(([route, count]) => ({ route, count }));
  const maxFlowValue = Math.max(...flowItems.map(f => f.count), 1);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col justify-start gap-3 p-1 pr-2 scrollbar-thin">
      {flowItems.length === 0 ? (
        <div className="text-center text-xs text-slate-500 italic py-6">無明確起迄(OD)轉向數據</div>
      ) : (
        flowItems.sort((a, b) => b.count - a.count).map((item) => {
          const ratioWidth = (item.count / maxFlowValue) * 100;
          return (
            <div key={item.route} className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-mono bg-slate-900 px-2 py-0.5 rounded text-[10px]">
                  {item.route}
                </span>
                <span className="text-emerald-400 font-bold">{item.count} 輛</span>
              </div>
              <div className="w-full h-2.5 bg-slate-950 rounded-full border border-slate-800 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-600 to-teal-400 rounded-full transition-all duration-500"
                  style={{ width: `${ratioWidth}%` }}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default DirectionFlowMap;