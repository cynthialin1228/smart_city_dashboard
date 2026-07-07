import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { useTrafficStore } from '../store/useTrafficStore';

function TrendChartScrubber() {
  const { masterData, currentTime, setCurrentTime } = useTrafficStore();
  const chartData = masterData?.trends || [];

  // 計算當前時間落在哪一個一分鐘區間 (bucket)
  const activeBucket = Math.floor(currentTime / 60) * 60;

  const handleChartClick = (state) => {
    if (state && state.activeLabel) {
      setCurrentTime(Number(state.activeLabel));
    }
  };

  return (
    <div className="h-28 w-full cursor-pointer">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} onClick={handleChartClick} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
          <XAxis dataKey="bucket" tickFormatter={(v) => `${Math.floor(v/60)}分`} stroke="#64748b" fontSize={10} />
          <YAxis stroke="#64748b" fontSize={10} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff', fontSize: '11px' }}
            formatter={(val) => [val, "PCU 當量流量"]}
          />
          <Area type="monotone" dataKey="pcu" stroke="#10b981" fill="rgba(16, 185, 129, 0.15)" strokeWidth={2} />
          {/* 時間連動紅線 */}
          <ReferenceLine x={activeBucket} stroke="#ef4444" strokeWidth={2} strokeDasharray="3 3" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TrendChartScrubber;