/**
 * Top Flow Widget — reads from /data/top-flow.json (updated by cron)
 * Shows top 5 AI-analyzed options trades. Clicking opens options-flow.html.
 */

const TopFlow = (() => {
  const REFRESH_MS   = 5 * 60 * 1000;
  const STALE_MIN    = 10;

  let containerId = null;

  // ── Helpers ────────────────────────────────────────────────────────────

  function timeSince(isoStr) {
    if (!isoStr) return null;
    const diffMin = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const h = Math.floor(diffMin / 60);
    return `${h}h ${diffMin % 60}m ago`;
  }

  function isStale(isoStr) {
    if (!isoStr) return false;
    return (Date.now() - new Date(isoStr).getTime()) > STALE_MIN * 60000;
  }

  function fmtPrem(p) {
    if (!p) return '—';
    if (p >= 1e6)  return `$${(p/1e6).toFixed(1)}M`;
    if (p >= 1000) return `$${(p/1000).toFixed(0)}K`;
    return `$${p}`;
  }

  function fmtExp(exp) {
    const s = String(exp);
    return s.length === 8 ? `${s.slice(4,6)}/${s.slice(6,8)}` : s;
  }

  // ── Render ─────────────────────────────────────────────────────────────

  function render(data) {
    const container = document.getElementById(containerId);
    const timeEl    = document.getElementById('top-flow-time');
    if (!container) return;

    const since = timeSince(data.fetched_at);
    if (timeEl) {
      timeEl.textContent = since ? `${since}` : '';
      timeEl.style.color = isStale(data.fetched_at) ? '#f59e0b' : '';
    }

    // No data yet
    if (!data.fetched_at) {
      container.innerHTML = '<div class="tf-empty">Awaiting first data fetch — check back during market hours</div>';
      return;
    }

    // Stale warning
    let headerNote = '';
    if (isStale(data.fetched_at)) headerNote = '<div class="tf-market-closed">⚠ Data may be stale</div>';
    if (!data.market_open)        headerNote = '<div class="tf-market-closed">Market Closed — last session data</div>';

    const trades = data.top_trades || [];
    if (!trades.length) {
      container.innerHTML = headerNote + '<div class="tf-empty">No significant flow data available</div>';
      return;
    }

    container.innerHTML = headerNote;
    trades.forEach(t => {
      const right  = (t.right || '').toUpperCase();
      const isCall = right === 'C' || right === 'CALL';
      const sym    = t.ticker || t.symbol || '—';

      const el = document.createElement('div');
      el.className = `tf-entry tf-${isCall ? 'call' : 'put'}`;
      el.innerHTML = `
        <div class="tf-entry-top">
          <span class="tf-ticker">${sym}</span>
          <span class="tf-type ${isCall ? 'tf-c' : 'tf-p'}">${right || '?'}</span>
          <span class="tf-strike">${t.strike != null ? (+t.strike).toFixed(0) : '—'}</span>
          <span class="tf-expiry">${t.expiration ? fmtExp(t.expiration) : '—'}</span>
          <span class="tf-prem">${fmtPrem(t.premium)}</span>
        </div>
        <div class="tf-reason">${t.reason || ''}</div>
      `;
      el.addEventListener('click', () => {
        window.location.href = `options-flow.html?ticker=${encodeURIComponent(sym)}`;
      });
      container.appendChild(el);
    });
  }

  // ── Fetch ──────────────────────────────────────────────────────────────

  async function load() {
    const container = document.getElementById(containerId);
    try {
      const res = await fetch(`/data/top-flow.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data);
    } catch (err) {
      if (container) container.innerHTML = '<div class="tf-empty">Awaiting first data fetch — check back during market hours</div>';
    }
  }

  function init(cId) {
    containerId = cId;
    load();
    setInterval(load, REFRESH_MS);
  }

  return { init };
})();
