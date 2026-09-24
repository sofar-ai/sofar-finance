// api/stream-health.js — FRONTEND_STATUS_V1 (SOF-75, operator commission 2026-09-18)
// Stream-health badge source of truth: flow_trades freshness (never socket/heartbeat).
// One indexed CTE on today's session; cached at the edge for 15 s.
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL_MARKET || process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const rows = await sql`
      WITH sd AS (SELECT fn_session_date(NOW()) AS d),
      f AS (SELECT max(ts) AS last_ts, count(*) AS n,
                   count(*) FILTER (WHERE (ts AT TIME ZONE 'America/New_York')::time >= '09:30') AS n_since_open
            FROM flow_trades WHERE session_date = (SELECT d FROM sd)),
      h AS (SELECT to_char(date_trunc('hour', ts AT TIME ZONE 'America/New_York'), 'HH24:00') AS hr,
                   count(*) AS n, count(*) FILTER (WHERE side = 'MID') AS mid
            FROM flow_trades WHERE session_date = (SELECT d FROM sd) GROUP BY 1)
      SELECT (SELECT d FROM sd)::text AS session_date,
             (SELECT last_ts FROM f) AS last_ts,
             to_char((SELECT last_ts FROM f) AT TIME ZONE 'America/New_York', 'HH24:MI') AS captured_through_et,
             (SELECT n FROM f) AS rows_today, (SELECT n_since_open FROM f) AS rows_since_open,
             round(EXTRACT(EPOCH FROM (NOW() - (SELECT last_ts FROM f))) / 60, 1) AS lag_min,
             to_char(NOW() AT TIME ZONE 'America/New_York', 'HH24:MI') AS now_et,
             EXTRACT(DOW FROM (NOW() AT TIME ZONE 'America/New_York'))::int AS dow,
             (SELECT json_agg(json_build_object('hour', hr, 'rows', n,
                       'backfilled', (n > 50 AND mid::float / n > 0.95),
                       'partial',    (n > 50 AND mid::float / n > 0.30 AND mid::float / n <= 0.95)) ORDER BY hr) FROM h) AS hours`;
    const r = rows[0] || {};
    const dow = Number(r.dow), hm = r.now_et || '';
    const rth = dow >= 1 && dow <= 5 && hm >= '09:30' && hm < '16:00';
    const lag = r.lag_min == null ? null : Number(r.lag_min);
    let state;
    if (!rth) state = 'OFF-HOURS';
    else if (lag == null || Number(r.rows_since_open || 0) === 0 || lag > 20) state = 'DEAD';
    else if (lag >= 2) state = 'LAGGING';
    else state = 'LIVE';
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json({
      state, lag_min: lag, last_ts: r.last_ts || null, captured_through_et: r.captured_through_et || null,
      rows_today: Number(r.rows_today || 0), rows_since_open: Number(r.rows_since_open || 0),
      session_date: r.session_date || null, now_et: hm, rth, hours: r.hours || [],
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'stream-health failed', detail: String(e).slice(0, 200) });
  }
}
