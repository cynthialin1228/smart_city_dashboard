/* ═══════════════════════════════════════════════════════════════════════════
   Smart City Traffic Dashboard — app.js
   Handles: data loading, i18n language toggle, all Chart.js charts,
            heatmap, recommendations, and table rendering.
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── i18n strings ─────────────────────────────────────────────────────────────
const I18N = {
  en: {
    title:           'Smart City Traffic Analytics',
    subtitle:        'Trade Corridor Monitoring System · Department of Transportation',
    status:          'Analysis Complete',
    kpi_total:       'Total Vehicles',
    kpi_congestion:  'Congestion Index',
    kpi_peak:        'Peak Time',
    kpi_duration:    'Recording Duration',
    kpi_level:       'Traffic Level',
    chart_dist:      'Vehicle Distribution',
    chart_timeline:  'Traffic Volume Timeline',
    chart_direction: 'Directional Flow Analysis',
    chart_heatmap:   'Congestion Index per Minute',
    hl_free:         'Free Flow',
    hl_moderate:     'Moderate',
    hl_heavy:        'Heavy',
    hl_severe:       'Severe',
    recs_title:      'Actionable Recommendations',
    table_title:     'Counting Line Details',
    footer:          'Smart City Traffic Analytics · Foxconn Internship Project · 2026',
    // table headers
    th_line:         'Line',
    th_direction:    'Direction',
    th_total:        'Total Vehicles',
    th_car:          'Cars/SUVs',
    th_moto:         'Motorcycles',
    th_truck:        'Trucks',
    th_bus:          'Buses',
    th_ped:          'Pedestrians',
    th_congestion:   'Congestion',
    th_level:        'Level',
    // chart labels
    cat_car_suv:     'Cars / SUVs',
    cat_motorcycle:  'Motorcycles',
    cat_truck:       'Trucks',
    cat_bus:         'Buses',
    cat_pedestrian:  'Pedestrians',
    // directions
    dir_north:       'North',
    dir_south:       'South',
    dir_west:        'West',
    dir_east:        'East',
    // priority
    pri_high:        'HIGH',
    pri_medium:      'MED',
    pri_low:         'LOW',
    // tooltip
    tip_minute:      'Minute',
    tip_index:       'Index',
    tip_level:       'Level',
    tip_vehicles:    'Vehicles',
    // donut center
    donut_center:    'Total',
    // duration unit
    min:             'min',
    vehicles:        'vehicles',
  },
  zh: {
    title:           '智慧城市交通分析系統',
    subtitle:        '貿易廊道監控系統 · 交通局',
    status:          '分析完成',
    kpi_total:       '車輛總數',
    kpi_congestion:  '壅塞指數',
    kpi_peak:        '尖峰時段',
    kpi_duration:    '錄影時長',
    kpi_level:       '交通狀態',
    chart_dist:      '車種分佈',
    chart_timeline:  '車流量時間軸',
    chart_direction: '方向流量分析',
    chart_heatmap:   '各分鐘壅塞指數',
    hl_free:         '順暢',
    hl_moderate:     '稍塞',
    hl_heavy:        '壅塞',
    hl_severe:       '嚴重壅塞',
    recs_title:      '交通管理建議',
    table_title:     '計數線詳細資料',
    footer:          '智慧城市交通分析 · 富士康實習專案 · 2026',
    th_line:         '計數線',
    th_direction:    '方向',
    th_total:        '總車輛數',
    th_car:          '轎車/SUV',
    th_moto:         '機車',
    th_truck:        '卡車',
    th_bus:          '公車',
    th_ped:          '行人',
    th_congestion:   '壅塞指數',
    th_level:        '壅塞等級',
    cat_car_suv:     '轎車 / SUV',
    cat_motorcycle:  '機車',
    cat_truck:       '卡車',
    cat_bus:         '公車',
    cat_pedestrian:  '行人',
    dir_north:       '北向',
    dir_south:       '南向',
    dir_west:        '西向',
    dir_east:        '東向',
    pri_high:        '高',
    pri_medium:      '中',
    pri_low:         '低',
    tip_minute:      '分鐘',
    tip_index:       '指數',
    tip_level:       '等級',
    tip_vehicles:    '車輛',
    donut_center:    '總計',
    min:             '分鐘',
    vehicles:        '輛',
  },
};

// ── State ─────────────────────────────────────────────────────────────────────
let currentLang = 'en';
let trafficData  = null;

// Chart instances (kept for destroy/re-render on lang change)
let donutChart     = null;
let timelineChart  = null;
let directionChart = null;

// ── Colour palette ─────────────────────────────────────────────────────────────
const CAT_COLORS = {
  car_suv:    '#00d4ff',
  motorcycle: '#ff6b35',
  truck:      '#a855f7',
  bus:        '#22c55e',
  pedestrian: '#facc15',
};

const LEVEL_COLORS = {
  free_flow: '#22c55e',
  moderate:  '#facc15',
  heavy:     '#f97316',
  severe:    '#ef4444',
};

// ── Utilities ─────────────────────────────────────────────────────────────────
const t = (key) => (I18N[currentLang][key] ?? key);

function fmt(n) { return Number(n).toLocaleString(); }

function congestionBgColor(index) {
  if (index < 25) return LEVEL_COLORS.free_flow;
  if (index < 50) return LEVEL_COLORS.moderate;
  if (index < 75) return LEVEL_COLORS.heavy;
  return LEVEL_COLORS.severe;
}

function dirLabel(line) {
  const dir = line.direction ?? '';
  return t('dir_' + dir) || line['label_' + currentLang] || line.label_en || line.id;
}

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const resp = await fetch('data/traffic_data.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    trafficData = await resp.json();
    renderAll();
  } catch (err) {
    console.error('Failed to load traffic_data.json:', err);
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  color:#ef4444;font-family:system-ui;flex-direction:column;gap:16px;">
        <div style="font-size:48px">⚠️</div>
        <div style="font-size:20px;font-weight:700;">Dashboard data not found</div>
        <div style="color:#8b949e;font-size:14px;">
          Run the pipeline first: <code style="color:#00d4ff">bash run_pipeline.sh video_20min.mp4</code>
        </div>
      </div>`;
  }
}

// ── Master render ──────────────────────────────────────────────────────────────
function renderAll() {
  applyI18n();
  renderKPIs();
  renderDonut();
  renderTimeline();
  renderDirection();
  renderHeatmap();
  renderRecommendations();
  renderTable();
}

// ── i18n apply ─────────────────────────────────────────────────────────────────
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.getElementById('langToggle').textContent = currentLang === 'en' ? '中文' : 'English';
}

window.toggleLang = function () {
  currentLang = currentLang === 'en' ? 'zh' : 'en';
  if (trafficData) renderAll();
};

// ── KPI cards ──────────────────────────────────────────────────────────────────
function renderKPIs() {
  const m = trafficData.meta;

  document.getElementById('kv-total').textContent      = fmt(m.total_vehicles);
  document.getElementById('kv-congestion').textContent = m.overall_congestion_index + '/100';
  document.getElementById('kv-peak').textContent       = m.peak_real_time ?? '—';
  document.getElementById('kv-duration').textContent   = m.duration_minutes + ' ' + t('min');

  const level     = m.overall_congestion_level;
  const levelKey  = level.level;
  const levelText = currentLang === 'zh' ? level.label_zh : level.label_en;
  document.getElementById('kv-level').textContent = levelText;
  document.getElementById('kv-level').style.color = LEVEL_COLORS[levelKey] ?? '#00d4ff';

  // Icon
  const icons = { free_flow: '🟢', moderate: '🟡', heavy: '🟠', severe: '🔴' };
  document.getElementById('kv-level-icon').textContent = icons[levelKey] ?? '🟢';
}

// ── Donut chart ────────────────────────────────────────────────────────────────
function renderDonut() {
  const cats   = Object.keys(trafficData.total_by_category);
  const values = Object.values(trafficData.total_by_category);
  const total  = values.reduce((a, b) => a + b, 0);
  const labels = cats.map(c => t('cat_' + c));
  const colors = cats.map(c => CAT_COLORS[c] ?? '#888');

  // Center label
  const center = document.getElementById('donut-center-label');
  center.innerHTML = `<span class="big">${fmt(total)}</span><br>${t('donut_center')}`;

  if (donutChart) donutChart.destroy();
  donutChart = new Chart(document.getElementById('donutChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: '#161b22',
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.parsed)} (${((ctx.parsed / total) * 100).toFixed(1)}%)`,
          },
        },
      },
      animation: { animateRotate: true, duration: 800 },
    },
  });

  // Custom legend
  const legendEl = document.getElementById('donut-legend');
  legendEl.innerHTML = cats.map((c, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <span>${labels[i]}: <strong>${fmt(values[i])}</strong></span>
    </div>`).join('');
}

// ── Timeline chart ─────────────────────────────────────────────────────────────
function renderTimeline() {
  const tl     = trafficData.congestion_timeline;
  const labels = tl.map(d => d.real_time);
  const cats   = ['car_suv', 'motorcycle', 'truck', 'bus', 'pedestrian'];

  const datasets = cats.map(cat => ({
    label: t('cat_' + cat),
    data:  tl.map(d => d.counts[cat] ?? 0),
    backgroundColor: CAT_COLORS[cat] + 'cc',
    borderColor:     CAT_COLORS[cat],
    borderWidth: 1,
    stack: 'traffic',
  }));

  if (timelineChart) timelineChart.destroy();
  timelineChart = new Chart(document.getElementById('timelineChart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          stacked: true,
          ticks: { color: '#8b949e', maxRotation: 45, font: { size: 10 } },
          grid:  { color: 'rgba(48,54,61,0.5)' },
        },
        y: {
          stacked: true,
          ticks: { color: '#8b949e' },
          grid:  { color: 'rgba(48,54,61,0.5)' },
          title: { display: true, text: t('vehicles'), color: '#8b949e', font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#8b949e', boxWidth: 12, font: { size: 11 } },
          position: 'bottom',
        },
      },
      animation: { duration: 600 },
    },
  });
}

// ── Direction bar chart ────────────────────────────────────────────────────────
function renderDirection() {
  const lines  = trafficData.counting_lines;
  const cats   = ['car_suv', 'motorcycle', 'truck', 'bus', 'pedestrian'];
  const labels = lines.map(l => dirLabel(l));

  const datasets = cats.map(cat => ({
    label: t('cat_' + cat),
    data:  lines.map(l => l.counts_by_category?.[cat] ?? 0),
    backgroundColor: CAT_COLORS[cat] + 'cc',
    borderColor:     CAT_COLORS[cat],
    borderWidth: 1,
    borderRadius: 4,
  }));

  if (directionChart) directionChart.destroy();
  directionChart = new Chart(document.getElementById('directionChart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: { color: '#8b949e' },
          grid:  { display: false },
        },
        y: {
          ticks: { color: '#8b949e' },
          grid:  { color: 'rgba(48,54,61,0.5)' },
          title: { display: true, text: t('vehicles'), color: '#8b949e', font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#8b949e', boxWidth: 12, font: { size: 11 } },
          position: 'bottom',
        },
      },
      animation: { duration: 600 },
    },
  });
}

// ── Heatmap ────────────────────────────────────────────────────────────────────
function renderHeatmap() {
  const tl = trafficData.congestion_timeline;
  const wrap = document.getElementById('heatmap');
  wrap.innerHTML = '';

  // Tooltip element
  let tooltip = document.getElementById('heatmap-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'heatmap-tooltip';
    tooltip.className = 'tooltip';
    document.body.appendChild(tooltip);
  }

  tl.forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    cell.setAttribute('data-level', d.congestion_level.level);
    cell.title = '';

    const totalVehicles = Object.values(d.counts).reduce((a, b) => a + b, 0);
    const levelLabel = currentLang === 'zh'
      ? d.congestion_level.label_zh
      : d.congestion_level.label_en;

    cell.addEventListener('mouseenter', (e) => {
      tooltip.innerHTML = `
        <div class="tooltip-title">${d.real_time}  (${t('tip_minute')} ${d.minute})</div>
        <div>${t('tip_index')}: <strong>${d.congestion_index}</strong>/100</div>
        <div>${t('tip_level')}: <strong style="color:${congestionBgColor(d.congestion_index)}">${levelLabel}</strong></div>
        <div>${t('tip_vehicles')}: <strong>${totalVehicles}</strong></div>`;
      tooltip.classList.add('visible');
    });

    cell.addEventListener('mousemove', (e) => {
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top  = (e.clientY + 14) + 'px';
    });

    cell.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });

    wrap.appendChild(cell);
  });
}

// ── Recommendations ────────────────────────────────────────────────────────────
function renderRecommendations() {
  const recs = trafficData.recommendations;
  const grid = document.getElementById('rec-grid');
  const badge = document.getElementById('rec-count-badge');

  badge.textContent = recs.length;

  grid.innerHTML = recs.map(r => {
    const title  = currentLang === 'zh' ? r.title_zh  : r.title_en;
    const detail = currentLang === 'zh' ? r.detail_zh : r.detail_en;
    const priLabel = t('pri_' + r.priority);
    return `
      <div class="rec-item priority-${r.priority}">
        <div class="rec-header">
          <span class="rec-icon">${r.icon}</span>
          <span class="rec-title">${title}</span>
          <span class="rec-priority">${priLabel}</span>
        </div>
        <p class="rec-detail">${detail}</p>
      </div>`;
  }).join('');
}

// ── Table ──────────────────────────────────────────────────────────────────────
function renderTable() {
  const lines = trafficData.counting_lines;

  // Header
  document.getElementById('lineTableHead').innerHTML = `
    <tr>
      <th>${t('th_line')}</th>
      <th>${t('th_direction')}</th>
      <th>${t('th_total')}</th>
      <th>${t('th_car')}</th>
      <th>${t('th_moto')}</th>
      <th>${t('th_truck')}</th>
      <th>${t('th_bus')}</th>
      <th>${t('th_ped')}</th>
      <th>${t('th_congestion')}</th>
      <th>${t('th_level')}</th>
    </tr>`;

  // Body
  document.getElementById('lineTableBody').innerHTML = lines.map(l => {
    const c = l.counts_by_category ?? {};
    const idx = l.congestion_index ?? 0;
    const lvl = l.congestion_level ?? {};
    const barColor = congestionBgColor(idx);
    const levelLabel = currentLang === 'zh' ? lvl.label_zh : lvl.label_en;
    const dirText = dirLabel(l);

    return `
      <tr>
        <td><strong>${l.id}</strong></td>
        <td>${dirText}</td>
        <td><strong>${fmt(l.total_vehicles ?? 0)}</strong></td>
        <td>${fmt(c.car_suv    ?? 0)}</td>
        <td>${fmt(c.motorcycle ?? 0)}</td>
        <td>${fmt(c.truck      ?? 0)}</td>
        <td>${fmt(c.bus        ?? 0)}</td>
        <td>${fmt(c.pedestrian ?? 0)}</td>
        <td>
          <div class="cbar-wrap">
            <div class="cbar">
              <div class="cbar-fill" style="width:${idx}%;background:${barColor}"></div>
            </div>
            <span class="cbar-num">${idx}</span>
          </div>
        </td>
        <td>
          <span class="badge badge-${lvl.level ?? 'free_flow'}">${levelLabel}</span>
        </td>
      </tr>`;
  }).join('');
}

// ── Boot ───────────────────────────────────────────────────────────────────────
loadData();
