# 🚦 智慧城市交通數位孿生系統 · 問題排查指南

**版本** 3.0 (同步修正版)  
**最後更新** 2026-07-07

---

## 🔍 快速診斷 (Quick Diagnosis)

### 問題 1：粒子不動（Particles Not Moving）

**表現**
- 進入戰情室後，右上角粒子 Canvas 全黑
- 左上影片在播放，但沒看到粒子

**診斷步驟**

```bash
# Step 1: 檢查 ROI
# 在設定模式，確保 ROI 綠色區域包含十字路口
# 如果 ROI 太小或位置錯誤 → 重新畫

# Step 2: 檢查後端
curl http://localhost:8000/api/status
# 應該回傳:
# { "configured": true, "frames_ready": 1501, "duration_s": 59.96 }

# Step 3: 開啟 DevTools 看 WS 訊息
# F12 → Network → WS → /ws/stream
# 查看訊息的 "positions" 陣列應該不為空
```

**可能原因**

| 原因 | 症狀 | 解決方案 |
|------|------|---------|
| ROI 沒包含車流 | Sankey 圖箭頭也是 0 | 重新畫 ROI，涵蓋整個十字路口 |
| 線段方向錯誤 | 只有某條線有 PCU | 重新檢查線段是否垂直於車流 |
| 後端未初始化 | `/api/status` 返回 configured=false | 點擊 🚀 LAUNCH 重新初始化 |
| Canvas 未對齐 | 粒子位置不對應影片 | 打開 `?debug=1` 檢查 alignment |

---

### 問題 2：PCU 永遠顯示 0.0

**表現**
- Control Panel 右下角的 A/B/C/D PCU/30s 都是 0.0
- Sankey 圖的箭頭也沒有寬度

**診斷步驟**

```
Step 1: 確認線段完整
  ✗ 線段只在影片角落 → 拉長它
  ✗ 線段只有半段穿過影片 → 延伸到邊界
  ✓ 線段完全水平/垂直穿過影片 → 進入 Step 2

Step 2: 檢查線段方向
  ✗ 車子向左移動，但線段也是向左 → 垂直相交判定會失敗
  ✓ 車子向左移動，線段向上 → 會觸發相交
     (線段必須垂直於車流方向)

Step 3: 檢查後端日誌
  看啟動後端的 Terminal，尋找:
  [precompute] 1501 frames | 150 crossing events | ...
  ✗ crossing events = 0 → 線段可能都沒穿過軌跡
  ✓ crossing events > 0 → 進入 Step 4
```

**常見原因**

```
❌ 線段方向錯誤
   A 線應該：←→ (水平)
   B 線應該：←→ (水平，與 A 平行)
   C 線應該：↑↓ (垂直)
   D 線應該：↑↓ (垂直，與 C 平行)

   車流如果是「橫過影片」，
   那計數線應該是「上下」的才行！

✅ 測試用線段繪製方法
   如果不確定方向，從頭到尾完全水平/垂直：
   - A: (0.0, 0.3) → (1.0, 0.3)  [完全水平]
   - B: (1.0, 0.7) → (0.0, 0.7)  [完全水平，反向]
   - C: (0.4, 0.0) → (0.4, 1.0)  [完全垂直]
   - D: (0.6, 1.0) → (0.6, 0.0)  [完全垂直，反向]
```

---

### 問題 3：前後端不同步

**表現**
- 影片播放速度正常
- 粒子卡住或延遲 2-3 秒

**診斷步驟**

```
Step 1: 檢查 WebSocket 連接
  F12 → Console 搜尋 "[ws]"
  應該看到:
  [ws] connected
  [ws/stream] seek event

  ✗ 看不到 → WebSocket 連接失敗
    檢查後端 Terminal 是否有 error

Step 2: 檢查訊息延遲
  F12 → Network → WS
  看訊息的時間戳
  ✗ 每次間隔 > 200ms → 可能是線程堵塞
    重啟後端試試
  ✓ 間隔 80-120ms → 正常

Step 3: 檢查播放速度
  時間軸上點 4× 速度按鈕
  ✗ 粒子不能跟上 → 可能是渲染瓶頸
    嘗試降速到 2× 或 1×
  ✓ 粒子能跟上 → 系統正常
```

