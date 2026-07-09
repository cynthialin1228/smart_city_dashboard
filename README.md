# 🚦 Smart City Traffic Digital Twin System
**智慧城市交通數位孿生系統**

> AI-powered traffic counting & signal optimization with real-time visualization.  
> Built for intelligent traffic management & urban planning.

### 1. Install Conda

If you don't have Conda, install [Miniconda](https://docs.conda.io/en/latest/miniconda.html):

```bash
# macOS (Apple Silicon or Intel)
brew install --cask miniconda
# or download installer from https://docs.conda.io/en/latest/miniconda.html
```

### 2. Create the environment

```bash
conda create -n smart_city python=3.11 -y
conda activate smart_city
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

> On first run, YOLOv8 will automatically download the model weights (~22 MB for `yolov8s.pt`). An internet connection is required.

---

## Running the Pipeline

### Full pipeline (detect → analyze → serve dashboard)

At the ```smart_city_dashboard``` root folder

1. Open 1 terminal
```bash
cd backend
conda activate smart_city
uvicorn app.main:app --reload --port 8000
```

2. Open the 2nd terminal
```bash
cd frontend
conda activate smart_city
npm run dev
```

Then open **http://localhost:5173/** in your browser.