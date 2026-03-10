/**
 * Chart Component — TradingView Lightweight Charts v4
 * Candlestick + volume histogram, dark Bloomberg theme.
 * Public: init(containerId), loadTicker(ticker), setTimeframe(tf)
 * Modular — TA indicators will be added on top.
 */

const ChartComponent = (() => {
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let currentTicker = 'SPY';
  let currentTimeframe = '1D';

  function initChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !window.LightweightCharts) {
      console.error('[Chart] LightweightCharts not loaded or container missing');
      return;
    }

    chart = LightweightCharts.createChart(container, {
      layout: {
        background: { color: '#0b0e11' },
        textColor: '#8b929e',
        fontSize: 11,
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      },
      grid: {
        vertLines: { color: '#1a1f28' },
        horzLines: { color: '#1a1f28' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#4a5060', width: 1, style: 2 },
        horzLine: { color: '#4a5060', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#252c38',
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: '#252c38',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    candleSeries = chart.addCandlestickSeries({
      upColor:        '#22c55e',
      downColor:      '#ef4444',
      borderUpColor:  '#22c55e',
      borderDownColor:'#ef4444',
      wickUpColor:    '#22c55e',
      wickDownColor:  '#ef4444',
    });

    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  }

  function setStatus(msg, isError = false) {
    const el = document.getElementById('chart-status');
    if (el) { el.textContent = msg; el.style.color = isError ? '#ef4444' : '#4a5060'; }
  }

  async function loadChart(ticker, timeframe) {
    if (!chart) return;
    currentTicker = ticker;
    currentTimeframe = timeframe;

    const nameEl  = document.getElementById('chart-ticker');
    const priceEl = document.getElementById('chart-price');
    if (nameEl)  nameEl.textContent  = ticker.includes(':') ? ticker.split(':')[1] : ticker;
    if (priceEl) priceEl.textContent = '—';

    setStatus('Loading…');
    candleSeries.setData([]);
    volumeSeries.setData([]);

    try {
      const res = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&timeframe=${timeframe}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.candles?.length) throw new Error('No data returned');

      candleSeries.setData(data.candles.map(c => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      })));

      volumeSeries.setData(data.candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
      })));

      chart.timeScale().fitContent();

      const last = data.candles[data.candles.length - 1];
      if (last && priceEl) {
        priceEl.textContent = last.close.toLocaleString(undefined, {
          minimumFractionDigits: 2, maximumFractionDigits: 2,
        });
      }
      setStatus(`${data.candles.length} bars · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      setStatus(`⚠ ${err.message}`, true);
      console.error('[Chart]', err);
    }
  }

  function setTimeframe(tf) {
    currentTimeframe = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tf === tf);
    });
    loadChart(currentTicker, tf);
  }

  function loadTicker(ticker) {
    currentTicker = ticker;
    document.querySelectorAll('.quote-list-item').forEach(el => {
      el.classList.toggle('active', el.dataset.ticker === ticker);
    });
    loadChart(ticker, currentTimeframe);
  }

  // Expose the current series refs so TA indicators can attach
  function getSeries() { return { chart, candleSeries, volumeSeries }; }

  function init(containerId) {
    initChart(containerId);
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', () => setTimeframe(btn.dataset.tf));
    });
    loadChart('SPY', '1D');
  }

  return { init, loadTicker, setTimeframe, getSeries };
})();
