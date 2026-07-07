from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

app = FastAPI(title="智慧城市新版車流觀測 API 服務")

# 啟用 CORS 跨網域存取，確保 React 前端 (localhost:3000 或 5173) 可以流暢抓取資料
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 定義並掛載後端的靜態資源目錄 (backend/static)
current_dir = os.path.dirname(os.path.dirname(__file__))
static_path = os.path.join(current_dir, "static")
os.makedirs(static_path, exist_ok=True)

# 提示開發者將影片放入正確位置
print(f"💡 請確認您的路口 mp4 影片已放入此路徑並命名為: {os.path.join(static_path, 'traffic_video.mp4')}")

app.mount("/static", StaticFiles(directory=static_path), name="static")

@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "message": "後端秒級車流資料對接引擎運作正常",
        "data_cached": os.path.exists(os.path.join(static_path, "traffic_indexed.json"))
    }