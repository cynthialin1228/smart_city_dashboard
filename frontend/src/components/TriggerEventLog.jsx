import React, { useEffect, useState } from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function TriggerEventLog() {
  const { masterData, currentTime } = useTrafficStore();
  const [eventList, setEventList] = useState([]);

  useEffect(() => {
    const freshEvents = masterData?.live_events?.[String(currentTime)] || [];
    if (freshEvents.length > 0) {
      setEventList(prev => [...freshEvents, ...prev].slice(0, 15)); // 保持最新 15 筆
    }
  }, [currentTime, masterData]);

  return (
    <div className="flex-1 overflow-y-auto font-mono text-[11px] flex flex-col gap-1 pr-1 scrollbar-thin">
      {eventList.length === 0 ? (
        <div className="text-slate-500 italic text-center py-4">等待車輛跨越路口偵測線...</div>
      ) : (
        eventList.map((evt, k) => (
          <div key={k} className="bg-slate-900 px-2 py-1.5 rounded border border-slate-800 flex justify-between items-center">
            <span className="text-slate-400">{evt.time_str}</span>
            <span className="text-amber-400 font-bold">ID:{evt.id}</span>
            <span className="bg-slate-800 text-slate-300 px-1 py-0.2 rounded text-[9px] uppercase">{evt.type}</span>
            <span className="text-emerald-400 font-medium">觸發 {evt.line_name}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default TriggerEventLog;