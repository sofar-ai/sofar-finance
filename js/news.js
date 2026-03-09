/**
 * News Feed Component — sofar-finance
 * Reads from:
 *   - /headlines.json (RSS feeds via cron)
 *   - /headlines-x.json (X.com tweets via Puppeteer + cron)
 * Both updated every 6h and auto-deployed via Vercel
 */

const NewsFeed = (() => {
  const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  let refreshTimer = null;

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date)) {
      try {
        const d = new Date(Date.parse(dateStr));
        if (!isNaN(d)) return formatRelativeTime(d.toISOString());
      } catch {}
      return '';
    }
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderCard(item) {
    const card = document.createElement('a');
    card.className = 'news-card';
    card.href = item.link || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    
    const sourceLabel = item.source === 'X' ? item.author : item.source;
    
    card.innerHTML = `
      <div class="news-card-top">
        <span class="news-source">${escapeHtml(sourceLabel)}</span>
        <span class="news-timestamp">${formatRelativeTime(item.timestamp)}</span>
      </div>
      <div class="news-headline">${escapeHtml(item.headline)}</div>
    `;
    return card;
  }

  function setRefreshedTime(el, fetchedAt) {
    if (!el) return;
    const t = fetchedAt ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    el.textContent = `Last refreshed: ${t}`;
  }

  async function loadBoth(containerId, timestampId) {
    const container = document.getElementById(containerId);
    const tsEl = document.getElementById(timestampId);
    if (!container) return;

    container.innerHTML = '<div class="news-loading">[ FETCHING HEADLINES... ]</div>';

    try {
      // Fetch both sources in parallel
      const [rssRes, xRes] = await Promise.all([
        fetch(`/headlines.json?v=${Date.now()}`).catch(() => ({ok: false})),
        fetch(`/headlines-x.json?v=${Date.now()}`).catch(() => ({ok: false}))
      ]);

      let allItems = [];
      let latestFetch = null;

      if (rssRes.ok) {
        const rssData = await rssRes.json();
        allItems.push(...(rssData.items || []));
        if (!latestFetch) latestFetch = rssData.fetched_at;
      }

      if (xRes.ok) {
        const xData = await xRes.json();
        allItems.push(...(xData.items || []));
        if (!latestFetch) latestFetch = xData.fetched_at;
      }

      // Sort by timestamp (newest first)
      allItems.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime() || 0;
        const tb = new Date(b.timestamp).getTime() || 0;
        return tb - ta;
      });

      // Deduplicate
      const seen = new Set();
      allItems = allItems.filter(item => {
        const key = item.headline.slice(0, 60).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      container.innerHTML = '';
      if (allItems.length === 0) {
        container.innerHTML = '<div class="news-error">⚠ No headlines available. Check back soon.</div>';
      } else {
        allItems.slice(0, 50).forEach(item => container.appendChild(renderCard(item)));
      }
      
      setRefreshedTime(tsEl, latestFetch);
    } catch (e) {
      container.innerHTML = `<div class="news-error">⚠ Could not load headlines — ${e.message}</div>`;
      console.error('[NewsFeed]', e);
    }
  }

  function init(containerId, timestampId) {
    loadBoth(containerId, timestampId);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadBoth(containerId, timestampId), REFRESH_INTERVAL_MS);
    const btn = document.getElementById('btn-refresh-news');
    if (btn) btn.addEventListener('click', () => loadBoth(containerId, timestampId));
  }

  return { init };
})();
