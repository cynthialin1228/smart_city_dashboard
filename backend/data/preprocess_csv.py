import pandas as pd
import json
import os
import ast

def run_fsd_style_preprocessing():
    print("🚀 [ FSD 建模引擎] 開始封裝 20 分鐘軌跡與 3D 建模背景坐標...")
    
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    data_folder = os.path.join(base_dir, "backend/data/")
    
    trajectories_path = os.path.join(data_folder, "trajectories.csv")
    events_path = os.path.join(data_folder, "events.csv")
    counts_path = os.path.join(data_folder, "counts_by_bucket.csv")

    df_trajectories = pd.read_csv(trajectories_path).fillna("")
    df_events = pd.read_csv(events_path).fillna("")
    df_counts = pd.read_csv(counts_path).fillna(0)
    
    trends_list = df_counts.to_dict(orient="records")
    max_sec = int(df_trajectories['last_t'].max()) + 2
    tracks_indexed = {str(s): [] for s in range(max_sec)}
    optimized_cluster_matrix = {}

    # 💡 核心創新：在 1280x720 影像空間中，定義路口周圍建築物的幾何多邊形頂點 (對齊監視器畫面)
    building_polygons = [
        # 建築物 1 (左側街景大樓立體面)
        {"id": "b_left_front", "pts": [[0, 0], [450, 0], [350, 220], [0, 280]], "type": "wall_light"},
        {"id": "b_left_side", "pts": [[350, 220], [450, 0], [520, 180], [380, 240]], "type": "wall_dark"},
        # 建築物 2 (右側橫向商業大樓)
        {"id": "b_right_wall", "pts": [[900, 0], [1280, 0], [1280, 250], [980, 190]], "type": "wall_light"},
        {"id": "b_right_roof", "pts": [[820, 120], [900, 0], [980, 190], [880, 160]], "type": "wall_dark"},
        # 中央路口交通安全島 / 非道路綠帶
        {"id": "island_center", "pts": [[580, 320], [700, 310], [680, 340], [560, 350]], "type": "island"}
    ]

    for _, row in df_trajectories.iterrows():
        t_start = max(0, int(row['first_t']))
        t_end = min(max_sec - 1, int(row['last_t']))
        total_duration = max((t_end - t_start), 1)
        
        pts = ast.literal_eval(str(row['points_json'])) if row['points_json'] else []
        if not pts:
            pts = [[float(row['first_x']), float(row['first_y'])], [float(row['last_x']), float(row['last_y'])]]

        raw_cluster = int(row['trajectory_cluster']) if row['trajectory_cluster'] != "" else -1
        cluster_label = "其他邊緣車流"
        
        if raw_cluster in [1, 2, 4, 5, 8]:
            names = {1: "幹線左轉 ⬅️", 2: "對向左轉 ↙️", 4: "主幹道直行 ⬆️", 5: "跨區穿梭 🔀", 8: "右方匯入 ➡️"}
            cluster_label = names.get(raw_cluster, f"分群群體 {raw_cluster}")
        elif raw_cluster == 0:
            fx, fy = pts[0][0], pts[0][1]
            lx, ly = pts[-1][0], pts[-1][1]
            if (lx - fx) < -120: cluster_label = "流向 0-A (幹線分流左轉)"
            elif (ly - fy) > 50: cluster_label = "流向 0-B (主幹道右轉)"
            else: cluster_label = "流向 0-C (核心路口直行)"
        elif raw_cluster in [3, 6, 7, 9, 10, 11, -1]:
            cluster_label = "次要轉向 / 噪點車流 (邏輯合併)"

        optimized_cluster_matrix[cluster_label] = optimized_cluster_matrix.get(cluster_label, 0) + 1
        
        # 精確適配寬高 (對齊 YOLO 抑制後大小)
        cls = str(row['class']).lower().strip()
        box_w, box_h = 36, 36
        if cls == 'motorcycle': box_w, box_h = 22, 22
        elif cls in ['truck', 'bus']: box_w, box_h = 70, 38

        for s in range(t_start, t_end + 1):
            progress = (s - t_start) / total_duration
            pt_idx = min(int(progress * len(pts)), len(pts) - 1)
            current_pixel_pt = pts[pt_idx] if len(pts) > 0 else [640, 360]
            
            tracks_indexed[str(s)].append({
                "id": str(row['track_id']),
                "class": cls,
                "x": float(current_pixel_pt[0]),
                "y": float(current_pixel_pt[1]),
                "w": box_w, "h": box_h,
                "full_path": pts
            })
            
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
            
    payload = {
        "status": "success",
        "trends": trends_list,
        "buildings": building_polygons, # 💡 注入幾何建模圖層
        "live_tracks": tracks_indexed,
        "live_events": events_indexed,
        "cluster_matrix": optimized_cluster_matrix
    }
    
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    output_path = os.path.join(static_dir, "traffic_indexed.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        
    print(f"✅ [ FSD 風格封裝完成] 快取已導出至：{output_path}")

if __name__ == "__main__":
    run_fsd_style_preprocessing();