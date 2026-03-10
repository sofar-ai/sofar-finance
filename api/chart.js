/**
 * Chart API — Yahoo Finance OHLCV (no API key required)
 * GET /api/chart?ticker=SPY&timeframe=1D|5D|1M
 *
 * Timeframe → Yahoo params:
 *   1D  →  interval=5m  range=1d
 *   5D  →  interval=30m range=5d
 *   1M  →  interval=1d  range=1mo
 *
 * Crypto: BTCUSD → BTC-USD
 */

const TICKER_MAP = {
  'BTCUSD': 'BTC-USD',
  'BTC':    'BTC-USD',
};

const TIMEFRAME_MAP = {
  '1D': { interval: '5m',  range: '1d'  },
  '5D': { interval: '30m', range: '5d'  },
  '1M': { interval: '1d',  range: '1mo' },
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

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ ticker, timeframe, candles });

  } catch (err) {
    console.error('Chart API error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
