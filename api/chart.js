/**
 * Chart API — Yahoo Finance OHLCV (no API key required)
 * GET /api/chart?ticker=SPY&timeframe=1D|5D|1M
 *
 * Timeframe → Yahoo params:
 *   1D  →  interval=5m  range=1d
 *   5D  →  interval=30m range=5d
 *   1M  →  interval=1d  range=1mo
 *
 * VIX: VIX → ^VIX
 */

const TICKER_MAP = {
  'VIX': '^VIX',
};

const TIMEFRAME_MAP = {
  '1D': { interval: '5m',  range: '1d'  },
  '1W': { interval: '30m', range: '5d'  },
  '1M': { interval: '1d',  range: '1mo' },
  // 1Y fetches 2y of daily bars so MA200 has full lookback history.
  // display_range tells the frontend to only render the last 1y on the x-axis;
  // the extra year is used silently for TA calculations.
  '1Y': { interval: '1d',  range: '2y', display_range: '1y' },
};

export default async function handler(req, res) {
  const { ticker = 'SPY', timeframe = '1D' } = req.query;

  const yahooTicker = TICKER_MAP[ticker] || ticker;
  const { interval, range } = TIMEFRAME_MAP[timeframe] || TIMEFRAME_MAP['1D'];

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=${interval}&range=${range}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
    });

    if (!response.ok) throw new Error(`Yahoo Finance HTTP ${response.status}`);

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No chart data returned');

    const timestamps = result.timestamp || [];
    const quote      = result.indicators?.quote?.[0] || {};

    if (!timestamps.length) {
      return res.status(404).json({ error: `No chart data for ${ticker}` });
    }

    // Zip into candle objects; skip rows with any null OHLC value
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      const v = quote.volume?.[i] ?? 0;
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({ time: timestamps[i], open: o, high: h, low: l, close: c, volume: v });
    }

    if (!candles.length) {
      return res.status(404).json({ error: `No valid candles for ${ticker}` });
    }

    // For timeframes with a display_range (e.g. 1Y fetches 2y for TA but shows 1y),
    // compute the unix timestamp at which the visible window starts.
    let displayFrom = null;
    if (TIMEFRAME_MAP[timeframe]?.display_range === '1y') {
      const oneYearAgo = Math.floor(Date.now() / 1000) - 365 * 24 * 3600;
      displayFrom = oneYearAgo;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ ticker, timeframe, candles, displayFrom });

  } catch (err) {
    console.error('Chart API error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
