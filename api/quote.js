/**
 * Serverless API: Prev close quote from Polygon.io (free tier)
 * Falls back to Yahoo Finance for indices not on Polygon free tier.
 * GET /api/quote?ticker=SPY
 * GET /api/quote?ticker=I:NKY
 */

const YAHOO_MAP = {
  'I:NKY':   '^N225',
  'I:TPX':   '^TOPX',
  'I:KOSPI': '^KS11',
  'I:TAIEX': '^TWII',
};

async function fetchPolygon(ticker, apiKey) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon ${res.status}`);
  const data = await res.json();
  const r = data.results?.[0];
  if (!r) throw new Error('No Polygon data');
  return {
    ticker: ticker.includes(':') ? ticker.split(':')[1] : ticker,
    price: r.c,
    label: 'Prev Close',
    change: (r.c - r.o).toFixed(2),
    changePercent: ((r.c - r.o) / r.o * 100).toFixed(2),
    high: r.h,
    low: r.l,
    volume: r.v,
    timestamp: new Date(r.t).toISOString(),
    source: 'polygon',
  };
}

async function fetchYahoo(polygonTicker) {
  const yahooTicker = YAHOO_MAP[polygonTicker];
  if (!yahooTicker) throw new Error(`No Yahoo mapping for ${polygonTicker}`);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SofarFinance/1.0)' },
  });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const data = await res.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) throw new Error('No Yahoo data');
  const price = meta.regularMarketPrice ?? meta.previousClose;
  const prev  = meta.previousClose ?? meta.chartPreviousClose;
  return {
    ticker: polygonTicker.includes(':') ? polygonTicker.split(':')[1] : polygonTicker,
    price,
    label: 'Prev Close',
    change: prev ? (price - prev).toFixed(2) : '0.00',
    changePercent: prev ? ((price - prev) / prev * 100).toFixed(2) : '0.00',
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    timestamp: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    source: 'yahoo',
  };
}

export default async function handler(req, res) {
  const { ticker = 'SPY' } = req.query;
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'POLYGON_API_KEY not configured' });

  try {
    let quote;
    try {
      quote = await fetchPolygon(ticker, apiKey);
    } catch (polygonErr) {
      console.warn(`Polygon failed for ${ticker}: ${polygonErr.message} — trying Yahoo`);
      quote = await fetchYahoo(ticker);
    }
    // Prev close data doesn't change intraday — cache aggressively
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(quote);
  } catch (err) {
    console.error('Quote API error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch quote' });
  }
}
