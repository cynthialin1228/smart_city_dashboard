import React from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function VehicleFilterBar() {
  const { activeFilter, setActiveFilter } = useTrafficStore();

  const options = [
    { id: 'all', label: '🚙 觀測全部車種' },
    { id: 'car', label: '汽車' },
    { id: 'motorcycle', label: '機車' },
    { id: 'truck', label: '卡車' }
  ];

  return (
    <div className="flex gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-700">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => setActiveFilter(opt.id)}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
            activeFilter === opt.id
              ? 'bg-emerald-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default VehicleFilterBar;