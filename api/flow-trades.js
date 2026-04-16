import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const {
      symbol,
      date,
      min_premium,
      right,
      limit
    } = req.query;
    const sessionDate = date || new Date().toISOString().slice(0, 10);
    const minPrem = parseInt(min_premium) || 0;
    const maxRows = Math.min(parseInt(limit) || 500, 2000);
    let trades;
    if (symbol && right) {
      trades = await sql`
        SELECT symbol, expiration, strike, right_type, price, size, premium,
               side, condition, exchange, bid, ask, sweep_id, ts, session_date
        FROM flow_trades
        WHERE session_date = ${sessionDate}
          AND symbol = ${symbol.toUpperCase()}
          AND right_type = ${right.toUpperCase()}
          AND premium >= ${minPrem}
        ORDER BY ts DESC
        LIMIT ${maxRows}`;
    } else if (symbol) {
      trades = await sql`
        SELECT symbol, expiration, strike, right_type, price, size, premium,
               side, condition, exchange, bid, ask, sweep_id, ts, session_date
        FROM flow_trades
        WHERE session_date = ${sessionDate}
          AND symbol = ${symbol.toUpperCase()}
          AND premium >= ${minPrem}
        ORDER BY ts DESC
        LIMIT ${maxRows}`;
    } else {
      trades = await sql`
        SELECT symbol, expiration, strike, right_type, price, size, premium,
               side, condition, exchange, bid, ask, sweep_id, ts, session_date
        FROM flow_trades
        WHERE session_date = ${sessionDate}
          AND premium >= ${minPrem}
        ORDER BY ts DESC
        LIMIT ${maxRows}`;
    }
    const stats = await sql`
      SELECT COUNT(*) as total_trades, COALESCE(SUM(premium), 0) as total_premium
      FROM flow_trades
      WHERE session_date = ${sessionDate}`;
    return res.json({
      trades: trades.map(t => ({
        symbol: t.symbol,
        expiration: t.expiration,
        strike: t.strike,
        right: t.right_type,
        price: t.price,
        size: t.size,
        premium: parseFloat(t.premium),
        side: t.side,
        condition: t.condition,
        exchange: t.exchange,
        bid: t.bid,
        ask: t.ask,
        sweep_id: t.sweep_id,
        timestamp: t.ts,
        session_date: t.session_date
      })),
      total_trades: parseInt(stats[0].total_trades),
      total_premium: parseFloat(stats[0].total_premium),
      session_date: sessionDate
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
