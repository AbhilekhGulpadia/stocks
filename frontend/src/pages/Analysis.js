import React, { useEffect, useState, useMemo } from 'react';
import Plot from 'react-plotly.js';

function formatBool(b) {
  if (b === null || b === undefined) return 'N/A';
  return b ? 'Yes' : 'No';
}

function numberOrNA(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return 'N/A';
  return Number(v).toFixed(digits);
}

// Compute EMA series from numeric array (null-safe). Returns array of same length with nulls preserved
function computeEMA(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) {
      out[i] = null;
      continue;
    }
    if (prev == null) {
      // initialize EMA at first valid value
      prev = v;
      out[i] = v;
    } else {
      const ema = alpha * v + (1 - alpha) * prev;
      out[i] = ema;
      prev = ema;
    }
  }
  return out;
}

// Compute RSI (Wilder smoothing) from numeric array. Returns array of same length with nulls preserved
function computeRSI(values, period = 14) {
  const out = new Array(values.length).fill(null);
  // collect valid indices
  const vals = values.map((v) => (v == null || Number.isNaN(v) ? null : v));
  // find first window with enough valid values
  let firstIdx = -1;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] == null) continue;
    // check if we have period+1 valid values ending at i
    let count = 0;
    for (let j = i; j > i - (period + 1) && j >= 0; j--) {
      if (vals[j] != null) count++;
    }
    if (count >= period + 1) {
      firstIdx = i - period; // start of window
      break;
    }
  }
  if (firstIdx === -1) return out;

  // compute initial average gain/loss over first 'period' intervals
  let gain = 0;
  let loss = 0;
  for (let i = firstIdx + 1; i <= firstIdx + period; i++) {
    const d = vals[i] - vals[i - 1];
    if (d > 0) gain += d;
    else loss += -d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  // RSI for the first valid point at index firstIdx+period
  const firstRsiIdx = firstIdx + period;
  if (avgLoss === 0 && avgGain === 0) out[firstRsiIdx] = 50;
  else if (avgLoss === 0) out[firstRsiIdx] = 100;
  else {
    const rs = avgGain / avgLoss;
    out[firstRsiIdx] = 100 - 100 / (1 + rs);
  }

  // propagate using Wilder smoothing
  for (let i = firstRsiIdx + 1; i < vals.length; i++) {
    if (vals[i] == null || vals[i - 1] == null) {
      out[i] = null;
      continue;
    }
    const d = vals[i] - vals[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    if (avgLoss === 0 && avgGain === 0) out[i] = 50;
    else if (avgLoss === 0) out[i] = 100;
    else {
      const rs = avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }

  return out;
}

// Compute MACD series from closes: returns { macd, signal, hist }
function computeMACD(values) {
  const ema12 = computeEMA(values, 12);
  const ema26 = computeEMA(values, 26);
  const macd = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (ema12[i] == null || ema26[i] == null) macd[i] = null;
    else macd[i] = ema12[i] - ema26[i];
  }
  const signal = computeEMA(macd, 9);
  const hist = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (macd[i] == null || signal[i] == null) hist[i] = null;
    else hist[i] = macd[i] - signal[i];
  }
  return { macd, signal, hist };
}



