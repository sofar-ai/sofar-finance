// /api/unusual-flow — unusual flow detection signals, grouped by symbol.
//
// Reads unusual_flow_signals for the requested session, groups by symbol so
// multi-method fires on the same symbol render as a single high-signal entry.
//
// Query params:
//   ?date=YYYY-MM-DD    exact session_date
//   ?session=prior      most recent prior real session (>$1B premium)
//   (default)           today via fn_session_date(NOW())
//
// Sentinel: UNUSUAL_FLOW_API_V1

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

    // Resolve target session — mirror flow-aggregates.js pattern
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

    const isWeekday = et_dow >= 1 && et_dow <= 5;
    const rthActive = isWeekday && et_hour >= 9 && et_hour < 16;
    const gthActive = isWeekday && (et_hour >= 20 || et_hour < 9);
    const phase = rthActive ? 'RTH'
                : gthActive ? 'GTH'
                : isWeekday ? 'AFTER_HOURS_NO_GTH'
                : 'WEEKEND';

    let sessionDate;
    if (requestedDate) {
      sessionDate = requestedDate;
    } else if (requestedSession === 'prior') {
      sessionDate = prior_sd || today_sd;
    } else {
      sessionDate = today_sd;
    }
    const isToday = sessionDate === today_sd;

    // Pull all signals for the session. Include latest detections first so
    // per-symbol grouping naturally keeps most recent on top when scores tie.
    const rows = await sql`
      SELECT signal_id, symbol, method,
             score::float          AS score,
             actual_value::float   AS actual_value,
             threshold_hit::float  AS threshold_hit,
             direction,
             premium_snapshot::float AS premium_snapshot,
             trigger_details,
             detected_at,
             first_detected_at,
             update_count
      FROM unusual_flow_signals
      WHERE session_date = ${sessionDate}
      ORDER BY score DESC, detected_at DESC
    `;

    // Group by symbol
    const bySymbol = new Map();
    const byMethod = {};
    for (const r of rows) {
      byMethod[r.method] = (byMethod[r.method] || 0) + 1;
      if (!bySymbol.has(r.symbol)) {
        bySymbol.set(r.symbol, {
          symbol: r.symbol,
          max_score: r.score,
          premium_usd: r.premium_snapshot,
          methods: [],
          dominant_direction: r.direction,
          direction_counts: { BUY_SKEW: 0, SELL_SKEW: 0, MIXED: 0 },
          detections: [],
          first_detected_at: r.first_detected_at,
          last_detected_at: r.detected_at,
        });
      }
      const s = bySymbol.get(r.symbol);
      if (r.score > s.max_score) s.max_score = r.score;
      if (!s.methods.includes(r.method)) s.methods.push(r.method);
      const dir = r.direction || 'MIXED';
      s.direction_counts[dir] = (s.direction_counts[dir] || 0) + 1;
      if (r.detected_at > s.last_detected_at) s.last_detected_at = r.detected_at;
      if (r.first_detected_at && (!s.first_detected_at || r.first_detected_at < s.first_detected_at)) {
        s.first_detected_at = r.first_detected_at;
      }
      s.detections.push({
        method: r.method,
        score: Math.round(r.score * 10) / 10,
        direction: r.direction,
        actual_value: r.actual_value,
        threshold_hit: r.threshold_hit,
        trigger_details: r.trigger_details,
        detected_at: r.detected_at,
        update_count: r.update_count,
      });
    }

    // Resolve dominant_direction from counts (majority wins; ties → MIXED)
    for (const s of bySymbol.values()) {
      const dc = s.direction_counts;
      const sorted = Object.entries(dc).sort((a, b) => b[1] - a[1]);
      s.dominant_direction = (sorted[0][1] > (sorted[1]?.[1] || 0)) ? sorted[0][0] : 'MIXED';
      s.methods.sort();
    }

    // Sort symbols by max_score desc, then by multi-method-fire bonus
    const signals = Array.from(bySymbol.values()).sort((a, b) => {
      // Multi-method fires rank higher at same score
      if (b.methods.length !== a.methods.length) {
        if (Math.abs(b.max_score - a.max_score) < 0.5) {
          return b.methods.length - a.methods.length;
        }
      }
      return b.max_score - a.max_score;
    });

    res.status(200).json({
      session_date: sessionDate,
      today_session: today_sd,
      prior_session: prior_sd,
      is_today: isToday,
      data_status: { phase, et_hour, et_dow, rth_active: rthActive, gth_active: gthActive },
      totals: {
        detections: rows.length,
        distinct_symbols: bySymbol.size,
        by_method: byMethod,
      },
      signals,
      generated_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[unusual-flow]', err);
    res.status(500).json({ error: err.message || String(err) });
  }
}
