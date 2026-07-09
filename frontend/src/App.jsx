import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';

// ─── i18n ──────────────────────────────────────────────────────────────────
const DIR_ARROW = { E: '➡️', NE: '↗️', N: '⬆️', NW: '↖️', W: '⬅️', SW: '↙️', S: '⬇️', SE: '↘️' };
const DIR_NAME = {
  zh: { E: '向東', NE: '東北', N: '向北', NW: '西北', W: '向西', SW: '西南', S: '向南', SE: '東南' },
  en: { E: 'East', NE: 'NE', N: 'North', NW: 'NW', W: 'West', SW: 'SW', S: 'South', SE: 'SE' },
};
const TRANSLATIONS = {
  zh: {
    loading: '載入交通資料中…',
    title: '智慧路口車流分析', subtitle: 'AI 即時車流監測',
    cursor: '時間', sec: '秒',
    modeTwin: '數位孿生', modeLive: '實景影像', mode: '檢視',
    boxes: '偵測框', trails: '軌跡', heat: '熱區',
    all: '全部', car: '汽車', motorcycle: '機車', heavy: '大型車',
    cardCar: '汽車', cardMoto: '機車', cardHeavy: '大型車', cardTotal: '畫面車輛', veh: '',
    tabFlow: '車流群集排行', tabLog: '跨線紀錄', flowHint: '累積車次 · 隨時間更新',
    cluster: '群集', crossed: '跨越', noLog: '尚無跨線事件', langBtn: 'EN',
    overlaysLabel: '圖層', vehicleLabel: '車種',
    tabSignal: '號誌建議', ph_main: '主幹道 · 東西向', ph_cross: '橫向 · 轉向',
    sugGreen: '建議綠燈', demandLbl: '需求 (近2分)', advTitle: '即時號誌配時建議',
    advExtend: (p, g, d) => `建議將「${p}」綠燈延長至 ${g} 秒（較均分 ${d >= 0 ? '+' : ''}${d} 秒）`,
    advBalanced: '雙向需求接近，維持均衡配時即可。',
    advSat: '單向需求接近飽和，建議延長週期或增設專用相位。',
    collecting: '車流資料收集中…', cyc: '週期',
    pcuLabel: '每分鐘車流當量', pcuUnit: '目前',
  },
  en: {
    loading: 'Loading traffic data…',
    title: 'Smart Intersection Analytics', subtitle: 'Real-time AI traffic monitoring',
    cursor: 'Time', sec: 's',
    modeTwin: 'Digital Twin', modeLive: 'Live Camera', mode: 'View',
    boxes: 'Boxes', trails: 'Trails', heat: 'Heatmap',
    all: 'All', car: 'Cars', motorcycle: 'Motorcycles', heavy: 'Heavy',
    cardCar: 'Cars', cardMoto: 'Motorcycles', cardHeavy: 'Buses / Trucks', cardTotal: 'In view', veh: '',
    tabFlow: 'Flow Clusters', tabLog: 'Crossing Log', flowHint: 'Cumulative trips · updates over time',
    cluster: 'Cluster', crossed: 'crossed', noLog: 'No crossings yet', langBtn: '中',
    overlaysLabel: 'Overlays', vehicleLabel: 'Vehicle',
    tabSignal: 'Signal Advisor', ph_main: 'Main St · E–W', ph_cross: 'Cross · turns',
    sugGreen: 'Suggested green', demandLbl: 'Demand (last 2 min)', advTitle: 'Live signal-timing suggestion',
    advExtend: (p, g, d) => `Extend “${p}” green to ${g}s (${d >= 0 ? '+' : ''}${d}s vs even split)`,
    advBalanced: 'Demand is balanced — keep an even split.',
    advSat: 'One direction is near saturation — consider a longer cycle or a dedicated phase.',
    collecting: 'Collecting traffic demand…', cyc: 'Cycle',
    pcuLabel: 'PCU / min', pcuUnit: 'now',
  },
};

