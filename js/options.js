/**
 * Options Flow Component — sofar-finance
 * Data sources (browser-direct, ThetaData runs locally):
 *   REST snapshot: http://localhost:25503/v3/option/snapshot/quote
 *   Live stream:   ws://localhost:25520
 *
 * Displays a scrolling feed of options trades with 🔥 for unusual activity.
 */

const OptionsFlow = (() => {
  const THETA_REST = 'http://localhost:25503/v3';
  const THETA_WS   = 'ws://localhost:25520';
  const MAX_ROWS   = 150;

  let ws            = null;
  let currentSymbol = 'SPY';
  let feedEl        = null;
  let reconnectTimer = null;
  let wsConnected   = false;

  // ── Formatting helpers ─────────────────────────────────────────────────

  function fmtExpiry(exp) {
    const s = String(exp);
    if (s.length === 8) return `${s.slice(4,6)}/${s.slice(6,8)}/${s.slice(2,4)}`;
    return s;
  }

  function fmtPremium(p) {
    if (p == null) return '—';
    if (p >= 1000000) return `$${(p/1000000).toFixed(1)}M`;
    if (p >= 1000)    return `$${(p/1000).toFixed(0)}K`;
    return `$${p.toFixed(0)}`;
  }

  function isUnusual(row) {
    return (row.size >= 100) || (row.premium >= 50000) || row.sweep;
  }

  // ── Row rendering ──────────────────────────────────────────────────────

  function renderRow(row) {
    const unusual = isUnusual(row);
    const side    = row.side || (row.ask_condition === 'A' ? 'ASK' : row.bid_condition === 'B' ? 'BID' : '—');
    const sideClass = side === 'ASK' || side === 'SELL' ? 'opt-ask' : side === 'BID' || side === 'BUY' ? 'opt-bid' : '';
    const right   = row.right || '?';
    const strike  = row.strike != null ? row.strike.toFixed(0) : '—';
    const exp     = row.expiration ? fmtExpiry(row.expiration) : '—';
    const price   = row.price != null ? `$${row.price.toFixed(2)}` : '—';
    const size    = row.size != null ? `${row.size}x` : '—';
    const premium = row.premium != null ? fmtPremium(row.premium) : '—';
    const cond    = row.condition || row.exchange || '';

    const el = document.createElement('div');
    el.className = `opt-row${unusual ? ' opt-unusual' : ''}`;
    el.innerHTML = `
      <span class="opt-flag">${unusual ? '🔥' : ''}</span>
      <span class="opt-sym">${row.symbol || currentSymbol}</span>
      <span class="opt-contract">${strike}${right} ${exp}</span>
      <span class="opt-price">${price}</span>
      <span class="opt-size">${size}</span>
      <span class="opt-prem">${premium}</span>
      <span class="opt-side ${sideClass}">${side}</span>
      <span class="opt-cond">${cond}</span>
    `;
    return el;
  }

  function prependRow(data) {
    if (!feedEl) return;
    feedEl.insertBefore(renderRow(data), feedEl.firstChild);
    while (feedEl.children.length > MAX_ROWS) feedEl.removeChild(feedEl.lastChild);
  }

  // ── Status ─────────────────────────────────────────────────────────────

  function setStatus(msg, color) {
    const el = document.getElementById('options-status');
    if (el) { el.textContent = msg; el.style.color = color || ''; }
  }

  // ── REST snapshot ──────────────────────────────────────────────────────

  async function fetchSnapshot(symbol) {
    if (!feedEl) return;
    feedEl.innerHTML = '<div class="opt-loading">[ FETCHING SNAPSHOT... ]</div>';
    try {
      const url = `${THETA_REST}/option/snapshot/quote?symbol=${encodeURIComponent(symbol)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      feedEl.innerHTML = '';
      const rows = Array.isArray(data) ? data : data.rows || data.data || data.results || [];

      if (!rows.length) {
        feedEl.innerHTML = '<div class="opt-empty">No options data — market may be closed</div>';
        return;
      }

      // Sort by size descending (largest trades first in snapshot)
      rows.sort((a, b) => (b.size || 0) - (a.size || 0));
      rows.forEach(row => prependRow({ symbol, ...row }));
    } catch (err) {
      feedEl.innerHTML = `<div class="opt-error">⚠ ${err.message}</div>`;
      console.error('[Options snapshot]', err);
    }
  }

  // ── WebSocket stream ───────────────────────────────────────────────────

  function connectWS() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }

    try {
      ws = new WebSocket(THETA_WS);

      ws.onopen = () => {
        wsConnected = true;
        setStatus('● LIVE', '#22c55e');

        // Subscribe to options trades for current symbol
        const sub = JSON.stringify({
          req_type: 'TRADE',
          sec_type: 'OPTION',
          root: currentSymbol,
        });
        ws.send(sub);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Filter to current symbol if symbol field present
          if (!data.symbol || data.symbol === currentSymbol || data.root === currentSymbol) {
            prependRow({ symbol: currentSymbol, ...data });
          }
        } catch (e) { /* skip unparseable */ }
      };

      ws.onerror = () => {
        wsConnected = false;
        setStatus('⚠ WS error — using snapshot', '#f59e0b');
      };

      ws.onclose = () => {
        wsConnected = false;
        setStatus('○ Disconnected — reconnecting…', '#4a5060');
        reconnectTimer = setTimeout(connectWS, 5000);
      };
    } catch (err) {
      setStatus(`⚠ ${err.message}`, '#ef4444');
      reconnectTimer = setTimeout(connectWS, 10000);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  function loadSymbol(symbol) {
    // Normalize — options only make sense for US equity/ETF tickers
    const normalized = symbol.includes(':') ? symbol.split(':')[1] : symbol;
    currentSymbol = normalized;

    const symEl = document.getElementById('options-symbol');
    if (symEl) symEl.textContent = normalized;

    fetchSnapshot(normalized);

    // Re-subscribe WS to new symbol
    if (ws && wsConnected) {
      try {
        ws.send(JSON.stringify({ req_type: 'TRADE', sec_type: 'OPTION', root: normalized }));
      } catch (e) { connectWS(); }
    }
  }

  function init(containerId) {
    feedEl = document.getElementById(containerId);
    connectWS();
    loadSymbol('SPY');
  }

  return { init, loadSymbol };
})();
