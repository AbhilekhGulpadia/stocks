import React, { useState } from 'react';
import Heatmap from './pages/Heatmap';
import Analysis from './pages/Analysis';
import PaperTrades from './pages/PaperTrades';

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#4f46e5,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>SS</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Stock Screener</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Analysis & Paper Trading</div>
      </div>
    </div>
  );
}

function Header({ tab, setTab, theme, toggleTheme }) {
  const tabs = [
    { id: 'heatmap', label: 'Heatmap' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'paper', label: 'Paper Trades' },
  ];

  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #eceff3', background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <Logo />
        <nav aria-label="Main navigation">
          <ul style={{ display: 'flex', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
            {tabs.map(t => (
              <li key={t.id}>
                <button onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 9999,
                    border: 'none',
                    cursor: 'pointer',
                    background: tab === t.id ? 'linear-gradient(90deg,#4f46e5,#06b6d4)' : 'transparent',
                    color: tab === t.id ? 'white' : '#334155',
                    fontWeight: 600,
                    boxShadow: tab === t.id ? '0 4px 12px rgba(79,70,229,0.12)' : 'none'
                  }}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative' }}>
          <input placeholder="Search symbol..." style={{ width: 220, padding: '8px 12px', borderRadius: 8, border: '1px solid #e6eef6' }} />
        </div>
  <button onClick={toggleTheme} aria-label="Toggle theme" style={{ padding: 8, borderRadius: 8, border: '1px solid #e6eef6', background: 'white', cursor: 'pointer' }}>{theme === 'dark' ? '🌙' : '☀️'}</button>
        <div style={{ width: 36, height: 36, borderRadius: 18, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#4f46e5' }}>A</div>
      </div>
    </header>
  );
}

export default function App() {
  const [tab, setTab] = useState('heatmap');
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('app_theme') || 'light'; } catch (e) { return 'light'; }
  });

  // Apply CSS variables for theming on the document root
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.style.setProperty('--bg', '#0b1220');
      root.style.setProperty('--card-bg', '#071126');
      root.style.setProperty('--text', '#e6eef6');
      root.style.setProperty('--muted', '#9aa8bf');
      root.style.setProperty('--accent', '#06b6d4');
      root.style.setProperty('--surface', '#0f1724');
    } else {
      root.style.setProperty('--bg', '#f6f8fb');
      root.style.setProperty('--card-bg', '#ffffff');
      root.style.setProperty('--text', '#0f172a');
      root.style.setProperty('--muted', '#6b7280');
      root.style.setProperty('--accent', '#4f46e5');
      root.style.setProperty('--surface', '#ffffff');
    }
    try { localStorage.setItem('app_theme', theme); } catch (e) {}
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial", background: 'var(--bg)', minHeight: '100vh', color: 'var(--text)' }}>
      <Header tab={tab} setTab={setTab} theme={theme} toggleTheme={toggleTheme} />
      <main style={{ maxWidth: 1200, margin: '28px auto', padding: '0 20px' }}>
        {tab === 'heatmap' && <Heatmap />}
        {tab === 'analysis' && <Analysis />}
        {tab === 'paper' && <PaperTrades />}
      </main>
    </div>
  );
}
