/**
 * News Feed Component — sofar-finance
 * Reads from /headlines.json (updated every 6h by cron + GitHub push)
 * Vercel auto-deploys on each push.
 */

const NewsFeed = (() => {
  const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  let refreshTimer = null;

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date)) {
      // Try RFC 2822 (pubDate format)
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
    card.innerHTML = `
      <div class="news-card-top">
        <span class="news-source">${escapeHtml(item.source)}</span>
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

  async function load(containerId, timestampId) {
    const container = document.getElementById(containerId);
    const tsEl = document.getElementById(timestampId);
    if (!container) return;

    container.innerHTML = '<div class="news-loading">[ FETCHING MARKETS DATA... ]</div>';

    try {
      // Cache-bust so we always get the freshest file
      const res = await fetch(`/headlines.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = data.items || [];

      container.innerHTML = '';
      if (items.length === 0) {
        container.innerHTML = '<div class="news-error">⚠ No headlines available. Retrying next refresh.</div>';
      } else {
        items.forEach(item => container.appendChild(renderCard(item)));
      }
      setRefreshedTime(tsEl, data.fetched_at);
    } catch (e) {
      container.innerHTML = `<div class="news-error">⚠ Could not load headlines.json — ${e.message}</div>`;
      console.error('[NewsFeed]', e);
    }
  }

  function init(containerId, timestampId) {
    load(containerId, timestampId);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => load(containerId, timestampId), REFRESH_INTERVAL_MS);
    const btn = document.getElementById('btn-refresh-news');
    if (btn) btn.addEventListener('click', () => load(containerId, timestampId));
  }

  return { init };
})();
