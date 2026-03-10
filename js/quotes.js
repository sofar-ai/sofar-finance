/**
 * Quotes Component — sofar-finance
 * Displays real-time stock quotes (SPY, etc.)
 * Fetches from /api/quote serverless function
 */

const Quotes = (() => {
  const REFRESH_INTERVAL_MS = 10 * 1000; // Refresh every 10s
  let refreshTimer = null;

  function formatPrice(p) {
    if (!p) return '—';
    return typeof p === 'number' ? p.toFixed(2) : p;
  }

  function formatNumber(n) {
    if (!n) return '—';
    if (typeof n !== 'number') n = parseFloat(n);
    if (isNaN(n)) return '—';
    return n.toFixed(2);
  }

  function getChangeColor(change) {
    if (!change) return 'neutral';
    const c = parseFloat(change);
    if (c > 0) return 'up';
    if (c < 0) return 'down';
    return 'neutral';
  }

  function renderQuoteCard(quote) {
    const changeNum = parseFloat(quote.change);
    const changePercent = parseFloat(quote.changePercent);
    const colorClass = getChangeColor(changeNum);

    const changeStr = changeNum >= 0 ? `+${formatNumber(changeNum)}` : formatNumber(changeNum);
    const changePercentStr = changePercent >= 0 ? `+${formatNumber(changePercent)}%` : `${formatNumber(changePercent)}%`;

    const card = document.createElement('div');
    card.className = `quote-card quote-${colorClass}`;
    card.innerHTML = `
      <div class="quote-ticker">${quote.ticker}</div>
      <div class="quote-price">${formatPrice(quote.price)}</div>
      <div class="quote-label">${quote.label || "Price"}</div>
      <div class="quote-change">
        <span class="quote-change-value">${changeStr}</span>
        <span class="quote-change-percent">${changePercentStr}</span>
      </div>
      <div class="quote-meta">
        <span>H: ${formatNumber(quote.high)}</span>
        <span>L: ${formatNumber(quote.low)}</span>
      </div>
    `;
    return card;
  }

  function setStatus(el, text) {
    if (el) el.textContent = text;
  }

  async function load(containerId, statusId, ticker = 'SPY') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div class="quote-loading">Fetching...</div>';

    try {
      const res = await fetch(`/api/quote?ticker=${ticker}&_=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const quote = await res.json();

      if (quote.error) {
        container.innerHTML = `<div class="quote-error">⚠ ${quote.error}</div>`;
        return;
      }

      container.innerHTML = '';
      container.appendChild(renderQuoteCard(quote));
      
      const t = new Date(quote.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setStatus(document.getElementById(statusId), t);
    } catch (e) {
      container.innerHTML = `<div class="quote-error">⚠ ${e.message}</div>`;
      console.error('[Quotes]', e);
    }
  }

  function init(containerId, statusId, ticker = 'SPY') {
    load(containerId, statusId, ticker);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => load(containerId, statusId, ticker), REFRESH_INTERVAL_MS);
  }

  return { init };
})();
