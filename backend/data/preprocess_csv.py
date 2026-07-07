import pandas as pd
import json
import os

def run_full_length_indexing():
    print("🚀 [全量大數據引擎] 開始 1:1 對齊 20 分鐘真實交通影片與 CSV 軌跡...")
    
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    data_folder = os.path.join(base_dir, "backend/data/")
    
    tracks_path = os.path.join(data_folder, "tracks_od.csv")
    events_path = os.path.join(data_folder, "events.csv")
    counts_path = os.path.join(data_folder, "counts_by_bucket.csv")
    
    # 載入並強制填充空值，避免前端 JSON 解析崩潰
    df_tracks = pd.read_csv(tracks_path).fillna("")
    df_events = pd.read_csv(events_path).fillna("")
    df_counts = pd.read_csv(counts_path).fillna(0)
    
    # 1. 處理每分鐘趨勢 (counts_by_bucket)
    trends_list = df_counts.to_dict(orient="records")
    
    # 2. 建立全量秒級活躍車輛活動索引 (0 ~ 1200+秒，毫無保留)
    max_sec = int(df_tracks['last_t'].max()) + 1
    tracks_indexed = {str(s): [] for s in range(max_sec)}
    
    for _, row in df_tracks.iterrows():
        t_start = max(0, int(row['first_t']))
        t_end = min(max_sec - 1, int(row['last_t']))
        
        # 實打實地將車輛記錄注入它活動的每一個真實秒數
        for s in range(t_start, t_end + 1):
            tracks_indexed[str(s)].append({
                "id": int(row['track_id']),
                "class": str(row['class']).lower().strip(), # 規範化小寫去空格
                "motion": float(row['max_motion_ratio']) if row['max_motion_ratio'] != "" else 0.0
            })
            
    # 3. 建立全量秒級觸發跨線事件索引
    events_indexed = {str(s): [] for s in range(max_sec)}
    for _, row in df_events.iterrows():
        sec_key = str(int(row['t_seconds']))
        if sec_key in events_indexed:
            events_indexed[sec_key].append({
                "time_str": str(row['video_time']),
                "line": str(row['line']),
                "direction": int(row['direction']),
                "id": int(row['track_id']),
                "class": str(row['class']).lower().strip()
            })
        
    # 4. 統計整體車流轉向矩陣强度 (起訖點排行)
    od_distribution = {}
    for _, row in df_tracks.iterrows():
        ori = str(row['origin']).strip() if str(row['origin']).strip() != "" else "未知路口進入"
        dest = str(row['destination']).strip() if str(row['destination']).strip() != "" else "未知路口離開"
        route = f"{ori} ➡️ {dest}"
        od_distribution[route] = od_distribution.get(route, 0) + 1
        
    payload = {
        "status": "success",
        "meta": {
            "duration_seconds": max_sec,
            "total_vehicles": len(df_tracks)
        },
        "trends": trends_list,
        "live_tracks": tracks_indexed,
        "live_events": events_indexed,
        "od_matrix": od_distribution
    }
    
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    output_path = os.path.join(static_dir, "traffic_indexed.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        
    print(f"✅ [全量對齊成功] 20 分鐘真實大數據已完整釋放！無任何時間截斷。路徑：{output_path}")

if __name__ == "__main__":
    run_full_length_indexing()