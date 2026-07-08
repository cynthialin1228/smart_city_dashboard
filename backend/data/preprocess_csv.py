import pandas as pd
import json
import os

def run_advanced_cluster_pipeline():
    print("🚀 [智慧群集對齊引擎] 開始解析真實車流幾何軌跡與優化 Cluster...")
    
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    data_folder = os.path.join(base_dir, "backend/data/")
    
    tracks_path = os.path.join(data_folder, "tracks_od.csv")
    events_path = os.path.join(data_folder, "events.csv")
    counts_path = os.path.join(data_folder, "counts_by_bucket.csv")
    
    df_tracks = pd.read_csv(tracks_path).fillna("")
    df_events = pd.read_csv(events_path).fillna("")
    df_counts = pd.read_csv(counts_path).fillna(0)
    
    # 1. PCU 全量趨勢
    trends_list = df_counts.to_dict(orient="records")
    
    # 2. 建立完備的秒級活動索引與真實幾何空間座標投射
    max_sec = int(df_tracks['last_t'].max()) + 1
    tracks_indexed = {str(s): [] for s in range(max_sec)}
    
    # 用於統計優化後的整體流向矩陣
    optimized_od_matrix = {}

    for _, row in df_tracks.iterrows():
        t_start = max(0, int(row['first_t']))
        t_end = min(max_sec - 1, int(row['last_t']))
        
        # 提取真實座標
        fx, fy = float(row['first_x']), float(row['first_y'])
        lx, ly = float(row['last_x']), float(row['last_y'])
        
        # 讀取真實的機器學習分群
        raw_cluster = int(row['trajectory_cluster']) if row['trajectory_cluster'] != "" else -1
        
        # --- 核心邏輯：依照您的規範對 Cluster 進行就地重組與細分 ---
        cluster_label = "其他雜碎車流"
        
        if raw_cluster in [1, 2, 4, 5, 8]:
            # 分得好的群組，直接轉化為直觀語意
            cluster_label = f"主要流向群群 (Cluster {raw_cluster})"
        elif raw_cluster == 0:
            # 流量極大群組 0：依據幾何起迄斜率與位移，動態解構分群為 3 個車流方向
            dx = lx - fx
            dy = ly - fy
            if dx < -100:
                cluster_label = "流向 0-A (主幹道左轉向)"
            elif dy > 50:
                cluster_label = "流向 0-B (主幹道右轉向)"
            else:
                cluster_label = "流向 0-C (路口直行向)"
        elif raw_cluster in [3, 6, 7, 9, 10, 11]:
            # 分太少或需要合併的類別，邏輯聚合為邊緣次要流向
            cluster_label = "次要分流/邊緣迴轉向 (合併群組)"
        else:
            cluster_label = "未分類噪點車流"

        # 累加至整體流向排行數據中
        optimized_od_matrix[cluster_label] = optimized_od_matrix.get(cluster_label, 0) + 1
        
        # 注入秒級活動時間軸，計算當前秒數的平滑內插坐標 (1:1 貼合車輛)
        total_t = max((t_end - t_start), 1)
        for s in range(t_start, t_end + 1):
            ratio = (s - t_start) / total_t
            # 實打實利用 CSV 內的幾何起迄點計算即時點位
            current_x = fx + (lx - fx) * ratio
            current_y = fy + (ly - fy) * ratio
            
            tracks_indexed[str(s)].append({
                "id": str(row['track_id']),
                "class": str(row['class']).lower().strip(),
                "x": current_x,
                "y": current_y,
                "fx": fx, "fy": fy, # 帶上起點用於畫歷史尾跡
                "cluster_label": cluster_label
            })
            
    # 3. 處理秒級事件日誌
    events_indexed = {str(s): [] for s in range(max_sec)}
    for _, row in df_events.iterrows():
        sec_key = str(int(row['t_seconds']))
        if sec_key in events_indexed:
            events_indexed[sec_key].append({
                "time_str": str(row['video_time']),
                "line": str(row['line']),
                "id": str(row['track_id']),
                "class": str(row['class']).lower().strip()
            })
            
    # 打包 Payloads
    payload = {
        "status": "success",
        "trends": trends_list,
        "live_tracks": tracks_indexed,
        "live_events": events_indexed,
        "od_matrix": optimized_od_matrix # 吐出全新改進的優化方向排行
    }
    
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    output_path = os.path.join(static_dir, "traffic_indexed.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        
    print(f"✅ [幾何分群引擎升級完成] 真實資料已對齊匯出至：{output_path}")

if __name__ == "__main__":
    run_advanced_cluster_pipeline()