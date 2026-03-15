// api/trigger-event-tree.js — Event tree trigger endpoint
// GET  → returns current trigger state
// POST → writes action (generate|curate|activate|archive|regenerate) to GitHub

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'sofar-ai/sofar-finance';
const TRIGGER_PATH = 'data/event-tree-trigger.json';
const TREES_PATH   = 'data/event-trees.json';
const API_BASE     = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

const GH_HEADERS = () => ({
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'sofar-finance-events',
  'Content-Type': 'application/json',
});

async function getFile(path) {
  const res = await fetch(`${API_BASE}/${path}`, { headers: GH_HEADERS() });
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  return { content, sha: data.sha };
}

async function putFile(path, content, sha, message) {
  const body = JSON.stringify({
    message,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
    sha,
  });
  const res = await fetch(`${API_BASE}/${path}`, { method: 'PUT', headers: GH_HEADERS(), body });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${path} failed: ${res.status} — ${err}`);
  }
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  try {
    if (req.method === 'GET') {
      const action = req.query?.action;
      if (action === 'trees') {
        const { content } = await getFile(TREES_PATH);
        return res.status(200).json(content);
      }
      const { content } = await getFile(TRIGGER_PATH);
      return res.status(200).json(content);
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { action, event_id, root_label, changes } = body;
      const VALID_ACTIONS = ['generate', 'curate', 'activate', 'archive', 'regenerate', 'delete'];
      if (!action || !VALID_ACTIONS.includes(action)) {
        return res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
      }

      const { content: trigger, sha } = await getFile(TRIGGER_PATH);
      if (trigger.state === 'pending' || trigger.state === 'running') {
        return res.status(200).json({ ...trigger, _note: 'already_in_progress' });
      }

      const updated = {
        state:        'pending',
        action,
        event_id:     event_id || null,
        root_label:   root_label || null,
        changes:      changes || null,
        requested_at: new Date().toISOString(),
        processed_at: null,
      };
      await putFile(TRIGGER_PATH, updated, sha, `event-trigger: ${action}`);
      return res.status(202).json(updated);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[trigger-event-tree]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
