import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action } = req.query;

    // GET /api/positions?action=list — all open positions
    if (req.method === 'GET' && (!action || action === 'list')) {
      const positions = await sql`SELECT * FROM positions WHERE status = 'open' ORDER BY entry_date`;
      const capital = await sql`SELECT value FROM portfolio_config WHERE key = 'capital'`;
      return res.json({ positions, capital: capital[0]?.value || '100000' });
    }

    // GET /api/positions?action=closed — trade history
    if (req.method === 'GET' && action === 'closed') {
      const closed = await sql`SELECT * FROM positions_closed ORDER BY exit_date DESC LIMIT 50`;
      return res.json({ closed });
    }

    // GET /api/positions?action=actions — latest exit signals
    if (req.method === 'GET' && action === 'actions') {
      const positions = await sql`SELECT id, description, exit_action, exit_reason, current_pnl, current_pnl_pct, net_delta, net_theta, avg_iv, current_value, last_enriched FROM positions WHERE status = 'open' ORDER BY entry_date`;
      return res.json({ positions });
    }

    // GET /api/positions?action=config — portfolio config
    if (req.method === 'GET' && action === 'config') {
      const config = await sql`SELECT key, value FROM portfolio_config`;
      const obj = {};
      config.forEach(r => { obj[r.key] = r.value; });
      return res.json(obj);
    }

    // POST /api/positions?action=enter — create new position
    if (req.method === 'POST' && action === 'enter') {
      const p = req.body;
      if (!p.id || !p.ticker) return res.status(400).json({ error: 'id and ticker required' });

      // Check max positions
      const count = await sql`SELECT COUNT(*) as n FROM positions WHERE status = 'open'`;
      if (parseInt(count[0].n) >= 5) return res.status(400).json({ error: 'Max 5 open positions' });

      await sql`INSERT INTO positions (id, type, ticker, direction, description, entry_date,
        entry_price, shares, expiration, contracts, legs, net_premium, max_profit, max_loss,
        total_cost, horizon_days, entry_spot)
        VALUES (${p.id}, ${p.type || 'options'}, ${p.ticker}, ${p.direction}, ${p.description},
        ${p.entry_date}, ${p.entry_price || null}, ${p.shares || null}, ${p.expiration || null},
        ${p.contracts || 1}, ${JSON.stringify(p.legs || [])}, ${p.net_premium || 0},
        ${p.max_profit || 0}, ${p.max_loss || 0}, ${p.total_cost || 0},
        ${p.horizon_days || 7}, ${p.entry_spot || 0})
        ON CONFLICT (id) DO NOTHING`;

      return res.json({ ok: true, id: p.id });
    }

    // POST /api/positions?action=close — close a position
    if (req.method === 'POST' && action === 'close') {
      const { id, realized_pnl, exit_price } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });

      // Get position
      const rows = await sql`SELECT * FROM positions WHERE id = ${id} AND status = 'open'`;
      if (!rows.length) return res.status(404).json({ error: 'Position not found' });
      const pos = rows[0];

      const exitDate = new Date().toISOString().split('T')[0];
      const entryDate = pos.entry_date;
      const daysHeld = Math.floor((new Date() - new Date(entryDate)) / 86400000);
      const pnl = parseFloat(realized_pnl) || 0;
      const win = pnl > 0;
      const pnlPct = pos.total_cost > 0 ? (pnl / parseFloat(pos.total_cost) * 100) : 0;

      // Move to closed
      await sql`INSERT INTO positions_closed (id, type, ticker, direction, description,
        entry_date, exit_date, entry_price, shares, expiration, contracts, legs,
        net_premium, max_profit, max_loss, total_cost, horizon_days, entry_spot,
        exit_price, realized_pnl, realized_pnl_pct, days_held, win, exit_reason)
        VALUES (${pos.id}, ${pos.type}, ${pos.ticker}, ${pos.direction}, ${pos.description},
        ${pos.entry_date}, ${exitDate}, ${pos.entry_price}, ${pos.shares}, ${pos.expiration},
        ${pos.contracts}, ${JSON.stringify(pos.legs || [])}, ${pos.net_premium}, ${pos.max_profit},
        ${pos.max_loss}, ${pos.total_cost}, ${pos.horizon_days}, ${pos.entry_spot},
        ${exit_price || null}, ${pnl}, ${pnlPct}, ${daysHeld}, ${win},
        ${pos.exit_reason || 'manual_close'})`;

      // Delete from open
      await sql`DELETE FROM positions WHERE id = ${id}`;

      // Update capital
      await sql`UPDATE portfolio_config SET value = (CAST(value AS NUMERIC) + ${pnl})::TEXT, updated_at = NOW() WHERE key = 'capital'`;

      return res.json({ ok: true, id, realized_pnl: pnl, win });
    }

    // POST /api/positions?action=capital — update capital
    if (req.method === 'POST' && action === 'capital') {
      const { value } = req.body;
      if (!value || parseFloat(value) <= 0) return res.status(400).json({ error: 'Invalid capital' });
      await sql`INSERT INTO portfolio_config (key, value, updated_at) VALUES ('capital', ${String(value)}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${String(value)}, updated_at = NOW()`;
      return res.json({ ok: true, capital: value });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('Positions API error:', err);
    return res.status(500).json({ error: err.message });
  }
}