import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { action } = req.query;
    if (!action || action === 'list') {
      const experiments = await sql`
        (SELECT experiment_id, signal_name, hypothesis, decision, decision_reason,
               backtest_accuracy, backtest_sharpe, vs_baseline_sharpe_delta,
               compute_time_seconds, created_at, llm_model
        FROM experiments
        WHERE decision IN ('needs_review', 'promoted')
        ORDER BY created_at DESC)
        UNION ALL
        (SELECT experiment_id, signal_name, hypothesis, decision, decision_reason,
               backtest_accuracy, backtest_sharpe, vs_baseline_sharpe_delta,
               compute_time_seconds, created_at, llm_model
        FROM experiments
        WHERE decision NOT IN ('needs_review', 'promoted')
        ORDER BY created_at DESC
        LIMIT 50)`;
      const stats = await sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE decision = 'promoted') as promoted,
          COUNT(*) FILTER (WHERE decision = 'needs_review') as needs_review,
          COUNT(*) FILTER (WHERE decision = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE decision = 'failed' OR decision IS NULL) as failed
        FROM experiments`;
      return res.json({ experiments, stats: stats[0] });
    }
    if (action === 'knowledge') {
      const knowledge = await sql`
        SELECT knowledge_type, content, confidence, created_at
        FROM experiment_knowledge
        WHERE active = TRUE
        ORDER BY created_at DESC
        LIMIT 30`;
      return res.json({ knowledge });
    }
    if (action === 'signal') {
      const id = req.query.id;
      const exp = await sql`
        SELECT * FROM experiments WHERE experiment_id = ${id}`;
      return res.json({ experiment: exp[0] || null });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
