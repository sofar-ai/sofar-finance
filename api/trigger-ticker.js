// api/trigger-ticker.js — Ticker deep-dive trigger
// POST {ticker} → writes ticker-analysis request to refresh-trigger.json
// GET  → returns current trigger state

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'sofar-ai/sofar-finance';
const FILE_PATH    = 'data/refresh-trigger.json';
const API_URL      = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;

const GH_HEADERS = () => ({
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'sofar-finance-trigger',
  'Content-Type': 'application/json',
});

async function getFile() {
  const res = await fetch(API_URL, { headers: GH_HEADERS() });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  return { content, sha: data.sha };
}

async function putFile(content, sha, message) {
  const body = JSON.stringify({
    message,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
    sha,
  });
  const res = await fetch(API_URL, { method: 'PUT', headers: GH_HEADERS(), body });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT failed: ${res.status} — ${err}`);
  }
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not set in Vercel environment' });
  }

  try {
    if (req.method === 'GET') {
      const { content } = await getFile();
      return res.status(200).json(content);
    }

    if (req.method === 'POST') {
      const body   = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const ticker = (body.ticker || '').toUpperCase().trim().replace(/^\$/, '');
      if (!ticker) return res.status(400).json({ error: 'ticker required' });

      const { content, sha } = await getFile();
      const newRequest = {
        state:        'pending',
        type:         'ticker-analysis',
        ticker,
        requested_at: new Date().toISOString(),
        completed_at: null,
        message:      null,
      };

      const busy = content.state === 'pending' || content.state === 'running';
      if (busy) {
        // Queue it — don't overwrite the in-progress job
        const queue = content.queue || [];
        // Deduplicate: don't queue same ticker twice
        if (!queue.some(q => q.type === 'ticker-analysis' && q.ticker === ticker)) {
          queue.push(newRequest);
          content.queue = queue;
          await putFile(content, sha, `trigger: queued ticker-analysis ${ticker}`);
        }
        return res.status(202).json({ ...newRequest, _note: 'queued', _current: content });
      }

      // Not busy — write directly, preserve any existing queue
      const updated = { ...newRequest, queue: content.queue || [] };
      await putFile(updated, sha, `trigger: ticker-analysis ${ticker}`);
      return res.status(202).json(updated);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[trigger-ticker]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
