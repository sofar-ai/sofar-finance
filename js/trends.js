/**
 * Trends Component — sofar-finance
 * Reads from /trends.json (analyzed every 6h alongside headlines)
 * Displays as a compact Bloomberg-style sidebar list
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

  // Returns color hex for the dot indicator
  function hotColor(score) {
    if (score >= 85) return '#ef4444'; // red — very hot
    if (score >= 65) return '#f97316'; // orange — hot
    if (score >= 40) return '#eab308'; // yellow — warm
    return '#4a5060';                  // grey — mild
  }

  function renderTrendRow(trend, rank) {
    const row = document.createElement('div');
    row.className = 'trend-row';
    row.title = trend.summary || '';

    const color = hotColor(trend.prominence);

    row.innerHTML = `
      <span class="trend-rank">${String(rank).padStart(2, '0')}</span>
      <span class="trend-dot" style="background:${color};box-shadow:0 0 4px ${color}88;"></span>
      <span class="trend-label">${escapeHtml(trend.name)}</span>
      <span class="trend-score-inline" style="color:${color}">${trend.prominence}</span>
    `;
    return row;
  }

  function setRefreshedTime(el, fetchedAt) {
    if (!el) return;
    const t = fetchedAt
      ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '—';
    el.textContent = t;
  }

  async function load(containerId, timestampId) {
    const container = document.getElementById(containerId);
    const tsEl = document.getElementById(timestampId);
    if (!container) return;

    container.innerHTML = '<div class="trends-loading">LOADING...</div>';

    try {
      const res = await fetch(`/trends.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const trends = (data.trends || []).sort((a, b) => b.prominence - a.prominence);

      container.innerHTML = '';
      if (trends.length === 0) {
        container.innerHTML = '<div class="trends-error">NO DATA</div>';
      } else {
        trends.forEach((t, i) => container.appendChild(renderTrendRow(t, i + 1)));
      }
      setRefreshedTime(tsEl, data.fetched_at);
    } catch (e) {
      container.innerHTML = `<div class="trends-error">ERR: ${e.message}</div>`;
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
