from flask import Flask, jsonify
from flask import send_from_directory, abort, request
from flask_cors import CORS
import json
from pathlib import Path
import csv
import pandas as pd
from datetime import datetime, timedelta
import subprocess
import sys
import os
import uuid

app = Flask(__name__)
# enable CORS so the frontend (running on a different port) can fetch data
CORS(app)


@app.route("/hello")
def hello():
    return jsonify({"message": "Flask backend up"})

    
@app.route("/sector-heatmap")
def sector_heatmap():
    """Return aggregated sector data derived from per-symbol CSVs and universe JSON.
    
    Query params:
        duration: One of "1d", "1w", "1m", "3m", "6m", "1y". Default "1d".
    
    Response:
    {
        "duration": "1d",
        "sectors": {
            "Technology": {
                "symbols": [...],
                "avg_change_pct": 1.2
            }
        }
    }
    """
    # Add debug logging
    app.logger.info("Sector heatmap request received")
    duration = request.args.get("duration", "1d")
    if duration not in ["1d", "1w", "1m", "3m", "6m", "1y"]:
        return jsonify({"error": "Invalid duration"}), 400

    base = Path(__file__).parent
    data_dir = base / "data"
    universe_file = data_dir / "universe_sample.json"
    
    # Add debug logging for data paths
    app.logger.info(f"Reading universe from {universe_file}")
    app.logger.info(f"Looking for OHLCV files in {data_dir/'ohlcv'}")
    
    if not universe_file.exists():
        app.logger.error("Universe file not found")
        return jsonify({"error": "Universe file not found"}), 500

    universe = read_universe(universe_file)

    sectors = {}

    for entry in universe:
        sym = entry.get("symbol")
        name = entry.get("name")
        sector = entry.get("sector") or "Unknown"
        csv_path = data_dir / "ohlcv" / f"{sym}.csv"
        app.logger.debug(f"Reading {sym} from {csv_path}")
        if not csv_path.exists():
            app.logger.warning(f"CSV not found for {sym}")
            continue
        latest = read_latest_from_csv(csv_path, duration)
        if latest is None:
            app.logger.warning(f"No valid data for {sym}")
            continue

        sym_obj = {
            "symbol": sym,
            "name": name,
            "date": latest.get("date"),
            "close": latest.get("close"),
            "change_pct": latest.get("change_pct"),
        }

        sect = sectors.setdefault(sector, {"symbols": [], "avg_change_pct": None})
        sect["symbols"].append(sym_obj)

    # compute averages per sector
    for sec_name, sec_data in sectors.items():
        changes = [s["change_pct"] for s in sec_data["symbols"] if s.get("change_pct") is not None]
        if changes:
            sec_data["avg_change_pct"] = sum(changes) / len(changes)
        else:
            sec_data["avg_change_pct"] = None
        
        app.logger.debug(f"Sector {sec_name}: {len(sec_data['symbols'])} symbols, avg change: {sec_data['avg_change_pct']}")

    if not sectors:
        app.logger.warning("No sector data found - did you run ingest first?")
        return jsonify({"error": "No data available. Run ingest first."}), 404

    return jsonify({"duration": duration, "sectors": sectors})



@app.route('/run-ingest', methods=['POST'])
def run_ingest():
    """Start the ingest script in background and return a job id and log path.

    Optional JSON body:
      { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "limit": 10 }

    Response: { "job_id": "...", "pid": 1234, "log_path": "/abs/path/to/log" }
    """
    base = Path(__file__).resolve().parent
    repo_root = base.parent
    script = repo_root / 'scripts' / 'ingest.py'
    if not script.exists():
        return jsonify({'error': 'ingest script not found', 'path': str(script)}), 400

    body = {}
    try:
        if request.is_json:
            body = request.get_json()
    except Exception:
        body = {}

    args = [sys.executable, str(script)]
    # support a few optional params
    if body.get('start'):
        args += ['--start', str(body['start'])]
    if body.get('end'):
        args += ['--end', str(body['end'])]
    if body.get('limit'):
        args += ['--limit', str(int(body['limit']))]

    logs_dir = repo_root / 'backend-python' / 'data' / 'ingest_logs'
    logs_dir.mkdir(parents=True, exist_ok=True)
    job_id = uuid.uuid4().hex
    log_path = logs_dir / f'{job_id}.log'
    progress_path = logs_dir / f'{job_id}.progress.json'

    # pass progress file to ingest script
    args += ['--progress-file', str(progress_path)]

    # start background process, redirect stdout/stderr to log file
    with open(log_path, 'wb') as out:
        proc = subprocess.Popen(args, stdout=out, stderr=subprocess.STDOUT, cwd=str(repo_root))

    return jsonify({'job_id': job_id, 'pid': proc.pid, 'log_path': str(log_path)})



