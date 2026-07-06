#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_pipeline.sh  —  Smart City Traffic Analytics
# Usage:  bash run_pipeline.sh [path/to/video.mp4]
# ─────────────────────────────────────────────────────────────────────────────

set -e  # exit on any error

# ── Config ────────────────────────────────────────────────────────────────────
VIDEO="${1:-video_20min.mp4}"          # first CLI arg or default
MODEL="${2:-yolov8s.pt}"               # second arg: yolov8n/s/m/l/x
SKIP_FRAMES=2                          # process every 3rd frame (speed vs accuracy)
CONF=0.35                              # detection confidence threshold
RAW_JSON="pipeline/tracking_raw.json"
DASHBOARD_JSON="dashboard/data/traffic_data.json"
DASHBOARD_PORT=8080

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   Smart City Traffic Analytics Pipeline${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── Check video exists ────────────────────────────────────────────────────────
if [ ! -f "$VIDEO" ]; then
    echo "❌  Video file not found: $VIDEO"
    echo "    Usage: bash run_pipeline.sh path/to/your_video.mp4"
    exit 1
fi
info "Video: $VIDEO"
info "Model: $MODEL"
echo ""

# ── Stage 1 & 2: Detection & Tracking ────────────────────────────────────────
echo -e "${CYAN}▶  Stage 1+2: Vehicle Detection & Tracking${NC}"
python pipeline/detect_and_track.py \
    --video  "$VIDEO"       \
    --model  "$MODEL"       \
    --skip   $SKIP_FRAMES   \
    --conf   $CONF          \
    --output "$RAW_JSON"
echo ""

# ── Stage 3: Analysis & Recommendations ──────────────────────────────────────
echo -e "${CYAN}▶  Stage 3: Traffic Analysis & Recommendations${NC}"
python pipeline/analyze_traffic.py \
    --input  "$RAW_JSON"       \
    --output "$DASHBOARD_JSON"
echo ""

# ── Stage 4: Serve Dashboard ──────────────────────────────────────────────────
echo -e "${CYAN}▶  Stage 4: Launching Dashboard${NC}"
success "Dashboard data ready at: $DASHBOARD_JSON"
echo ""
echo -e "  Open your browser at  ${GREEN}http://localhost:${DASHBOARD_PORT}${NC}"
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop the server."
echo ""

cd dashboard
python -m http.server $DASHBOARD_PORT
