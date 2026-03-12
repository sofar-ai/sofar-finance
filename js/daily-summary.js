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
          <div class="ds-stat"><span class="ds-stat-label">Regime</span><span class="ds-stat-val">${s.regime || '—'}</span></div>
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

    const today   = summaries[0];
    const history = summaries.slice(1);

    let html = renderMain(today);
    if (history.length) {
      html += `<div class="ds-history-label">Previous Sessions</div>`;
      html += history.map(renderPastCard).join('');
    }
    root.innerHTML = html;
  }

  return { init };
})();
