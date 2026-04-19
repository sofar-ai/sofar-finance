import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

function parseISODate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const requestedDate = parseISODate(req.query.date);
    const [{ today }] = await sql`SELECT fn_session_date(NOW())::text AS today`;
    const sessionDate = requestedDate || today;
    const isToday = sessionDate === today;

    res.setHeader(
      'Cache-Control',
      isToday ? 'public, s-maxage=20, stale-while-revalidate=60'
              : 'public, s-maxage=300, stale-while-revalidate=3600'
    );

    // ── 1. Per-symbol session metrics ─────────────────────────────────
    const sessionMetrics = await sql`
      SELECT symbol, trade_count, total_premium, call_premium, put_premium,
             call_count, put_count, buy_premium, sell_premium, buy_count, sell_count,
             cvd, pc_ratio, sweep_count, first_trade_ts, last_trade_ts, last_refreshed_at
      FROM flow_session_metrics
      WHERE session_date = ${sessionDate}
      ORDER BY total_premium DESC
    `;

    // ── 2. Session totals ─────────────────────────────────────────────
    const [totals] = await sql`
      SELECT
        COALESCE(SUM(trade_count), 0)::bigint      AS total_trades,
        COALESCE(SUM(total_premium), 0)::numeric   AS total_premium,
        COALESCE(SUM(call_premium), 0)::numeric    AS total_call_premium,
        COALESCE(SUM(put_premium), 0)::numeric     AS total_put_premium,
        COALESCE(SUM(buy_premium), 0)::numeric     AS total_buy_premium,
        COALESCE(SUM(sell_premium), 0)::numeric    AS total_sell_premium,
        COALESCE(SUM(sweep_count), 0)::bigint      AS total_sweeps,
        MAX(last_refreshed_at)                     AS last_refreshed_at
      FROM flow_session_metrics
      WHERE session_date = ${sessionDate}
    `;

    const totalCallPrem = parseFloat(totals.total_call_premium);
    const totalPutPrem  = parseFloat(totals.total_put_premium);
    const sessionPcRatio = totalCallPrem > 0 ? totalPutPrem / totalCallPrem : null;

    // ── 3. Sweeps ─────────────────────────────────────────────────────
    const sweeps = await sql`
      SELECT sweep_id, symbol, total_premium, trade_count, direction,
             first_ts, last_ts, duration_ms, exchanges
      FROM flow_sweep_rollups
      WHERE session_date = ${sessionDate}
      ORDER BY total_premium DESC
      LIMIT 50
    `;

    // ── 4. Sector flow via JOIN on symbol_sectors ─────────────────────
    const sectorRows = await sql`
      SELECT
        s.sector,
        COUNT(DISTINCT m.symbol)::int              AS symbol_count,
        SUM(m.trade_count)::int                    AS trades,
        SUM(m.total_premium)::numeric              AS premium,
        SUM(m.call_premium)::numeric               AS call_premium,
        SUM(m.put_premium)::numeric                AS put_premium,
        SUM(m.buy_premium)::numeric                AS buy_premium,
        SUM(m.sell_premium)::numeric               AS sell_premium,
        SUM(m.sweep_count)::int                    AS sweeps,
        ARRAY_AGG(m.symbol ORDER BY m.total_premium DESC) AS symbols
      FROM flow_session_metrics m
      JOIN symbol_sectors s ON s.symbol = m.symbol
      WHERE m.session_date = ${sessionDate}
      GROUP BY s.sector
      ORDER BY premium DESC NULLS LAST
    `;

    const sectorFlow = {};
    for (const r of sectorRows) {
      const callPrem = parseFloat(r.call_premium) || 0;
      const putPrem  = parseFloat(r.put_premium) || 0;
      const buyPrem  = parseFloat(r.buy_premium) || 0;
      const sellPrem = parseFloat(r.sell_premium) || 0;
      const pcRatio = callPrem > 0 ? putPrem / callPrem : null;
      const cvd = buyPrem - sellPrem;
      let direction = 'NEUTRAL';
      if (pcRatio !== null) {
        if (pcRatio < 0.7 && cvd > 0)      direction = 'BULL';
        else if (pcRatio > 1.3 && cvd < 0) direction = 'BEAR';
        else if (pcRatio < 0.85)           direction = 'LEAN_BULL';
        else if (pcRatio > 1.15)           direction = 'LEAN_BEAR';
      }
      sectorFlow[r.sector] = {
        symbol_count: r.symbol_count,
        trades: r.trades,
        premium: parseFloat(r.premium) || 0,
        call_premium: callPrem,
        put_premium: putPrem,
        buy_premium: buyPrem,
        sell_premium: sellPrem,
        pc_ratio: pcRatio,
        cvd,
        sweeps: r.sweeps || 0,
        direction,
        symbols: r.symbols || [],
      };
    }

    // ── 5. Top tickers (top 10 by premium) ────────────────────────────
    const topTickers = sessionMetrics.slice(0, 10).map(m => ({
      symbol: m.symbol,
      trade_count: m.trade_count,
      total_premium: parseFloat(m.total_premium),
      pc_ratio: m.pc_ratio !== null ? parseFloat(m.pc_ratio) : null,
      cvd: parseFloat(m.cvd),
      last_trade_ts: m.last_trade_ts,
    }));

    // ── 6. Baselines ──────────────────────────────────────────────────
    let baselineMap = {};
    try {
      const baselines = await sql`
        SELECT symbol, pc_mean_20d, pc_std_20d, premium_mean_20d, premium_std_20d, days_in_baseline
        FROM flow_baselines
        WHERE as_of_date = (
          SELECT MAX(as_of_date) FROM flow_baselines WHERE as_of_date <= ${sessionDate}
        )
      `;
      for (const b of baselines) {
        baselineMap[b.symbol] = {
          pc_mean_20d: b.pc_mean_20d !== null ? parseFloat(b.pc_mean_20d) : null,
          pc_std_20d: b.pc_std_20d !== null ? parseFloat(b.pc_std_20d) : null,
          premium_mean_20d: b.premium_mean_20d !== null ? parseFloat(b.premium_mean_20d) : null,
          premium_std_20d: b.premium_std_20d !== null ? parseFloat(b.premium_std_20d) : null,
          days: b.days_in_baseline,
        };
      }
    } catch (e) {
      console.error('flow-aggregates baselines query error:', e);
      baselineMap = {};
    }

    // ── 7. Per-symbol with z-scores ───────────────────────────────────
    const perSymbol = sessionMetrics.map(m => {
      const baseline = baselineMap[m.symbol];
      let pcZscore = null;
      if (baseline && baseline.pc_std_20d && baseline.pc_std_20d > 0 && m.pc_ratio !== null) {
        pcZscore = (parseFloat(m.pc_ratio) - baseline.pc_mean_20d) / baseline.pc_std_20d;
      }
      return {
        symbol: m.symbol,
        trade_count: m.trade_count,
        total_premium: parseFloat(m.total_premium),
        call_premium: parseFloat(m.call_premium),
        put_premium: parseFloat(m.put_premium),
        buy_premium: parseFloat(m.buy_premium),
        sell_premium: parseFloat(m.sell_premium),
        cvd: parseFloat(m.cvd),
        pc_ratio: m.pc_ratio !== null ? parseFloat(m.pc_ratio) : null,
        pc_zscore: pcZscore,
        sweep_count: m.sweep_count,
        first_trade_ts: m.first_trade_ts,
        last_trade_ts: m.last_trade_ts,
      };
    });

    return res.json({
      session_date: sessionDate,
      is_today: isToday,
      last_refreshed_at: totals.last_refreshed_at,
      session_totals: {
        total_trades: parseInt(totals.total_trades),
        total_premium: parseFloat(totals.total_premium),
        total_call_premium: totalCallPrem,
        total_put_premium: totalPutPrem,
        total_buy_premium: parseFloat(totals.total_buy_premium),
        total_sell_premium: parseFloat(totals.total_sell_premium),
        total_sweeps: parseInt(totals.total_sweeps),
        session_pc_ratio: sessionPcRatio,
      },
      per_symbol: perSymbol,
      top_tickers: topTickers,
      sweeps: sweeps.map(s => ({
        sweep_id: s.sweep_id,
        symbol: s.symbol,
        total_premium: parseFloat(s.total_premium),
        trade_count: s.trade_count,
        direction: s.direction,
        first_ts: s.first_ts,
        last_ts: s.last_ts,
        duration_ms: s.duration_ms,
        exchanges: s.exchanges,
      })),
      sector_flow: sectorFlow,
      baselines_available: Object.keys(baselineMap).length > 0,
    });
  } catch (err) {
    console.error('flow-aggregates error:', err);
    return res.status(500).json({ error: err.message });
  }
}
