// api/list-snapshots.js — Returns list of synthesis snapshot filenames from GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'sofar-ai/sofar-finance';
const API_BASE     = `https://api.github.com/repos/${GITHUB_REPO}/contents/data/synthesis-snapshots`;

const GH_HEADERS = () => ({
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept':        'application/vnd.github.v3+json',
  'User-Agent':    'sofar-finance-audit',
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  try {
    const r = await fetch(API_BASE, { headers: GH_HEADERS() });
    if (!r.ok) return res.status(r.status).json({ error: `GitHub error ${r.status}` });
    const files = await r.json();
    const names = (Array.isArray(files) ? files : [])
      .filter(f => f.name?.endsWith('.json'))
      .map(f => f.name)
      .sort()
      .slice(-30);  // last 30
    return res.status(200).json({ files: names });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
