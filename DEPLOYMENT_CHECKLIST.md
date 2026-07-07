# 🚀 部署檢查清單 (Deployment Checklist)

**版本**: 3.0.0 (同步修正版)  
**日期**: 2026-07-07  
**狀態**: ✅ 就緒

---

## 📋 部署前準備

### 環境檢查

- [ ] **操作系統**: macOS / Linux / Windows (確認分支指令相容)
- [ ] **Node.js**: v20+ 已安裝
  ```bash
  node --version  # 應為 v20.0.0+
  ```

- [ ] **Python**: 3.9+ 已安裝
  ```bash
  python --version  # 應為 3.9+
  ```

- [ ] **Conda 環境**: `smart_city` 已建立
  ```bash
  conda activate smart_city
  ```

### 依賴檢查

- [ ] **前端依賴** (`frontend/`)
  ```bash
  cd frontend
  npm install
  # 無 error 訊息
  ```

- [ ] **後端依賴** (`backend/`)
  ```bash
  cd backend
  pip install -r requirements.txt
  # 看到 "Successfully installed" 訊息
  ```

### 文件檢查

- [ ] **前端組件**
  - [ ] `frontend/src/components/Dashboard.jsx` ✅ 已修正
  - [ ] `frontend/src/components/CoordinateDebugger.jsx` ✅ 新增
  - [ ] `frontend/src/components/ParticleCanvas.jsx` ✅ 已驗証
  - [ ] `frontend/src/components/ControlPanel.jsx` ✅ 已驗証
  - [ ] `frontend/src/App.jsx` ✅ WebSocket 正確

- [ ] **後端模組**
  - [ ] `backend/app/main.py` ✅ 無修正需要
  - [ ] `backend/app/spatial_engine.py` ✅ 座標空間正確
  - [ ] `backend/app/traffic_rules.py` ✅ 無修正需要
  - [ ] `backend/data/traffic_base.json` ✅ 存在

- [ ] **媒體文件**
  - [ ] `frontend/public/video/raw_video.mp4` ✅ 存在
  - [ ] 時長: 60 秒左右

---

## 🧪 測試執行

### 集成測試

```bash
# 執行後端集成測試
python test_integration.py

# 期望輸出:
# ✅ Coordinate space test passed
# ✅ Geometry test passed
# ✅ Traffic rules test passed
# ✅ Spatial engine test passed
# ✅ WebSocket message format test passed
# ✅ ALL TESTS PASSED
```

- [ ] 所有測試通過 (PASSED 訊息)
- [ ] 無 ERROR 或 exception

### 手動測試流程

#### 1️⃣ 啟動服務

```bash
# Terminal 1: 後端
cd backend
conda activate smart_city
uvicorn app.main:app --reload --port 8000

# 期望:
# INFO:     Uvicorn running on http://127.0.0.1:8000
# [startup] Loaded 1501 frames from backend/data/traffic_base.json
```

- [ ] 後端啟動成功
- [ ] 看到 "Loaded 1501 frames" 訊息
- [ ] 無 error 訊息

```bash
# Terminal 2: 前端
cd frontend
conda activate smart_city
npm run dev

# 期望:
# VITE v5... ready in ... ms
# Local: http://localhost:5173/
```

- [ ] 前端啟動成功
- [ ] 顯示本地 URL
- [ ] 無 error 訊息

#### 2️⃣ 打開瀏覽器

```
http://localhost:5173
```

- [ ] 頁面加載成功 (無 404)
- [ ] 顯示 TrafficCanvas 組件
- [ ] 能看到影片

#### 3️⃣ Config Mode 測試

- [ ] **ROI 繪製**
  - [ ] 點擊 "ROI Mask" 按鈕
  - [ ] 在影片上繪製至少 3 個點圍成多邊形
  - [ ] 區域變成半透明藍色
  - [ ] 看到 "ROI confirmed" 訊息

- [ ] **計數線繪製**
  - [ ] 點擊 "A" 按鈕
  - [ ] 在影片上點 2 點繪製線段
  - [ ] 看到綠色線段出現
  - [ ] 自動跳到 "B"
  - [ ] 重複 B、C、D 線段繪製

- [ ] **確認發送**
  - [ ] 4 條線全畫完後，"🚀 LAUNCH" 按鈕應亮起
  - [ ] 點擊 LAUNCH 按鈕
  - [ ] 顯示 "INITIALISING AI ENGINE" 畫面
  - [ ] 約 2-3 秒後進入 Dashboard Mode

#### 4️⃣ Dashboard Mode 測試

- [ ] **視覺元素**
  - [ ] 左上: 影片正常播放，能看到線段
  - [ ] 右上: Particle Canvas 顯示動態粒子
  - [ ] 左下: Sankey 圖顯示流量箭頭
  - [ ] 右下: Control Panel 顯示信號建議

- [ ] **數據更新**
  - [ ] Control Panel 的 A/B/C/D PCU 數字在變化
  - [ ] 數字不全是 0.0
  - [ ] Alert 面板有建議訊息
  - [ ] Webster 號誌方案有週期時間

