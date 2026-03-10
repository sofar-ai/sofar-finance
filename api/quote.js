/**
 * Serverless API: Real-time stock quote from Polygon.io
 * GET /api/quote?ticker=SPY
 */

export default async function handler(req, res) {
  const { ticker = 'SPY' } = req.query;
  const apiKey = process.env.POLYGON_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'POLYGON_API_KEY not configured' });
  }

  try {
    const url = `https://api.polygon.io/v3/snapshot/last/stock/${ticker}?apiKey=${apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Polygon.io returned ${response.status}`);
    }

    const data = await response.json();

    // Extract the quote data
    const result = data.results?.[0] || data.results;
    if (!result) {
      return res.status(404).json({ error: 'No data found for ticker' });
    }

    // Build our response format
    const quote = {
      ticker: result.ticker || ticker,
      price: result.last?.price,
      prevClose: result.prevDay?.c,
      session: result.session || result.lastTrade,
      change: (result.session?.change || result.lastTrade?.change || 0).toFixed(2),
      changePercent: (result.session?.change_percent || result.lastTrade?.change_percent || 0).toFixed(2),
      high: result.session?.h || result.lastTrade?.h,
      low: result.session?.l || result.lastTrade?.l,
      volume: result.session?.v || result.lastTrade?.v,
      timestamp: new Date().toISOString(),
    };

    // Cache for 5 seconds
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');
    res.status(200).json(quote);
  } catch (error) {
    console.error('Quote API error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch quote' });
  }
}
