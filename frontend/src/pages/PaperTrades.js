import React, { useState, useEffect } from 'react';

// Format number as currency
const formatCurrency = (value) => {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(value);
};

// Format number with 2 decimal places
const formatNumber = (value) => {
  if (value == null) return 'N/A';
  return Number(value).toFixed(2);
};

export default function PaperTrades() {
  // State for trade execution
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState(null);
  const [availableSymbols, setAvailableSymbols] = useState([]);

  // State for order book (persisted in localStorage)
  const [trades, setTrades] = useState(() => {
    try {
      const raw = localStorage.getItem('papertrades_trades');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  // State for P&L tracking (persisted)
  const [positions, setPositions] = useState(() => {
    try {
      const raw = localStorage.getItem('papertrades_positions');
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }); // { symbol: { quantity, avgPrice } }
  const [realizedPL, setRealizedPL] = useState(() => {
    try {
      const raw = localStorage.getItem('papertrades_realized');
      return raw ? Number(JSON.parse(raw)) : 0;
    } catch (e) {
      return 0;
    }
  });
  const [unrealizedPL, setUnrealizedPL] = useState(0);
  const [pricesMap, setPricesMap] = useState({}); // latest prices per symbol

  // Fetch available symbols on mount
  useEffect(() => {
    fetch('http://127.0.0.1:5000/analysis')
      .then(r => r.json())
      .then(data => {
        if (data.symbols) {
          setAvailableSymbols(Object.keys(data.symbols).sort());
        }
      })
      .catch(console.error);
  }, []);

  // Update current price when symbol changes
  useEffect(() => {
    if (!selectedSymbol) return;
    fetch(`http://127.0.0.1:5000/analysis?symbol=${selectedSymbol}`)
      .then(r => r.json())
      .then(data => {
        const price = data.symbols?.[selectedSymbol]?.latest_close;
        setCurrentPrice(price);
        setBuyPrice(price?.toString() || '');
        setSellPrice(price?.toString() || '');
      })
      .catch(console.error);
  }, [selectedSymbol]);

  // Calculate unrealized P&L whenever positions or current prices change
  useEffect(() => {
    // fetch latest prices for all symbols in positions and compute unrealized P/L
    const symbols = Object.keys(positions);
    if (symbols.length === 0) {
      setUnrealizedPL(0);
      return;
    }

    let isCancelled = false;

    async function fetchPricesAndCompute() {
      const priceMap = { ...pricesMap };
      for (const sym of symbols) {
        try {
          const resp = await fetch(`http://127.0.0.1:5000/analysis?symbol=${sym}`);
          const data = await resp.json();
          const price = data.symbols?.[sym]?.latest_close ?? null;
          priceMap[sym] = price;
        } catch (e) {
          // keep previous price if fetch fails
          console.error('price fetch error', sym, e);
        }
      }
      if (isCancelled) return;
      setPricesMap(priceMap);

      let total = 0;
      for (const [symbol, pos] of Object.entries(positions)) {
        if (pos.quantity === 0) continue;
        const price = priceMap[symbol];
        if (price != null) total += pos.quantity * (price - pos.avgPrice);
      }
      setUnrealizedPL(total);
    }

    fetchPricesAndCompute();

    return () => { isCancelled = true; };
  }, [positions]);

  const executeTrade = (type) => {
    if (!selectedSymbol || !quantity) return;
    const price = type === 'buy' ? Number(buyPrice) : Number(sellPrice);
    if (!price) return;

    const trade = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      symbol: selectedSymbol,
      type,
      quantity: Number(quantity),
      price,
    };

    // Update positions
    setPositions(prev => {
      const pos = prev[selectedSymbol] || { quantity: 0, avgPrice: 0 };
      const newPos = { ...prev };

      if (type === 'buy') {
        // Update average price for buys
        const totalCost = pos.quantity * pos.avgPrice + trade.quantity * trade.price;
        const totalQty = pos.quantity + trade.quantity;
        newPos[selectedSymbol] = {
          quantity: totalQty,
          avgPrice: totalCost / totalQty
        };
      } else {
        // Calculate realized P/L for sells
        const realizedPL = trade.quantity * (trade.price - pos.avgPrice);
        setRealizedPL(p => p + realizedPL);
        
        newPos[selectedSymbol] = {
          quantity: pos.quantity - trade.quantity,
          avgPrice: pos.avgPrice // keep same avg price for remaining
        };
      }

      return newPos;
    });

    // Add to trades history
    setTrades(prev => {
      const next = [...prev, trade];
      try { localStorage.setItem('papertrades_trades', JSON.stringify(next)); } catch (e) {}
      return next;
    });

    // persist positions and realizedPL will be handled by effects below

    // Reset form
    setQuantity('');
  };

  // Persist positions and realizedPL when they change
  useEffect(() => {
    try { localStorage.setItem('papertrades_positions', JSON.stringify(positions)); } catch (e) {}
  }, [positions]);

  useEffect(() => {
    try { localStorage.setItem('papertrades_realized', JSON.stringify(realizedPL)); } catch (e) {}
  }, [realizedPL]);

  return (
    <div style={{ fontFamily: 'Inter, Arial, sans-serif', background: 'var(--bg)', minHeight: '100vh', padding: '32px 0', color: 'var(--text)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <h2 style={{ fontWeight: 700, fontSize: 28, marginBottom: 24, color: 'var(--text)' }}>Paper Trading</h2>

        {/* Trade Execution Form */}
        <div style={{ background: 'var(--card-bg)', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#555', marginBottom: 6, display: 'block' }}>Symbol</label>
              <select 
                value={selectedSymbol} 
                onChange={(e) => setSelectedSymbol(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15 }}
              >
                <option value="">Select Symbol</option>
                {availableSymbols.map(sym => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#555', marginBottom: 6, display: 'block' }}>Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15 }}
                placeholder="Enter quantity"
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#555', marginBottom: 6, display: 'block' }}>Buy Price</label>
              <input
                type="number"
                step="0.01"
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15 }}
                placeholder="Enter buy price"
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#555', marginBottom: 6, display: 'block' }}>Sell Price</label>
              <input
                type="number"
                step="0.01"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15 }}
                placeholder="Enter sell price"
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => executeTrade('buy')}
                style={{ flex: 1, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4caf50', color: 'white', fontSize: 15, cursor: 'pointer' }}
              >
                Buy
              </button>
              <button
                onClick={() => executeTrade('sell')}
                style={{ flex: 1, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#f44336', color: 'white', fontSize: 15, cursor: 'pointer' }}
              >
                Sell
              </button>
            </div>
          </div>
          {currentPrice && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#f8f9fa', borderRadius: 8, fontSize: 14 }}>
              Current Price: {formatCurrency(currentPrice)}
            </div>
          )}
        </div>

        {/* Order Book */}
        <div style={{ background: 'var(--card-bg)', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>Order Book</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#444' }}>Time</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#444' }}>Symbol</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#444' }}>Type</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#444' }}>Quantity</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#444' }}>Price</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#444' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice().reverse().map(trade => (
                  <tr key={trade.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '12px 16px' }}>{new Date(trade.timestamp).toLocaleString()}</td>
                    <td style={{ padding: '12px 16px' }}>{trade.symbol}</td>
                    <td style={{ padding: '12px 16px', color: trade.type === 'buy' ? '#4caf50' : '#f44336' }}>
                      {trade.type.toUpperCase()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>{trade.quantity}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>{formatCurrency(trade.price)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>{formatCurrency(trade.quantity * trade.price)}</td>
                  </tr>
                ))}
                {trades.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
                      No trades executed yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* P&L Console */}
        <div style={{ background: 'var(--card-bg)', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>P&L Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
            <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 10 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Realized P&L</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: realizedPL >= 0 ? '#4caf50' : '#f44336' }}>
                {formatCurrency(realizedPL)}
              </div>
            </div>
            <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 10 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Unrealized P&L</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: unrealizedPL >= 0 ? '#4caf50' : '#f44336' }}>
                {formatCurrency(unrealizedPL)}
              </div>
            </div>
            <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 10 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Total P&L</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: (realizedPL + unrealizedPL) >= 0 ? '#4caf50' : '#f44336' }}>
                {formatCurrency(realizedPL + unrealizedPL)}
              </div>
            </div>
          </div>

          {/* Current Positions */}
          <div style={{ marginTop: 24 }}>
            <h4 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#333' }}>Open Positions</h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#444' }}>Symbol</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#444' }}>Quantity</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#444' }}>Avg Price</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#444' }}>Current Price</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#444' }}>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(positions)
                    .filter(([_, pos]) => pos.quantity > 0)
                    .map(([symbol, pos]) => (
                      <tr key={symbol} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '12px 16px' }}>{symbol}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>{pos.quantity}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>{formatCurrency(pos.avgPrice)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>{formatCurrency(currentPrice)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: currentPrice && (currentPrice - pos.avgPrice) * pos.quantity >= 0 ? '#4caf50' : '#f44336' }}>
                          {formatCurrency(currentPrice ? (currentPrice - pos.avgPrice) * pos.quantity : null)}
                        </td>
                      </tr>
                    ))}
                  {Object.values(positions).every(pos => pos.quantity === 0) && (
                    <tr>
                      <td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
                        No open positions
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
