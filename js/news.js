/**
 * News Feed Component — sofar-finance
 * Fetches from multiple RSS sources via rss2json proxy (no backend needed)
 * Auto-refreshes every 6 hours
 */

const NewsFeed = (() => {
  const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

  const FEEDS = [
    {
      url: 'https://feeds.marketwatch.com/marketwatch/topstories/',
      source: 'MarketWatch',
    },
    {
      url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/',
      source: 'MW Markets',
    },
    {
      url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
      source: 'WSJ Markets',
    },
    {
      url: 'https://search.cnbc.com/rs/search/combinedcsvfeed?id=100003114&partnerId=wrss01&hasCBSId=1',
      source: 'CNBC',
    },
  ];

  let refreshTimer = null;

  function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date)) return '';
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  async function fetchFeed(feed) {
    try {
      const res = await fetch(RSS2JSON + encodeURIComponent(feed.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== 'ok') throw new Error('Feed error');
      return (data.items || []).map(item => ({
        source: feed.source,
        headline: item.title,
        timestamp: item.pubDate,
        link: item.link,
      }));
    } catch (e) {
      console.warn(`[NewsFeed] Failed to fetch ${feed.source}:`, e.message);
      return [];
    }
  }

  async function fetchAll() {
    const results = await Promise.allSettled(FEEDS.map(fetchFeed));
    const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    // Sort newest first
    all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Deduplicate by headline similarity
    const seen = new Set();
    return all.filter(item => {
      const key = item.headline.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function renderCard(item) {
    const card = document.createElement('a');
    card.className = 'news-card';
    card.href = item.link || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    card.innerHTML = `
      <div class="news-card-top">
        <span class="news-source">${escapeHtml(item.source)}</span>
        <span class="news-timestamp">${formatRelativeTime(item.timestamp)}</span>
      </div>
      <div class="news-headline">${escapeHtml(item.headline)}</div>
    `;
    return card;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setRefreshedTime(el) {
    if (!el) return;
    el.textContent = 'Last refreshed: ' + new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit'
    });
  }

  async function load(containerId, timestampId) {
    const container = document.getElementById(containerId);
    const tsEl = document.getElementById(timestampId);
    if (!container) return;

    container.innerHTML = '<div class="news-loading">[ FETCHING MARKETS DATA... ]</div>';

    const items = await fetchAll();

    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = '<div class="news-error">⚠ Unable to load feed data. Retrying next refresh.</div>';
    } else {
      items.slice(0, 30).forEach(item => container.appendChild(renderCard(item)));
    }

    setRefreshedTime(tsEl);
  }

  function init(containerId, timestampId) {
    load(containerId, timestampId);

    // Auto-refresh every 6 hours
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => load(containerId, timestampId), REFRESH_INTERVAL_MS);

    // Manual refresh button
    const btn = document.getElementById('btn-refresh-news');
    if (btn) btn.addEventListener('click', () => load(containerId, timestampId));
  }

  return { init };
})();
