# Role & Context
You are an expert full-stack engineer and computer vision specialist. We are building a dynamic "Digital Twin Traffic Control Room" dashboard demo on localhost. The folder name is `smart_city_dashboard/`, and it is currently completely empty.

## Core Concept: The Cyberpunk Digital Twin Dashboard
Instead of boring pie charts and standard grids, this dashboard is a high-tech control room. 
1. **Config Mode**: A non-engineer user can open the local web page and use their mouse to draw an ROI mask (polygon) and 4 directional counting lines (A: Straight, B: Opposite, C: Cross Direction 1, D: Cross Direction 2) directly on top of a playing video.
2. **Dashboard Mode**: Once confirmed, the UI seamlessly transforms. The video plays on one side, while the canvas turns into a "Digital Twin Particle Renderer" where vehicles are rendered as glowing sci-fi particles based on spatial data processed by the backend. A dynamic Cross-Sankey Flow Chart shows directional flow using water-pipe thickness, and a Rule-based optimization engine alerts users with tactical signal adjustments ("Extend left-turn green by 8s").

## Technical Architecture (Lightweight & Offline)
- **Backend**: FastAPI (Python) + WebSocket. To save compute resources and ensure 60 FPS, we use a `PRE_COMPUTED` approach. We assume YOLOv8/v10 + ByteTrack tracking data is already available as a raw relative trajectory database (`backend/data/traffic_base.json`). The backend reads user-defined canvas lines, performs instant cross-product vector geometry intersections, updates traffic metrics (PCU conversion: Motorcycle=0.5, Car=1.0, Bus=2.5), and streams them via WebSocket based on the video timestamp.
- **Frontend**: React + TailwindCSS + HTML5 Canvas (for particle/line rendering) + D3.js (for Cross-Sankey flow).

---

# Project Structure to Create

smart_city_dashboard/
│
├── backend/                  # FastAPI Backend
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py           # FastAPI entry & WebSocket server
│   │   ├── spatial_engine.py # Vector intersection geometry algorithm
│   │   └── traffic_rules.py  # Rule-based traffic signal advisor
│   ├── data/
│   │   └── traffic_base.json # Mock/Pre-computed raw trajectory coordinates
│   └── requirements.txt      
│
├── frontend/                 # React Frontend (Vite + Tailwind)
│   ├── public/
│   │   └── video/
│   │       └── raw_video.mp4 # 20-min source traffic monitoring video
│   ├── src/
│   │   ├── components/
│   │   │   ├── TrafficCanvas.jsx # Canvas Overlay (Drawing Lines & Particle Rendering)
│   │   │   ├── SankeyFlow.jsx    # Cross-shaped dynamic water-pipe flow
│   │   │   ├── ControlPanel.jsx  # Interactive signal optimization alerts
│   │   │   └── TimeScrubber.jsx  # Bottom timeline synced with video
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── tailwind.config.js    # Cyberpunk / Dark sci-fi color palette
│
└── run_all.sh                # Automation script to spin up both servers

---

# Data Contract (JSON Structures)

### 1. Front-to-Back Config Payload (`POST /api/config`)
Sent when user clicks "[🚀 Launch AI Traffic Analysis]" after drawing lines (coordinates normalized $0.0 \sim 1.0$):
```json
{
  "roi": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
  "lines": {
    "A": [[0.2, 0.7], [0.5, 0.7]],
    "B": [[0.5, 0.3], [0.8, 0.3]],
    "C": [[0.3, 0.2], [0.3, 0.8]],
    "D": [[0.7, 0.2], [0.7, 0.8]]
  }
}