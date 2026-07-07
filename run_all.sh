#!/usr/bin/env zsh
# ─────────────────────────────────────────────────────────────────
# run_all.sh  –  Start both backend and frontend in split terminals
# Usage: ./run_all.sh
# ─────────────────────────────────────────────────────────────────

CONDA_ENV="/Users/cynthia/opt/miniconda3/envs/smart_city"
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🚀  Starting FastAPI backend on http://localhost:8000 ..."
osascript -e "
  tell application \"Terminal\"
    do script \"cd '$ROOT/backend' && '$CONDA_ENV/bin/python' -m uvicorn app.main:app --reload --port 8000\"
  end tell
"

sleep 1

echo "🚀  Starting Vite frontend on http://localhost:5173 ..."
osascript -e "
  tell application \"Terminal\"
    do script \"cd '$ROOT/frontend' && '$CONDA_ENV/bin/node' '$CONDA_ENV/bin/npm' run dev\"
  end tell
"

echo ""
echo "✅  Both servers starting in separate Terminal windows."
echo "   Backend  →  http://localhost:8000/docs"
echo "   Frontend →  http://localhost:5173"