- [ ] **播放控制**
  - [ ] ▶ 按鈕可以播放/暫停
  - [ ] ◀◀ 按鈕可以倒帶 5 秒
  - [ ] 時間軸可以拖動
  - [ ] 倍速按鈕 (1×, 2×, 4×) 有效

- [ ] **對齐檢查**
  - [ ] 打開 `http://localhost:5173?debug=1`
  - [ ] 底部調試面板顯示 "✅ ALIGNED"
  - [ ] 關閉 debug 模式

#### 5️⃣ 壓力測試

- [ ] **高倍速播放**
  - [ ] 點擊 4× 速度
  - [ ] 粒子應該平滑運動 (不卡頓)
  - [ ] PCU 數字持續更新
  - [ ] 無 JavaScript error

- [ ] **快速拖曳時間軸**
  - [ ] 用滑鼠快速拖動時間軸
  - [ ] 粒子應該立即跟上
  - [ ] 無延遲或凍結
  - [ ] 無 WebSocket 錯誤

- [ ] **長時間運行**
  - [ ] 讓系統運行 2-3 分鐘
  - [ ] 無記憶體洩漏 (頻繁檢查 F12 Memory)
  - [ ] 無累積 error 訊息

---

## 🐛 已知問題排查

### 若 PCU 顯示 0.0

- [ ] 檢查 ROI 是否包含車流
- [ ] 檢查線段是否完整穿過影片
- [ ] 檢查線段方向是否正確 (垂直於車流)
- [ ] 查看後端 Terminal 的 crossing events 數量
- [ ] 執行 `test_integration.py` 驗証後端

### 若粒子不動

- [ ] 檢查右上 Canvas 是否有顏色變化
- [ ] 打開 DevTools Console 看是否有 error
- [ ] 檢查 WebSocket 連接 (Network → WS)
- [ ] 嘗試重新整理頁面 (Cmd+R)
- [ ] 重啟後端

### 若佈局錯亂

- [ ] 打開 DevTools Elements，檢查 HTML 結構
- [ ] 檢查是否有 CSS 衝突
- [ ] 清除瀏覽器快取 (Cmd+Shift+Delete)
- [ ] 打開 ?debug=1 確認對齐狀態

---

## 📊 效能基準 (Performance Baseline)

部署前應符合以下指標：

| 指標 | 目標 | 測試方法 |
|------|------|---------|
| 首次加載時間 | < 5 秒 | 打開 http://localhost:5173，計時 |
| WebSocket 延遲 | < 200 ms | DevTools Network → WS，看訊息間隔 |
| 粒子幀率 | ≥ 25 fps | 1× 倍速時平滑運動 |
| Config → Dashboard | < 4 秒 | 從 LAUNCH 到 Dashboard 出現 |
| 記憶體使用 | < 500 MB | F12 → Performance → Memory |

測試記錄:
```
日期: ____________
首次加載: ____________
WS 延遲: ____________
粒子幀率: ____________
轉換時間: ____________
記憶體: ____________
備註: _____________________________
```

---

## 🔐 安全檢查

- [ ] **無硬編碼密鑰**
  - [ ] 檢查 `.env` 檔案不提交
  - [ ] API 端點無敏感資訊

- [ ] **CORS 設定**
  - [ ] 前端可連接後端
  - [ ] WebSocket 連接正常
  - [ ] 無跨域 error

- [ ] **輸入驗証**
  - [ ] ROI 座標範圍在 0.0~1.0
  - [ ] 線段座標有效
  - [ ] 無 NaN 或 Infinity 值

---

## 📤 部署步驟

### 本機部署 (Development)

```bash
# 1. 進入專案目錄
cd ~/Desktop/26SumIntern/Foxconn_Internship/smart_city_dashboard

# 2. 啟動後端
cd backend
conda activate smart_city
uvicorn app.main:app --reload --port 8000 &

# 3. 啟動前端
cd ../frontend
npm run dev &

# 4. 打開瀏覽器
open http://localhost:5173
```

### 生產部署 (Production)

```bash
# 1. 後端 (改用 production 設定)
cd backend
conda activate smart_city
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

# 2. 前端 (構建靜態文件)
cd ../frontend
npm run build
# 將 dist/ 上傳到 web server

# 3. 配置 reverse proxy (Nginx)
# 將 /api → http://localhost:8000
# 將 /ws → ws://localhost:8000
```

---

## ✅ 最終確認

### 系統管理員確認

- [ ] 所有測試通過
- [ ] 無待處理的 bug
- [ ] 文檔完整
- [ ] 團隊已通知
- [ ] 備份已完成

### 簽名

```
確認者: ___________________
簽署日期: ___________________
備註: _____________________________
```

---

## 🎉 上線宣布

如果所有項目都打勾了 ✅，恭喜！

🟢 **系統已準備好上線！**

---

## 📞 應急聯繫

若部署過程出現問題:

1. **檢查** `TROUBLESHOOTING.md`
2. **執行** `test_integration.py`
3. **查看** 後端 Terminal 的 error 訊息
4. **重啟** 服務
5. **聯繫** 技術支援

---

祝部署順利！🚀
