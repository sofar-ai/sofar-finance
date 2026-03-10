/**
 * Serverless API: Previous close stock quote from Polygon.io (free tier)
 * GET /api/quote?ticker=SPY
 */

export default async function handler(req, res) {
  const { ticker = 'SPY' } = req.query;
  const apiKey = process.env.POLYGON_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'POLYGON_API_KEY not configured' });
  }

  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Polygon.io returned ${response.status}`);
    }

    const data = await response.json();

    const result = data.results?.[0];
    if (!result) {
      return res.status(404).json({ error: 'No data found for ticker' });
    }

    const prevClose = result.c;
    const open = result.o;
    const change = (prevClose - open).toFixed(2);
    const changePercent = ((prevClose - open) / open * 100).toFixed(2);

    const quote = {
      ticker: ticker.toUpperCase(),
      price: prevClose,
      label: 'Previous Close',
      change,
      changePercent,
      high: result.h,
      low: result.l,
      volume: result.v,
      timestamp: new Date(result.t).toISOString(),
    };

    // Cache for 60s — prev close data doesn't change intraday
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.status(200).json(quote);
  } catch (error) {
    console.error('Quote API error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch quote' });
  }
}
