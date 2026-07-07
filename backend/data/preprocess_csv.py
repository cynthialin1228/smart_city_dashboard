import pandas as pd
import json
import os

def run_perfect_indexing():
    print("🚀 [大數據校正引擎] 開始對齊 20 分鐘 CSV 時間軸至 3 分鐘精華影片...")
    
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    data_folder = os.path.join(base_dir, "backend/data/")
    
    tracks_path = os.path.join(data_folder, "tracks_od.csv")
    events_path = os.path.join(data_folder, "events.csv")
    counts_path = os.path.join(data_folder, "counts_by_bucket.csv")
    
    # 載入並強制填充空值
    df_tracks = pd.read_csv(tracks_path).fillna("")
    df_events = pd.read_csv(events_path).fillna("")
    df_counts = pd.read_csv(counts_path).fillna(0)
    
    # 1. 處理每分鐘趨勢
    trends_list = df_counts.to_dict(orient="records")
    
    # 2. 生成秒級活跃車輛地圖 (0 ~ 1200 秒)
    max_sec = int(df_tracks['last_t'].max()) + 1
    tracks_indexed = {str(s): [] for s in range(max_sec)}
    
    for _, row in df_tracks.iterrows():
        t_start = max(0, int(row['first_t']))
        t_end = min(max_sec - 1, int(row['last_t']))
        
        # 核心校正：因為影片只有 3 分鐘 (180秒)，我們將 20 分鐘的車流做「模數循環（Modulo）」
        # 讓這 20 分鐘綿延不斷的車流數據，能夠完美在 3 分鐘的影片播放中重複對齊渲染，絕不歸零！
        for s in range(t_start, t_end + 1):
            video_sec_loop = s % 180 # 限制在 0-179 秒的影片活動窗口內
            tracks_indexed[str(video_sec_loop)].append({
                "id": int(row['track_id']),
                "class": str(row['class']).lower().strip(), # 強制轉小寫去空格
                "motion": float(row['max_motion_ratio']) if row['max_motion_ratio'] != "" else 0.0
            })
            
    # 3. 處理跨線事件
    events_indexed = {str(s): [] for s in range(max_sec)}
    for _, row in df_events.iterrows():
        sec_key = str(int(row['t_seconds']) % 180) # 同步循環校正
        events_indexed[sec_key].append({
            "time_str": str(row['video_time']),
            "line": str(row['line']),
            "direction": int(row['direction']),
            "id": int(row['track_id']),
            "class": str(row['class']).lower()
        })
        
    # 4. 統計整體流向
    od_distribution = {}
    for _, row in df_tracks.iterrows():
        ori = str(row['origin']).strip() if str(row['origin']).strip() != "" else "未知進入向"
        dest = str(row['destination']).strip() if str(row['destination']).strip() != "" else "未知離開向"
        route = f"{ori} ➡️ {dest}"
        od_distribution[route] = od_distribution.get(route, 0) + 1
        
    payload = {
        "status": "success",
        "trends": trends_list,
        "live_tracks": tracks_indexed,
        "live_events": events_indexed,
        "od_matrix": od_distribution
    }
    
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    output_path = os.path.join(static_dir, "traffic_indexed.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        
    print(f"✅ [後端快取校正成功] 數據已完美壓縮對齊至 3 分鐘視窗！路徑：{output_path}")

if __name__ == "__main__":
    run_perfect_indexing()