export default function Analysis() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedSym, setSelectedSym] = useState(null);

  // filters
  const [rsiMin, setRsiMin] = useState(0);
  const [rsiMax, setRsiMax] = useState(100);
  const [above200Filter, setAbove200Filter] = useState('any'); // any | true | false
  const [macdFilter, setMacdFilter] = useState('any'); // any | bullish | bearish | neutral
  // lookback for series-based filters (number of sessions); use null for full history
  const [lookback, setLookback] = useState(200);
  // EMA crossover filter
  const [crossoverPair, setCrossoverPair] = useState('none'); // none | '21_44' | '44_200' | '21_200'
  const [crossoverType, setCrossoverType] = useState('any'); // any | bullish | bearish

  useEffect(() => {
    setLoading(true);
    fetch('http://127.0.0.1:5000/analysis')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setData(json))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const rowHeight = 36;
  const visibleRows = 15;  // Changed to show 15 rows

  // sorting state for table
  const [sortKey, setSortKey] = useState(null); // e.g. 'symbol','rsi','dist_200'
  const [sortDir, setSortDir] = useState(null); // 'asc' | 'desc'

  const symbolsList = useMemo(() => Object.entries((data && data.symbols) || {}), [data]);

  // helper: detect crossover between two EMA arrays within lookback window
  function detectCrossover(shortArr, longArr, lookbackCount) {
    if (!shortArr || !longArr) return 'none';
    const n = Math.min(shortArr.length, longArr.length);
    if (n < 2) return 'none';
    const start = lookbackCount && lookbackCount > 0 ? Math.max(1, n - lookbackCount) : 1;
    let lastCross = 'none';
    for (let i = start; i < n; i++) {
      const prevShort = shortArr[i - 1];
      const prevLong = longArr[i - 1];
      const curShort = shortArr[i];
      const curLong = longArr[i];
      if (prevShort == null || prevLong == null || curShort == null || curLong == null) continue;
      if (prevShort <= prevLong && curShort > curLong) lastCross = 'bullish';
      else if (prevShort >= prevLong && curShort < curLong) lastCross = 'bearish';
    }
    return lastCross;
  }

  // apply filters and sorting
  const filtered = useMemo(() => {
    let arr = symbolsList.filter(([k, v]) => {
      if (v.rsi != null) {
        if (v.rsi < rsiMin || v.rsi > rsiMax) return false;
      }
      if (above200Filter !== 'any') {
        const want = above200Filter === 'true';
        if (v.above_200 == null) return false;
        if (v.above_200 !== want) return false;
      }

      // MACD filter: compute from ohlcv if available, otherwise fall back to v.macd_crossover
      if (macdFilter !== 'any') {
        let macdComputed = v.macd_crossover;
        try {
          const ohlcv = v.ohlcv || [];
          const closes = ohlcv.map(d => d.close);
          const macdObj = computeMACD(closes);
          const n = closes.length;
          if (n >= 2 && macdObj.macd[n - 2] != null && macdObj.signal[n - 2] != null && macdObj.macd[n - 1] != null && macdObj.signal[n - 1] != null) {
            const prev = macdObj.macd[n - 2] - macdObj.signal[n - 2];
            const curr = macdObj.macd[n - 1] - macdObj.signal[n - 1];
            if (prev <= 0 && curr > 0) macdComputed = 'bullish';
            else if (prev >= 0 && curr < 0) macdComputed = 'bearish';
            else macdComputed = 'neutral';
          }
        } catch (e) {
          // ignore
        }
        if (macdComputed !== macdFilter) return false;
      }

      // EMA crossover filter
      if (crossoverPair !== 'none') {
        const ohlcv = v.ohlcv || [];
        const closes = ohlcv.map(d => d.close);
        if (!closes || closes.length < 5) return false;
        let shortP = 21, longP = 44;
        if (crossoverPair === '21_44') { shortP = 21; longP = 44; }
        else if (crossoverPair === '44_200') { shortP = 44; longP = 200; }
        else if (crossoverPair === '21_200') { shortP = 21; longP = 200; }
        const shortEma = computeEMA(closes, shortP);
        const longEma = computeEMA(closes, longP);
        const cross = detectCrossover(shortEma, longEma, lookback);
        if (crossoverType !== 'any' && cross !== crossoverType) return false;
        if (crossoverType === 'any' && cross === 'none') return false;
      }

      return true;
    });

    if (sortKey) {
      const dir = sortDir === 'desc' ? -1 : 1;
      arr = arr.slice().sort(([aK, aV], [bK, bV]) => {
        let av;
        let bv;
        if (sortKey === 'symbol') {
          av = aK;
          bv = bK;
          if (av == null) return 1 * dir;
          if (bv == null) return -1 * dir;
          return av.localeCompare(bv) * dir;
        }
        av = aV[sortKey];
        bv = bV[sortKey];
        // sort nulls last
        if (av == null && bv == null) return 0;
        if (av == null) return 1 * dir;
        if (bv == null) return -1 * dir;
        if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
        return (av - bv) * dir;
      });
    }

    return arr;
  }, [symbolsList, rsiMin, rsiMax, above200Filter, macdFilter, crossoverPair, crossoverType, lookback, sortKey, sortDir]);

  const selected = useMemo(() => {
    if (!selectedSym || !data) return null;
    return data.symbols[selectedSym] || null;
  }, [selectedSym, data]);

  // compute latest MACD crossover status from per-symbol OHLCV (fallback to provided value)
  function computeLatestMacdCrossover(v) {
    try {
      const ohlcv = v.ohlcv || [];
      const closes = ohlcv.map(d => d.close);
      const macdObj = computeMACD(closes);
      const n = closes.length;
      if (n >= 2 && macdObj.macd[n - 2] != null && macdObj.signal[n - 2] != null && macdObj.macd[n - 1] != null && macdObj.signal[n - 1] != null) {
        const prev = macdObj.macd[n - 2] - macdObj.signal[n - 2];
        const curr = macdObj.macd[n - 1] - macdObj.signal[n - 1];
        if (prev <= 0 && curr > 0) return 'bullish';
        if (prev >= 0 && curr < 0) return 'bearish';
        return 'neutral';
      }
    } catch (e) {
      // ignore
    }
    return v.macd_crossover || 'neutral';
  }

  // prepare scatter data for grid
  const scatterArrays = useMemo(() => {
    const arr = symbolsList.map(([k, v]) => ({ symbol: k, ...v }));
    return {
      rsi: arr.map((d) => (d.rsi == null ? null : d.rsi)),
      macd_hist: arr.map((d) => (d.macd_hist == null ? null : d.macd_hist)),
      dist200: arr.map((d) => (d.dist_200 == null ? null : d.dist_200)),
      dist44: arr.map((d) => (d.dist_44 == null ? null : d.dist_44)),
      dist21: arr.map((d) => (d.dist_21 == null ? null : d.dist_21)),
      symbols: arr.map((d) => d.symbol),
    };
  }, [symbolsList]);

  if (loading) return <div>Loading analysis...</div>;
  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;
  if (!data) return <div>No data</div>;

  return (
    <div style={{ fontFamily: 'Inter, Arial, sans-serif', background: 'var(--bg)', minHeight: '100vh', padding: '32px 0', color: 'var(--text)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <h2 style={{ fontWeight: 700, fontSize: 28, marginBottom: 24, color: 'var(--text)' }}>Analysis</h2>
        <div style={{ background: 'var(--card-bg)', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: 24, marginBottom: 32 }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>RSI range</label>
              <div>
                <input type="number" value={rsiMin} onChange={(e) => setRsiMin(Number(e.target.value))} style={{ width: 80, padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 15 }} />
                {' – '}
                <input type="number" value={rsiMax} onChange={(e) => setRsiMax(Number(e.target.value))} style={{ width: 80, padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 15 }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>Lookback (sessions)</label>
              <div>
                <input type="number" value={lookback} onChange={(e) => setLookback(Number(e.target.value) || 0)} style={{ width: 120, padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 15 }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>EMA Crossover</label>
              <div>
                <select value={crossoverPair} onChange={(e) => setCrossoverPair(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 15, marginRight: 8 }}>
                  <option value="none">None</option>
                  <option value="21_44">21 EMA / 44 EMA</option>
                  <option value="44_200">44 EMA / 200 EMA</option>
                  <option value="21_200">21 EMA / 200 EMA</option>
                </select>
                <select value={crossoverType} onChange={(e) => setCrossoverType(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 15 }}>
                  <option value="any">Any</option>
                  <option value="bullish">Bullish (short crosses above long)</option>
                  <option value="bearish">Bearish (short crosses below long)</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>Above 200 EMA</label>
              <div>
                <select value={above200Filter} onChange={(e) => setAbove200Filter(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 15 }}>
                  <option value="any">Any</option>
                  <option value="true">Above</option>
                  <option value="false">Below</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>MACD</label>
              <div>
                <select value={macdFilter} onChange={(e) => setMacdFilter(e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 15 }}>
                  <option value="any">Any</option>
                  <option value="bullish">Bullish</option>
                  <option value="bearish">Bearish</option>
                  <option value="neutral">Neutral</option>
                </select>
              </div>
            </div>
          </div>
          {/* Table */}
          <div style={{ border: '1px solid var(--surface)', borderRadius: 10, overflow: 'auto', maxHeight: rowHeight * visibleRows, marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 15 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
                <tr>
                  <th onClick={() => { const k = 'symbol'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ textAlign: 'left', padding: 10, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', cursor: 'pointer' }}>Symbol{sortKey==='symbol' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'rsi'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>RSI{sortKey==='rsi' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'macd_crossover'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>MACD{sortKey==='macd_crossover' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'above_200'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>200 EMA{sortKey==='above_200' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'above_44'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>44 EMA{sortKey==='above_44' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'above_21'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>21 EMA{sortKey==='above_21' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'dist_200'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>Dist200%{sortKey==='dist_200' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'dist_44'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>Dist44%{sortKey==='dist_44' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th onClick={() => { const k = 'dist_21'; setSortKey(k); setSortDir(sortKey===k? (sortDir==='asc'?'desc':'asc') : 'asc'); }} style={{ padding: 10, fontWeight: 600, color: '#333', background: '#f5f5f5', cursor: 'pointer' }}>Dist21%{sortKey==='dist_21' ? (sortDir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(([k, v]) => (
                  <tr key={k} onClick={() => setSelectedSym(k)} style={{ cursor: 'pointer', borderTop: '1px solid var(--surface)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: 10, color: 'var(--text)' }}>{k}</td>
                    <td style={{ padding: 10 }}>{v.rsi == null ? 'N/A' : Number(v.rsi).toFixed(2)}</td>
                    <td style={{ padding: 10 }}>{computeLatestMacdCrossover(v)}</td>
                    <td style={{ padding: 10 }}>{formatBool(v.above_200)}</td>
                    <td style={{ padding: 10 }}>{formatBool(v.above_44)}</td>
                    <td style={{ padding: 10 }}>{formatBool(v.above_21)}</td>
                    <td style={{ padding: 10 }}>{v.dist_200 == null ? 'N/A' : Number(v.dist_200).toFixed(2)}</td>
                    <td style={{ padding: 10 }}>{v.dist_44 == null ? 'N/A' : Number(v.dist_44).toFixed(2)}</td>
                    <td style={{ padding: 10 }}>{v.dist_21 == null ? 'N/A' : Number(v.dist_21).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Candlestick chart full width below table with data labels/indicators as subplots */}
  <div style={{ marginTop: 24, width: '100%', background: 'var(--card-bg)', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: 24 }}>
          <h3 style={{ marginBottom: 12, fontWeight: 600, color: 'var(--text)', fontSize: 20 }}>Candlestick & Indicators</h3>
          {!selected && <div style={{ color: '#666' }}>Select a symbol from the table to view candlestick and indicators</div>}
          {selected && (
            <div style={{ width: '100%' }}>
              <Plot
                style={{ width: '100%' }}
                useResizeHandler={true}
                data={(() => {
                  const ohlcv = selected.ohlcv || [];
                  const dates = ohlcv.map((d) => d.date);
                  const opens = ohlcv.map((d) => d.open);
                  const highs = ohlcv.map((d) => d.high);
                  const lows = ohlcv.map((d) => d.low);
                  const closes = ohlcv.map((d) => d.close);

                  // EMAs (if present). If backend didn't provide them, compute from closes
                  let ema21 = ohlcv.map((d) => (d.ema_21 != null ? d.ema_21 : null));
                  let ema44 = ohlcv.map((d) => (d.ema_44 != null ? d.ema_44 : null));
                  let ema200 = ohlcv.map((d) => (d.ema_200 != null ? d.ema_200 : null));

                  const hasValidClose = closes.some((v) => v != null && !Number.isNaN(v));
                  // If EMAs missing but we have closes, compute EMAs on the frontend
                  if (hasValidClose) {
                    if (!ema21.some((v) => v != null)) ema21 = computeEMA(closes, 21);
                    if (!ema44.some((v) => v != null)) ema44 = computeEMA(closes, 44);
                    if (!ema200.some((v) => v != null)) ema200 = computeEMA(closes, 200);
                  }

                  const traces = [
                    {
                      x: dates,
                      open: opens,
                      high: highs,
                      low: lows,
                      close: closes,
                      increasing: { line: { color: '#26a69a' } },
                      decreasing: { line: { color: '#ef5350' } },
                      type: 'candlestick',
                      xaxis: 'x',
                      yaxis: 'y',
                      name: 'Price',
                      showlegend: true,
                      legendgroup: 'price',
                      hoverinfo: 'x+open+high+low+close'
                    }
                  ];

                  // Add EMA traces if present
                  if (ema21.some((v) => v != null)) traces.push({ x: dates, y: ema21, type: 'scatter', mode: 'lines', line: { color: '#ffd700', width: 1 }, name: '21 EMA', yaxis: 'y', legendgroup: 'price', hoverinfo: 'x+y' });
                  if (ema44.some((v) => v != null)) traces.push({ x: dates, y: ema44, type: 'scatter', mode: 'lines', line: { color: '#ff8c00', width: 1 }, name: '44 EMA', yaxis: 'y', legendgroup: 'price', hoverinfo: 'x+y' });
                  if (ema200.some((v) => v != null)) traces.push({ x: dates, y: ema200, type: 'scatter', mode: 'lines', line: { color: '#ff4500', width: 1 }, name: '200 EMA', yaxis: 'y', legendgroup: 'price', hoverinfo: 'x+y' });

                  // (No DEMA traces — only plot EMAs)

                  return traces;
                })()}
                layout={{
                  autosize: true,
                  height: 640,
                  margin: { t: 20, b: 40, l: 40, r: 40 },
                  showlegend: true,
                  legend: {
                    orientation: 'h',
                    x: 0.5,
                    xanchor: 'center',
                    y: 1.02,
                    yanchor: 'bottom',
                    bgcolor: 'rgba(255,255,255,0.8)',
                    bordercolor: '#ddd',
                    borderwidth: 1,
                    font: { size: 11 }
                  },
                  xaxis: {
                    domain: [0, 1],
                    rangeslider: { visible: false },
                    showgrid: true,
                    gridcolor: 'var(--surface)'
                  },
                  yaxis: {
                    domain: [0, 1],
                    title: 'Price',
                    showgrid: true,
                    gridcolor: 'var(--surface)',
                    zeroline: false
                  },
                  plot_bgcolor: 'var(--card-bg)',
                  paper_bgcolor: 'var(--card-bg)'
                }}
                config={{ responsive: true, displayModeBar: true }}
              />
              {/* Show selected metrics summary */}
              <div style={{ marginTop: 12, display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 16, color: 'var(--muted)' }}>
                <div>Symbol: <strong style={{ color: 'var(--text)' }}>{selectedSym}</strong></div>
                <div>Latest Price: <strong style={{ color: 'var(--text)' }}>{numberOrNA(selected.latest_close, 2)}</strong></div>
                <div>RSI: <strong style={{ color: 'var(--text)' }}>{numberOrNA(selected.rsi, 2)}</strong></div>
                <div>Above 200 EMA: <strong style={{ color: 'var(--text)' }}>{formatBool(selected.above_200)}</strong></div>
                <div>Dist200%: <strong style={{ color: 'var(--text)' }}>{numberOrNA(selected.dist_200, 2)}%</strong></div>
              </div>
            </div>
          )}
        </div>
        {/* MACD and RSI charts stacked below candlestick */}
        {selected && (() => {
          const ohlcv = selected.ohlcv || [];
          const dates = ohlcv.map((d) => d.date);
          const closes = ohlcv.map((d) => d.close);
          const macdObj = computeMACD(closes);
          const rsiSeries = computeRSI(closes, 14);
          return (
            <>
              <div style={{ marginTop: 16, width: '100%', background: 'var(--card-bg)', borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.04)', padding: 12 }}>
                <Plot
                  style={{ width: '100%' }}
                  useResizeHandler={true}
                  data={[
                    { x: dates, y: macdObj.hist, type: 'bar', marker: { color: macdObj.hist.map(v => v != null && v >= 0 ? '#2ecc71' : '#e74c3c') }, name: 'MACD Hist' },
                    { x: dates, y: macdObj.macd, type: 'scatter', mode: 'lines', line: { color: '#34495e', width: 1 }, name: 'MACD' },
                    { x: dates, y: macdObj.signal, type: 'scatter', mode: 'lines', line: { color: '#e67e22', width: 1 }, name: 'Signal' }
                  ]}
                  layout={{ autosize: true, height: 220, margin: { t: 8, b: 30, l: 40, r: 24 }, showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.02 }, xaxis: { showgrid: false, gridcolor: '#f5f5f5' }, yaxis: { title: 'MACD', showgrid: true, gridcolor: '#f5f5f5' }, plot_bgcolor: 'white', paper_bgcolor: 'white' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              </div>

              <div style={{ marginTop: 12, width: '100%', background: 'var(--card-bg)', borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.04)', padding: 12 }}>
                <Plot
                  style={{ width: '100%' }}
                  useResizeHandler={true}
                  data={[{ x: dates, y: rsiSeries, type: 'scatter', mode: 'lines', line: { color: '#3f51b5', width: 1 }, name: 'RSI' }]}
                  layout={{ autosize: true, height: 180, margin: { t: 8, b: 30, l: 40, r: 24 }, showlegend: false, xaxis: { showgrid: false }, yaxis: { title: 'RSI', range: [0, 100], showgrid: true, gridcolor: '#f5f5f5' }, shapes: [ { type: 'line', x0: dates[0] || 0, x1: dates[dates.length-1] || 0, y0: 70, y1: 70, line: { color: '#d9534f', width: 1, dash: 'dash' } }, { type: 'line', x0: dates[0] || 0, x1: dates[dates.length-1] || 0, y0: 30, y1: 30, line: { color: '#5cb85c', width: 1, dash: 'dash' } } ], plot_bgcolor: 'white', paper_bgcolor: 'white' }}
                  config={{ responsive: true, displayModeBar: false }}
                />
              </div>
            </>
          );
        })()}
        {/* Scatter plots stacked full width below the above charts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginTop: 32 }}>
          <div style={{ background: 'var(--card-bg)', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: 24 }}>
            <Plot
              style={{ width: '100%' }}
              useResizeHandler={true}
              data={[{
                x: scatterArrays.rsi,
                y: scatterArrays.dist200,
                mode: 'markers',
                type: 'scatter',
                text: scatterArrays.symbols,
                marker: { color: '#3f51b5', size: 8 },
                hovertemplate: '%{text}<br>RSI: %{x:.1f}<br>Dist200: %{y:.1f}%<extra></extra>'
              }]} 
              layout={{
                title: { text: 'RSI vs Distance from 200 EMA', font: { size: 16 } },
                autosize: true,
                height: 320,
                margin: { t: 30, r: 24, b: 40, l: 44 },
                showlegend: false,
                xaxis: { title: 'RSI', showgrid: true, gridcolor: '#f5f5f5', range: [0, 100] },
                yaxis: { title: 'Distance from 200 EMA (%)', showgrid: true, gridcolor: '#f5f5f5' },
                plot_bgcolor: 'var(--card-bg)',
                paper_bgcolor: 'var(--card-bg)'
              }}
              config={{ responsive: true, displayModeBar: false }}
            />
          </div>
          <div style={{ background: 'var(--card-bg)', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: 24 }}>
            <Plot
              style={{ width: '100%' }}
              useResizeHandler={true}
              data={[{
                x: scatterArrays.dist200,
                y: scatterArrays.dist44,
                mode: 'markers',
                type: 'scatter',
                text: scatterArrays.symbols,
                marker: { color: '#ff8c00', size: 8 },
                hovertemplate: '%{text}<br>Dist200: %{x:.2f}%<br>Dist44: %{y:.2f}%<extra></extra>'
              }]} 
              layout={{
                title: { text: 'Distance from 200 EMA vs Distance from 44 EMA', font: { size: 16 } },
                autosize: true,
                height: 320,
                margin: { t: 30, r: 24, b: 40, l: 44 },
                showlegend: false,
                xaxis: { title: 'Distance from 200 EMA (%)', showgrid: true, gridcolor: '#f5f5f5' },
                yaxis: { title: 'Distance from 44 EMA (%)', showgrid: true, gridcolor: '#f5f5f5' },
                plot_bgcolor: 'var(--card-bg)',
                paper_bgcolor: 'var(--card-bg)'
              }}
              config={{ responsive: true, displayModeBar: false }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}