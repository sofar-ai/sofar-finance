/**
 * Quotes Component — vertical list sidebar, real-time via Finnhub
 * Clicking a ticker loads its chart AND options flow.
 */

const Quotes = (() => {
  const MARKET_TICKERS    = ['SPY', 'QQQ', 'I:DJI', 'I:NKY', 'I:KOSPI', 'I:TAIEX'];
  const COMMODITY_TICKERS = ['BTCUSD', 'GOLD', 'SILVER', 'WTI', 'BRENT'];
  const REFRESH_MS        = 30 * 1000; // 30s — Finnhub is real-time

  const DISPLAY_NAMES = {
    'I:DJI': 'DJI', 'I:NKY': 'NKY', 'I:KOSPI': 'KOSPI', 'I:TAIEX': 'TAIEX',
    'BTCUSD': 'BTC', 'GOLD': 'GOLD', 'SILVER': 'SLVR', 'WTI': 'WTI', 'BRENT': 'BRNT',
  };

  function displayName(ticker) {
    return DISPLAY_NAMES[ticker] || (ticker.includes(':') ? ticker.split(':')[1] : ticker);
  }

  function formatPrice(p) {
    if (p == null) return '—';
    const n = typeof p === 'number' ? p : parseFloat(p);
    if (isNaN(n)) return '—';
    if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1000)  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function updateItem(el, quote) {
    const pct   = parseFloat(quote.changePercent);
    const isUp  = pct >= 0;
    const pctStr = isNaN(pct) ? '—' : (isUp ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`);
    el.className = `quote-list-item ${isUp ? 'qli-up' : 'qli-down'}`;
    const priceEl  = el.querySelector('.qli-price');
    const changeEl = el.querySelector('.qli-change');
    if (priceEl)  priceEl.textContent  = formatPrice(quote.price);
    if (changeEl) changeEl.textContent = pctStr;
  }

  function renderItem(quote, originalTicker) {
    const pct   = parseFloat(quote.changePercent);
    const isUp  = pct >= 0;
    const pctStr = isNaN(pct) ? '—' : (isUp ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`);

    const item = document.createElement('div');
    item.className = `quote-list-item ${isUp ? 'qli-up' : 'qli-down'}`;
    item.dataset.ticker = originalTicker;
    item.innerHTML = `
      <span class="qli-ticker">${displayName(originalTicker)}</span>
      <span class="qli-right">
        <span class="qli-price">${formatPrice(quote.price)}</span>
        <span class="qli-change">${pctStr}</span>
      </span>
    `;
    item.addEventListener('click', () => {
      try { ChartComponent.loadTicker(originalTicker); } catch(e) {}
      try { OptionsFlow.loadSymbol(originalTicker); }    catch(e) {}
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

  async function loadSection(containerId, tickers, isRefresh) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!isRefresh) {
      container.innerHTML = tickers.map(t =>
        `<div class="quote-list-item qli-neutral" data-ticker="${t}">
          <span class="qli-ticker">${displayName(t)}</span>
          <span class="qli-right qli-muted">…</span>
        </div>`
      ).join('');
    }

    const results = await Promise.allSettled(tickers.map(fetchQuote));

    if (isRefresh) {
      // In-place update to avoid flicker
      results.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        const el = container.querySelector(`[data-ticker="${tickers[i]}"]`);
        if (el) updateItem(el, result.value);
      });
    } else {
      container.innerHTML = '';
      results.forEach((result, i) => {
        container.appendChild(
          result.status === 'fulfilled'
            ? renderItem(result.value, tickers[i])
            : renderErrorItem(tickers[i])
        );
      });
    }
  }

  function init(marketId, commodityId) {
    loadSection(marketId,    MARKET_TICKERS,    false);
    loadSection(commodityId, COMMODITY_TICKERS, false);

    // Refresh quotes every 30s (Finnhub real-time)
    setInterval(() => {
      loadSection(marketId,    MARKET_TICKERS,    true);
      loadSection(commodityId, COMMODITY_TICKERS, true);
    }, REFRESH_MS);
  }

  return { init };
})();