@app.route('/ingest-progress/<job_id>')
def ingest_progress(job_id: str):
    base = Path(__file__).resolve().parent
    repo_root = base.parent
    logs_dir = repo_root / 'backend-python' / 'data' / 'ingest_logs'
    progress_path = logs_dir / f'{job_id}.progress.json'
    if not progress_path.exists():
        return jsonify({'error': 'progress not found'}), 404
    try:
        with progress_path.open('r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as exc:
        return jsonify({'error': 'failed to read progress', 'detail': str(exc)}), 500
    return jsonify(data)


def read_universe(universe_path: Path):
    if not universe_path.exists():
        return []
    with universe_path.open("r", encoding="utf-8") as f:
        return json.load(f)

def compute_indicators_from_csv(csv_path: Path):
    """Read CSV into pandas and compute indicators: RSI(14), MACD, EMAs (21,44,200).

    Returns dict with keys: symbol, latest_close, rsi, macd_signal, macd_hist, macd_crossover ("bullish"/"bearish"/"neutral"),
    above_ema_21, above_ema_44, above_ema_200, dist_21, dist_44, dist_200, and ohlcv (list of recent rows)
    """
    if not csv_path.exists():
        return None
    try:
        # many CSVs include an extra ticker row; skip the 2nd and 3rd lines if present
        df = pd.read_csv(csv_path, header=0, skiprows=[1,2], parse_dates=[0])
    except Exception:
        try:
            df = pd.read_csv(csv_path, header=0, parse_dates=[0])
        except Exception:
            return None

    if df.shape[0] < 10:
        return None

    # ensure first column is Date
    df.rename(columns={df.columns[0]: 'Date'}, inplace=True)
    df.set_index('Date', inplace=True)

    # canonical close column
    close_col = None
    for c in ['Close', 'close', 'Adj Close', 'AdjClose', 'Adj_Close']:
        if c in df.columns:
            close_col = c
            break
    if close_col is None:
        # pick second column if uncertain
        close_col = df.columns[0]

    close = df[close_col].astype(float)

    # RSI 14 (Wilder smoothing using ewm)
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1/14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/14, adjust=False).mean()
    rs = avg_gain / (avg_loss.replace(0, pd.NA))
    rsi = 100 - (100 / (1 + rs))

    # EMAs
    ema21 = close.ewm(span=21, adjust=False).mean()
    ema44 = close.ewm(span=44, adjust=False).mean()
    ema200 = close.ewm(span=200, adjust=False).mean()

    # MACD
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    macd_hist = macd - signal

    # Determine crossover from last two values
    macd_crossover = 'neutral'
    if len(macd_hist) >= 2:
        prev = macd_hist.iloc[-2]
        curr = macd_hist.iloc[-1]
        if prev <= 0 and curr > 0:
            macd_crossover = 'bullish'
        elif prev >= 0 and curr < 0:
            macd_crossover = 'bearish'

    latest_close = float(close.iloc[-1])

    def pct_dist(series):
        v = series.iloc[-1]
        if v == 0 or pd.isna(v):
            return None
        return (latest_close - v) / v * 100.0

    above_21 = latest_close > float(ema21.iloc[-1]) if not pd.isna(ema21.iloc[-1]) else None
    above_44 = latest_close > float(ema44.iloc[-1]) if not pd.isna(ema44.iloc[-1]) else None
    above_200 = latest_close > float(ema200.iloc[-1]) if not pd.isna(ema200.iloc[-1]) else None

    dist_21 = pct_dist(ema21)
    dist_44 = pct_dist(ema44)
    dist_200 = pct_dist(ema200)

    # prepare recent ohlcv for candlestick (last 200 rows)
    ohlcv_cols = None
    for cset in [['Open','High','Low','Close'], ['Open','High','Low','close'], ['Open','High','Low','Adj Close']]:
        if all(c in df.columns for c in cset):
            ohlcv_cols = cset
            break
    if ohlcv_cols is None:
        # try common names
        possible = [c for c in df.columns if c.lower() in ('open','high','low','close')]
        ohlcv_cols = possible[:4]

    ohlcv = []
    take = df.tail(200)
    for idx, row in take.iterrows():
        try:
            ohlcv.append({
                'date': idx.strftime('%Y-%m-%d'),
                'open': float(row.get('Open', row.get('open', None))) if 'Open' in row.index or 'open' in row.index else None,
                'high': float(row.get('High', row.get('high', None))) if 'High' in row.index or 'high' in row.index else None,
                'low': float(row.get('Low', row.get('low', None))) if 'Low' in row.index or 'low' in row.index else None,
                'close': float(row.get(close_col)),
                'volume': int(row.get('Volume', row.get('volume', 0))) if ('Volume' in row.index or 'volume' in row.index) else None,
            })
        except Exception:
            continue

    return {
        'latest_close': latest_close,
        'rsi': None if pd.isna(rsi.iloc[-1]) else float(rsi.iloc[-1]),
        'macd': float(macd.iloc[-1]) if not pd.isna(macd.iloc[-1]) else None,
        'macd_signal': float(signal.iloc[-1]) if not pd.isna(signal.iloc[-1]) else None,
        'macd_hist': float(macd_hist.iloc[-1]) if not pd.isna(macd_hist.iloc[-1]) else None,
        'macd_crossover': macd_crossover,
        'above_21': above_21,
        'above_44': above_44,
        'above_200': above_200,
        'dist_21': dist_21,
        'dist_44': dist_44,
        'dist_200': dist_200,
        'ohlcv': ohlcv,
    }


