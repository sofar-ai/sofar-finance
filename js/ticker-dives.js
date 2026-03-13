/**
 * ticker-dives.js — Ticker Deep Dives page
 * Reads /data/ticker-analyses.json, renders compact table with accordion expand
 */
(function () {
  const DATA_URL  = `/data/ticker-analyses.json?v=${Date.now()}`;
  const MAX_SIGNAL = 90; // chars for signal summary in compact row

  // ── Helpers ────────────────────────────────────────────────────────────────
  function signalColor(bias) {
    if (!bias) return '#9ca3af';
    const b = bias.toLowerCase();
    if (b === 'bullish') return '#22c55e';
    if (b === 'bearish') return '#ef4444';
    return '#f59e0b';
  }

  function fmtTs(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  }

  function fmtPremium(str) {
    if (!str) return '—';
    // Extract first dollar amount from the summary string e.g. "$77.8M"
    const m = str.match(/\$[\d,.]+[MBK]?/i);
    return m ? m[0] : '—';
  }

  function truncate(s, n) {
    if (!s) return '—';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderRow(a, idx) {
    const color  = signalColor(a.bias);
    const signal = truncate(a.options_flow_summary || a.news_sentiment_summary, MAX_SIGNAL);
    const premium = fmtPremium(a.options_flow_summary);
    const conf   = a.confidence || 0;
    const confColor = conf >= 70 ? '#22c55e' : conf >= 50 ? '#f59e0b' : '#ef4444';

    const drivers = (a.key_drivers || []).map(d => `<li>${esc(d)}</li>`).join('');
    const biasClass = (a.bias || '').toLowerCase();

    const detailHtml = `
      <tr class="td-detail-row" id="td-detail-${idx}">
        <td class="td-detail-cell" colspan="6">
          <div class="td-detail-inner">
            <div class="td-trade-box ${biasClass}">
              <div class="td-trade-box-label">💡 Trade Idea</div>
              ${esc(a.trade_idea || '—')}
            </div>
            <div>
              <div class="td-detail-label">Options Flow</div>
              <div class="td-detail-text">${esc(a.options_flow_summary || '—')}</div>
            </div>
            <div>
              <div class="td-detail-label">News Sentiment</div>
              <div class="td-detail-text">${esc(a.news_sentiment_summary || '—')}</div>
            </div>
            <div>
              <div class="td-detail-label">Market Context</div>
              <div class="td-detail-text">${esc(a.market_context_summary || '—')}</div>
            </div>
            <div>
              <div class="td-detail-label">Key Drivers</div>
              <ul class="td-drivers">${drivers || '<li>—</li>'}</ul>
            </div>
            <div>
              <div class="td-detail-label">Confidence</div>
              <div class="td-conf-bar">
                <div class="td-conf-track"><div class="td-conf-fill" style="width:${conf}%;background:${confColor}"></div></div>
                <span class="td-conf-pct" style="color:${confColor}">${conf}%</span>
              </div>
              ${a.data_freshness ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:6px">Flow data as of ${fmtTs(a.data_freshness)}</div>` : ''}
            </div>
          </div>
        </td>
      </tr>`;

    const rowHtml = `
      <tr class="td-row" id="td-row-${idx}" onclick="TickerDives.toggle(${idx})">
        <td class="td-cell td-chevron">›</td>
        <td class="td-cell td-cell-ts">${fmtTs(a.generated_at)}</td>
        <td class="td-cell td-cell-ticker">${esc(a.ticker)}</td>
        <td class="td-cell td-cell-bias" style="color:${color}">${esc((a.bias||'').toUpperCase())}</td>
        <td class="td-cell td-cell-signal">${esc(signal)}</td>
        <td class="td-cell td-cell-premium">${premium}</td>
      </tr>${detailHtml}`;

    return rowHtml;
  }

  function render(analyses, filter) {
    const body = document.getElementById('td-body');
    const countEl = document.getElementById('td-count');
    if (!analyses || !analyses.length) {
      body.innerHTML = '<div class="td-empty">No analyses yet. Use the Ticker Deep Dive on the AI Analysis page.</div>';
      countEl.textContent = '';
      return;
    }

    const f = (filter || '').toUpperCase().trim();
    const filtered = f ? analyses.filter(a => (a.ticker || '').toUpperCase().includes(f)) : analyses;

    countEl.textContent = f
      ? `${filtered.length} of ${analyses.length} results`
      : `${analyses.length} analyses`;

    if (!filtered.length) {
      body.innerHTML = `<div class="td-empty">No analyses for "${esc(f)}"</div>`;
      return;
    }

    const rows = filtered.map((a, i) => renderRow(a, i)).join('');
    body.innerHTML = `
      <table class="td-table">
        <thead>
          <tr>
            <th style="width:16px"></th>
            <th>Time (ET)</th>
            <th>Ticker</th>
            <th>Bias</th>
            <th>Signal Summary</th>
            <th style="text-align:right">Flow Premium</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Toggle accordion ───────────────────────────────────────────────────────
  function toggle(idx) {
    const row    = document.getElementById(`td-row-${idx}`);
    const detail = document.getElementById(`td-detail-${idx}`);
    if (!row || !detail) return;
    const open = row.classList.toggle('td-open');
    detail.classList.toggle('td-open', open);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  let _allAnalyses = [];

  async function init() {
    try {
      const res  = await fetch(DATA_URL);
      const data = await res.json();
      _allAnalyses = data.analyses || [];
      render(_allAnalyses);
    } catch (e) {
      document.getElementById('td-body').innerHTML =
        `<div class="td-empty">Failed to load analyses: ${e.message}</div>`;
    }

    document.getElementById('td-search').addEventListener('input', function () {
      render(_allAnalyses, this.value);
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.TickerDives = { toggle };
})();
