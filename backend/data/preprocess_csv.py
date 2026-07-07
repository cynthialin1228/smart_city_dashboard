import pandas as pd
import json
import os

def run_perfect_alignment():
    print("🚀 [交通大數據引擎] 開始進行真實 CSV 欄位對齊洗牌...")
    
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    data_folder = os.path.join(base_dir, "intersection_01")
    
    tracks_path = os.path.join(data_folder, "tracks_od.csv")
    events_path = os.path.join(data_folder, "events.csv")
    counts_path = os.path.join(data_folder, "counts_by_bucket.csv")
    
    # 讀取資料並全面填充 NaN 值，防止 JSON 轉譯失敗
    df_tracks = pd.read_csv(tracks_path).fillna("")
    df_events = pd.read_csv(events_path).fillna("")
    df_counts = pd.read_csv(counts_path).fillna(0)
    
    # 1. 處理下方全量每分鐘趨勢折線圖 (counts_by_bucket)
    trends_list = []
    for _, row in df_counts.iterrows():
        trends_list.append({
            "bucket": int(row['bucket']),
            "car": int(row['car']),
            "motorcycle": int(row['motorcycle']),
            "truck": int(row['truck']),
            "bus": int(row['bus']),
            "total": int(row['total']),
            "pcu": float(row['pcu'])
        })
        
    # 2. 建立全域秒級活躍車輛活動索引 (0 ~ Max 秒)
    max_sec = int(df_tracks['last_t'].max()) + 1
    tracks_indexed = {str(s): [] for s in range(max_sec)}
    
    for _, row in df_tracks.iterrows():
        t_start = max(0, int(row['first_t']))
        t_end = min(max_sec - 1, int(row['last_t']))
        for s in range(t_start, t_end + 1):
            tracks_indexed[str(s)].append({
                "id": int(row['track_id']),
                "class": str(row['class']), # motorcycle, car, truck
                "motion": float(row['max_motion_ratio']) if row['max_motion_ratio'] != "" else 0.0
            })
            
    # 3. 建立秒級觸發跨線事件索引
    events_indexed = {str(s): [] for s in range(max_sec)}
    for _, row in df_events.iterrows():
        sec_key = str(int(row['t_seconds']))
        if sec_key in events_indexed:
            events_indexed[sec_key].append({
                "time_str": str(row['video_time']),
                "line": str(row['line']),
                "direction": int(row['direction']),
                "id": int(row['track_id']),
                "class": str(row['class'])
            })
            
    # 4. 統計整體車流方向轉向強度 (防禦性填充空起迄點，解決右側一片空白的盲點)
    od_distribution = {}
    for _, row in df_tracks.iterrows():
        ori = str(row['origin']).strip() if str(row['origin']).strip() != "" else "未知路口進入"
        dest = str(row['destination']).strip() if str(row['destination']).strip() != "" else "未知路口離開"
        route = f"{ori} ➡️ {dest}"
        od_distribution[route] = od_distribution.get(route, 0) + 1
        
    # 封裝輸出 Payload
    output_payload = {
        "status": "success",
        "trends": trends_list,
        "live_tracks": tracks_indexed,
        "live_events": events_indexed,
        "od_matrix": od_distribution
    }
    
    # 儲存至後端與前端皆可讀取的靜態目錄
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    os.makedirs(static_dir, exist_ok=True)
    
    output_path = os.path.join(static_dir, "traffic_indexed.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False)
        
    print(f"✅ [資料重組完成] 對齊的資料快取已成功匯出至：{output_path}")

if __name__ == "__main__":
    run_perfect_alignment()