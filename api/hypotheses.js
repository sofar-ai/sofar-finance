// api/hypotheses.js
// List, filter, and create hypotheses.
//
// Usage:
//   GET  /api/hypotheses                                   — all hypotheses, grouped by status
//   GET  /api/hypotheses?status=pending_experiment          — filter by status
//   GET  /api/hypotheses?proposer=human                     — filter by proposer
//   GET  /api/hypotheses?id=hyp-human-20260419-abc12345     — single hypothesis + its experiments
//   GET  /api/hypotheses?action=stats                       — counts by status/proposer/priority
//   POST /api/hypotheses  { text, rationale?, priority?, tags?, required_tables?, parent? }

import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const sql = neon(process.env.DATABASE_URL_RESEARCH || process.env.DATABASE_URL);

function generateHypothesisId(prefix = 'hyp-human-web') {
  const ts = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '-');
  const short = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${ts}-${short}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ error: 'GET or POST only' });
  } catch (err) {
    console.error('hypotheses error:', err);
    return res.status(500).json({ error: String(err) });
  }
}

async function handleGet(req, res) {
  const { id, status, proposer, action, limit } = req.query;

  if (action === 'stats') {
    const byStatus = await sql`
      SELECT status, COUNT(*)::int AS n
      FROM hypotheses GROUP BY status ORDER BY status
    `;
    const byProposer = await sql`
      SELECT proposer, COUNT(*)::int AS n
      FROM hypotheses GROUP BY proposer ORDER BY proposer
    `;
    const byPriority = await sql`
      SELECT priority, COUNT(*)::int AS n
      FROM hypotheses
      WHERE status NOT IN ('promoted', 'rejected', 'parked')
      GROUP BY priority ORDER BY priority
    `;
    return res.status(200).json({
      by_status: byStatus,
      by_proposer: byProposer,
      by_priority_active: byPriority,
    });
  }

  if (id) {
    const rows = await sql`
      SELECT * FROM hypotheses WHERE hypothesis_id = ${id}
    `;
    if (!rows[0]) return res.status(404).json({ error: 'not found' });

    let experiments = [];
    if (rows[0].experiment_ids && rows[0].experiment_ids.length > 0) {
      experiments = await sql`
        SELECT experiment_id, signal_name, decision, backtest_sharpe,
               vs_baseline_sharpe_delta, created_at
        FROM experiments
        WHERE experiment_id = ANY(${rows[0].experiment_ids})
        ORDER BY created_at DESC
      `;
    }

    return res.status(200).json({ hypothesis: rows[0], experiments });
  }

  // List with filters — construct query via conditional branches (tagged template
  // literals don't support dynamic WHERE composition easily)
  const limitN = Math.min(parseInt(limit) || 200, 1000);
  let rows;

  if (status && proposer) {
    rows = await sql`
      SELECT hypothesis_id, text, rationale, proposer, parent_hypothesis,
             priority, tags, required_tables, status, status_reason,
             experiment_ids, created_at, updated_at
      FROM hypotheses
      WHERE status = ${status} AND proposer = ${proposer}
      ORDER BY
        CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                      WHEN 'normal' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  } else if (status) {
    rows = await sql`
      SELECT hypothesis_id, text, rationale, proposer, parent_hypothesis,
             priority, tags, required_tables, status, status_reason,
             experiment_ids, created_at, updated_at
      FROM hypotheses
      WHERE status = ${status}
      ORDER BY
        CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                      WHEN 'normal' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  } else if (proposer) {
    rows = await sql`
      SELECT hypothesis_id, text, rationale, proposer, parent_hypothesis,
             priority, tags, required_tables, status, status_reason,
             experiment_ids, created_at, updated_at
      FROM hypotheses
      WHERE proposer = ${proposer}
      ORDER BY
        CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                      WHEN 'normal' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  } else {
    rows = await sql`
      SELECT hypothesis_id, text, rationale, proposer, parent_hypothesis,
             priority, tags, required_tables, status, status_reason,
             experiment_ids, created_at, updated_at
      FROM hypotheses
      ORDER BY
        CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                      WHEN 'normal' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  }

  return res.status(200).json({
    hypotheses: rows,
    count: rows.length,
  });
}

async function handlePost(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    text,
    rationale = null,
    priority = 'normal',
    tags = [],
    required_tables = [],
    parent = null,
  } = body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 10) {
    return res.status(400).json({ error: 'text required (min 10 chars)' });
  }
  if (!['urgent', 'high', 'normal', 'low'].includes(priority)) {
    return res.status(400).json({ error: 'invalid priority' });
  }

  const hypothesis_id = generateHypothesisId();

  const rows = await sql`
    INSERT INTO hypotheses (
      hypothesis_id, text, rationale, proposer, parent_hypothesis,
      priority, tags, required_tables, status
    )
    VALUES (
      ${hypothesis_id}, ${text.trim()}, ${rationale}, 'human-web', ${parent},
      ${priority}, ${tags}, ${required_tables}, 'proposed'
    )
    RETURNING hypothesis_id, text, priority, status, created_at
  `;

  return res.status(201).json({ hypothesis: rows[0] });
}