// signal phases: opposing through movements share a green; turns/cross the other
const PHASES = [
  { key: 'main', dirs: ['E', 'W'] },
  { key: 'cross', dirs: ['N', 'S', 'NE', 'NW', 'SE', 'SW'] },
];
const SIG = { WIN: 120, CYCLE: 90, LOST: 8, MIN_GREEN: 12 };

// overlay-button icons (inherit text color)
const IconBox = () => (<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><rect x="1.6" y="2.6" width="11.8" height="9.8" rx="1.6" stroke="currentColor" strokeWidth="1.6" /></svg>);
const IconTrail = () => (<svg width="17" height="12" viewBox="0 0 17 12" fill="none" aria-hidden="true"><path d="M1 8 L4.5 3 L8.5 8 L12.5 3 L16 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const IconHeat = () => (<svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="6.5" fill="currentColor" opacity="0.22" /><circle cx="7.5" cy="7.5" r="3.8" fill="currentColor" opacity="0.5" /><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor" /></svg>);

// glass button style — translucent fill, top sheen, light border, toned accent (Tailwind v4 opacity steps)
const btnCls = (active) =>
  'px-5 py-2.5 rounded-xl text-base font-medium transition-all backdrop-blur-md border ' +
  (active
    ? 'bg-sky-400/25 border-sky-300/50 text-sky-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.30),0_4px_18px_rgba(96,180,235,0.20)]'
    : 'bg-white/10 border-white/15 text-slate-200 hover:bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]');
const glassPanel = 'bg-[#0e1626]/70 backdrop-blur-xl border border-white/15 rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]';

