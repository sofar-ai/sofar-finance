/**
 * Chart API — OHLCV candles from Polygon.io (free tier)
 * GET /api/chart?ticker=SPY&timeframe=1D|5D|1M
 */

export default async function handler(req, res) {
  const { ticker: rawTicker = 'SPY', timeframe = '1D' } = req.query;
  // Map friendly ticker names to Polygon format
  const TICKER_MAP = { 'BTCUSD': 'X:BTCUSD' };
  const ticker = TICKER_MAP[rawTicker] || rawTicker;
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'POLYGON_API_KEY not configured' });

  const fmt = d => d.toISOString().slice(0, 10);
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

  let multiplier, timespan, from, to;
  switch (timeframe) {
    case '5D':
      multiplier = 30; timespan = 'minute';
      from = fmt(daysAgo(10)); to = fmt(new Date());
      break;
    case '1M':
      multiplier = 1; timespan = 'day';
      from = fmt(daysAgo(35)); to = fmt(new Date());
      break;
    case '1D':
    default:
      multiplier = 5; timespan = 'minute';
      from = fmt(daysAgo(4)); to = fmt(new Date());
      break;
  }

  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=1000&apiKey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Polygon ${response.status}`);
    const data = await response.json();
    if (!data.results?.length) return res.status(404).json({ error: `No chart data for ${ticker}` });

    let results = data.results;

    // For 1D: keep only the most recent trading day
    if (timeframe === '1D') {
      const lastDate = new Date(results[results.length - 1].t).toISOString().slice(0, 10);
      results = results.filter(r => new Date(r.t).toISOString().slice(0, 10) === lastDate);
    }

    const candles = results.map(r => ({
      time: Math.floor(r.t / 1000),
      open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.status(200).json({ ticker, timeframe, candles });
  } catch (err) {
    console.error('Chart API error:', err);
    res.status(500).json({ error: err.message });
  }
}
