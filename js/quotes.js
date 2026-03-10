/**
 * Quotes Component — sofar-finance
 * Loads prev-close for all tickers once on init (no auto-refresh).
 * Falls back gracefully if a ticker errors.
 */

const Quotes = (() => {
  const TICKERS = ['SPY', 'QQQ', 'I:NKY', 'I:TPX', 'I:KOSPI', 'I:TAIEX'];

  function displayName(ticker) {
    return ticker.includes(':') ? ticker.split(':')[1] : ticker;
  }

  function formatPrice(p) {
    if (p == null) return '—';
    const n = typeof p === 'number' ? p : parseFloat(p);
    return isNaN(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumber(n) {
    if (n == null) return '—';
    if (typeof n !== 'number') n = parseFloat(n);
    return isNaN(n) ? '—' : n.toFixed(2);
  }

  function getChangeColor(change) {
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
    const pctStr    = changePercent >= 0 ? `+${formatNumber(changePercent)}%` : `${formatNumber(changePercent)}%`;

    const card = document.createElement('div');
    card.className = `quote-card quote-${colorClass}`;
    card.innerHTML = `
      <div class="quote-ticker">${displayName(quote.ticker || '')}</div>
      <div class="quote-price">${formatPrice(quote.price)}</div>
      <div class="quote-label">${quote.label || 'Prev Close'}</div>
      <div class="quote-change">
        <span class="quote-change-value">${changeStr}</span>
        <span class="quote-change-percent">${pctStr}</span>
      </div>
      <div class="quote-meta">
        <span>H: ${formatNumber(quote.high)}</span>
        <span>L: ${formatNumber(quote.low)}</span>
      </div>
    `;
    return card;
  }

  function renderErrorCard(ticker) {
    const card = document.createElement('div');
    card.className = 'quote-card quote-neutral';
    card.innerHTML = `
      <div class="quote-ticker">${displayName(ticker)}</div>
      <div class="quote-error">⚠ unavailable</div>
    `;
    return card;
  }

  async function fetchQuote(ticker) {
    const res = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function init(containerId, statusId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Placeholder skeleton cards while loading
    container.innerHTML = TICKERS.map(t =>
      `<div class="quote-card quote-neutral"><div class="quote-ticker">${displayName(t)}</div><div class="quote-loading">…</div></div>`
    ).join('');

    // Fetch all tickers in parallel
    const results = await Promise.allSettled(TICKERS.map(fetchQuote));

    container.innerHTML = '';
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        container.appendChild(renderQuoteCard(result.value));
      } else {
        console.error(`[Quotes] ${TICKERS[i]}:`, result.reason?.message);
        container.appendChild(renderErrorCard(TICKERS[i]));
      }
    });

    const statusEl = document.getElementById(statusId);
    if (statusEl) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusEl.textContent = `as of ${t}`;
    }
  }

  return { init };
})();
