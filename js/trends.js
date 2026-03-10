/**
 * Trends Component — sofar-finance
 * Reads from /trends.json (analyzed every 6h alongside headlines)
 * Displays key news themes ranked by prominence score
 */

const TrendsFeed = (() => {
  const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let refreshTimer = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPostCount(n) {
    if (!n) return null;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M posts`;
    if (n >= 1000) return `${Math.round(n / 1000)}K posts`;
    return `${n} posts`;
  }

  function prominenceClass(score) {
    if (score >= 85) return 'trend-critical';
    if (score >= 65) return 'trend-high';
    if (score >= 40) return 'trend-medium';
    return 'trend-low';
  }

  function renderTrendCard(trend) {
    const card = document.createElement('div');
    card.className = `trend-card ${prominenceClass(trend.prominence)}`;

    const postCount = trend.x_posts ? formatPostCount(trend.x_posts) : null;
    const sourcesStr = (trend.sources || []).slice(0, 4).join(' · ');

    card.innerHTML = `
      <div class="trend-header">
        <span class="trend-name">${escapeHtml(trend.name)}</span>
        <span class="trend-score">${trend.prominence}</span>
      </div>
      <div class="trend-summary">${escapeHtml(trend.summary)}</div>
      <div class="trend-meta">
        <span class="trend-sources">${escapeHtml(sourcesStr)}</span>
        ${postCount ? `<span class="trend-posts">${escapeHtml(postCount)}</span>` : ''}
      </div>
    `;
    return card;
  }

  function setRefreshedTime(el, fetchedAt) {
    if (!el) return;
    const t = fetchedAt
      ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '—';
    el.textContent = `Last refreshed: ${t}`;
  }

  async function load(containerId, timestampId) {
    const container = document.getElementById(containerId);
    const tsEl = document.getElementById(timestampId);
    if (!container) return;

    container.innerHTML = '<div class="trends-loading">[ ANALYZING TRENDS... ]</div>';

    try {
      const res = await fetch(`/trends.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const trends = (data.trends || []).sort((a, b) => b.prominence - a.prominence);

      container.innerHTML = '';
      if (trends.length === 0) {
        container.innerHTML = '<div class="trends-error">⚠ No trend data available.</div>';
      } else {
        trends.forEach(t => container.appendChild(renderTrendCard(t)));
      }
      setRefreshedTime(tsEl, data.fetched_at);
    } catch (e) {
      container.innerHTML = `<div class="trends-error">⚠ Could not load trends — ${e.message}</div>`;
      console.error('[TrendsFeed]', e);
    }
  }

  function init(containerId, timestampId) {
    load(containerId, timestampId);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => load(containerId, timestampId), REFRESH_INTERVAL_MS);
    const btn = document.getElementById('btn-refresh-trends');
    if (btn) btn.addEventListener('click', () => load(containerId, timestampId));
  }

  return { init };
})();
