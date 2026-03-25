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

  function renderMorningBrief(mb) {
    const container = document.getElementById('ds-morning-brief');
    if (!container) return;
    if (!mb || !mb.brief) { container.style.display = 'none'; return; }

    const genDate = (mb.generated_at || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (genDate !== today) { container.style.display = 'none'; return; }

    const prev = mb.previous_prediction || {};
    const futures = mb.current_futures || {};
    const es = futures['ES=F'] || {};
    const nq = futures['NQ=F'] || {};
    const vix = futures['^VIX'] || {};

    const brief = mb.brief || '';
    const thesis = brief.match(/THESIS STATUS:\s*(.+)/)?.[1] || '';
    const confidence = brief.match(/ADJUSTED CONFIDENCE:\s*(\d+)%/)?.[1] || '';
    const summary = brief.match(/OVERNIGHT SUMMARY:\s*([\s\S]*?)(?=KEY DEVELOPMENTS:|$)/)?.[1]?.trim() || '';
    const developments = brief.match(/KEY DEVELOPMENTS:\s*([\s\S]*?)(?=TRADE RECOMMENDATION|$)/)?.[1]?.trim() || '';
    const tradeStatus = brief.match(/TRADE RECOMMENDATION STATUS:\s*(.+)/)?.[1] || '';
    const tradeNotes = brief.match(/TRADE NOTES:\s*([\s\S]*?)(?=DAY AHEAD RISKS:|$)/)?.[1]?.trim() || '';
    const risks = brief.match(/DAY AHEAD RISKS:\s*([\s\S]*?)(?=DAY AHEAD OPPORTUNITIES:|$)/)?.[1]?.trim() || '';
    const opps = brief.match(/DAY AHEAD OPPORTUNITIES:\s*([\s\S]*?)$/)?.[1]?.trim() || '';

    const thesisColor = thesis.includes('CONFIRMED') ? '#22c55e' :
                        thesis.includes('WEAKENED') ? '#f59e0b' :
                        thesis.includes('INVALIDATED') ? '#ef4444' : '#94a3b8';

    const fmtFuture = (label, d) => {
      if (!d.price) return '';
      const c = (d.change_pct||0) >= 0 ? '#22c55e' : '#ef4444';
      const s = (d.change_pct||0) >= 0 ? '+' : '';
      return '<div class="mb-future"><span class="mb-future-label">'+label+'</span>'+
             '<span class="mb-future-price">$'+d.price.toLocaleString()+'</span>'+
             '<span class="mb-future-chg" style="color:'+c+'">'+s+(d.change_pct||0).toFixed(2)+'%</span></div>';
    };

    const fmtBullets = (txt) => {
      if (!txt) return '';
      return txt.split('\n').filter(l => l.trim()).map(l =>
        '<div class="mb-bullet">'+l.replace(/^[•\-]\s*/, '')+'</div>'
      ).join('');
    };

    const age = Math.round((Date.now() - new Date(mb.generated_at.replace(' ET', '')).getTime()) / 60000);
    const ageStr = age < 60 ? age + 'm ago' : Math.round(age/60) + 'h ago';

    container.style.display = 'block';
    container.innerHTML =
      '<div class="mb-header">' +
        '<div class="mb-title">☀️ Morning Brief</div>' +
        '<div class="mb-time">Generated ' + ageStr + '</div>' +
      '</div>' +
      '<div class="mb-thesis-row">' +
        '<div class="mb-thesis">' +
          '<span class="mb-thesis-label">Thesis:</span> ' +
          '<span class="mb-thesis-status" style="color:'+thesisColor+'">'+thesis+'</span>' +
          (confidence ? ' <span class="mb-thesis-conf">('+confidence+'% confidence)</span>' : '') +
        '</div>' +
        '<div class="mb-prev-pred">' +
          'Previous: <span style="color:'+(prev.direction==='BEARISH'?'#ef4444':'#22c55e')+'">'+
          (prev.direction||'—')+' '+(prev.confidence||'')+'%</span>' +
        '</div>' +
      '</div>' +
      '<div class="mb-futures">' +
        fmtFuture('ES', es) + fmtFuture('NQ', nq) + fmtFuture('VIX', vix) +
      '</div>' +
      (summary ? '<div class="mb-summary">'+summary+'</div>' : '') +
      (developments ? '<div class="mb-section"><div class="mb-section-title">Key Developments</div>'+fmtBullets(developments)+'</div>' : '') +
      (tradeNotes ? '<div class="mb-section"><div class="mb-section-title">Trade Notes — <span style="color:'+thesisColor+'">'+tradeStatus+'</span></div><div class="mb-notes">'+tradeNotes+'</div></div>' : '') +
      '<div class="mb-two-col">' +
        (risks ? '<div class="mb-col"><div class="mb-section-title">⚠️ Risks</div>'+fmtBullets(risks)+'</div>' : '') +
        (opps ? '<div class="mb-col"><div class="mb-section-title">💡 Opportunities</div>'+fmtBullets(opps)+'</div>' : '') +
      '</div>';
  }

  return { init };
})();
