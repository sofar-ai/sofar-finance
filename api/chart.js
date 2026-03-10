/**
 * Chart API — Finnhub candles (stocks + crypto)
 * No Polygon references.
 * GET /api/chart?ticker=SPY&timeframe=1D|5D|1M
 */

// Crypto tickers mapped to Finnhub exchange:pair format
const CRYPTO_MAP = {
  'BTCUSD': 'BINANCE:BTCUSDT',
};

export default async function handler(req, res) {
  const { ticker = 'SPY', timeframe = '1D' } = req.query;
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' });

  const now  = Math.floor(Date.now() / 1000);
  const DAY  = 86400;

  let resolution, from;
  switch (timeframe) {
    case '5D': resolution = '30'; from = now - 10 * DAY; break;
    case '1M': resolution = 'D';  from = now - 35 * DAY; break;
    case '1D':
    default:   resolution = '5';  from = now - 2  * DAY; break;
  }

  try {
    const cryptoSymbol = CRYPTO_MAP[ticker];
    const url = cryptoSymbol
      ? `https://finnhub.io/api/v1/crypto/candle?symbol=${encodeURIComponent(cryptoSymbol)}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`
      : `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Finnhub ${response.status}`);
    const data = await response.json();

    if (data.s !== 'ok' || !data.t?.length) {
      return res.status(404).json({ error: `No chart data for ${ticker}` });
    }

    let candles = data.t.map((t, i) => ({
      time: t,
      open:   data.o[i],
      high:   data.h[i],
      low:    data.l[i],
      close:  data.c[i],
      volume: data.v[i],
    }));

    // For 1D: keep only the most recent trading day
    if (timeframe === '1D' && candles.length > 0) {
      const lastDate = new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10);
      candles = candles.filter(c => new Date(c.time * 1000).toISOString().slice(0, 10) === lastDate);
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ ticker, timeframe, candles });
  } catch (err) {
    console.error('Chart API error:', err);
    res.status(500).json({ error: err.message });
  }
}
