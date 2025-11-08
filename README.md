# Stock Screener (Barebone Scaffold)

## Structure
- frontend/ : React app with three tabs (Heatmap, Analysis, Paper Trades)
- backend-python/ : Flask API backend
- scripts/ : placeholder for data ingestion scripts

## Run frontend
cd frontend
npm install
npm start

## Run backend
cd backend-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py

Frontend: http://localhost:3000
Backend: http://localhost:5000/hello
