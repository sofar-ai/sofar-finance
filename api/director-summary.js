// api/director-summary.js
// Returns the latest daily_summaries row(s) for rendering on research.html.
//
// Usage:
//   GET /api/director-summary                  — latest of either type
//   GET /api/director-summary?type=morning     — latest morning brief
//   GET /api/director-summary?type=evening     — latest evening summary
//   GET /api/director-summary?type=morning&date=2026-04-20 — specific date
//   GET /api/director-summary?action=history&limit=7       — recent summaries list

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_RESEARCH || process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { type, date, action, limit } = req.query;

  try {
    if (action === 'history') {
      const limitN = Math.min(parseInt(limit) || 14, 90);
      const rows = await sql`
        SELECT run_id, run_type, session_date, created_at, compute_time_seconds,
               posted_to_discord,
               LENGTH(summary_markdown) AS summary_chars
        FROM daily_summaries
        ORDER BY session_date DESC, created_at DESC
        LIMIT ${limitN}
      `;
      return res.status(200).json({ summaries: rows });
    }

    let rows;
    if (date && type) {
      rows = await sql`
        SELECT run_id, run_type, session_date, summary_markdown, sections,
               input_context, director_model, compute_time_seconds,
               posted_to_discord, created_at
        FROM daily_summaries
        WHERE session_date = ${date} AND run_type = ${type}
        ORDER BY created_at DESC
        LIMIT 1
      `;
    } else if (type) {
      rows = await sql`
        SELECT run_id, run_type, session_date, summary_markdown, sections,
               input_context, director_model, compute_time_seconds,
               posted_to_discord, created_at
        FROM daily_summaries
        WHERE run_type = ${type}
        ORDER BY session_date DESC, created_at DESC
        LIMIT 1
      `;
    } else {
      rows = await sql`
        SELECT run_id, run_type, session_date, summary_markdown, sections,
               input_context, director_model, compute_time_seconds,
               posted_to_discord, created_at
        FROM daily_summaries
        ORDER BY session_date DESC, created_at DESC
        LIMIT 1
      `;
    }

    return res.status(200).json({
      summary: rows[0] || null,
      count: rows.length,
    });
  } catch (err) {
    console.error('director-summary error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
