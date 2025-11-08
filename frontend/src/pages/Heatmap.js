import React, { useEffect, useState } from 'react';

function colorForChange(pct) {
	if (pct == null) return '#ddd';
	// green for positive, red for negative, scale by magnitude
	const capped = Math.max(-10, Math.min(10, pct));
	if (capped >= 0) {
		// interpolate between white and green
		const g = Math.round(200 - (200 * (10 - capped)) / 10);
		return `rgb(${255 - g}, ${255}, ${255 - g})`;
	} else {
		const r = Math.round(200 - (200 * (10 - Math.abs(capped))) / 10);
		return `rgb(${255}, ${255 - r}, ${255 - r})`;
	}
}

const DURATIONS = [
	{ key: '1d', label: '1 Day' },
	{ key: '1w', label: '1 Week' },
	{ key: '1m', label: '1 Month' },
	{ key: '3m', label: '3 Months' },
	{ key: '6m', label: '6 Months' },
	{ key: '1y', label: '1 Year' },
];

export default function Heatmap() {
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);
	const [ingestStatus, setIngestStatus] = useState(null);
	const [ingestRunning, setIngestRunning] = useState(false);
	const [ingestJobId, setIngestJobId] = useState(null);
	const [duration, setDuration] = useState('1d');
	const pollRef = React.useRef(null);

	const fetchHeatmap = (selectedDuration) => {
		setLoading(true);
		// resolve API base dynamically so dev (localhost:3000 -> backend:5000) and
		// production (nginx serving static + proxy) both work without rebuilds.
		const API_BASE = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '3000')) ? 'http://127.0.0.1:5000' : '';
		fetch(`${API_BASE}/sector-heatmap?duration=${selectedDuration}`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((json) => {
				console.log('Received heatmap data:', json);  // debug log
				setData(json);
			})
			.catch((err) => {
				console.error('Error fetching heatmap:', err);  // debug log
				setError(err.message);
			})
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		fetchHeatmap(duration);
	}, [duration]);

		// cleanup polling on unmount
		useEffect(() => {
			return () => {
				if (pollRef.current) {
					clearInterval(pollRef.current);
					pollRef.current = null;
				}
			};
		}, []);

		const runIngest = () => {
			setIngestRunning(true);
			setIngestStatus(null);
			const API_BASE = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '3000')) ? 'http://127.0.0.1:5000' : '';
			fetch(`${API_BASE}/run-ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
				.then((r) => {
					if (!r.ok) throw new Error(`HTTP ${r.status}`);
					return r.json();
				})
				.then((json) => {
				setIngestStatus(json);
				if (json.job_id) {
					setIngestJobId(json.job_id);
					// start polling
					if (pollRef.current) clearInterval(pollRef.current);
					pollRef.current = setInterval(() => {
						fetch(`${API_BASE}/ingest-progress/${json.job_id}`)
							.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
							.then((p) => {
								setIngestStatus((prev) => ({ ...prev, progress: p }));
								if (p.status === 'finished') {
									clearInterval(pollRef.current);
									pollRef.current = null;
									// refresh heatmap after ingest completes
									fetchHeatmap(duration);
								}
							})
							.catch(() => {});
					}, 1000);
				}
				})
				.catch((err) => setIngestStatus({ error: err.message }))
				.finally(() => setIngestRunning(false));
		};

	if (loading) return <div>Loading sector heatmap...</div>;
	if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;
	if (!data) return <div>No data available. Try running an ingest first.</div>;
	
	console.log('Rendering with data:', { sectors: Object.keys(data.sectors || {}), duration: data.duration });  // debug

	const sectors = Object.entries(data.sectors || {});

		return (
			<div style={{ fontFamily: 'Inter, Arial, sans-serif', background: 'var(--bg)', minHeight: '100vh', padding: '32px 0', color: 'var(--text)' }}>
				<div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
					<h2 style={{ fontWeight: 700, fontSize: 28, marginBottom: 24, color: 'var(--text)' }}>Sector Heatmap</h2>
					<div style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
						<div style={{ display: 'flex', gap: 6 }}>
							{DURATIONS.map(d => (
								<button
									key={d.key}
									onClick={() => setDuration(d.key)}
									style={{
										padding: '6px 16px',
										background: duration === d.key ? 'linear-gradient(90deg,#4caf50,#43a047)' : '#fff',
										color: duration === d.key ? '#fff' : '#333',
										border: duration === d.key ? 'none' : '1px solid #ccc',
										borderRadius: 6,
										fontWeight: 500,
										fontSize: 15,
										boxShadow: duration === d.key ? '0 2px 8px rgba(76,175,80,0.08)' : 'none',
										cursor: 'pointer',
										transition: 'all 0.2s',
									}}
								>
									{d.label}
								</button>
							))}
						</div>
						<div style={{ width: 1, height: 28, background: '#e0e0e0', margin: '0 12px' }} />
						<button onClick={runIngest} disabled={ingestRunning} style={{
							padding: '6px 16px',
							background: ingestRunning ? '#eee' : 'linear-gradient(90deg,#2196f3,#1976d2)',
							color: ingestRunning ? '#888' : '#fff',
							border: 'none',
							borderRadius: 6,
							fontWeight: 500,
							fontSize: 15,
							boxShadow: ingestRunning ? 'none' : '0 2px 8px rgba(33,150,243,0.08)',
							cursor: ingestRunning ? 'not-allowed' : 'pointer',
							transition: 'all 0.2s',
						}}>
							{ingestRunning ? 'Starting ingest...' : 'Run Ingest'}
						</button>
						{ingestStatus && (
							<div style={{ marginLeft: 16 }}>
								{ingestStatus.error ? (
									<span style={{ color: '#e53935', fontWeight: 500 }}>Error: {ingestStatus.error}</span>
								) : (
									<div style={{ fontSize: 13, color: '#333' }}>
										Ingest started — job: <b>{ingestStatus.job_id}</b> (pid: {ingestStatus.pid}) — log: {ingestStatus.log_path}
										{ingestStatus.progress && (
											<div style={{ marginTop: 8 }}>
												<div style={{ fontSize: 12 }}>
													{ingestStatus.progress.status} — {ingestStatus.progress.done}/{ingestStatus.progress.total}
												</div>
												<div style={{
													height: 12,
													background: '#e0e0e0',
													borderRadius: 6,
													overflow: 'hidden',
													marginTop: 6,
												}}>
													<div style={{
														height: '100%',
														width: `${ingestStatus.progress.total ? (ingestStatus.progress.done / ingestStatus.progress.total) * 100 : 0}%`,
														background: 'linear-gradient(90deg,#4caf50,#43a047)',
														transition: 'width 300ms linear'
													}} />
												</div>
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
							gap: 20,
						}}
					>
						{sectors.map(([name, info]) => {
							const avg = info.avg_change_pct;
							return (
								<div
									key={name}
									style={{
										padding: 20,
										borderRadius: 14,
										background: colorForChange(avg),
										boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
										transition: 'box-shadow 0.2s',
										fontSize: 15,
										fontWeight: 500,
										color: '#222',
										position: 'relative',
										minHeight: 120,
										border: '1px solid #e0e0e0',
									}}
									onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 24px rgba(76,175,80,0.15)'}
									onMouseLeave={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.07)'}
								>
									<strong style={{ fontSize: 17 }}>{name}</strong>
									<div style={{ fontSize: 13, color: '#333', marginTop: 4 }}>
										Avg change: {avg == null ? 'N/A' : `${Number(avg).toFixed(2)}%`}
									</div>
									<ul style={{ marginTop: 12, paddingLeft: 0, maxHeight: 160, overflow: 'auto', listStyle: 'none' }}>
										{(info.symbols || []).map((s) => (
											<li key={s.symbol} title={s.name} style={{ padding: '4px 0', fontSize: 13, color: '#444', borderBottom: '1px solid #eee' }}>
												<span style={{ fontWeight: 600 }}>{s.symbol}</span>: {s.change_pct == null ? 'N/A' : `${Number(s.change_pct).toFixed(2)}%`} <span style={{ color: '#888' }}>({s.close == null ? 'N/A' : Number(s.close).toFixed(2)})</span>
											</li>
										))}
									</ul>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		);
}
