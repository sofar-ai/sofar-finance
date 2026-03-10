/**
 * Quote API — Finnhub for US stocks, Yahoo for indices & commodities
 * No Polygon references.
 * GET /api/quote?ticker=SPY
 */

const YAHOO_INDEX_MAP = {
  'I:NKY':   '^N225',
  'I:KOSPI': '^KS11',
  'I:TAIEX': '^TWII',
};

const YAHOO_COMMODITY_MAP = {
  'BTCUSD': 'BTC-USD',
  'GOLD':   'GC=F',
  'SILVER': 'SI=F',
  'WTI':    'CL=F',
  'BRENT':  'BZ=F',
};

async function fetchFinnhub(ticker, apiKey) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  const data = await res.json();
  if (!data.c || data.c === 0) throw new Error('No Finnhub data');
  const price = data.c;
  const prev  = data.pc;
  return {
    ticker,
    price,
    label: 'Live',
    change:        (data.d  ?? price - prev).toFixed(2),
    changePercent: (data.dp ?? ((price - prev) / prev * 100)).toFixed(2),
    high:      data.h,
    low:       data.l,
    open:      data.o,
    prevClose: prev,
    timestamp: new Date((data.t || Date.now() / 1000) * 1000).toISOString(),
    source: 'finnhub',
  };
}

async function fetchYahoo(yahooTicker, displayTicker) {
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
    ticker: displayTicker,
    price,
    label: 'Prev Close',
    change:        prev ? (price - prev).toFixed(2) : '0.00',
    changePercent: prev ? ((price - prev) / prev * 100).toFixed(2) : '0.00',
    high:   meta.regularMarketDayHigh,
    low:    meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    timestamp: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    source: 'yahoo',
  };
}

export default async function handler(req, res) {
  const { ticker = 'SPY' } = req.query;
  const finnhubKey = process.env.FINNHUB_API_KEY;

  try {
    let quote;

    if (YAHOO_COMMODITY_MAP[ticker]) {
      quote = await fetchYahoo(YAHOO_COMMODITY_MAP[ticker], ticker);
    } else if (YAHOO_INDEX_MAP[ticker]) {
      quote = await fetchYahoo(YAHOO_INDEX_MAP[ticker], ticker.includes(':') ? ticker.split(':')[1] : ticker);
    } else {
      if (!finnhubKey) return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' });
      quote = await fetchFinnhub(ticker, finnhubKey);
    }

    const maxAge = quote.source === 'finnhub' ? 15 : 300;
    res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    res.status(200).json(quote);
  } catch (err) {
    console.error('Quote API error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch quote' });
  }
}
