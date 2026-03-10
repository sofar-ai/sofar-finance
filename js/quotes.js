/**
 * Quotes Component — vertical grid sidebar, 3-col layout
 * Clicking a ticker loads it in the chart.
 */

const Quotes = (() => {
  const MARKET_TICKERS    = ['SPY', 'QQQ', 'I:NKY', 'I:KOSPI', 'I:TAIEX'];
  const COMMODITY_TICKERS = ['BTCUSD', 'GOLD', 'SILVER'];

  const DISPLAY_NAMES = {
    'BTCUSD': 'BTC',
    'GOLD':   'GOLD',
    'SILVER': 'SLVR',
    'I:NKY':  'NKY',
    'I:KOSPI':'KOSP',
    'I:TAIEX':'TWII',
  };

  function displayName(ticker) {
    if (DISPLAY_NAMES[ticker]) return DISPLAY_NAMES[ticker];
    return ticker.includes(':') ? ticker.split(':')[1] : ticker;
  }

  function formatPrice(p) {
    if (p == null) return '—';
    const n = typeof p === 'number' ? p : parseFloat(p);
    if (isNaN(n)) return '—';
    // Compact for large numbers (BTC, KRW)
    if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1000)  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderItem(quote, originalTicker) {
    const pct = parseFloat(quote.changePercent);
    const isUp = pct >= 0;
    const colorClass = isUp ? 'qli-up' : 'qli-down';
    const pctStr = isNaN(pct) ? '—' : (isUp ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`);

    const item = document.createElement('div');
    item.className = `quote-grid-item ${colorClass}`;
    item.dataset.ticker = originalTicker;
    item.title = `Load ${displayName(originalTicker)} chart`;
    item.innerHTML = `
      <div class="qgi-ticker">${displayName(originalTicker)}</div>
      <div class="qgi-price">${formatPrice(quote.price)}</div>
      <div class="qgi-change">${pctStr}</div>
    `;
    // Fix: ChartComponent is const in global scope, not on window
    item.addEventListener('click', () => {
      try { ChartComponent.loadTicker(originalTicker); } catch(e) { console.warn('[Quotes] chart not ready', e); }
    });
    return item;
  }

  function renderErrorItem(ticker) {
    const item = document.createElement('div');
    item.className = 'quote-grid-item qli-neutral';
    item.dataset.ticker = ticker;
    item.innerHTML = `
      <div class="qgi-ticker">${displayName(ticker)}</div>
      <div class="qgi-price qgi-muted">—</div>
      <div class="qgi-change qgi-muted">—</div>
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

  async function loadSection(containerId, tickers) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = tickers.map(t =>
      `<div class="quote-grid-item qli-neutral"><div class="qgi-ticker">${displayName(t)}</div><div class="qgi-price qgi-muted">…</div><div class="qgi-change"></div></div>`
    ).join('');

    const results = await Promise.allSettled(tickers.map(fetchQuote));
    container.innerHTML = '';
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        container.appendChild(renderItem(result.value, tickers[i]));
      } else {
        console.error(`[Quotes] ${tickers[i]}:`, result.reason?.message);
        container.appendChild(renderErrorItem(tickers[i]));
      }
    });

    // Default active on SPY
    const spyItem = container.querySelector('[data-ticker="SPY"]');
    if (spyItem) spyItem.classList.add('active');
  }

  function init(marketId, commodityId) {
    loadSection(marketId, MARKET_TICKERS);
    loadSection(commodityId, COMMODITY_TICKERS);
  }

  return { init };
})();
