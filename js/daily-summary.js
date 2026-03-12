/**
 * DailySummary — reads /data/daily-summaries.json and renders today's write-up
 * plus a history of previous days.
 */
const DailySummary = (() => {

  function sigColor(s) {
    if (!s) return '#9ca3af';
    const u = s.toUpperCase();
    if (u.includes('BULLISH')) return '#22c55e';
    if (u.includes('BEARISH')) return '#ef4444';
    return '#f59e0b';
  }

  function retColor(r) {
    if (r == null) return '#9ca3af';
    return r >= 0 ? '#22c55e' : '#ef4444';
  }

  function fmtRet(r) {
    if (r == null) return '—';
    return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function fmtDateShort(d) {
    if (!d) return '—';
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function renderMain(s) {
    const bullets = (s.ticker_highlights || []).map(t => `<li>${t}</li>`).join('');
    const idSig   = s.intraday_signal || '—';
    const ndSig   = s.nextday_signal  || '—';

    return `
      <div class="ds-header">
        <div class="ds-date">${fmtDate(s.date)}</div>
        <div class="ds-headline">${s.headline || '—'}</div>
        <div class="ds-stats-strip">
          <div class="ds-stat"><span class="ds-stat-label">SPY</span><span class="ds-stat-val" style="color:${retColor(s.spy_return_pct)}">$${(s.spy_close||0).toFixed(2)} ${fmtRet(s.spy_return_pct)}</span></div>
          <div class="ds-stat"><span class="ds-stat-label">QQQ</span><span class="ds-stat-val" style="color:${retColor(s.qqq_return_pct)}">$${(s.qqq_close||0).toFixed(2)} ${fmtRet(s.qqq_return_pct)}</span></div>
          <div class="ds-stat"><span class="ds-stat-label">VIX</span><span class="ds-stat-val">${s.vix_close != null ? s.vix_close.toFixed(2) : '—'}</span></div>
          <div class="ds-stat"><span class="ds-stat-label">Regime</span><span class="ds-stat-val">${(s.regime||'—').replace(/_/g,' ')}</span></div>
        </div>
        <div class="ds-signals">
          <span class="ds-sig-pill" style="color:${sigColor(idSig)};border-color:${sigColor(idSig)}44;background:${sigColor(idSig)}11">
            ID ${idSig}
          </span>
          <span class="ds-sig-pill" style="color:${sigColor(ndSig)};border-color:${sigColor(ndSig)}44;background:${sigColor(ndSig)}11">
            ND ${ndSig}
          </span>
        </div>
      </div>

      <div class="ds-section">
        <div class="ds-section-label">Market Summary</div>
        <div class="ds-text">${s.market_summary || '—'}</div>
      </div>

      <div class="ds-section">
        <div class="ds-section-label">Notable Options Flow</div>
        <div class="ds-text">${s.notable_flows || '—'}</div>
      </div>

      <div class="ds-section">
        <div class="ds-section-label">Prediction Recap</div>
        <div class="ds-text">${s.directional_recap || '—'}</div>
      </div>

      ${bullets ? `
      <div class="ds-section">
        <div class="ds-section-label">Ticker Highlights</div>
        <ul class="ds-bullets">${bullets}</ul>
      </div>` : ''}

      <div class="ds-section">
        <div class="ds-section-label">Forward Look</div>
        <div class="ds-forward">${s.forward_look || '—'}</div>
      </div>`;
  }

  function renderPastCard(s) {
    return `
      <div class="ds-past-card">
        <div class="ds-past-header">
          <span class="ds-past-date">${fmtDateShort(s.date)}</span>
          <span class="ds-past-hl">${s.headline || '—'}</span>
          <span class="ds-past-ret" style="color:${retColor(s.spy_return_pct)}">SPY ${fmtRet(s.spy_return_pct)}</span>
        </div>
        <div class="ds-text" style="font-size:11px;color:#4b5563">${(s.market_summary||'').slice(0,120)}${(s.market_summary||'').length>120?'…':''}</div>
      </div>`;
  }

  function renderSidebar(summaries) {
    const today   = summaries[0];
    const history = summaries.slice(1, 8);

    // Stats sidebar
    const statsEl = document.getElementById('ds-sidebar-stats');
    const statsBody = document.getElementById('ds-sidebar-stats-body');
    if (statsEl && statsBody && today) {
      statsEl.style.display = '';
      statsBody.innerHTML = `
        <div class="ds-sb-stat"><span class="ds-sb-label">SPY</span><span style="color:${retColor(today.spy_return_pct)};font-weight:700;font-family:var(--font-mono);font-size:11px">$${(today.spy_close||0).toFixed(2)} ${fmtRet(today.spy_return_pct)}</span></div>
        <div class="ds-sb-stat"><span class="ds-sb-label">QQQ</span><span style="color:${retColor(today.qqq_return_pct)};font-weight:700;font-family:var(--font-mono);font-size:11px">$${(today.qqq_close||0).toFixed(2)} ${fmtRet(today.qqq_return_pct)}</span></div>
        <div class="ds-sb-stat"><span class="ds-sb-label">VIX</span><span style="font-weight:700;font-family:var(--font-mono);font-size:11px">${today.vix_close != null ? today.vix_close.toFixed(2) : '—'}</span></div>
        <div class="ds-sb-stat"><span class="ds-sb-label">Regime</span><span style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);text-align:right;max-width:130px">${(today.regime||'—').replace(/_/g,' ')}</span></div>
        <div class="ds-sb-stat"><span class="ds-sb-label">Intraday</span><span style="color:${sigColor(today.intraday_signal)};font-family:var(--font-mono);font-size:10px;font-weight:700">${today.intraday_signal||'—'}</span></div>
        <div class="ds-sb-stat"><span class="ds-sb-label">Next Day</span><span style="color:${sigColor(today.nextday_signal)};font-family:var(--font-mono);font-size:10px;font-weight:700">${today.nextday_signal||'—'}</span></div>
      `;
    }

    // History sidebar
    const histEl   = document.getElementById('ds-sidebar-history');
    const histBody = document.getElementById('ds-sidebar-history-body');
    if (histEl && histBody && history.length) {
      histEl.style.display = '';
      histBody.innerHTML = history.map(s => `
        <div class="ds-sb-hist-row">
          <span class="ds-sb-hist-date">${fmtDateShort(s.date)}</span>
          <span class="ds-sb-hist-ret" style="color:${retColor(s.spy_return_pct)}">${fmtRet(s.spy_return_pct)}</span>
        </div>
        <div class="ds-sb-hist-hl">${(s.headline||'').slice(0,60)}${(s.headline||'').length>60?'…':''}</div>
      `).join('<div class="ds-sb-hist-divider"></div>');
    }
  }

  async function init() {
    const root = document.getElementById('ds-root');
    if (!root) return;

    let data;
    try {
      const r = await fetch(`/data/daily-summaries.json?v=${Date.now()}`);
      data = await r.json();
    } catch (e) {
      root.innerHTML = `<div class="ds-empty">Could not load summaries: ${e.message}</div>`;
      return;
    }

    const summaries = (data.summaries || []);
    if (!summaries.length) {
      root.innerHTML = `
        <div class="ds-empty">
          No summaries yet.<br>
          <span class="ds-generating">The first daily summary will be generated at market close (4:05 PM ET) on the next trading day.</span>
        </div>`;
      return;
    }

    root.innerHTML = renderMain(summaries[0]);
    renderSidebar(summaries);
  }

  return { init };
})();