**修復方案**

```bash
# 方案 A: 重啟後端
cd backend
# 停止現在的後端 (Ctrl+C)
# 重新啟動
uvicorn app.main:app --reload --port 8000

# 方案 B: 檢查埠佔用
lsof -i :8000
# 應該只看到 1 個 uvicorn 進程
# 如果有多個，殺掉它們：
kill -9 <PID>

# 方案 C: 用不同埠啟動
uvicorn app.main:app --reload --port 8001
# 然後改 frontend/src/App.jsx 的 API_BASE 指向 :8001
```

---

### 問題 4：Canvas 幾何不對齐

**表現**
- 線段在影片上看起來位置不對
- 粒子座標跟影片不符

**診斷方法**

```
在瀏覽器打開調試面板：
http://localhost:5173?debug=1

底部會出現調試面板，顯示：
  VIDEO: 原生尺寸 vs 顯示尺寸
  CANVAS: DOM 尺寸 vs 顯示尺寸
  ALIGNMENT: 是否對齐

✅ 應該看到
  VIDEO: 1920×1080  (原生)
  Display: 640×360   (顯示尺寸，取決於容器)
  
  CANVAS: 640×360    (應該跟 VIDEO display 一致!)
  
  ALIGNMENT: ✅ ALIGNED

❌ 如果看到
  CANVAS 尺寸 ≠ VIDEO display 尺寸
  ALIGNMENT: ❌ MISMATCH
  
  → 有幾何問題，需要修復
```

**修復步驟**

```
1. 重新整理頁面 (Cmd+R 或 Ctrl+Shift+R)
2. 等待 2-3 秒讓 canvas resize observer 初始化
3. 檢查 ?debug=1 面板是否顯示 ALIGNED
4. 如果仍有問題，檢查:
   - frontend/src/components/Dashboard.jsx 的 useEffect (canvas sizing)
   - 是否有 CSS overflow 或 transform 影響到 canvas 尺寸
```

---

## 🛠 進階除錯 (Advanced Debugging)

### 打開 DevTools Network 檢查 WebSocket

```
1. F12 打開開發者工具
2. Network 標籤 → 過濾 "ws"
3. 點擊 "/ws/stream" 連接
4. 查看訊息內容:

發出訊息 (outgoing):
{
  "type": "seek",
  "t": 12.5
}

接收訊息 (incoming):
{
  "type": "frame",
  "t": 12.48,
  "events": [              // 車輛穿過線段事件
    { "track_id": 1, "line": "A", "class": "car", "pcu": 1.0 }
  ],
  "positions": [           // 當前所有車輛位置
    { "track_id": 1, "x": 0.52, "y": 0.45, "class": "car" },
    { "track_id": 2, "x": 0.30, "y": 0.60, "class": "motorcycle" }
  ],
  "pcu_window": {          // 過去 30 秒的累計 PCU
    "A": 15.2,
    "B": 8.5,
    "C": 0.0,
    "D": 0.0
  },
  "alerts": [              // 交通專家建議
    { "rule_id": "R1A", "severity": "warning", "message_zh": "..." }
  ]
}

✅ 檢查清單:
  □ events 不為空
  □ positions 有多個車輛
  □ pcu_window 不全是 0
  □ alerts 有內容
```

### 檢查後端日誌

```bash
# 啟動後端時的日誌應該包含:

[startup] Loaded 1501 frames from backend/data/traffic_base.json
[config] Generating trajectories for lines: ['A', 'B', 'C', 'D']
[precompute] 1501 frames | 150 crossing events | 125.3 total PCU
[ws] connected at t=0.00
[ws] seek t=12.50, pcu_window={'A': 5.2, 'B': 3.1, ...}

✅ 正常訊號:
  - 啟動時看到 "Loaded" 訊息
  - Config 後看到 "Generating" + "precompute"
  - 播放時持續看到 "[ws] seek" 訊息

❌ 錯誤訊號:
  - ModuleNotFoundError → 依賴未安裝，執行 pip install -r requirements.txt
  - Port 8000 in use → 改用其他埠或殺掉佔用的進程
  - FileNotFoundError → 檢查 traffic_base.json 路徑
```

