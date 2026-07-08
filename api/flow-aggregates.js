import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL_MARKET || process.env.DATABASE_URL);

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
    const requestedSession = (req.query.session || '').toString().toLowerCase();

    // API_BIFURCATE_V1 — return TRUE current session via fn_session_date(NOW()).
    // No more $1B fallback that masquerades yesterday's RTH as today.
    // Accompanying data_status field tells the frontend where we are in the
    // trading day so it can render appropriate UX (pre-market banner, etc.)
    //
    // Two queries:
    //   today_sd  = fn_session_date(NOW()) — actual current session
    //   prior_sd  = most recent session_date < today with > $1B premium
    //               (yesterday's closed RTH, the carry-in reference)
    const [{ today_sd, prior_sd, et_hour, et_dow }] = await sql`
      WITH today_q AS (
        SELECT fn_session_date(NOW()) AS sd
      ),
      prior_q AS (
        SELECT MAX(session_date) AS sd
        FROM flow_session_metrics
        WHERE session_date >= CURRENT_DATE - INTERVAL '14 days'
          AND session_date < (SELECT sd FROM today_q)
        GROUP BY ()
        HAVING SUM(total_premium) > 1e9
      ),
      now_et AS (
        SELECT EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/New_York'))::int AS h,
               EXTRACT(DOW  FROM (NOW() AT TIME ZONE 'America/New_York'))::int AS d
      )
      SELECT
        (SELECT sd::text FROM today_q) AS today_sd,
        (SELECT sd::text FROM prior_q) AS prior_sd,
        (SELECT h FROM now_et)         AS et_hour,
        (SELECT d FROM now_et)         AS et_dow
    `;

    const today = today_sd;
    const prior = prior_sd;
    const etHour = et_hour;
    const etDow = et_dow;

    // RTH = Mon-Fri (DOW 1-5), 9:30 AM ET to ~4:15 PM ET
    // (we use 9-16 hour window for inclusivity; precise minute check below)
    const isWeekday = etDow >= 1 && etDow <= 5;
    const rthActive = isWeekday && etHour >= 9 && etHour < 16;
    const gthActive = isWeekday && (etHour >= 20 || etHour < 9);
    const phase = rthActive ? 'RTH'
                : gthActive ? 'GTH'
                : isWeekday ? 'AFTER_HOURS_NO_GTH'
                : 'WEEKEND';

    // Resolve which session the caller wants:
    //   ?date=YYYY-MM-DD → that exact date
    //   ?session=prior   → most recent prior RTH session (yesterday)
    //   default          → today (true current session)
    let sessionDate;
    if (requestedDate) {
      sessionDate = requestedDate;
    } else if (requestedSession === 'prior') {
      sessionDate = prior || today;
    } else {
      sessionDate = today;
    }
    const isToday = sessionDate === today;
    const isPrior = sessionDate === prior;

    res.setHeader(
      'Cache-Control',
      isToday ? 'public, s-maxage=20, stale-while-revalidate=60'
              : 'public, s-maxage=300, stale-while-revalidate=3600'
    );

    // ── 1. Per-symbol session metrics ─────────────────────────────────
    // COMPANY_NAMES_API_V1 — left-join ticker_names so company_name flows
    // through to top_tickers and per_symbol output. Unknown symbols return
    // company_name=NULL; demand-insertion below registers them for next FMP run.
    const sessionMetrics = await sql`
      SELECT m.symbol, m.trade_count, m.total_premium, m.call_premium, m.put_premium,
             m.call_count, m.put_count, m.buy_premium, m.sell_premium,
             m.buy_count, m.sell_count,
             m.cvd, m.pc_ratio, m.sweep_count,
             m.first_trade_ts, m.last_trade_ts, m.last_refreshed_at,
             tn.company_name
      FROM flow_session_metrics m
      LEFT JOIN ticker_names tn ON tn.symbol = m.symbol
      WHERE m.session_date = ${sessionDate}
      ORDER BY m.total_premium DESC
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

    // ── 5. Top tickers (top 25 by premium) ────────────────────────────
    // COMPANY_NAMES_API_V1 — surface company_name so UI can show
    // "MU — MICRON TECHNOLOGY" for Cmd+F-by-name discoverability.
    const topTickers = sessionMetrics.slice(0, 25).map(m => ({
      symbol: m.symbol,
      company_name: m.company_name || null,
      trade_count: m.trade_count,
      total_premium: parseFloat(m.total_premium),
      pc_ratio: m.pc_ratio !== null ? parseFloat(m.pc_ratio) : null,
      cvd: parseFloat(m.cvd),
      last_trade_ts: m.last_trade_ts,
    }));

    // COMPANY_NAMES_API_V1 demand-insertion MOVED to
    // unusual-flow-detector.py (SOF-32, FLOW_AGGREGATES_GET_WRITE_REMOVED_V1)
    // — a GET handler must not write. Names still come from the
    // LEFT JOIN ticker_names above; registration of new symbols now
    // happens cron-side within 15 min of first ranking.

    // ── 6. Baselines — KILLED (SOF-32 item 3, FLOW_BASELINES_KILLED_V1).
    // flow_baselines was stillborn: 0 rows ever, in both market and production.
    // baselineMap stays an empty map so per_symbol[].pc_zscore keeps its shape
    // (null) — identical to live behavior since April (options-flow.js reads
    // pc_zscore in 5 places). Table DROP is a separate HARD RULE 1 decision.
    const baselineMap = {};

    // ── 7. Per-symbol with z-scores ───────────────────────────────────
    const perSymbol = sessionMetrics.map(m => {
      const baseline = baselineMap[m.symbol];
      let pcZscore = null;
      if (baseline && baseline.pc_std_20d && baseline.pc_std_20d > 0 && m.pc_ratio !== null) {
        pcZscore = (parseFloat(m.pc_ratio) - baseline.pc_mean_20d) / baseline.pc_std_20d;
      }
      return {
        symbol: m.symbol,
        company_name: m.company_name || null,    // COMPANY_NAMES_API_V1
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
      // API_BIFURCATE_V1 — context for the frontend
      data_status: {
        current_session_date: today,
        prior_session_date:   prior,
        viewing_session_date: sessionDate,
        is_viewing_today:     isToday,
        is_viewing_prior:     isPrior,
        phase:                phase,        // 'RTH' | 'GTH' | 'AFTER_HOURS_NO_GTH' | 'WEEKEND'
        rth_active:           rthActive,
        gth_active:           gthActive,
        et_hour:              etHour,
        // Hint for the UI: if viewing today during pre-market and data is
        // thin, the frontend should show the prior-session context banner
        // and offer a "View prior session" action.
        thin_pre_market: isToday && !rthActive && parseFloat(totals.total_premium) < 1e9,
      },
    });
  } catch (err) {
    console.error('flow-aggregates error:', err);
    return res.status(500).json({ error: err.message });
  }
}
