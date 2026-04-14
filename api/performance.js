import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action } = req.query;

    // GET /api/performance — overall stats
    if (!action || action === 'stats') {
      const total = await sql`SELECT COUNT(*) as n FROM prediction_tracking`;
      const resolved = await sql`
        SELECT source, horizon_days,
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE correct = true) as correct,
               ROUND(AVG(pnl_pct)::numeric, 4) as avg_pnl,
               ROUND(AVG(price_error_pct)::numeric, 4) as avg_error
        FROM prediction_tracking
        WHERE resolved_at IS NOT NULL
        GROUP BY source, horizon_days
        ORDER BY source, horizon_days`;
      const unresolved = await sql`
        SELECT COUNT(*) as n FROM prediction_tracking WHERE resolved_at IS NULL`;
      return res.json({ total: total[0].n, unresolved: unresolved[0].n, by_source: resolved });
    }

    // GET /api/performance?action=recent — last 50 predictions
    if (action === 'recent') {
      const recent = await sql`
        SELECT source, ticker, direction, confidence, probability,
               horizon_days, price_at_prediction, predicted_price,
               actual_price, actual_direction, correct, pnl_pct,
               price_error_pct, created_at, resolved_at, regime_at_prediction
        FROM prediction_tracking
        ORDER BY created_at DESC
        LIMIT 50`;
      return res.json({ predictions: recent });
    }

    // GET /api/performance?action=by_source&source=lgbm_21d
    if (action === 'by_source') {
      const source = req.query.source || 'lgbm_21d';
      const stats = await sql`
        SELECT direction, correct, pnl_pct, confidence, price_error_pct, created_at
        FROM prediction_tracking
        WHERE source = ${source} AND resolved_at IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 100`;
      return res.json({ source, predictions: stats });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
