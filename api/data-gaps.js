// api/data-gaps.js
// List data gaps and take approve/reject/defer actions.
//
// Usage:
//   GET  /api/data-gaps                        — all gaps
//   GET  /api/data-gaps?status=user_review     — pending decisions only
//   GET  /api/data-gaps?tier=2                 — tier-filter
//   GET  /api/data-gaps?action=stats           — counts by status/tier
//   POST /api/data-gaps  { gap_id, action: 'approve'|'reject'|'defer', vendor?, notes? }

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_RESEARCH || process.env.DATABASE_URL);

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
    console.error('data-gaps error:', err);
    return res.status(500).json({ error: String(err) });
  }
}

async function handleGet(req, res) {
  const { status, tier, action, limit } = req.query;

  if (action === 'stats') {
    const byStatus = await sql`
      SELECT status, COUNT(*)::int AS n
      FROM data_gaps GROUP BY status ORDER BY status
    `;
    const byTier = await sql`
      SELECT tier, COUNT(*)::int AS n
      FROM data_gaps GROUP BY tier ORDER BY tier
    `;
    const pendingCost = await sql`
      SELECT COALESCE(SUM(proposed_cost_monthly), 0)::float AS total_pending_monthly
      FROM data_gaps WHERE status = 'user_review'
    `;
    return res.status(200).json({
      by_status: byStatus,
      by_tier: byTier,
      pending_monthly_cost: pendingCost[0]?.total_pending_monthly || 0,
    });
  }

  const limitN = Math.min(parseInt(limit) || 100, 500);
  let rows;

  if (status && tier) {
    const tierN = parseInt(tier);
    rows = await sql`
      SELECT gap_id, data_description, tier, proposed_cost_monthly,
             proposed_vendors, cost_benefit_analysis, blocking_hypothesis,
             status, user_decision, user_decision_at, approved_vendor,
             user_decision_notes, created_at, updated_at
      FROM data_gaps
      WHERE status = ${status} AND tier = ${tierN}
      ORDER BY
        CASE status WHEN 'user_review' THEN 1 WHEN 'new' THEN 2
                    WHEN 'scout_implementing' THEN 3 WHEN 'scout_failed' THEN 4
                    ELSE 5 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  } else if (status) {
    rows = await sql`
      SELECT gap_id, data_description, tier, proposed_cost_monthly,
             proposed_vendors, cost_benefit_analysis, blocking_hypothesis,
             status, user_decision, user_decision_at, approved_vendor,
             user_decision_notes, created_at, updated_at
      FROM data_gaps
      WHERE status = ${status}
      ORDER BY
        CASE status WHEN 'user_review' THEN 1 WHEN 'new' THEN 2
                    WHEN 'scout_implementing' THEN 3 WHEN 'scout_failed' THEN 4
                    ELSE 5 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  } else if (tier) {
    const tierN = parseInt(tier);
    rows = await sql`
      SELECT gap_id, data_description, tier, proposed_cost_monthly,
             proposed_vendors, cost_benefit_analysis, blocking_hypothesis,
             status, user_decision, user_decision_at, approved_vendor,
             user_decision_notes, created_at, updated_at
      FROM data_gaps
      WHERE tier = ${tierN}
      ORDER BY
        CASE status WHEN 'user_review' THEN 1 WHEN 'new' THEN 2
                    WHEN 'scout_implementing' THEN 3 WHEN 'scout_failed' THEN 4
                    ELSE 5 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  } else {
    rows = await sql`
      SELECT gap_id, data_description, tier, proposed_cost_monthly,
             proposed_vendors, cost_benefit_analysis, blocking_hypothesis,
             status, user_decision, user_decision_at, approved_vendor,
             user_decision_notes, created_at, updated_at
      FROM data_gaps
      ORDER BY
        CASE status WHEN 'user_review' THEN 1 WHEN 'new' THEN 2
                    WHEN 'scout_implementing' THEN 3 WHEN 'scout_failed' THEN 4
                    ELSE 5 END,
        created_at DESC
      LIMIT ${limitN}
    `;
  }

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

  const mapping = {
    approve: { status: 'scout_implementing', user_decision: 'approved' },
    reject:  { status: 'rejected', user_decision: 'rejected' },
    defer:   { status: 'new', user_decision: 'defer' },
  };
  const { status: newStatus, user_decision } = mapping[action];
  const gapIdN = parseInt(gap_id);

  const rows = await sql`
    UPDATE data_gaps
    SET status = ${newStatus},
        user_decision = ${user_decision},
        user_decision_notes = ${notes || null},
        user_decision_at = NOW(),
        approved_vendor = ${vendor || null},
        updated_at = NOW()
    WHERE gap_id = ${gapIdN}
    RETURNING gap_id, data_description, status, user_decision, approved_vendor
  `;

  if (rows.length === 0) {
    return res.status(404).json({ error: `gap_id ${gap_id} not found` });
  }

  return res.status(200).json({ gap: rows[0], action });
}
