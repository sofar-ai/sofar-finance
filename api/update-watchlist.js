// api/update-watchlist.js — Read/write watchlist.json via GitHub
// GET  → returns current watchlist
// POST → {tickers: [...]} → validates and writes watchlist.json

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'sofar-ai/sofar-finance';
const FILE_PATH    = 'data/watchlist.json';
const API_URL      = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;

const ALWAYS_INCLUDE = ['SPY', 'QQQ'];  // cannot be removed
const MAX_TICKERS    = 30;
const TICKER_RE      = /^[A-Z]{1,6}(\.[A-Z]{1,2})?$/;

const GH_HEADERS = () => ({
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'sofar-finance-config',
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
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      let tickers = (body.tickers || []).map(t => t.toUpperCase().trim().replace(/^\$/, ''));

      // Validate
      const invalid = tickers.filter(t => !TICKER_RE.test(t));
      if (invalid.length) {
        return res.status(400).json({ error: `Invalid ticker(s): ${invalid.join(', ')}` });
      }
      if (tickers.length > MAX_TICKERS) {
        return res.status(400).json({ error: `Max ${MAX_TICKERS} tickers allowed` });
      }

      // Always include SPY/QQQ, deduplicate, preserve order
      for (const t of ALWAYS_INCLUDE) {
        if (!tickers.includes(t)) tickers.unshift(t);
      }
      tickers = [...new Set(tickers)];

      const { sha } = await getFile();
      const updated = { tickers, updated_at: new Date().toISOString() };
      await putFile(updated, sha, `config: update watchlist (${tickers.length} tickers)`);
      return res.status(200).json(updated);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[update-watchlist]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