### 查看座標空間

```bash
# 在前端 Console (F12 → Console) 執行:

// 查看 video 元素實際尺寸
const v = document.querySelector('video');
console.log('Video dimensions:', {
  videoWidth: v.videoWidth,
  videoHeight: v.videoHeight,
  displayWidth: v.offsetWidth,
  displayHeight: v.offsetHeight
});

// 查看 canvas 元素
const c = document.querySelector('canvas');
console.log('Canvas dimensions:', {
  canvasWidth: c.width,
  canvasHeight: c.height,
  displayWidth: c.offsetWidth,
  displayHeight: c.offsetHeight
});

// 應該看到:
// Video: 1920×1080 → 640×360 (或依容器大小)
// Canvas: 640×360 → 640×360 (應該完全相同)
```

---

## 📊 性能優化 (Performance Tuning)

### 粒子渲染卡頓？

```javascript
// 檢查 ParticleCanvas 的 positions 數量
// 如果超過 500 個粒子，可能會卡

// 臨時解決: 降低粒子密度
// 編輯 frontend/src/components/ParticleCanvas.jsx:
// posRef.current.filter((_, i) => i % 2 === 0)  // 只顯示一半
```

### WebSocket 訊息堆積？

```javascript
// App.jsx 已有背壓機制
// 如果仍然堆積，嘗試增加 MIN_SEEK_GAP_MS:
const MIN_SEEK_GAP_MS = 150;  // 改成 150ms (從 80ms)
// 這會降低發送頻率
```

### 後端 CPU 使用率高？

```bash
# 檢查是否有多個 uvicorn 進程
ps aux | grep uvicorn

# 如果有多個，殺掉舊的:
pkill -f "uvicorn app.main"

# 重新啟動:
uvicorn app.main:app --reload --port 8000 --workers 1
```

---

## 🚀 驗證清單 (Verification Checklist)

部署前確保所有項目勾選：

- [ ] 後端啟動成功，無 error
- [ ] `/api/status` 回傳 configured=true
- [ ] 前端連接到 WebSocket
- [ ] 線段在影片上清晰可見
- [ ] PCU 數字不全是 0.0
- [ ] Sankey 圖有箭頭寬度差異
- [ ] 粒子在右上角 Canvas 可見
- [ ] 按 4× 速度，粒子不卡頓
- [ ] Timeline 拖桿有背景 sparkline 圖
- [ ] Alert 面板有建議訊息（不只是 "正常"）
- [ ] ?debug=1 面板顯示 ALIGNED

---

## 📞 求助資源 (Support Resources)

### 常見錯誤訊息

| 錯誤 | 解決方案 |
|------|---------|
| `ConnectionRefusedError: localhost:8000` | 後端未啟動，執行 `uvicorn app.main:app --reload --port 8000` |
| `No module named 'app'` | 在 backend 目錄執行，不是項目根目錄 |
| `Address already in use` | 已有進程佔用 port 8000，殺掉或用其他埠 |
| `POST /api/config 500 Internal Server Error` | 線段座標無效，確保都是 0.0~1.0 的浮點數 |
| `WebSocket connection closed` | 後端掛掉，檢查後端 Terminal 的 error 訊息 |

---

## 📝 提交問題時的資訊清單

如果以上都無法解決，提供以下資訊：

1. **OS 和版本** (macOS 12.5、Windows 11 等)
2. **瀏覽器** (Chrome 127、Firefox latest 等)
3. **後端 Terminal 的完整 error 訊息**
4. **DevTools Network 中 /ws/stream 的完整訊息 payload**
5. **?debug=1 面板的 alignment 狀態**
6. **描述具體表現**:
   - 粒子？PCU？線段？還是完全無法進入戰情室？
7. **嘗試過的步驟** (重啟、清快取、etc.)

---

**祝除錯順利！** 🔧

若有任何問題，檢查 `SYNC_FIX_NOTES.md` 了解技術細節。
