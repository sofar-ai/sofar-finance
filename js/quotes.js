/**
 * Quotes Component — sofar-finance (vertical sidebar list, 3-col layout)
 * Clicking a ticker loads it in the chart.
 */

const Quotes = (() => {
  const TICKERS = ['SPY', 'QQQ', 'I:NKY', 'I:KOSPI', 'I:TAIEX'];

  function displayName(ticker) {
    return ticker.includes(':') ? ticker.split(':')[1] : ticker;
  }

  function formatPrice(p) {
    if (p == null) return '—';
    const n = typeof p === 'number' ? p : parseFloat(p);
    if (isNaN(n)) return '—';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderItem(quote, originalTicker) {
    const pct = parseFloat(quote.changePercent);
    const isUp = pct >= 0;
    const colorClass = isUp ? 'qli-up' : 'qli-down';
    const pctStr = isNaN(pct) ? '—' : (isUp ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`);

    const item = document.createElement('div');
    item.className = `quote-list-item ${colorClass}`;
    item.dataset.ticker = originalTicker;
    item.title = `Load ${displayName(originalTicker)} chart`;
    item.innerHTML = `
      <span class="qli-ticker">${displayName(quote.ticker || originalTicker)}</span>
      <span class="qli-right">
        <span class="qli-price">${formatPrice(quote.price)}</span>
        <span class="qli-change">${pctStr}</span>
      </span>
    `;
    item.addEventListener('click', () => {
      if (window.ChartComponent) ChartComponent.loadTicker(originalTicker);
    });
    return item;
  }

  function renderErrorItem(ticker) {
    const item = document.createElement('div');
    item.className = 'quote-list-item qli-neutral';
    item.dataset.ticker = ticker;
    item.innerHTML = `
      <span class="qli-ticker">${displayName(ticker)}</span>
      <span class="qli-right"><span class="qli-price qli-muted">—</span></span>
    `;
    return item;
  }

  async function fetchQuote(ticker) {
    const res = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = TICKERS.map(t =>
      `<div class="quote-list-item qli-neutral"><span class="qli-ticker">${displayName(t)}</span><span class="qli-right qli-muted">…</span></div>`
    ).join('');

    const results = await Promise.allSettled(TICKERS.map(fetchQuote));
    container.innerHTML = '';
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        container.appendChild(renderItem(result.value, TICKERS[i]));
      } else {
        console.error(`[Quotes] ${TICKERS[i]}:`, result.reason?.message);
        container.appendChild(renderErrorItem(TICKERS[i]));
      }
    });

    // Default active: SPY
    const spyItem = container.querySelector('[data-ticker="SPY"]');
    if (spyItem) spyItem.classList.add('active');
  }

  return { init };
})();
