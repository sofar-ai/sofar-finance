// api/director-summary.js
// Returns the latest daily_summaries row(s) for rendering on research.html.
//
// Usage:
//   GET /api/director-summary                  — latest of either type
//   GET /api/director-summary?type=morning     — latest morning brief
//   GET /api/director-summary?type=evening     — latest evening summary
//   GET /api/director-summary?type=morning&date=2026-04-20 — specific date
//   GET /api/director-summary?action=history&limit=7       — recent summaries list
//
// Response shape:
//   {
//     summary: { run_id, run_type, session_date, summary_markdown, sections, ... } | null
//   }
// or for history:
//   { summaries: [ { run_id, run_type, session_date, created_at }, ... ] }

import { Pool } from 'pg';

// Research DB (sofar-research Neon project)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_RESEARCH || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { type, date, action, limit } = req.query;

  try {
    // --- History mode: list recent summaries ---
    if (action === 'history') {
      const limitN = Math.min(parseInt(limit) || 14, 90);
      const { rows } = await pool.query(
        `SELECT run_id, run_type, session_date, created_at, compute_time_seconds,
                posted_to_discord,
                LENGTH(summary_markdown) AS summary_chars
         FROM daily_summaries
         ORDER BY session_date DESC, created_at DESC
         LIMIT $1`,
        [limitN]
      );
      return res.status(200).json({ summaries: rows });
    }

    // --- Fetch specific or latest ---
    let query, params;
    if (date && type) {
      // Specific run
      query = `SELECT run_id, run_type, session_date, summary_markdown, sections,
                      input_context, director_model, compute_time_seconds,
                      posted_to_discord, created_at
               FROM daily_summaries
               WHERE session_date = $1 AND run_type = $2
               ORDER BY created_at DESC
               LIMIT 1`;
      params = [date, type];
    } else if (type) {
      // Latest of given type
      query = `SELECT run_id, run_type, session_date, summary_markdown, sections,
                      input_context, director_model, compute_time_seconds,
                      posted_to_discord, created_at
               FROM daily_summaries
               WHERE run_type = $1
               ORDER BY session_date DESC, created_at DESC
               LIMIT 1`;
      params = [type];
    } else {
      // Latest overall
      query = `SELECT run_id, run_type, session_date, summary_markdown, sections,
                      input_context, director_model, compute_time_seconds,
                      posted_to_discord, created_at
               FROM daily_summaries
               ORDER BY session_date DESC, created_at DESC
               LIMIT 1`;
      params = [];
    }

    const { rows } = await pool.query(query, params);
    return res.status(200).json({
      summary: rows[0] || null,
      count: rows.length,
    });
  } catch (err) {
    console.error('director-summary error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