export default function App() {
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedClass, setSelectedClass] = useState('all');
  const [masterData, setMasterData] = useState(null);
  const [activeTab, setActiveTab] = useState('flow');
  const [logs, setLogs] = useState([]);
  const [showBoxes, setShowBoxes] = useState(true);
  const [showTails, setShowTails] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [isDigitalTwin, setIsDigitalTwin] = useState(false);
  const [lang, setLang] = useState('zh');
  const T = TRANSLATIONS[lang];
  const [bgReady, setBgReady] = useState(0);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const bgImgRef = useRef(null);

  useEffect(() => {
    fetch('http://localhost:8000/static/traffic_indexed.json')
      .then(res => res.json())
      .then(data => { setMasterData(data); })
      .catch(err => console.error(err));
  }, []);

  // FSD 數位孿生底圖 (background.png，與監視器視角對齊)
  useEffect(() => {
    const img = new Image();
    img.src = 'http://localhost:8000/static/background.png';
    img.onload = () => { bgImgRef.current = img; setBgReady(v => v + 1); };
  }, []);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const floatTime = videoRef.current.currentTime;
      setCurrentTime(floatTime);
      const currentSecInt = Math.floor(floatTime);
      const freshEvents = masterData?.live_events?.[String(currentSecInt)] || [];
      if (freshEvents.length > 0) {
        setLogs(prev => {
          const exists = prev.some(e => e.id === freshEvents[0].id && e.time_str === freshEvents[0].time_str);
          if (exists) return prev;
          return [...freshEvents, ...prev].slice(0, 15);
        });
      }
    }
  };

  const smoothTrendData = useMemo(() => {
    if (!masterData?.trends) return [];
    const smooth = [];
    const trends = masterData.trends;
    const maxBucket = Math.max(...trends.map(t => t.bucket), 1200);
    const bucketMap = new Map(trends.map(t => [t.bucket, t]));
    let lastPcu = 0;
    for (let s = 0; s <= maxBucket; s++) {
      if (bucketMap.has(s)) lastPcu = bucketMap.get(s).pcu;
      smooth.push({ second: s, pcu: lastPcu + (Math.sin(s / 6) * 0.04) });
    }
    return smooth;
  }, [masterData]);

  // busiest moment → speedometer max (rounded up to a tidy value)
  const gaugeMax = useMemo(() => {
    const totals = Object.values(masterData?.live_counts || {}).map(c => c.total || 0);
    const peak = totals.length ? Math.max(...totals) : 30;
    return Math.max(10, Math.ceil(peak / 5) * 5);
  }, [masterData]);

  // 💥 60 FPS 自駕空間 3D 建模與螢光筆光流底色渲染引擎
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !masterData) return;
    
    const ctx = canvas.getContext('2d');
    const videoRect = video.getBoundingClientRect();
    
    canvas.width = videoRect.width > 0 ? videoRect.width : 800;
    canvas.height = videoRect.height > 0 ? videoRect.height : 450;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const rawWidth = 1280;
    const rawHeight = 720;

    // 1. FSD 數位孿生底圖：低多邊形 3D 城市場景 (background.png)
    if (isDigitalTwin) {
      if (bgImgRef.current) {
        ctx.drawImage(bgImgRef.current, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = '#0b0f1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    // 2. 物件內插與 60 FPS 渲染
    const currentSecInt = Math.floor(currentTime);
    const subSecondFraction = currentTime - currentSecInt;

    // 密度熱區圖：以滾動時間窗內的車輛位置累積疊加 (additive glow)
    if (showHeat) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const WIN = 15;
      const rad = Math.max(canvas.width, canvas.height) * 0.028;
      for (let s = Math.max(0, currentSecInt - WIN); s <= currentSecInt; s++) {
        (masterData.live_tracks?.[String(s)] || []).forEach(v => {
          if (selectedClass !== 'all' && v.class !== selectedClass) return;
          const hx = (v.x / rawWidth) * canvas.width;
          const hy = (v.y / rawHeight) * canvas.height;
          const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, rad);
          g.addColorStop(0, 'rgba(255,150,40,0.10)');
          g.addColorStop(0.5, 'rgba(255,90,30,0.05)');
          g.addColorStop(1, 'rgba(255,60,20,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(hx, hy, rad, 0, Math.PI * 2); ctx.fill();
        });
      }
      ctx.restore();
    }
    const vehiclesCurrent = masterData.live_tracks?.[String(currentSecInt)] || [];
    const vehiclesNext = masterData.live_tracks?.[String(currentSecInt + 1)] || [];
    const nextMap = new Map(vehiclesNext.map(v => [v.id, v]));
    const filtered = vehiclesCurrent.filter(v => selectedClass === 'all' || v.class === selectedClass);

    const getColor = (cls) => {
      if (cls === 'car') return '#3b82f6';
      if (cls === 'motorcycle') return '#f97316';
      return '#10b981';
    };

    // shade a #hex toward white (amt>0) or black (amt<0) — for 3D face lighting
    const shade = (hex, amt) => {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
      r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
      return `rgb(${r},${g},${b})`;
    };
    // low-poly footprint [width, height(px), extrude-depth] per class (raw 1280-space)
    const DIM3D = { car: [40, 20, 12], motorcycle: [22, 14, 8], truck: [54, 26, 15], bus: [54, 26, 15] };

    filtered.forEach((v) => {
      let targetX = v.x;
      let targetY = v.y;
      if (nextMap.has(v.id)) {
        const nextV = nextMap.get(v.id);
        targetX = v.x + (nextV.x - v.x) * subSecondFraction;
        targetY = v.y + (nextV.y - v.y) * subSecondFraction;
      }

      const canvasX = (targetX / rawWidth) * canvas.width;
      const canvasY = (targetY / rawHeight) * canvas.height;
      
      // 💥 讀取 YOLO 的真實 detections 寬高進行等比例網頁投影，不再盲猜大小！
      const canvasW = (v.w / rawWidth) * canvas.width;
      const canvasH = (v.h / rawHeight) * canvas.height;
      const color = getColor(v.class);

      if (showBoxes && canvasX > 0 && canvasX < canvas.width) {
        if (isDigitalTwin) {
          // FSD 數位孿生：低多邊形 3D 車輛方塊 (置於地面錨點)
          const sc = canvas.width / rawWidth;
          const [dw, dh, ddep] = DIM3D[v.class] || DIM3D.car;
          const w = dw * sc, h = dh * sc, dep = ddep * sc;
          const gx = canvasX, gy = canvasY + canvasH / 2;   // ground anchor (box bottom)
          const ox = dep, oy = dep * 0.6;
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(10,15,25,0.85)';
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.beginPath(); ctx.ellipse(gx, gy + h * 0.05, w * 0.6, h * 0.28, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = color; // front
          ctx.beginPath(); ctx.moveTo(gx - w / 2, gy - h); ctx.lineTo(gx + w / 2, gy - h); ctx.lineTo(gx + w / 2, gy); ctx.lineTo(gx - w / 2, gy); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = shade(color, -0.32); // right side
          ctx.beginPath(); ctx.moveTo(gx + w / 2, gy - h); ctx.lineTo(gx + w / 2 + ox, gy - h - oy); ctx.lineTo(gx + w / 2 + ox, gy - oy); ctx.lineTo(gx + w / 2, gy); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = shade(color, 0.30); // top
          ctx.beginPath(); ctx.moveTo(gx - w / 2, gy - h); ctx.lineTo(gx - w / 2 + ox, gy - h - oy); ctx.lineTo(gx + w / 2 + ox, gy - h - oy); ctx.lineTo(gx + w / 2, gy - h); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
          // 實景影像：真實偵測外框 + ID 標籤
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(canvasX - canvasW / 2, canvasY - canvasH / 2, canvasW, canvasH);
          const labelW = Math.max(canvasW, 42);
          const labelX = canvasX - canvasW / 2;
          const labelY = canvasY - canvasH / 2 - 13;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(labelX, labelY, labelW, 11);
          ctx.fillStyle = color;
          ctx.font = 'bold 8px monospace';
          ctx.fillText(`ID:${v.id}`, labelX + 2, labelY + 8);
        }
      }

      // ─── 💡 核心創新：寬幅螢光筆流向光帶 + 加粗核心前進實線 ───
      const path = masterData.paths?.[v.id];
      if (showTails && path && path.length > 1) {
        // [層級 1] 底層繪製：寬度 18px、具備高半透明度的「螢光筆著色光帶」包住整個軌跡
        ctx.beginPath();
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = `${color}25`; // 超柔和半透明
        path.forEach((pt, idx) => {
          const hCanvasX = (pt[0] / rawWidth) * canvas.width;
          const hCanvasY = (pt[1] / rawHeight) * canvas.height;
          if (idx === 0) ctx.moveTo(hCanvasX, hCanvasY);
          else ctx.lineTo(hCanvasX, hCanvasY);
        });
        ctx.lineTo(canvasX, canvasY);
        ctx.stroke();

        // [層級 2] 核心疊加：2.5px 加粗、完全不帶任何虛線的「核心車流前進實線導軌」
        ctx.beginPath();
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        path.forEach((pt, idx) => {
          const hCanvasX = (pt[0] / rawWidth) * canvas.width;
          const hCanvasY = (pt[1] / rawHeight) * canvas.height;
          if (idx === 0) ctx.moveTo(hCanvasX, hCanvasY);
          else ctx.lineTo(hCanvasX, hCanvasY);
        });
        ctx.lineTo(canvasX, canvasY);
        ctx.stroke();

        if (path.length > 2) {
          ctx.fillStyle = color;
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText("➔", canvasX - 5, canvasY + 4);
        }
      }
    });
  }, [currentTime, masterData, selectedClass, showBoxes, showTails, showHeat, isDigitalTwin, bgReady]);

  if (!masterData) return (
    <div className="h-screen w-screen bg-[#080b14] flex items-center justify-center gap-2 text-slate-400 text-sm">
      <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />{T.loading}
    </div>
  );

  const currentSecInt = Math.floor(currentTime);

  // 累積式群集流向排行：依當前秒數索引 cluster_series，隨影片播放即時更新
  const sortedFlows = Object.entries(masterData.cluster_series || {})
    .map(([cid, series]) => {
      const dir = masterData.cluster_dirs?.[cid] || 'E';
      const count = series[Math.min(currentSecInt, series.length - 1)] || 0;
      return { cid, count, route: `${T.cluster} ${cid} · ${DIR_NAME[lang][dir]} ${DIR_ARROW[dir]}` };
    })
    .filter(f => f.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxFlow = Math.max(...sortedFlows.map(f => f.count), 1);

  // 每秒逐幀真實可見車輛數 (frame_vehicle_counts.csv)，非窗口估算
  const lc = masterData.live_counts?.[String(currentSecInt)] || { car: 0, motorcycle: 0, truck: 0, bus: 0, total: 0 };
  const counts = { car: lc.car, motorcycle: lc.motorcycle, heavy: (lc.truck || 0) + (lc.bus || 0) };
  const activeTotal = lc.total;

  // ── rule-based signal-timing advisor (Webster-style green split) ──────────
  const series = masterData.cluster_series || {};
  const dirs = masterData.cluster_dirs || {};
  const phaseDemand = (phaseDirs) => Object.entries(series).reduce((sum, [cid, s]) => {
    if (!phaseDirs.includes(dirs[cid])) return sum;
    const now = s[Math.min(currentSecInt, s.length - 1)] || 0;
    const past = s[Math.max(0, currentSecInt - SIG.WIN)] || 0;
    return sum + (now - past);
  }, 0);
  const avail = SIG.CYCLE - SIG.LOST;
  const phases = PHASES.map(p => ({ ...p, name: T[`ph_${p.key}`], demand: phaseDemand(p.dirs) }));
  const totalDemand = phases.reduce((a, p) => a + p.demand, 0);
  phases.forEach(p => {
    p.share = totalDemand ? p.demand / totalDemand : 1 / phases.length;
    p.green = Math.max(SIG.MIN_GREEN, Math.round(avail * p.share));
  });
  const evenGreen = Math.round(avail / phases.length);
  const topPhase = phases.reduce((a, b) => (b.demand > a.demand ? b : a), phases[0]);
  const advice = totalDemand < 4 ? T.collecting
    : (topPhase.share > 0.6 ? T.advSat
      : (topPhase.share < 0.56 ? T.advBalanced
        : T.advExtend(topPhase.name, topPhase.green, topPhase.green - evenGreen)));

  const overlays = [
    { on: showBoxes, set: setShowBoxes, label: T.boxes, Icon: IconBox },
    { on: showTails, set: setShowTails, label: T.trails, Icon: IconTrail },
    { on: showHeat, set: setShowHeat, label: T.heat, Icon: IconHeat },
  ];
  const filters = [
    { id: 'all', label: T.all, dot: '#e2e8f0' },
    { id: 'car', label: T.car, dot: '#3b82f6' },
    { id: 'motorcycle', label: T.motorcycle, dot: '#f97316' },
    { id: 'truck', label: T.heavy, dot: '#10b981' },
  ];

  // speedometer geometry (180° arc, open at bottom)
  const polar = (cx, cy, r, deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (cx, cy, r, a0, a1) => {
    const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
    const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const gFrac = Math.min(activeTotal / gaugeMax, 1);
  const gEnd = 180 - 180 * gFrac;
  const [needleX, needleY] = polar(120, 120, 62, gEnd);
  const rings = [
    { label: T.cardCar, value: counts.car, color: '#3b82f6' },
    { label: T.cardMoto, value: counts.motorcycle, color: '#f97316' },
    { label: T.cardHeavy, value: counts.heavy, color: '#10b981' },
  ];
  const RING_C = 2 * Math.PI * 26;
  const currentPcu = (smoothTrendData[Math.min(currentSecInt, smoothTrendData.length - 1)] || {}).pcu || 0;

  return (
    <div className="h-screen w-screen bg-[#080b14] text-slate-200 px-6 pt-8 pb-6 flex flex-col gap-6 overflow-hidden font-sans select-none">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className={`flex items-center justify-between gap-6 px-8 py-6 ${glassPanel}`}>
        <div className="flex items-center gap-6 min-w-0">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-50 leading-tight truncate">{T.title}</h1>
            <p className="text-sm text-slate-400 leading-tight mt-1">{T.subtitle}</p>
          </div>
          <span className="flex items-center gap-2 text-base text-slate-300 font-mono border-l border-white/10 pl-6">
            <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
            {currentTime.toFixed(1)}{T.sec}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {[[false, T.modeLive], [true, T.modeTwin]].map(([val, label]) => (
            <button key={String(val)} onClick={() => setIsDigitalTwin(val)} className={btnCls(isDigitalTwin === val)}>
              {label}
            </button>
          ))}
          <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className={btnCls(false)}>
            {T.langBtn}
          </button>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-2 flex flex-col gap-6 min-h-0">
          <div className={`flex items-center gap-6 flex-wrap px-6 py-4 ${glassPanel}`}>
            <div className="flex items-center gap-3">
              <span className="text-sm uppercase tracking-wider text-slate-500 font-medium mr-1">{T.overlaysLabel}</span>
              {overlays.map((o) => (
                <button key={o.label} onClick={() => o.set(!o.on)} className={btnCls(o.on)}>
                  <span className="inline-flex items-center gap-2"><o.Icon />{o.label}</span>
                </button>
              ))}
            </div>
            <div className="w-px self-stretch bg-white/10 mx-1" />
            <div className="flex items-center gap-3">
              <span className="text-sm uppercase tracking-wider text-slate-500 font-medium mr-1">{T.vehicleLabel}</span>
              {filters.map((f) => (
                <button key={f.id} onClick={() => setSelectedClass(f.id)} className={btnCls(selectedClass === f.id)}>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.dot }} />{f.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-[#0e1626]/70 backdrop-blur-xl rounded-2xl p-2 border border-white/10 flex items-center justify-center relative flex-1 min-h-0 overflow-hidden">
            <video
              ref={videoRef}
              src="http://localhost:8000/static/traffic_video.mp4"
              controls
              className={`w-full h-full rounded-lg object-contain transition-opacity duration-500 z-0 ${isDigitalTwin ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
              onTimeUpdate={handleTimeUpdate}
            />
            {isDigitalTwin && (
              <div className="absolute top-3 left-3 z-20 text-[10px] uppercase tracking-widest text-sky-300/80 bg-[#080b14]/60 px-2 py-0.5 rounded border border-slate-700/60">
                {T.modeTwin}
              </div>
            )}
            <canvas ref={canvasRef} className="absolute pointer-events-none z-10 rounded-lg" />
          </div>

          <div className="bg-[#0e1626]/70 backdrop-blur-xl px-4 py-3 rounded-2xl border border-white/10">
            <div className="flex items-end justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">{T.pcuLabel}</span>
              <span className="text-sm font-semibold text-sky-300 tabular-nums leading-none">
                {currentPcu.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal">{T.pcuUnit}</span>
              </span>
            </div>
            <div className="h-20 w-full cursor-pointer">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={smoothTrendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
                  onClick={(e)=>e&&e.activeLabel&&(videoRef.current.currentTime=Number(e.activeLabel))}>
                  <defs>
                    <linearGradient id="pcuFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#18233a" strokeDasharray="2 4" />
                  <XAxis dataKey="second" type="number" domain={[0, 1200]}
                    ticks={[0,120,240,360,480,600,720,840,960,1080,1200]}
                    tickFormatter={(v)=>`${Math.floor(v/60)}${lang==='zh'?'分':'m'}`}
                    stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#475569" fontSize={9} width={24} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, color: '#e2e8f0', fontSize: '11px' }}
                    labelFormatter={(v)=>`${Math.floor(v/60)}:${String(Math.floor(v%60)).padStart(2,'0')}`}
                    formatter={(val)=>[Number(val).toFixed(1), 'PCU']} />
                  <Area type="monotone" dataKey="pcu" stroke="#38bdf8" fill="url(#pcuFill)" strokeWidth={1.8} />
                  <ReferenceLine x={currentSecInt} stroke="#f59e0b" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 min-h-0">
          {/* speedometer + category rings */}
          <div className="bg-[#0e1626]/70 backdrop-blur-xl rounded-2xl border border-white/10 px-5 pt-4 pb-5">
            <svg viewBox="0 0 240 132" className="w-full" style={{ maxHeight: 150 }}>
              <path d={arc(120, 120, 92, 180, 0)} fill="none" stroke="#1e293b" strokeWidth="14" strokeLinecap="round" />
              <path d={arc(120, 120, 92, 180, gEnd)} fill="none" stroke="#38bdf8" strokeWidth="14" strokeLinecap="round"
                style={{ transition: 'all 0.4s ease' }} />
              <line x1="120" y1="120" x2={needleX.toFixed(1)} y2={needleY.toFixed(1)} stroke="#e2e8f0" strokeWidth="3"
                strokeLinecap="round" style={{ transition: 'all 0.4s ease' }} />
              <circle cx="120" cy="120" r="5" fill="#e2e8f0" />
              <text x="120" y="86" textAnchor="middle" fill="#e2e8f0" fontSize="40" fontWeight="600">{activeTotal}</text>
              <text x="120" y="106" textAnchor="middle" fill="#64748b" fontSize="10" letterSpacing="1">{T.cardTotal}</text>
            </svg>
            <div className="grid grid-cols-3 gap-1 mt-1">
              {rings.map((rg) => {
                const pct = activeTotal ? rg.value / activeTotal : 0;
                return (
                  <div key={rg.label} className="flex flex-col items-center">
                    <svg viewBox="0 0 72 72" className="w-16 h-16">
                      <circle cx="36" cy="36" r="26" fill="none" stroke="#1e293b" strokeWidth="9" />
                      <circle cx="36" cy="36" r="26" fill="none" stroke={rg.color} strokeWidth="9" strokeLinecap="round"
                        strokeDasharray={`${(pct * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`}
                        transform="rotate(-90 36 36)" style={{ transition: 'stroke-dasharray 0.4s ease' }} />
                      <text x="36" y="34" textAnchor="middle" fill={rg.color} fontSize="20" fontWeight="600">{rg.value}</text>
                      <text x="36" y="48" textAnchor="middle" fill="#64748b" fontSize="10">{Math.round(pct * 100)}%</text>
                    </svg>
                    <span className="text-[10px] text-slate-400 mt-0.5 text-center leading-tight">{rg.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* tabbed panel */}
          <div className="bg-[#0e1626]/70 backdrop-blur-xl rounded-2xl border border-white/10 flex-1 flex flex-col min-h-0">
            <div className="flex px-4 pt-3 gap-2 border-b border-white/10">
              {[['flow', T.tabFlow], ['signal', T.tabSignal], ['log', T.tabLog]].map(([id, label]) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={`pb-3 px-2.5 text-sm font-medium transition-colors ${activeTab === id ? 'text-sky-300 border-b-2 border-sky-400' : 'text-slate-400 hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-none p-4">
              {activeTab === 'flow' && (
                <div className="flex flex-col gap-2.5">
                  <p className="text-[10px] text-slate-400 mb-0.5">{T.flowHint}</p>
                  {sortedFlows.map((item) => (
                    <div key={item.route} className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-300">{item.route}</span>
                        <span className="text-slate-100 font-semibold tabular-nums">{item.count}</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#080b14] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-sky-500 to-teal-400 rounded-full transition-all duration-500" style={{ width: `${(item.count / maxFlow) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'signal' && (
                <div className="flex flex-col gap-3">
                  <div className="bg-[#080b14] border border-white/10 rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">{T.advTitle}</p>
                    <p className="text-[13px] text-sky-200 leading-snug">{advice}</p>
                  </div>
                  <p className="text-[10px] text-slate-400">{T.cyc}: {SIG.CYCLE}s · {T.demandLbl}</p>
                  {phases.map((p) => (
                    <div key={p.key} className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-300">{p.name}</span>
                        <span className="text-slate-400 tabular-nums">
                          {p.demand} · <span className="text-slate-100 font-semibold">{p.green}s</span>
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#080b14] rounded-full overflow-hidden border border-white/10">
                        <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500" style={{ width: `${Math.round(p.share * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'log' && (
                <div className="text-[11px] flex flex-col gap-1.5 text-slate-300">
                  {logs.length === 0 && <p className="text-slate-600 text-center mt-4">{T.noLog}</p>}
                  {logs.map((log, idx) => (
                    <div key={idx} className="bg-[#080b14] px-2.5 py-1.5 rounded-lg border border-white/10 flex justify-between items-center font-mono">
                      <span className="text-slate-400">{log.time_str}</span>
                      <span className="text-amber-400">#{log.id}</span>
                      <span className="text-sky-300">{T.crossed} {log.line}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}