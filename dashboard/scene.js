/* ═══════════════════════════════════════════════════════════════════════════
   scene.js  —  Smart City Scene Viewer  (Static only)
   Three view modes rendered on a single <canvas>:
     · Top-Down   — overhead 2D map view
     · Perspective — 1-point perspective road from driver/CCTV eye level
     · Isometric  — pure Canvas-2D isometric projection (no Three.js)
   Two overlay modes:
     · Flow    — directional arrows with Tesla-style HUD count labels
     · Heatmap — colour-coded congestion zones per road section
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let sceneData    = null;
let sceneLang    = 'en';
let sceneView    = 'topdown';   // topdown | perspective | isometric
let sceneOverlay = 'flow';      // flow | heatmap
let scrubMinute  = 7;
let vehicles     = [];

const getCanvas = () => document.getElementById('sceneCanvas');

// ── Palette ───────────────────────────────────────────────────────────────────
const VCOLORS = {
  car_suv:    { body:'#00d4ff', glass:'#003d55', stroke:'#0099bb', shadow:'rgba(0,212,255,0.4)' },
  motorcycle: { body:'#ff6b35', glass:'#882200', stroke:'#cc4400', shadow:'rgba(255,107,53,0.4)' },
  truck:      { body:'#a855f7', glass:'#3b0066', stroke:'#7c22d4', shadow:'rgba(168,85,247,0.4)' },
  bus:        { body:'#22c55e', glass:'#003311', stroke:'#16a34a', shadow:'rgba(34,197,94,0.4)'  },
  pedestrian: { body:'#facc15', glass:'#664d00', stroke:'#ca8a04', shadow:'rgba(250,204,21,0.4)' },
};

// ── i18n ──────────────────────────────────────────────────────────────────────
const SI18N = {
  en: {
    north:'North', south:'South', west:'West', east:'East',
    cat_car_suv:'Cars/SUVs', cat_motorcycle:'Motorcycles',
    cat_truck:'Trucks', cat_bus:'Buses', cat_pedestrian:'Pedestrians',
    low:'Low', high:'High', congestion:'Congestion',
    stat_cars:'Cars/SUVs', stat_moto:'Motorcycles', stat_trucks:'Trucks',
    total:'Total', per_min:'/ min',
  },
  zh: {
    north:'北', south:'南', west:'西', east:'東',
    cat_car_suv:'轎車/SUV', cat_motorcycle:'機車',
    cat_truck:'卡車', cat_bus:'公車', cat_pedestrian:'行人',
    low:'低', high:'高', congestion:'壅塞',
    stat_cars:'轎車/SUV', stat_moto:'機車', stat_trucks:'卡車',
    total:'總計', per_min:'/ 分鐘',
  },
};
const st = k => SI18N[sceneLang][k] ?? k;

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════
window.initScene = function(data, lang) {
  sceneData = data;
  sceneLang = lang;
  fitCanvas();
  buildVehicles();
  draw();
  renderSceneStats();
  renderSceneLegend();
};

window.setView = function(v) {
  sceneView = v;
  document.querySelectorAll('#viewBtns .ctrl-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === v));
  buildVehicles();
  draw();
};

window.setMotion = function() {};  // removed — no-op kept for safety

window.setOverlay = function(o) {
  sceneOverlay = o;
  document.querySelectorAll('#overlayBtns .ctrl-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.overlay === o));
  draw();
};

window.onScrub = function(val) {
  scrubMinute = parseInt(val);
  const entry = (sceneData?.congestion_timeline ?? [])[scrubMinute];
  document.getElementById('scrubTimeLabel').textContent = entry?.real_time ?? '—';
  buildVehicles();
  draw();
  renderSceneStats();
};

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function fitCanvas() {
  const c  = getCanvas();
  const vp = c.parentElement;
  c.width  = vp.clientWidth  || 900;
  c.height = vp.clientHeight || 580;
}

window.addEventListener('resize', () => {
  if (document.getElementById('panel-scene').style.display !== 'none' && sceneData) {
    fitCanvas(); buildVehicles(); draw();
  }
});

// ── Shared helpers ────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);    ctx.arcTo(x+w,y,  x+w,y+r,  r);
  ctx.lineTo(x+w,y+h-r);  ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h);    ctx.arcTo(x,y+h,  x,y+h-r,  r);
  ctx.lineTo(x,y+r);      ctx.arcTo(x,y,    x+r,y,     r);
  ctx.closePath();
}

function hudBox(ctx, x, y, lines, accentColor) {
  // lines: [{text, color, bold}]
  ctx.save();
  ctx.font = '11px "Segoe UI",system-ui';
  const pad = 8, lineH = 16;
  let maxW = 0;
  lines.forEach(l => {
    ctx.font = (l.bold ? 'bold ' : '') + '11px "Segoe UI",system-ui';
    maxW = Math.max(maxW, ctx.measureText(l.text).width);
  });
  const bw = maxW + pad*2, bh = lines.length * lineH + pad*1.5;

  // Glass background
  ctx.fillStyle = 'rgba(8,14,26,0.88)';
  roundRect(ctx, x, y, bw, bh, 5);
  ctx.fill();
  // Accent left border
  ctx.fillStyle = accentColor;
  ctx.fillRect(x, y+4, 2.5, bh-8);
  // Cyan corner tick
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x+bw-10,y); ctx.lineTo(x+bw,y); ctx.lineTo(x+bw,y+10);
  ctx.stroke();

  lines.forEach((l, i) => {
    ctx.font = (l.bold ? 'bold ' : '') + '11px "Segoe UI",system-ui';
    ctx.fillStyle = l.color ?? '#e6edf3';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(l.text, x+pad+4, y+pad*0.75+i*lineH);
  });
  ctx.restore();
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIEW 1 — TOP-DOWN
// ═════════════════════════════════════════════════════════════════════════════
function drawTopDown(ctx, W, H) {
  const cx = W/2, cy = H/2;
  const rw = W*0.13, rh = H*0.13;  // road half-widths

  // ── City blocks ────────────────────────────────────────────────────────────
  ctx.fillStyle = '#0b1a10';
  ctx.fillRect(0,0,W,H);

  const quads = [
    [0,0,cx-rw,cy-rh],[cx+rw,0,W-(cx+rw),cy-rh],
    [0,cy+rh,cx-rw,H-(cy+rh)],[cx+rw,cy+rh,W-(cx+rw),H-(cy+rh)],
  ];
  quads.forEach(([x,y,w,h]) => {
    ctx.fillStyle = '#0f1a0f';
    ctx.fillRect(x,y,w,h);
    // Stylised building footprints
    for (let bx=x+16;bx<x+w-20;bx+=34) {
      for (let by=y+16;by<y+h-20;by+=34) {
        const bw2=14+Math.random()*12, bh2=14+Math.random()*12;
        ctx.fillStyle = `rgba(${20+Math.random()*15|0},${35+Math.random()*20|0},${50+Math.random()*20|0},0.9)`;
        roundRect(ctx,bx,by,bw2,bh2,2); ctx.fill();
        // window glow
        ctx.fillStyle = 'rgba(0,212,255,0.07)';
        roundRect(ctx,bx+2,by+2,bw2-4,bh2-4,1); ctx.fill();
      }
    }
  });

  // ── Road surface ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#182030'; ctx.fillRect(cx-rw,0,rw*2,H);
  ctx.fillStyle = '#182030'; ctx.fillRect(0,cy-rh,W,rh*2);
  ctx.fillStyle = '#1c2840'; ctx.fillRect(cx-rw,cy-rh,rw*2,rh*2); // junction

  // Kerb lines
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1.5;
  [[cx-rw,0,cx-rw,cy-rh],[cx+rw,0,cx+rw,cy-rh],
   [cx-rw,cy+rh,cx-rw,H],[cx+rw,cy+rh,cx+rw,H],
   [0,cy-rh,cx-rw,cy-rh],[0,cy+rh,cx-rw,cy+rh],
   [cx+rw,cy-rh,W,cy-rh],[cx+rw,cy+rh,W,cy+rh]
  ].forEach(([x1,y1,x2,y2])=>{
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  });

  // Centre dashes (yellow)
  ctx.setLineDash([16,12]); ctx.strokeStyle='rgba(255,200,0,0.4)'; ctx.lineWidth=2;
  [[cx,0,cx,cy-rh],[cx,cy+rh,cx,H],[0,cy,cx-rw,cy],[cx+rw,cy,W,cy]].forEach(([x1,y1,x2,y2])=>{
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  });
  ctx.setLineDash([]);

  // Stop lines
  ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=3.5;
  [[cx-rw,cy-rh,cx+rw,cy-rh],[cx-rw,cy+rh,cx+rw,cy+rh],
   [cx-rw,cy-rh,cx-rw,cy+rh],[cx+rw,cy-rh,cx+rw,cy+rh]
  ].forEach(([x1,y1,x2,y2])=>{
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  });

  // Crosswalks
  ctx.fillStyle='rgba(255,255,255,0.17)';
  const sw=7,sg=5;
  for(let x=cx-rw+4;x<cx+rw-4;x+=sw+sg){ ctx.fillRect(x,cy-rh-16,sw,16); ctx.fillRect(x,cy+rh,sw,16); }
  for(let y=cy-rh+4;y<cy+rh-4;y+=sw+sg){ ctx.fillRect(cx-rw-16,y,16,sw); ctx.fillRect(cx+rw,y,16,sw); }

  return { cx, cy, rw, rh };
}

// Draw a vehicle in top-down view
function drawVehicleTopDown(ctx, v, cx, cy) {
  const col = VCOLORS[v.cat];
  const { x, y, size, dir } = v;
  const horiz = (dir==='west'||dir==='east');
  ctx.save();
  ctx.translate(x, y);
  if (horiz) ctx.rotate(Math.PI/2);

  // Shadow
  ctx.shadowColor = col.shadow; ctx.shadowBlur = 8;

  if (v.cat === 'pedestrian') {
    ctx.beginPath(); ctx.arc(0,0,size,0,Math.PI*2);
    ctx.fillStyle=col.body; ctx.fill();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=1.2; ctx.stroke();
    ctx.shadowBlur=0;
    ctx.beginPath(); ctx.arc(0,-size*0.35,size*0.42,0,Math.PI*2);
    ctx.fillStyle=col.stroke; ctx.fill();
  } else if (v.cat === 'motorcycle') {
    ctx.beginPath(); ctx.ellipse(0,0,size*0.45,size*1.3,0,0,Math.PI*2);
    ctx.fillStyle=col.body; ctx.fill();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=1.2; ctx.stroke();
  } else {
    const w = v.cat==='bus'?size*1.05:size*0.82;
    const h = v.cat==='truck'?size*2.1:v.cat==='bus'?size*2.5:size*1.75;
    roundRect(ctx,-w,-h/2,w*2,h,3.5); ctx.fillStyle=col.body; ctx.fill();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=1.4; ctx.stroke();
    ctx.shadowBlur=0;
    // Windshield
    roundRect(ctx,-w*0.68,-h/2+h*0.07,w*1.36,h*0.24,2);
    ctx.fillStyle=col.glass; ctx.fill();
    // Headlights
    ctx.fillStyle='rgba(255,255,180,0.9)';
    ctx.fillRect(-w*0.58,-h/2+2,w*0.38,3.5);
    ctx.fillRect( w*0.20,-h/2+2,w*0.38,3.5);
  }
  ctx.shadowBlur=0; ctx.restore();
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIEW 2 — 1-POINT PERSPECTIVE  (eye-level, looking into the intersection)
//  Camera sits on the south side looking north.
//  Everything uses a single vanishing point VP = (cx, hy).
// ═════════════════════════════════════════════════════════════════════════════
function drawPerspective(ctx, W, H) {
  const cx  = W / 2;
  const hy  = H * 0.40;   // horizon / vanishing point Y
  const vp  = { x: cx, y: hy };

  // ── Sky ─────────────────────────────────────────────────────────────────────
  const sky = ctx.createLinearGradient(0,0,0,hy);
  sky.addColorStop(0,'#060c18'); sky.addColorStop(1,'#0d1c30');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,hy);

  // Distant city glow on horizon
  const glow = ctx.createRadialGradient(cx,hy,0,cx,hy,W*0.5);
  glow.addColorStop(0,'rgba(0,80,160,0.25)'); glow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=glow; ctx.fillRect(0,hy-60,W,120);

  // ── Ground (below horizon) ──────────────────────────────────────────────────
  const grd = ctx.createLinearGradient(0,hy,0,H);
  grd.addColorStop(0,'#0e1a28'); grd.addColorStop(1,'#0a1018');
  ctx.fillStyle=grd; ctx.fillRect(0,hy,W,H-hy);

  // ── Helper: project a world point to screen ─────────────────────────────────
  // World: X=lateral (left-right), Z=depth (0=near/bottom, 1=far/horizon)
  // Returns screen {sx, sy, scale}
  const project = (worldX, worldZ) => {
    const z  = Math.max(0.01, worldZ);             // avoid div/0
    const sy = hy + (H - hy) * (1 - z);           // near→bottom, far→horizon
    const sx = cx + worldX * (H - hy) * (1 - z) * 0.9;
    const sc = (1 - z) * 1.2 + 0.05;             // scale shrinks toward horizon
    return { sx, sy, sc };
  };

  // ── Road surface — main straight (N–S) ─────────────────────────────────────
  const rHW = W * 0.16;   // half-width of road at camera level
  const near = project(-rHW, 0), nearR = project(rHW, 0);
  const farL = project(-12,  1), farR  = project(12,  1);

  ctx.fillStyle='#172030';
  ctx.beginPath();
  ctx.moveTo(near.sx,near.sy); ctx.lineTo(nearR.sx,nearR.sy);
  ctx.lineTo(farR.sx,farR.sy); ctx.lineTo(farL.sx,farL.sy);
  ctx.closePath(); ctx.fill();

  // ── Cross road — E–W (horizontal band at mid depth) ──────────────────────
  const crossZ  = 0.52;                           // depth of intersection
  const crossY  = hy + (H-hy)*(1-crossZ);
  const crossH  = (H-hy)*0.18;                    // road height in screen space
  const crossGd = ctx.createLinearGradient(0,crossY,0,crossY+crossH);
  crossGd.addColorStop(0,'#1c2a3e'); crossGd.addColorStop(1,'#172030');
  ctx.fillStyle=crossGd;
  ctx.fillRect(0, crossY, W, crossH);

  // Junction box highlight
  const jL = project(-rHW, crossZ), jR = project(rHW, crossZ);
  const jBL = project(-rHW, crossZ+0.11), jBR = project(rHW, crossZ+0.11);
  ctx.fillStyle='rgba(28,42,62,0.9)';
  ctx.beginPath();
  ctx.moveTo(jL.sx,jL.sy); ctx.lineTo(jR.sx,jR.sy);
  ctx.lineTo(jBR.sx,jBR.sy); ctx.lineTo(jBL.sx,jBL.sy);
  ctx.closePath(); ctx.fill();

  // ── Lane markings (dashed) ─────────────────────────────────────────────────
  ctx.strokeStyle='rgba(255,200,0,0.4)'; ctx.lineWidth=2.5;
  // Left of centre dash
  for(let z=0.05; z<1; z+=0.08) {
    if(z>crossZ-0.05 && z<crossZ+0.14) continue;
    const p1=project(-2,z), p2=project(-2,z+0.05);
    ctx.beginPath(); ctx.moveTo(p1.sx,p1.sy); ctx.lineTo(p2.sx,p2.sy); ctx.stroke();
  }
  // Right of centre dash
  for(let z=0.05; z<1; z+=0.08) {
    if(z>crossZ-0.05 && z<crossZ+0.14) continue;
    const p1=project(2,z), p2=project(2,z+0.05);
    ctx.beginPath(); ctx.moveTo(p1.sx,p1.sy); ctx.lineTo(p2.sx,p2.sy); ctx.stroke();
  }

  // ── Kerb lines ──────────────────────────────────────────────────────────────
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1.5;
  [[-rHW,0.01,-rHW*0.22,1],[rHW,0.01,rHW*0.22,1]].forEach(([wx1,z1,wx2,z2])=>{
    const p1=project(wx1,z1), p2=project(wx2,z2);
    ctx.beginPath(); ctx.moveTo(p1.sx,p1.sy); ctx.lineTo(p2.sx,p2.sy); ctx.stroke();
  });

  // ── Crosswalk (near side of intersection) ────────────────────────────────
  const cwZ = crossZ - 0.03;
  ctx.fillStyle='rgba(255,255,255,0.18)';
  for(let wx=-rHW+6; wx<rHW-6; wx+=20) {
    const pL=project(wx,cwZ), pR=project(wx+10,cwZ);
    const pLb=project(wx,cwZ+0.018), pRb=project(wx+10,cwZ+0.018);
    ctx.beginPath();
    ctx.moveTo(pL.sx,pL.sy); ctx.lineTo(pR.sx,pR.sy);
    ctx.lineTo(pRb.sx,pRb.sy); ctx.lineTo(pLb.sx,pLb.sy);
    ctx.closePath(); ctx.fill();
  }

  // ── Horizon glow line ──────────────────────────────────────────────────────
  ctx.strokeStyle='rgba(0,212,255,0.10)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,hy); ctx.lineTo(W,hy); ctx.stroke();

  // ── Stylised buildings on left & right ─────────────────────────────────────
  const buildings = [
    {side:-1, wx:-rHW-80, bw:70, z:0.75, floors:7},
    {side:-1, wx:-rHW-160,bw:55, z:0.65, floors:11},
    {side: 1, wx: rHW+20,  bw:65, z:0.70, floors:9},
    {side: 1, wx: rHW+100, bw:80, z:0.60, floors:6},
  ];
  buildings.forEach(b => {
    const base   = project(b.wx, b.z);
    const top    = project(b.wx, b.z);
    const screenH = (H - hy) * b.floors * 0.04;
    const screenW = b.bw * (1 - b.z) * 1.8;
    // Building face
    const grad = ctx.createLinearGradient(base.sx, base.sy-screenH, base.sx, base.sy);
    grad.addColorStop(0,'#0f2040'); grad.addColorStop(1,'#0a1525');
    ctx.fillStyle=grad;
    ctx.fillRect(base.sx-(b.side<0?screenW:0), base.sy-screenH, screenW, screenH);
    // Windows (grid)
    ctx.fillStyle='rgba(0,180,255,0.12)';
    for(let wy=base.sy-screenH+6; wy<base.sy-8; wy+=12) {
      for(let wx2=base.sx-(b.side<0?screenW:0)+5; wx2<base.sx-(b.side<0?0:-screenW)-5; wx2+=10) {
        if(Math.random()>0.35) ctx.fillRect(wx2,wy,6,7);
      }
    }
  });

  return { project, crossZ, rHW, hy };
}

// Draw vehicle in perspective view — projected by depth
function drawVehiclePerspective(ctx, v, proj) {
  const col = VCOLORS[v.cat];
  // v.pz = depth 0(near)–1(far), v.px = lateral world units
  const { sx, sy, sc } = proj(v.px, v.pz);
  if (sy < 0) return;  // clipped above horizon

  const s = v.size * sc * 28;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.shadowColor=col.shadow; ctx.shadowBlur=6*sc;

  if (v.cat==='pedestrian') {
    // Stick figure silhouette
    ctx.fillStyle=col.body;
    ctx.beginPath(); ctx.ellipse(0,-s*1.5,s*0.4,s*0.5,0,0,Math.PI*2); ctx.fill(); // head
    ctx.strokeStyle=col.body; ctx.lineWidth=s*0.35;
    ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(0,s); ctx.stroke(); // body
    ctx.beginPath(); ctx.moveTo(-s*0.7,-s*0.2); ctx.lineTo(s*0.7,-s*0.2); ctx.stroke(); // arms
    ctx.beginPath(); ctx.moveTo(0,s); ctx.lineTo(-s*0.55,s*2); ctx.moveTo(0,s); ctx.lineTo(s*0.55,s*2); ctx.stroke(); // legs
  } else if (v.cat==='motorcycle') {
    ctx.fillStyle=col.body;
    ctx.beginPath(); ctx.ellipse(0,0,s*0.5,s*1.1,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=1; ctx.stroke();
    // Rider
    ctx.fillStyle=col.glass;
    ctx.beginPath(); ctx.ellipse(0,-s*0.8,s*0.35,s*0.5,0,0,Math.PI*2); ctx.fill();
  } else {
    // Car/truck/bus — front face (camera is behind)
    const fw = v.cat==='bus'?s*1.1:s*0.95;
    const fh = v.cat==='truck'?s*0.75:v.cat==='bus'?s*0.7:s*0.65;
    const fDepth = v.cat==='truck'?s*2.2:v.cat==='bus'?s*2.6:s*1.7; // length

    // Body top rectangle
    roundRect(ctx,-fw,-fh,fw*2,fh*1.8,3);
    ctx.fillStyle=col.body; ctx.fill();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=1.2; ctx.stroke();

    // Windshield (front)
    roundRect(ctx,-fw*0.7,-fh*0.95,fw*1.4,fh*0.8,2);
    ctx.fillStyle=col.glass; ctx.fill();

    // Headlights (two circles)
    [-0.55,0.55].forEach(side=>{
      ctx.beginPath(); ctx.arc(fw*side, fh*0.65, fw*0.14,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,180,0.95)'; ctx.fill();
      const lglow = ctx.createRadialGradient(fw*side,fh*0.65,0,fw*side,fh*0.65,fw*0.4);
      lglow.addColorStop(0,'rgba(255,255,180,0.35)'); lglow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=lglow; ctx.fillRect(fw*side-fw*0.4,fh*0.3,fw*0.8,fw*0.8);
    });

    // Side perspective face (right side)
    ctx.fillStyle=`rgba(${hexToRgb(col.body)},0.55)`;
    ctx.beginPath();
    ctx.moveTo(fw, -fh);    ctx.lineTo(fw+fDepth*0.28, -fh*0.7);
    ctx.lineTo(fw+fDepth*0.28, fh*0.8); ctx.lineTo(fw, fh*0.8);
    ctx.closePath(); ctx.fill();

    // Roof perspective face
    ctx.fillStyle=`rgba(${hexToRgb(col.body)},0.35)`;
    ctx.beginPath();
    ctx.moveTo(-fw,-fh); ctx.lineTo(fw,-fh);
    ctx.lineTo(fw+fDepth*0.22,-fh*1.4); ctx.lineTo(-fw+fDepth*0.02,-fh*1.4);
    ctx.closePath(); ctx.fill();
  }
  ctx.shadowBlur=0; ctx.restore();
}

function hexToRgb(hex) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIEW 3 — ISOMETRIC  (pure Canvas 2D, 45°/30° dimetric projection)
//  World is a grid of unit tiles. We project via:
//    screenX = (worldX - worldY) * TILE_W/2
//    screenY = (worldX + worldY) * TILE_H/2 - worldZ * TILE_Z
// ═════════════════════════════════════════════════════════════════════════════
const TILE_W = 52, TILE_H = 30, TILE_Z = 26;

function isoProject(wx, wy, wz=0) {
  return {
    sx: (wx - wy) * TILE_W / 2,
    sy: (wx + wy) * TILE_H / 2 - wz * TILE_Z,
  };
}

function drawIsometric(ctx, W, H) {
  // Origin offset — centre the grid
  const OX = W/2, OY = H*0.42;

  ctx.fillStyle='#070e18'; ctx.fillRect(0,0,W,H);

  // ── Draw helper that applies origin ──────────────────────────────────────
  const p = (wx,wy,wz=0) => {
    const {sx,sy} = isoProject(wx,wy,wz);
    return { sx: sx+OX, sy: sy+OY };
  };

  // ── Fill an iso tile (top face, left face, right face) ───────────────────
  function isoTile(wx, wy, wz, color, shade=0.7) {
    const TL=p(wx,wy,wz+1),TR=p(wx+1,wy,wz+1);
    const BL=p(wx,wy+1,wz+1),BR=p(wx+1,wy+1,wz+1);
    const BL0=p(wx,wy+1,wz),BR0=p(wx+1,wy+1,wz);
    const TR0=p(wx+1,wy,wz);

    const [r,g,b] = hexToRgbArr(color);
    // Top face
    ctx.beginPath(); ctx.moveTo(TL.sx,TL.sy); ctx.lineTo(TR.sx,TR.sy);
    ctx.lineTo(BR.sx,BR.sy); ctx.lineTo(BL.sx,BL.sy); ctx.closePath();
    ctx.fillStyle=`rgb(${r},${g},${b})`; ctx.fill();

    // Left face (darker)
    ctx.beginPath(); ctx.moveTo(BL.sx,BL.sy); ctx.lineTo(BR.sx,BR.sy);
    ctx.lineTo(BR0.sx,BR0.sy); ctx.lineTo(BL0.sx,BL0.sy); ctx.closePath();
    ctx.fillStyle=`rgb(${r*0.55|0},${g*0.55|0},${b*0.55|0})`; ctx.fill();

    // Right face (medium shade)
    ctx.beginPath(); ctx.moveTo(TR.sx,TR.sy); ctx.lineTo(BR.sx,BR.sy);
    ctx.lineTo(BR0.sx,BR0.sy); ctx.lineTo(TR0.sx,TR0.sy); ctx.closePath();
    ctx.fillStyle=`rgb(${r*0.72|0},${g*0.72|0},${b*0.72|0})`; ctx.fill();
  }

  function isoFlat(wx, wy, color) {
    const TL=p(wx,wy,0),TR=p(wx+1,wy,0);
    const BL=p(wx,wy+1,0),BR=p(wx+1,wy+1,0);
    ctx.beginPath(); ctx.moveTo(TL.sx,TL.sy); ctx.lineTo(TR.sx,TR.sy);
    ctx.lineTo(BR.sx,BR.sy); ctx.lineTo(BL.sx,BL.sy); ctx.closePath();
    ctx.fillStyle=color; ctx.fill();
  }

  function hexToRgbArr(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
  }

  // ── Ground grid 12×12 ────────────────────────────────────────────────────
  const GRID=12, MID=5;
  // Road cols/rows: x=4..7 vertical road, y=4..7 horizontal road
  for(let x=0;x<GRID;x++) for(let y=0;y<GRID;y++) {
    const onVRoad = x>=MID-1 && x<=MID+1;
    const onHRoad = y>=MID-1 && y<=MID+1;
    if(onVRoad||onHRoad) {
      isoFlat(x,y, (onVRoad&&onHRoad)?'#1c2840':'#182030');
    } else {
      isoFlat(x,y,'#0e1a0e');
    }
  }

  // ── Lane dashes (vertical road) ─────────────────────────────────────────
  for(let y=0;y<GRID;y++) {
    if(y>=MID-1&&y<=MID+1) continue;
    const a=p(MID,y,0.01), b2=p(MID,y+0.5,0.01);
    ctx.strokeStyle='rgba(255,200,0,0.4)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(a.sx,a.sy); ctx.lineTo(b2.sx,b2.sy); ctx.stroke();
  }
  // (horizontal road)
  for(let x=0;x<GRID;x++) {
    if(x>=MID-1&&x<=MID+1) continue;
    const a=p(x,MID,0.01), b2=p(x+0.5,MID,0.01);
    ctx.beginPath(); ctx.moveTo(a.sx,a.sy); ctx.lineTo(b2.sx,b2.sy); ctx.stroke();
  }

  // ── Buildings in 4 corner quadrants ────────────────────────────────────
  const bldgDefs = [
    {x:0,y:0},{x:2,y:0},{x:0,y:2},{x:1,y:3},
    {x:8,y:0},{x:9,y:1},{x:10,y:0},
    {x:0,y:8},{x:1,y:9},{x:0,y:10},
    {x:8,y:8},{x:9,y:9},{x:10,y:8},{x:8,y:10},
  ];
  const BCOLORS=['#0d2040','#0f1e38','#122238','#0e1c35'];
  bldgDefs.forEach((b,i)=>{
    const h = 1+Math.floor(Math.random()*4);
    isoTile(b.x,b.y,0, BCOLORS[i%4]);
    if(h>1) for(let z=1;z<h;z++) isoTile(b.x,b.y,z,BCOLORS[i%4]);
  });

  // ── Stop lines at junction edges ────────────────────────────────────────
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2;
  [[MID-1,MID-1,MID+2,MID-1],[MID-1,MID+2,MID+2,MID+2],
   [MID-1,MID-1,MID-1,MID+2],[MID+2,MID-1,MID+2,MID+2]
  ].forEach(([x1,y1,x2,y2])=>{
    const a=p(x1,y1,0.02), b2=p(x2,y2,0.02);
    ctx.beginPath(); ctx.moveTo(a.sx,a.sy); ctx.lineTo(b2.sx,b2.sy); ctx.stroke();
  });

  // ── Crosswalks ───────────────────────────────────────────────────────────
  ctx.fillStyle='rgba(255,255,255,0.2)';
  for(let x=MID-1;x<=MID+1;x+=0.4) {
    const a=p(x,MID-1,0.01), b2=p(x+0.2,MID-1,0.01);
    const c2=p(x+0.2,MID-1.3,0.01), d=p(x,MID-1.3,0.01);
    ctx.beginPath(); ctx.moveTo(a.sx,a.sy); ctx.lineTo(b2.sx,b2.sy); ctx.lineTo(c2.sx,c2.sy); ctx.lineTo(d.sx,d.sy); ctx.closePath(); ctx.fill();
  }

  return { p, isoTile, MID };
}

// Draw vehicle in isometric view
function drawVehicleIso(ctx, v, isoCtx) {
  const { p } = isoCtx;
  const col = VCOLORS[v.cat];
  const { ix, iy } = v;  // iso world coords

  if (v.cat==='pedestrian') {
    const base=p(ix,iy,0.01);
    ctx.save(); ctx.translate(base.sx,base.sy);
    ctx.fillStyle=col.body;
    ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=col.stroke;
    ctx.beginPath(); ctx.arc(0,-7,3.5,0,Math.PI*2); ctx.fill();
    ctx.restore();
  } else {
    const vw = v.cat==='truck'?0.85:v.cat==='bus'?0.8:0.7;
    const vd = v.cat==='truck'?1.6:v.cat==='bus'?1.8:1.1;
    const vh = v.cat==='truck'?0.7:v.cat==='bus'?0.75:0.45;
    const horiz = (v.dir==='west'||v.dir==='east');

    const wx1=ix-(horiz?vd/2:vw/2), wx2=ix+(horiz?vd/2:vw/2);
    const wy1=iy-(horiz?vw/2:vd/2), wy2=iy+(horiz?vw/2:vd/2);

    // Bottom face
    const TL=p(wx1,wy1,0), TR=p(wx2,wy1,0);
    const BL=p(wx1,wy2,0), BR=p(wx2,wy2,0);
    // Top face
    const TLt=p(wx1,wy1,vh), TRt=p(wx2,wy1,vh);
    const BLt=p(wx1,wy2,vh), BRt=p(wx2,wy2,vh);

    const [r,g,b]=hexToRgbArrS(col.body);
    // Top
    ctx.beginPath(); ctx.moveTo(TLt.sx,TLt.sy); ctx.lineTo(TRt.sx,TRt.sy); ctx.lineTo(BRt.sx,BRt.sy); ctx.lineTo(BLt.sx,BLt.sy); ctx.closePath();
    ctx.fillStyle=`rgb(${r},${g},${b})`; ctx.fill();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=0.8; ctx.stroke();
    // Left face
    ctx.beginPath(); ctx.moveTo(BLt.sx,BLt.sy); ctx.lineTo(BRt.sx,BRt.sy); ctx.lineTo(BR.sx,BR.sy); ctx.lineTo(BL.sx,BL.sy); ctx.closePath();
    ctx.fillStyle=`rgb(${r*0.55|0},${g*0.55|0},${b*0.55|0})`; ctx.fill();
    // Right face
    ctx.beginPath(); ctx.moveTo(TRt.sx,TRt.sy); ctx.lineTo(BRt.sx,BRt.sy); ctx.lineTo(BR.sx,BR.sy); ctx.lineTo(TR.sx,TR.sy); ctx.closePath();
    ctx.fillStyle=`rgb(${r*0.72|0},${g*0.72|0},${b*0.72|0})`; ctx.fill();
    // Windshield (top face rectangle)
    const wsf=0.3;
    const wTL=p(wx1+(horiz?vd*(1-wsf)/2:0.05),wy1+(horiz?0.05:vd*(1-wsf)/2),vh+0.01);
    const wTR=p(wx2-(horiz?vd*(1-wsf)/2:0.05),wy1+(horiz?0.05:vd*(1-wsf)/2),vh+0.01);
    const wBL=p(wx1+(horiz?vd*(1-wsf)/2:0.05),wy2-(horiz?0.05:vd*(1-wsf)/2),vh+0.01);
    const wBR=p(wx2-(horiz?vd*(1-wsf)/2:0.05),wy2-(horiz?0.05:vd*(1-wsf)/2),vh+0.01);
    ctx.beginPath(); ctx.moveTo(wTL.sx,wTL.sy); ctx.lineTo(wTR.sx,wTR.sy); ctx.lineTo(wBR.sx,wBR.sy); ctx.lineTo(wBL.sx,wBL.sy); ctx.closePath();
    ctx.fillStyle=col.glass; ctx.fill();
  }
}

function hexToRgbArrS(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

// ═════════════════════════════════════════════════════════════════════════════
//  VEHICLE SPAWN — builds vehicle list once for current minute
// ═════════════════════════════════════════════════════════════════════════════
function buildVehicles() {
  vehicles = [];
  if (!sceneData) return;
  const tl    = sceneData.congestion_timeline ?? [];
  const entry = tl[scrubMinute] ?? tl[0];
  if (!entry) return;
  const counts = entry.counts ?? {};

  const c = getCanvas();
  const W = c.width, H = c.height;
  const cx=W/2, cy=H/2, rw=W*0.13, rh=H*0.13;

  // Direction lanes: {dir, axis:'NS'|'EW', laneOffset(signed), laneSpread}
  const lanes = [
    { dir:'north', axis:'NS', laneX:  cx+rw*0.32, minY:-20,     maxY:H+20  },
    { dir:'south', axis:'NS', laneX:  cx-rw*0.32, minY:-20,     maxY:H+20  },
    { dir:'west',  axis:'EW', laneY:  cy+rh*0.32, minX:-20,     maxX:W+20  },
    { dir:'east',  axis:'EW', laneY:  cy-rh*0.32, minX:-20,     maxX:W+20  },
  ];

  const cats = ['car_suv','motorcycle','truck','bus','pedestrian'];
  const sizeMap = { truck:13, bus:12, car_suv:9, motorcycle:6, pedestrian:4 };
  const MID = 5; // iso grid mid

  lanes.forEach(lane => {
    cats.forEach(cat => {
      const n = counts[cat] ?? 0;
      const show = Math.max(1, Math.ceil(n * 0.28));
      for (let i=0; i<show; i++) {
        const t = (i+0.5) / show;   // evenly spread along lane
        let x, y, px, pz, ix, iy;

        if (lane.axis==='NS') {
          const spread = (cat==='pedestrian') ? rw*0.32 : rw*0.22;
          x = lane.laneX + (Math.random()-0.5)*spread;
          y = lane.minY + t*(lane.maxY-lane.minY);
          px = (x - cx) / (W*0.1);         // perspective world X
          pz = Math.max(0.02, 1 - y/H);   // depth: bottom=near, top=far
          ix = MID + (lane.dir==='north'?0.3:-0.3);
          iy = t*10;
        } else {
          const spread = (cat==='pedestrian') ? rh*0.32 : rh*0.22;
          y = lane.laneY + (Math.random()-0.5)*spread;
          x = lane.minX + t*(lane.maxX-lane.minX);
          px = (x - cx) / (W*0.1);
          pz = Math.max(0.02, 0.45 + (y-cy)/(H*0.8)*0.15);
          ix = t*10;
          iy = MID + (lane.dir==='west'?0.3:-0.3);
        }

        vehicles.push({ cat, dir:lane.dir, x, y, px, pz, ix, iy,
                        size: sizeMap[cat]??9 });
      }
    });
  });

  // Sort perspective vehicles back-to-front (far first)
  vehicles.sort((a,b) => b.pz - a.pz);
}

// ═════════════════════════════════════════════════════════════════════════════
//  OVERLAYS
// ═════════════════════════════════════════════════════════════════════════════
function drawFlowOverlay(ctx, W, H, viewInfo) {
  const cx=W/2, cy=H/2, rw=W*0.13, rh=H*0.13;
  const lineData = sceneData?.counting_lines ?? [];
  const tl       = sceneData?.congestion_timeline ?? [];
  const entry    = tl[scrubMinute] ?? tl[0] ?? {};
  const counts   = entry.counts ?? {};
  const minTotal = Object.values(counts).reduce((a,b)=>a+b,0);

  // Arrow definitions per view
  let arrowDefs;
  if (sceneView==='topdown') {
    arrowDefs = [
      { dir:'north', x:cx+rw*0.62,  y:H*0.14,  angle:-Math.PI/2, color:'#00d4ff' },
      { dir:'south', x:cx-rw*0.62,  y:H*0.86,  angle: Math.PI/2, color:'#00d4ff' },
      { dir:'west',  x:W*0.09,       y:cy-rh*0.5, angle:Math.PI,  color:'#ff6b35' },
      { dir:'east',  x:W*0.91,       y:cy+rh*0.5, angle:0,        color:'#ff6b35' },
    ];
  } else if (sceneView==='perspective') {
    const { project, crossZ, rHW } = viewInfo;
    const toScreen = (wx,wz) => project(wx,wz);
    arrowDefs = [
      { dir:'north', x:toScreen( rHW*0.6, 0.75).sx, y:toScreen( rHW*0.6, 0.75).sy, angle:-Math.PI/2, color:'#00d4ff' },
      { dir:'south', x:toScreen(-rHW*0.6, 0.12).sx, y:toScreen(-rHW*0.6, 0.12).sy, angle: Math.PI/2, color:'#00d4ff' },
      { dir:'west',  x:W*0.08, y:cy*0.92, angle:Math.PI, color:'#ff6b35' },
      { dir:'east',  x:W*0.92, y:cy*0.92, angle:0,        color:'#ff6b35' },
    ];
  } else {
    // isometric — fixed screen positions
    const { p } = viewInfo;
    const MID=5;
    const pN=p(MID+0.4,1.5,0), pS=p(MID-0.4,9,0);
    const pW=p(1.5,MID+0.4,0), pE=p(9,MID-0.4,0);
    arrowDefs = [
      { dir:'north', x:pN.sx, y:pN.sy, angle:-Math.PI/2, color:'#00d4ff' },
      { dir:'south', x:pS.sx, y:pS.sy, angle: Math.PI/2, color:'#00d4ff' },
      { dir:'west',  x:pW.sx, y:pW.sy, angle: Math.PI*0.75, color:'#ff6b35' },
      { dir:'east',  x:pE.sx, y:pE.sy, angle:-Math.PI*0.25, color:'#ff6b35' },
    ];
  }

  arrowDefs.forEach(a => {
    const line  = lineData.find(l => l.direction===a.dir);
    const total = line?.total_vehicles ?? 0;
    const cats  = line?.counts_by_category ?? {};

    // Arrow
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    ctx.shadowColor=a.color; ctx.shadowBlur=14;
    ctx.strokeStyle=a.color; ctx.lineWidth=3.5;
    ctx.beginPath(); ctx.moveTo(-24,0); ctx.lineTo(18,0); ctx.stroke();
    ctx.fillStyle=a.color;
    ctx.beginPath(); ctx.moveTo(30,0); ctx.lineTo(16,-8); ctx.lineTo(16,8); ctx.closePath(); ctx.fill();
    ctx.shadowBlur=0; ctx.restore();

    // HUD box beside arrow
    const icon = {north:'↑',south:'↓',west:'←',east:'→'}[a.dir];
    const lx = a.x + Math.cos(a.angle)*62;
    const ly = a.y + Math.sin(a.angle)*62 - 14;
    hudBox(ctx, lx, ly, [
      { text:`${icon} ${st(a.dir)}`, color:'#e6edf3', bold:true },
      { text:`${total} ${st('cat_car_suv').split('/')[0]}+`, color:a.color, bold:true },
      { text:`🚗${cats.car_suv??0}  🏍${cats.motorcycle??0}  🚛${cats.truck??0}`, color:'#8b949e' },
    ], a.color);
  });

  // Virtual counting lines (top-down only, too cluttered in others)
  if (sceneView==='topdown') {
    lineData.forEach(l => {
      ctx.setLineDash([7,5]); ctx.strokeStyle='rgba(0,212,255,0.5)'; ctx.lineWidth=1.8;
      ctx.beginPath();
      ctx.moveTo(l.x1*(W/1280), l.y1*(H/720));
      ctx.lineTo(l.x2*(W/1280), l.y2*(H/720));
      ctx.stroke(); ctx.setLineDash([]);
      const mx=((l.x1+l.x2)/2)*(W/1280), my=((l.y1+l.y2)/2)*(H/720);
      ctx.fillStyle='rgba(0,212,255,0.85)'; ctx.font='bold 9px monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(l.id, mx, my-9);
    });
  }
}

function drawHeatmapOverlay(ctx, W, H, viewInfo) {
  const cx=W/2, cy=H/2, rw=W*0.13, rh=H*0.13;
  const lineData = sceneData?.counting_lines ?? [];

  if (sceneView==='topdown') {
    const zones=[
      {lid:'L1',x:cx-rw,y:0,     w:rw*2,h:cy-rh},
      {lid:'L2',x:cx-rw,y:cy+rh, w:rw*2,h:H-(cy+rh)},
      {lid:'L3',x:0,    y:cy-rh, w:cx-rw,h:rh*2},
      {lid:'L4',x:cx+rw,y:cy-rh, w:W-(cx+rw),h:rh*2},
      {lid:null,x:cx-rw,y:cy-rh, w:rw*2,h:rh*2},
    ];
    zones.forEach(z=>{
      const l=lineData.find(d=>d.id===z.lid);
      const idx=l?l.congestion_index:58;
      const [r,g,b]=heatRgb(idx/100);
      ctx.fillStyle=`rgba(${r},${g},${b},0.36)`; ctx.fillRect(z.x,z.y,z.w,z.h);
      if(z.lid){
        const bx=z.x+z.w/2, by=z.y+z.h/2;
        ctx.font='bold 15px "Segoe UI",system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillText(idx.toFixed(0),bx+1,by+1);
        ctx.fillStyle=`rgb(${r},${g},${b})`; ctx.fillText(idx.toFixed(0),bx,by);
        const dn={L1:st('north'),L2:st('south'),L3:st('west'),L4:st('east')};
        ctx.font='10px "Segoe UI",system-ui'; ctx.fillStyle='rgba(255,255,255,0.65)';
        ctx.fillText(dn[z.lid]??'',bx,by+18);
      }
    });
  } else if (sceneView==='perspective') {
    const { project } = viewInfo;
    // Three horizontal bands: far, mid, near
    const bands=[
      {lid:'L1',z0:0.7,z1:1.0},{lid:null,z0:0.48,z1:0.7},{lid:'L2',z0:0.0,z1:0.48}
    ];
    bands.forEach(b=>{
      const l=lineData.find(d=>d.id===b.lid);
      const idx=l?l.congestion_index:55;
      const [r,g,b2]=heatRgb(idx/100);
      const p1=project(-W*0.22,b.z0), p2=project(W*0.22,b.z0);
      const p3=project(W*0.22,b.z1),  p4=project(-W*0.22,b.z1);
      ctx.fillStyle=`rgba(${r},${g},${b2},0.30)`;
      ctx.beginPath(); ctx.moveTo(p1.sx,p1.sy); ctx.lineTo(p2.sx,p2.sy);
      ctx.lineTo(p3.sx,p3.sy); ctx.lineTo(p4.sx,p4.sy); ctx.closePath(); ctx.fill();
      if(b.lid){
        const mx=(p1.sx+p2.sx)/2, my=(p1.sy+p3.sy)/2;
        ctx.font='bold 14px "Segoe UI",system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle=`rgb(${r},${g},${b2})`; ctx.fillText(idx.toFixed(0)+'/100',mx,my);
      }
    });
  } else {
    // Isometric: colour the road tiles
    const { p, isoTile, MID } = viewInfo;
    lineData.forEach(l=>{
      const idx=l.congestion_index??0;
      const [r,g,b]=heatRgb(idx/100);
      const hc=`#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
      for(let i=0;i<12;i++){
        const onV=(l.direction==='north'||l.direction==='south');
        ctx.globalAlpha=0.35;
        if(onV) { isoTile(MID,i,0,hc); isoTile(MID-1,i,0,hc); isoTile(MID+1,i,0,hc); }
        else    { isoTile(i,MID,0,hc); isoTile(i,MID-1,0,hc); isoTile(i,MID+1,0,hc); }
        ctx.globalAlpha=1;
      }
      // Index badge
      const bp = onV(l.direction) ? p(MID, l.direction==='north'?2:9, 0.1) : p(l.direction==='west'?2:9, MID, 0.1);
      function onV(d){ return d==='north'||d==='south'; }
      const bp2 = onV(l.direction) ? p(MID, l.direction==='north'?2:9, 0.1) : p(l.direction==='west'?2:9, MID, 0.1);
      ctx.fillStyle=`rgb(${r},${g},${b})`; ctx.font='bold 12px "Segoe UI",system-ui';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(idx.toFixed(0), bp2.sx, bp2.sy);
    });
    ctx.globalAlpha=1;
  }

  drawHeatLegend(ctx);
}

function heatRgb(t) {
  if(t<0.5){const u=t*2;return[Math.round(34+u*(250-34)),Math.round(197+u*(204-197)),Math.round(94+u*(21-94))];}
  else if(t<0.75){const u=(t-0.5)*4;return[Math.round(250+u*(249-250)),Math.round(204+u*(115-204)),Math.round(21+u*(22-21))];}
  else{const u=(t-0.75)*4;return[Math.round(249+u*(239-249)),Math.round(115+u*(68-115)),Math.round(22+u*(68-22))];}
}

function drawHeatLegend(ctx) {
  const x=14,y=14,w=128,h=50;
  ctx.fillStyle='rgba(8,14,26,0.86)'; roundRect(ctx,x,y,w,h,5); ctx.fill();
  ctx.strokeStyle='rgba(48,54,61,0.7)'; ctx.lineWidth=1; roundRect(ctx,x,y,w,h,5); ctx.stroke();
  ctx.font='bold 10px "Segoe UI",system-ui'; ctx.fillStyle='#8b949e';
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(st('congestion'), x+8, y+7);
  const gd=ctx.createLinearGradient(x+8,0,x+w-8,0);
  gd.addColorStop(0,'#22c55e'); gd.addColorStop(0.5,'#facc15');
  gd.addColorStop(0.75,'#f97316'); gd.addColorStop(1,'#ef4444');
  ctx.fillStyle=gd; ctx.fillRect(x+8,y+22,w-16,9);
  ctx.font='9px "Segoe UI",system-ui'; ctx.fillStyle='#8b949e';
  ctx.textAlign='left';  ctx.fillText(st('low'),  x+8,  y+35);
  ctx.textAlign='right'; ctx.fillText(st('high'), x+w-8,y+35);
}

// ═════════════════════════════════════════════════════════════════════════════
//  MASTER DRAW
// ═════════════════════════════════════════════════════════════════════════════
function draw() {
  if (!sceneData) return;
  const c   = getCanvas();
  const ctx = c.getContext('2d');
  const { width: W, height: H } = c;
  ctx.clearRect(0, 0, W, H);

  let viewInfo = {};

  if (sceneView === 'topdown') {
    const { cx, cy, rw, rh } = drawTopDown(ctx, W, H);
    // Draw vehicles
    vehicles.forEach(v => drawVehicleTopDown(ctx, v, cx, cy));
    // Overlay
    if (sceneOverlay==='heatmap') drawHeatmapOverlay(ctx,W,H,viewInfo);
    else                          drawFlowOverlay(ctx,W,H,viewInfo);

  } else if (sceneView === 'perspective') {
    viewInfo = drawPerspective(ctx, W, H);
    // Draw vehicles sorted far-to-near (already sorted by pz desc)
    vehicles.forEach(v => drawVehiclePerspective(ctx, v, viewInfo.project));
    if (sceneOverlay==='heatmap') drawHeatmapOverlay(ctx,W,H,viewInfo);
    else                          drawFlowOverlay(ctx,W,H,viewInfo);

  } else if (sceneView === 'isometric') {
    viewInfo = drawIsometric(ctx, W, H);
    // Draw vehicles
    vehicles.forEach(v => drawVehicleIso(ctx, v, viewInfo));
    if (sceneOverlay==='heatmap') drawHeatmapOverlay(ctx,W,H,viewInfo);
    else                          drawFlowOverlay(ctx,W,H,viewInfo);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  STATS & LEGEND
// ═════════════════════════════════════════════════════════════════════════════
function renderSceneStats() {
  if (!sceneData) return;
  const tl    = sceneData.congestion_timeline ?? [];
  const entry = tl[scrubMinute] ?? tl[0] ?? { counts:{} };
  const c2    = entry.counts ?? {};
  const cards = [
    { icon:'🚗', val:c2.car_suv??0,    lbl:st('stat_cars'),  color:'#00d4ff' },
    { icon:'🏍️', val:c2.motorcycle??0, lbl:st('stat_moto'),  color:'#ff6b35' },
    { icon:'🚛', val:c2.truck??0,       lbl:st('stat_trucks'),color:'#a855f7' },
    { icon:'🚌', val:c2.bus??0,         lbl:st('cat_bus'),    color:'#22c55e' },
    { icon:'🚶', val:c2.pedestrian??0,  lbl:st('cat_pedestrian'),color:'#facc15' },
  ];
  document.getElementById('sceneStats').innerHTML = cards.map(c3=>`
    <div class="scene-stat-card">
      <div class="scene-stat-icon">${c3.icon}</div>
      <div class="scene-stat-body">
        <div class="scene-stat-val" style="color:${c3.color}">${c3.val}</div>
        <div class="scene-stat-lbl">${c3.lbl}</div>
      </div>
    </div>`).join('');
}

function renderSceneLegend() {
  const cats=[
    {key:'car_suv',icon:'🚗',color:'#00d4ff'},
    {key:'motorcycle',icon:'🏍️',color:'#ff6b35'},
    {key:'truck',icon:'🚛',color:'#a855f7'},
    {key:'bus',icon:'🚌',color:'#22c55e'},
    {key:'pedestrian',icon:'🚶',color:'#facc15'},
  ];
  document.getElementById('sceneLegend').innerHTML = cats.map(c=>`
    <div class="scene-legend-item">
      <div class="scene-legend-dot" style="background:${c.color}"></div>
      <span>${c.icon} ${st('cat_'+c.key)}</span>
    </div>`).join('');
}
