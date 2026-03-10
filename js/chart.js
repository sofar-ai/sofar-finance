/**
 * Chart Component — 2x2 grid of TradingView Lightweight Charts
 * Tickers: SPY, QQQ, DJI, VIX
 * Public: init(), loadTicker(ticker), setTimeframe(tf), getSeries()
 */

const ChartComponent = (() => {
  const CHARTS = [
    { ticker: 'SPY',    id: 'SPY', display: 'SPY'  },
    { ticker: 'QQQ',   id: 'QQQ', display: 'QQQ'  },
    { ticker: 'DIA',   id: 'DJI', display: 'DIA'  },
    { ticker: 'VIX',   id: 'VIX', display: 'VIX'  },
  ];

  let instances = {}; // id -> { chart, candleSeries, volumeSeries }
  let currentTimeframe = '1D';

  const CHART_OPTS = {
    layout: {
      background: { color: '#0b0e11' },
      textColor: '#8b929e',
      fontSize: 10,
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    },
    grid: { vertLines: { color: '#1a1f28' }, horzLines: { color: '#1a1f28' } },
    crosshair: { mode: 1 /* Normal */ },
    rightPriceScale: { borderColor: '#252c38', scaleMargins: { top: 0.06, bottom: 0.25 } },
    timeScale: { borderColor: '#252c38', timeVisible: true, secondsVisible: false },
    handleScroll: true,
    handleScale: true,
  };

  function createInstance(canvasId) {
    const container = document.getElementById(canvasId);
    if (!container || !window.LightweightCharts) return null;

    const chart = LightweightCharts.createChart(container, CHART_OPTS);

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });

    return { chart, candleSeries, volumeSeries };
  }

  function setInfo(id, msg, isError) {
    const el = document.getElementById(`chart-info-${id}`);
    if (el) { el.textContent = msg; el.style.color = isError ? '#ef4444' : '#4a5060'; }
  }

  async function loadOne(ticker, id, timeframe) {
    const inst = instances[id];
    if (!inst) return;
    inst.candleSeries.setData([]);
    inst.volumeSeries.setData([]);
    setInfo(id, 'Loading…');

    try {
      const res = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&timeframe=${timeframe}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.candles?.length) throw new Error('No data');

      inst.candleSeries.setData(data.candles.map(c => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      })));
      inst.volumeSeries.setData(data.candles.map(c => ({
        time: c.time, value: c.volume,
        color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
      })));
      inst.chart.timeScale().fitContent();
      inst.candles = data.candles; // store for indicators
      if (typeof Indicators !== 'undefined') Indicators.applyAll(inst);

      const last  = data.candles[data.candles.length - 1];
      const first = data.candles[0];
      const priceEl = document.getElementById(`chart-price-${id}`);
      if (last && priceEl) {
        const chg = last.close - first.open;
        const pct = (chg / first.open * 100).toFixed(2);
        priceEl.textContent = last.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        priceEl.style.color = chg >= 0 ? '#22c55e' : '#ef4444';
        setInfo(id, (chg >= 0 ? '+' : '') + pct + '%');
      }
    } catch (err) {
      setInfo(id, `⚠ ${err.message}`, true);
      console.error(`[Chart:${id}]`, err);
    }
  }

  function setTimeframe(tf) {
    currentTimeframe = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tf === tf);
    });
    CHARTS.forEach(({ ticker, id }) => loadOne(ticker, id, tf));
  }

  function loadTicker(ticker) {
    // Highlight the matching chart cell
    document.querySelectorAll('.chart-grid-cell').forEach(el => {
      el.classList.toggle('chart-cell-active', el.dataset.ticker === ticker);
    });
  }

  function getSeries() { return instances; }

  function init() {
    CHARTS.forEach(({ ticker, id }) => {
      const inst = createInstance(`chart-canvas-${id}`);
      if (inst) {
        instances[id] = inst;
        loadOne(ticker, id, currentTimeframe);
      }
    });

    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', () => setTimeframe(btn.dataset.tf));
    });
  }

  return { init, loadTicker, setTimeframe, getSeries };
})();
