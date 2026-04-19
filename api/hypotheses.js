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
//       — creates a new hypothesis (proposer='human', status='proposed')

import { Pool } from 'pg';
import crypto from 'crypto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_RESEARCH || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function generateHypothesisId(prefix = 'hyp-human-web') {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const short = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${ts}-${short}`;
}

export default async function handler(req, res) {
  setCors(res);
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

  // Stats
  if (action === 'stats') {
    const byStatus = await pool.query(
      `SELECT status, COUNT(*) AS n FROM hypotheses GROUP BY status ORDER BY status`
    );
    const byProposer = await pool.query(
      `SELECT proposer, COUNT(*) AS n FROM hypotheses GROUP BY proposer ORDER BY proposer`
    );
    const byPriority = await pool.query(
      `SELECT priority, COUNT(*) AS n FROM hypotheses
       WHERE status NOT IN ('promoted', 'rejected', 'parked')
       GROUP BY priority ORDER BY priority`
    );
    return res.status(200).json({
      by_status: byStatus.rows,
      by_proposer: byProposer.rows,
      by_priority_active: byPriority.rows,
    });
  }

  // Single hypothesis
  if (id) {
    const { rows } = await pool.query(
      `SELECT * FROM hypotheses WHERE hypothesis_id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });

    // Also fetch any experiments linked to this hypothesis
    let experiments = [];
    if (rows[0].experiment_ids && rows[0].experiment_ids.length > 0) {
      const exp = await pool.query(
        `SELECT experiment_id, signal_name, decision, backtest_sharpe,
                vs_baseline_sharpe_delta, created_at
         FROM experiments
         WHERE experiment_id = ANY($1)
         ORDER BY created_at DESC`,
        [rows[0].experiment_ids]
      );
      experiments = exp.rows;
    }

    return res.status(200).json({ hypothesis: rows[0], experiments });
  }

  // List with filters
  const filters = [];
  const params = [];
  if (status) { params.push(status); filters.push(`status = $${params.length}`); }
  if (proposer) { params.push(proposer); filters.push(`proposer = $${params.length}`); }
  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const limitN = Math.min(parseInt(limit) || 200, 1000);
  params.push(limitN);

  const { rows } = await pool.query(
    `SELECT hypothesis_id, text, rationale, proposer, parent_hypothesis,
            priority, tags, required_tables, status, status_reason,
            experiment_ids, created_at, updated_at
     FROM hypotheses
     ${whereClause}
     ORDER BY
       CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                     WHEN 'normal' THEN 3 ELSE 4 END,
       created_at DESC
     LIMIT $${params.length}`,
    params
  );

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

  const { rows } = await pool.query(
    `INSERT INTO hypotheses (
       hypothesis_id, text, rationale, proposer, parent_hypothesis,
       priority, tags, required_tables, status
     )
     VALUES ($1, $2, $3, 'human-web', $4, $5, $6, $7, 'proposed')
     RETURNING hypothesis_id, text, priority, status, created_at`,
    [hypothesis_id, text.trim(), rationale, parent,
     priority, tags, required_tables]
  );

  return res.status(201).json({ hypothesis: rows[0] });
}
