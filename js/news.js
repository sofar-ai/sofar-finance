/**
 * NewsFeed — RSS headlines + separate 𝕏 posts section
 *   - /headlines.json (RSS feeds via cron)
 *   - /headlines-x.json (X.com curated accounts via Puppeteer + cron)
 */

const NewsFeed = (() => {
  const REFRESH_INTERVAL_MS = 6 * 60 * 1000;
  let refreshTimer = null;

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
      const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
      if (diff < 1)   return 'just now';
      if (diff < 60)  return `${diff}m ago`;
      const h = Math.floor(diff / 60);
      if (h < 24)     return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    } catch { return ''; }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function renderCard(item, isX) {
    const card = document.createElement('a');
    card.className = 'news-card' + (isX ? ' news-card-x' : '');
    card.href = item.link || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    const sourceLabel = isX ? '𝕏' : item.source;
    card.innerHTML = `
      <div class="news-card-top">
        <span class="news-source${isX ? ' news-source-x' : ''}">${escapeHtml(sourceLabel)}</span>
        <span class="news-timestamp">${formatRelativeTime(item.timestamp)}</span>
      </div>
      <div class="news-headline">${escapeHtml(item.headline)}</div>`;
    return card;
  }

  function setRefreshedTime(el, fetchedAt) {
    if (!el) return;
    const t = fetchedAt ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    el.textContent = `Updated ${t}`;
  }

  async function loadBoth(containerId, timestampId) {
    const container = document.getElementById(containerId);
    const tsEl      = document.getElementById(timestampId);
    if (!container) return;

    container.innerHTML = '<div class="news-loading">[ FETCHING HEADLINES... ]</div>';

    try {
      const [rssRes, xRes] = await Promise.all([
        fetch(`/headlines.json?v=${Date.now()}`).catch(() => ({ ok: false })),
        fetch(`/headlines-x.json?v=${Date.now()}`).catch(() => ({ ok: false })),
      ]);

      let rssItems = [];
      let xItems   = [];
      let latestFetch = null;

      if (rssRes.ok) {
        const rssData = await rssRes.json();
        rssItems = rssData.items || [];
        latestFetch = rssData.fetched_at;
      }

      if (xRes.ok) {
        const xData = await xRes.json();
        xItems = xData.items || [];
        if (!latestFetch) latestFetch = xData.fetched_at;
      }

      setRefreshedTime(tsEl, latestFetch);

      // Sort RSS by timestamp
      rssItems.sort((a, b) => {
        try { return new Date(b.timestamp) - new Date(a.timestamp); }
        catch { return 0; }
      });
      // Deduplicate RSS by headline prefix
      const seen = new Set();
      rssItems = rssItems.filter(item => {
        const key = (item.headline || '').slice(0, 60).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      container.innerHTML = '';

      // ── RSS headlines section ──────────────────────────────────────────────
      if (rssItems.length === 0) {
        container.innerHTML = '<div class="news-error">⚠ No headlines available.</div>';
      } else {
        rssItems.slice(0, 40).forEach(item => container.appendChild(renderCard(item, false)));
      }

      // ── 𝕏 Posts section ───────────────────────────────────────────────────
      if (xItems.length > 0) {
        const xSection = document.createElement('div');
        xSection.className = 'news-x-section';
        xSection.innerHTML = `<div class="news-x-header"><span class="news-x-icon">𝕏</span> Posts</div>`;
        xItems.slice(0, 15).forEach(item => xSection.appendChild(renderCard(item, true)));
        container.appendChild(xSection);
      }

    } catch (e) {
      container.innerHTML = `<div class="news-error">⚠ Could not load headlines — ${e.message}</div>`;
    }
  }

  function init(containerId, timestampId) {
    loadBoth(containerId, timestampId);
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadBoth(containerId, timestampId), REFRESH_INTERVAL_MS);
    const btn = document.getElementById('btn-refresh-news');
    if (btn) btn.addEventListener('click', () => loadBoth(containerId, timestampId));
  }

  return { init };
})();
