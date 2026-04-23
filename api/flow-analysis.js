import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL_MARKET || process.env.DATABASE_URL);

// SESSION_DATE_FALLBACK_V1 — when ?date= is not provided, resolve the current
// session via fn_session_date(NOW()) rather than the naive getETDate() which
// returns the ET calendar date and misses the 8pm CBOE GTH rollover. Mirrors
// the pattern already used in flow-aggregates.js (API_BIFURCATE_V1) and
// unusual-flow.js. Explicit ?date=YYYY-MM-DD still honored unchanged.
function getETDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, symbol, date } = req.query;
    // SESSION_DATE_FALLBACK_V1
    let sessionDate;
    if (date) {
      sessionDate = date;
    } else {
      const sdRows = await sql`SELECT fn_session_date(NOW()) AS sd`;
      sessionDate = sdRows[0].sd;
    }

    if (!action || action === 'latest') {
      const analyses = await sql`
        SELECT DISTINCT ON (symbol)
          symbol, reference_price, total_trades, total_premium,
          analysis, is_cross_asset, analysis_time, model_used, cycle_seconds
        FROM flow_analysis
        WHERE session_date = ${sessionDate}
        ORDER BY symbol, analysis_time DESC`;

      return res.json({
        session_date: sessionDate,
        analyses: analyses.map(a => ({
          symbol: a.symbol,
          reference_price: parseFloat(a.reference_price) || null,
          total_trades: a.total_trades,
          total_premium: parseFloat(a.total_premium) || 0,
          analysis: a.analysis,
          is_cross_asset: a.is_cross_asset,
          timestamp: a.analysis_time,
          model: a.model_used,
        }))
      });
    }

    if (action === 'history') {
      const sym = symbol || 'SPX';
      const history = await sql`
        SELECT symbol, reference_price, analysis, analysis_time,
               is_cross_asset, cycle_seconds
        FROM flow_analysis
        WHERE session_date = ${sessionDate} AND symbol = ${sym}
        ORDER BY analysis_time ASC`;

      return res.json({
        symbol: sym,
        session_date: sessionDate,
        cycles: history.map(h => ({
          analysis: h.analysis,
          timestamp: h.analysis_time,
          reference_price: parseFloat(h.reference_price) || null,
          cycle_seconds: parseFloat(h.cycle_seconds) || 0,
        }))
      });
    }

    if (action === 'cross-asset') {
      const cross = await sql`
        SELECT analysis, analysis_time
        FROM flow_analysis
        WHERE session_date = ${sessionDate} AND is_cross_asset = TRUE
        ORDER BY analysis_time DESC
        LIMIT 1`;

      return res.json({
        session_date: sessionDate,
        synthesis: cross.length > 0 ? {
          analysis: cross[0].analysis,
          timestamp: cross[0].analysis_time,
        } : null
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