@app.route('/analysis')
def analysis():
    """Return analysis metrics for all symbols or a single symbol if query param `symbol` is provided.

    Response:
      { "symbols": { "SYM": { ...metrics... }, ... }, "selected": { "symbol": "SYM", "ohlcv": [...] } }
    """
    base = Path(__file__).parent
    data_dir = base / 'data' / 'ohlcv'
    symbol = request.args.get('symbol')

    # load universe to decide which symbols to include
    universe = read_universe(base / 'data' / 'universe_sample.json')
    symbols = [e.get('symbol') for e in universe if e.get('symbol')]

    results = {}
    for sym in symbols:
        csv_path = data_dir / f"{sym}.csv"
        info = compute_indicators_from_csv(csv_path)
        if info is None:
            continue
        results[sym] = info

    selected_data = None
    if symbol:
        sym = symbol
        csv_path = data_dir / f"{sym}.csv"
        selected_data = compute_indicators_from_csv(csv_path)

    return jsonify({'symbols': results, 'selected': {'symbol': symbol, 'data': selected_data}})


def read_latest_from_csv(csv_path: Path, duration: str = "1d"):
    """Read the latest row from a CSV produced by the ingest script.
    
    Args:
        csv_path: Path to CSV file
        duration: One of "1d" (1 day), "1w" (1 week), "1m" (1 month), "3m", "6m", "1y" (1 year)
                 Default is "1d" for 1-day change.
    
    Returns dict with keys:
        date (str): Latest date
        close (float): Latest close price
        prev_close (float or None): Previous close for computing change
        change_pct (float or None): Percentage change over duration
    """
    if not csv_path.exists():
        return None
    
    # Map duration to number of calendar days to look back
    duration_days = {
        "1d": 1,
        "1w": 7,
        "1m": 30,
        "3m": 90,
        "6m": 180,
        "1y": 365,
    }.get(duration, 1)  # default to 1 day

    # Find latest date and target date for comparison
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.reader(f)
        # skip the first 3 header-ish lines if present (based on sample files)
        rows = [r for r in reader if r]
        # find rows that look like date rows (start with YYYY-)
        data_rows = [r for r in rows if r[0] and (len(r[0]) >= 4 and r[0][0].isdigit())]
        if not data_rows:
            return None

        # Get latest row
        last = data_rows[-1]
        last_date = datetime.strptime(last[0], "%Y-%m-%d")
        target_date = last_date - timedelta(days=duration_days)

        # Find closest row to target date by comparing dates
        prev = None
        prev_diff = None
        for row in data_rows:
            try:
                date = datetime.strptime(row[0], "%Y-%m-%d")
                diff = abs((date - target_date).days)
                if prev_diff is None or diff < prev_diff:
                    prev = row
                    prev_diff = diff
            except ValueError:
                continue

    try:
        close = float(last[2]) if len(last) > 2 and last[2] != "" else float(last[1])
    except Exception:
        # fallback try other columns
        try:
            close = float(last[1])
        except Exception:
            return None

    prev_close = None
    if prev is not None:
        try:
            prev_close = float(prev[2]) if len(prev) > 2 and prev[2] != "" else float(prev[1])
        except Exception:
            prev_close = None

    change_pct = None
    if prev_close is not None and prev_close != 0:
        change_pct = (close - prev_close) / prev_close * 100.0

    return {
        "date": last[0],
        "close": close,
        "prev_close": prev_close,
        "change_pct": change_pct,
    }

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
