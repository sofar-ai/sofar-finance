/**
 * Top Flow Widget — shows top 5 most interesting options trades
 * Scores by: premium size, sweep flag, vol/OI ratio, ATM proximity
 * Refreshes every 5 minutes. Clicking opens options-flow.html?ticker=X
 * Runs in index.html; connects to ws://localhost:25520 (browser-direct)
 */

const TopFlow = (() => {
  const WS_URL     = 'ws://localhost:25520';
  const REFRESH_MS = 5 * 60 * 1000;
  const MAX_BUF    = 1000;

  let trades      = [];
  let ws          = null;
  let containerId = null;
  let refreshTimer = null;

  // ── Scoring ────────────────────────────────────────────────────────────

  function score(t) {
    let s = 0;
    const prem = t.premium || 0;
    if (prem >= 500000) s += 50;
    else if (prem >= 100000) s += 35;
    else if (prem >= 50000)  s += 22;
    else if (prem >= 25000)  s += 12;

    if (t.sweep || t.isSweep) s += 30;

    if (t.volume && t.oi > 0) {
      const r = t.volume / t.oi;
      if (r > 5) s += 20; else if (r > 2) s += 12; else if (r > 1) s += 6;
    }

    if (t.underlying && t.strike) {
      const pct = Math.abs(t.strike - t.underlying) / t.underlying;
      if (pct < 0.02) s += 10; else if (pct < 0.05) s += 5;
    }

    // Recency bonus (newer = more relevant)
    const age = (Date.now() - (t._at || Date.now())) / 60000; // minutes old
    s -= Math.min(age, 30);

    return s;
  }

  function reason(t) {
    const parts = [];
    if (t.sweep || t.isSweep) parts.push('Sweep execution');
    const p = t.premium || 0;
    if (p >= 500000)      parts.push('Whale-size premium');
    else if (p >= 100000) parts.push('Large block trade');
    if (t.volume && t.oi > 0 && t.volume / t.oi > 3)
      parts.push(`${(t.volume / t.oi).toFixed(1)}× open interest`);
    const side = (t.side || t.condition || '').toUpperCase();
    if (side === 'A' || side === 'BUY')  parts.push('Bought on ask');
    if (side === 'B' || side === 'SELL') parts.push('Sold on bid');
    return parts.length ? parts.join(', ') : 'Notable flow';
  }

  // ── Formatting ─────────────────────────────────────────────────────────

  function fmtPrem(p) {
    if (!p) return '—';
    if (p >= 1e6)  return `$${(p/1e6).toFixed(1)}M`;
    if (p >= 1000) return `$${(p/1000).toFixed(0)}K`;
    return `$${p.toFixed(0)}`;
  }

  function fmtExp(exp) {
    const s = String(exp);
    return s.length === 8 ? `${s.slice(4,6)}/${s.slice(6,8)}` : s;
  }

  // ── Render ─────────────────────────────────────────────────────────────

  function render() {
    const container = document.getElementById(containerId);
    const statusEl  = document.getElementById('top-flow-time');
    if (!container) return;

    if (statusEl) {
      statusEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
    }

    const top5 = trades
      .map(t => ({ ...t, _score: score(t) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 5);

    if (!top5.length) {
      container.innerHTML = '<div class="tf-empty">Collecting flow…</div>';
      return;
    }

    container.innerHTML = '';
    top5.forEach(t => {
      const right  = (t.right || '').toUpperCase();
      const isCall = right === 'C' || right === 'CALL';
      const sym    = t.symbol || '—';

      const el = document.createElement('div');
      el.className = `tf-entry tf-${isCall ? 'call' : 'put'}`;
      el.innerHTML = `
        <div class="tf-entry-top">
          <span class="tf-ticker">${sym}</span>
          <span class="tf-type ${isCall ? 'tf-c' : 'tf-p'}">${right || '?'}</span>
          <span class="tf-strike">${t.strike != null ? t.strike.toFixed(0) : '—'}</span>
          <span class="tf-expiry">${t.expiration ? fmtExp(t.expiration) : '—'}</span>
          <span class="tf-prem">${fmtPrem(t.premium)}</span>
        </div>
        <div class="tf-reason">${reason(t)}</div>
      `;
      el.addEventListener('click', () => {
        window.location.href = `options-flow.html?ticker=${encodeURIComponent(sym)}`;
      });
      container.appendChild(el);
    });
  }

  // ── WebSocket ──────────────────────────────────────────────────────────

  function connectWS() {
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        ws.send(JSON.stringify({ req_type: 'TRADE', sec_type: 'OPTION', root: '' }));
      };
      ws.onmessage = (e) => {
        try {
          const t = JSON.parse(e.data);
          trades.unshift({ ...t, _at: Date.now() });
          if (trades.length > MAX_BUF) trades.length = MAX_BUF;
        } catch {}
      };
      ws.onclose = () => setTimeout(connectWS, 5000);
      ws.onerror = () => {};
    } catch {}
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init(cId) {
    containerId = cId;
    const container = document.getElementById(cId);
    if (container) container.innerHTML = '<div class="tf-empty">Collecting flow…</div>';

    connectWS();

    // First render after 8s, then every 5 min
    setTimeout(() => {
      render();
      refreshTimer = setInterval(render, REFRESH_MS);
    }, 8000);
  }

  return { init };
})();
