/**
 * Options Flow Panel (main dashboard mini-view)
 * Reads from /data/options-flow.json — no localhost/ThetaData calls.
 */

const OptionsFlow = (() => {
  const STALE_MIN = 10;
  const MAX_ROWS  = 80;

  let currentSymbol = 'SPY';
  let feedEl        = null;
  let allTrades     = [];

  function timeSince(isoStr) {
    if (!isoStr) return null;
    const m = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m/60)}h ${m%60}m ago`;
  }

  function isStale(isoStr) {
    return isoStr && (Date.now() - new Date(isoStr).getTime()) > STALE_MIN * 60000;
  }

  function fmtPrem(p) {
    if (!p) return '—';
    if (p >= 1e6)  return `$${(p/1e6).toFixed(1)}M`;
    if (p >= 1000) return `$${(p/1000).toFixed(0)}K`;
    return `$${(+p).toFixed(0)}`;
  }

  function fmtExp(exp) {
    const s = String(exp);
    return s.length === 8 ? `${s.slice(4,6)}/${s.slice(6,8)}` : s;
  }

  function renderRow(row) {
    const right   = (row.right || '?').toUpperCase();
    const isCall  = right === 'C' || right === 'CALL';
    const side    = (row.side || row.condition || '').toUpperCase();
    const sideLabel = side === 'A' || side === 'BUY' ? 'BUY' : side === 'B' || side === 'SELL' ? 'SELL' : side || '—';
    const sideClass = sideLabel === 'BUY' ? 'opt-bid' : sideLabel === 'SELL' ? 'opt-ask' : '';
    const unusual = (row.premium || 0) >= 50000 || row.sweep;

    const el = document.createElement('div');
    el.className = `opt-row${unusual ? ' opt-unusual' : ''}`;
    el.innerHTML = `
      <span class="opt-flag">${unusual ? '🔥' : ''}</span>
      <span class="opt-sym">${row.symbol || currentSymbol}</span>
      <span class="opt-contract">${row.strike != null ? (+row.strike).toFixed(0) : '—'}${right} ${row.expiration ? fmtExp(row.expiration) : '—'}</span>
      <span class="opt-price">${row.ask != null ? `$${(+row.ask).toFixed(2)}` : '—'}</span>
      <span class="opt-size">${row.size != null ? `${row.size}x` : '—'}</span>
      <span class="opt-prem">${fmtPrem(row.premium)}</span>
      <span class="opt-side ${sideClass}">${sideLabel}</span>
      <span class="opt-cond">${row.exchange || ''}</span>
    `;
    return el;
  }

  function setStatus(msg, color) {
    const el = document.getElementById('options-status');
    if (el) { el.textContent = msg; if (color) el.style.color = color; }
  }

  function renderFeed(data) {
    if (!feedEl) return;
    feedEl.innerHTML = '';

    const since = timeSince(data.fetched_at);
    const stale = isStale(data.fetched_at);

    if (!data.fetched_at) {
      feedEl.innerHTML = '<div class="opt-loading">Awaiting first data fetch</div>';
      setStatus('—');
      return;
    }

    if (!data.market_open) setStatus('Market Closed', '#f59e0b');
    else if (stale)        setStatus(`⚠ Stale — ${since}`, '#f59e0b');
    else                   setStatus(since || '—');

    const trades = (data.trades || [])
      .filter(t => !currentSymbol || (t.symbol || '').toUpperCase() === currentSymbol)
      .slice(0, MAX_ROWS);

    if (!trades.length) {
      feedEl.innerHTML = `<div class="opt-empty">No ${currentSymbol} flow in latest fetch</div>`;
      return;
    }
    trades.forEach(t => feedEl.appendChild(renderRow(t)));
  }

  async function loadData() {
    try {
      const res  = await fetch(`/data/options-flow.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allTrades = data.trades || [];
      renderFeed(data);
    } catch {
      if (feedEl) feedEl.innerHTML = '<div class="opt-empty">Awaiting first data fetch</div>';
    }
  }

  function loadSymbol(symbol) {
    currentSymbol = symbol.includes(':') ? symbol.split(':')[1] : symbol;
    const symEl = document.getElementById('options-symbol');
    if (symEl) symEl.textContent = currentSymbol;
    // Re-render from cached data
    const fakeData = { fetched_at: null, market_open: false, trades: allTrades };
    if (allTrades.length) renderFeed({ ...fakeData, fetched_at: new Date().toISOString(), market_open: true });
  }

  function init(containerId) {
    feedEl = document.getElementById(containerId);
    loadData();
    setInterval(loadData, 5 * 60 * 1000);
  }

  return { init, loadSymbol };
})();
