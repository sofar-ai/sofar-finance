// api/data-gaps.js
// List data gaps and take approve/reject/defer actions.
//
// Usage:
//   GET  /api/data-gaps                        — all gaps
//   GET  /api/data-gaps?status=user_review     — pending decisions only
//   GET  /api/data-gaps?tier=2                 — tier-filter
//   GET  /api/data-gaps?action=stats           — counts by status/tier
//   POST /api/data-gaps  { gap_id, action: 'approve'|'reject'|'defer', vendor?, notes? }
//       — acts on a gap; 'approve' requires vendor name

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_RESEARCH || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ error: 'GET or POST only' });
  } catch (err) {
    console.error('data-gaps error:', err);
    return res.status(500).json({ error: String(err) });
  }
}

async function handleGet(req, res) {
  const { status, tier, action, limit } = req.query;

  if (action === 'stats') {
    const byStatus = await pool.query(
      `SELECT status, COUNT(*) AS n FROM data_gaps GROUP BY status ORDER BY status`
    );
    const byTier = await pool.query(
      `SELECT tier, COUNT(*) AS n FROM data_gaps GROUP BY tier ORDER BY tier`
    );
    const pendingCost = await pool.query(
      `SELECT COALESCE(SUM(proposed_cost_monthly), 0) AS total_pending_monthly
       FROM data_gaps WHERE status = 'user_review'`
    );
    return res.status(200).json({
      by_status: byStatus.rows,
      by_tier: byTier.rows,
      pending_monthly_cost: parseFloat(pendingCost.rows[0].total_pending_monthly),
    });
  }

  const filters = [];
  const params = [];
  if (status) { params.push(status); filters.push(`status = $${params.length}`); }
  if (tier) { params.push(parseInt(tier)); filters.push(`tier = $${params.length}`); }
  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const limitN = Math.min(parseInt(limit) || 100, 500);
  params.push(limitN);

  const { rows } = await pool.query(
    `SELECT gap_id, data_description, tier, proposed_cost_monthly,
            proposed_vendors, cost_benefit_analysis, blocking_hypothesis,
            status, user_decision, user_decision_at, approved_vendor,
            user_decision_notes, created_at, updated_at
     FROM data_gaps
     ${whereClause}
     ORDER BY
       CASE status
         WHEN 'user_review' THEN 1
         WHEN 'new' THEN 2
         WHEN 'scout_implementing' THEN 3
         WHEN 'scout_failed' THEN 4
         ELSE 5
       END,
       created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return res.status(200).json({
    gaps: rows,
    count: rows.length,
  });
}

async function handlePost(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { gap_id, action, vendor, notes } = body || {};

  if (!gap_id || !action) {
    return res.status(400).json({ error: 'gap_id and action required' });
  }
  if (!['approve', 'reject', 'defer'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve, reject, or defer' });
  }
  if (action === 'approve' && !vendor) {
    return res.status(400).json({ error: 'vendor required when approving' });
  }

  // Map action to target status + user_decision
  const mapping = {
    approve: { status: 'scout_implementing', user_decision: 'approved' },
    reject:  { status: 'rejected', user_decision: 'rejected' },
    defer:   { status: 'new', user_decision: 'defer' },
  };
  const { status: newStatus, user_decision } = mapping[action];

  const { rows } = await pool.query(
    `UPDATE data_gaps
     SET status = $1,
         user_decision = $2,
         user_decision_notes = $3,
         user_decision_at = NOW(),
         approved_vendor = $4,
         updated_at = NOW()
     WHERE gap_id = $5
     RETURNING gap_id, data_description, status, user_decision, approved_vendor`,
    [newStatus, user_decision, notes || null, vendor || null, gap_id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: `gap_id ${gap_id} not found` });
  }

  return res.status(200).json({ gap: rows[0], action });
}
