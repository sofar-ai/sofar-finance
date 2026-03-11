/**
 * AI Synthesis — reads /data/ai-synthesis.json, /data/accuracy-stats.json, /data/accuracy-log.json
 * Powers both the main dashboard strip and ai-analysis.html page.
 * Handles three-timeframe format: intraday / next_day / long_term
 */

const AISynthesis = (() => {
  const REFRESH_MS = 5 * 60 * 1000;

  // ── Helpers ─────────────────────────────────────────────────────────

  function timeSince(iso) {
    if (!iso) return null;
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
  }

  // Returns the next scheduled cron run time: :40 of 9,11,13,15 ET on weekdays
  function nextScheduledRun() {
    const RUN_HOURS_ET = [9, 11, 13, 15]; // :40 past each
    const now = new Date();
    // Convert to ET offset (UTC-5 standard, UTC-4 daylight)
    const etOffset = (() => {
      const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
      const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
      const stdOffset = Math.max(jan, jul);
      const isDST = now.getTimezoneOffset() < stdOffset;
      return isDST ? -4 : -5;
    })();
    const etNow = new Date(now.getTime() + (etOffset - (-now.getTimezoneOffset()/60)) * 3600000);
    const dayET = etNow.getDay(); // 0=Sun 6=Sat

    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      const checkDay = (dayET + dayOffset) % 7;
      if (checkDay === 0 || checkDay === 6) continue; // skip weekends
      for (const h of RUN_HOURS_ET) {
        const candidate = new Date(etNow);
        candidate.setDate(etNow.getDate() + dayOffset);
        candidate.setHours(h, 40, 0, 0);
        // Convert back to UTC for comparison
        const candidateUTC = new Date(candidate.getTime() - etOffset * 3600000);
        if (candidateUTC > now) return candidateUTC;
      }
    }
    return null;
  }

  function countdown(iso) {
    if (!iso) return '—';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'soon';
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m/60)}h ${m%60}m`;
  }

  function signalEmoji(s) {
    if (s === 'BULLISH') return '🟢';
    if (s === 'BEARISH') return '🔴';
    return '🟡';
  }

  function signalColor(s) {
    if (s === 'BULLISH') return '#22c55e';
    if (s === 'BEARISH') return '#ef4444';
    return '#f59e0b';
  }

  function fmtPrice(p) {
    if (p == null) return '—';
    return p > 1000
      ? `$${(+p).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}`
      : `$${(+p).toFixed(2)}`;
  }

  function fmtChange(cur, pred) {
    if (cur == null || pred == null) return '';
    const diff = pred - cur;
    const pct  = (diff / cur * 100).toFixed(1);
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)`;
  }

  async function fetchJSON(url) {
    const res = await fetch(`${url}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Strip (main dashboard) ─────────────────────────────────────────

  function renderStrip(data, stats) {
    const el = document.getElementById('ai-strip');
    if (!el) return;

    if (!data || !data.generated_at) {
      el.innerHTML = `<div class="ai-strip-pending">
        <span>🤖</span><span>AI Analysis pending — next run at market open</span>
      </div>`;
      return;
    }

    const id_ = data.intraday  || data.short_term || {};
    const nd_ = data.next_day  || {};
    const lt_ = data.long_term || {};
    const since = timeSince(data.generated_at);

    const accBadge = stats && stats.total_predictions > 0
      ? `<span class="ai-strip-acc">🎯 ${stats.accuracy_pct}% accuracy (${stats.total_predictions} calls)</span>`
      : '';

    const pill = (label, sig) => `
      <div class="ai-strip-pill" style="border-color:${signalColor(sig.signal)}33;background:${signalColor(sig.signal)}0d">
        <span class="ai-pill-label">${label}</span>
        <span class="ai-pill-sig" style="color:${signalColor(sig.signal)}">${signalEmoji(sig.signal)} ${sig.signal||'—'}</span>
        <span class="ai-pill-conf">${sig.confidence ?? '—'}%</span>
      </div>`;

    el.innerHTML = `
      <div class="ai-strip-signals">
        ${pill('INTRADAY', id_)}
        ${pill('NEXT DAY', nd_)}
        ${pill('30-DAY', lt_)}
      </div>
      <div class="ai-strip-drivers">
        <div class="ai-strip-driver"><span class="ai-driver-label">ID:</span> ${id_.key_driver || '—'}</div>
        <div class="ai-strip-driver"><span class="ai-driver-label">ND:</span> ${nd_.key_driver || '—'}</div>
      </div>
      <div class="ai-strip-meta">
        ${accBadge}
        <span class="ai-strip-time">Updated ${since}</span>
        <span class="ai-strip-cta">Full analysis →</span>
      </div>`;
  }

  // ── Full analysis page ─────────────────────────────────────────────

  function renderPage(data, stats, log) {
    if (!data || !data.generated_at) {
      const body = document.getElementById('ai-page-body');
      if (body) body.innerHTML = `<div class="ai-pending-box">
        <div class="ai-pending-icon">🤖</div>
        <div class="ai-pending-title">AI Analysis Pending</div>
        <div class="ai-pending-sub">First run at market open (9:40 AM ET)</div>
      </div>`;
      return;
    }

    const id_ = data.intraday  || data.short_term || {};
    const nd_ = data.next_day  || {};
    const lt_ = data.long_term || {};

    // ── Header: three signal cards ──
    const hdr = document.getElementById('ai-header-cards');
    if (hdr) {
      const card = (label, sig) => `
        <div class="ai-signal-card" style="border-color:${signalColor(sig.signal)}44">
          <div class="ai-sc-label">${label}</div>
          <div class="ai-sc-sig" style="color:${signalColor(sig.signal)}">${signalEmoji(sig.signal)} ${sig.signal||'—'}</div>
          <div class="ai-sc-conf" style="color:${signalColor(sig.signal)}">${sig.confidence ?? '—'}% confidence</div>
          <div class="ai-sc-summary">${sig.summary || ''}</div>
          <div class="ai-sc-driver"><strong>Key driver:</strong> ${sig.key_driver || ''}</div>
        </div>`;
      hdr.innerHTML = card('INTRADAY (2H)', id_) + card('NEXT DAY', nd_) + card('LONG TERM (30D)', lt_);
    }

    const metaEl = document.getElementById('ai-header-meta');
    if (metaEl) metaEl.innerHTML =
      `Generated ${timeSince(data.generated_at)} &nbsp;·&nbsp; Next update in <span id="ai-countdown">${countdown(nextScheduledRun()?.toISOString())}</span>`;
    setInterval(() => {
      const c = document.getElementById('ai-countdown');
      if (c) c.textContent = countdown(nextScheduledRun()?.toISOString());
    }, 60000);

    const accEl = document.getElementById('ai-header-acc');
    if (accEl && stats && stats.total_predictions > 0) {
      const byTf = stats.by_timeframe || {};
      const fmt = (tf) => {
        const d = byTf[tf] || {};
        return d.total ? `${d.accuracy_pct}% (${d.total})` : '—';
      };
      accEl.innerHTML = `<span class="ai-acc-badge">🎯 Intraday: ${fmt('intraday')} &nbsp;·&nbsp; Next Day: ${fmt('next_day')} &nbsp;·&nbsp; 30D: ${fmt('long_term')}</span>`;
    }

    // ── Section 1: News & Flow impact ──
    const impactEl = document.getElementById('ai-impact-grid');
    if (impactEl) impactEl.innerHTML = `
      <div class="ai-impact-card">
        <div class="ai-impact-label">📰 News & Trends Impact</div>
        <div class="ai-impact-text">${data.news_impact || '—'}</div>
      </div>
      <div class="ai-impact-card">
        <div class="ai-impact-label">📊 Options Flow Impact</div>
        <div class="ai-impact-text">${data.options_flow_impact || '—'}</div>
      </div>`;

    // ── Section 2a: SPY / QQQ Benchmarks ──
    const benchEl = document.getElementById('ai-benchmarks-grid');
    if (benchEl) {
      const benchmarks = data.benchmarks || {};
      const benchSyms  = Object.keys(benchmarks);
      if (!benchSyms.length) {
        benchEl.innerHTML = '<div class="ai-empty">No benchmark data</div>';
      } else {
        benchEl.innerHTML = '';
        benchSyms.forEach(sym => {
          const b   = benchmarks[sym];
          const idc = signalColor(b.intraday_bias);
          const ndc = signalColor(b.next_day_bias);
          const ltc = signalColor(b.long_term_bias);
          const px  = data.prices_at_generation?.[sym];
          const cur = typeof px === 'object' ? px?.price : px;
          const card = document.createElement('div');
          card.className = 'ai-ticker-card ai-benchmark-card';
          card.innerHTML = `
            <div class="ai-ticker-top">
              <span class="ai-ticker-sym ai-bench-sym">${sym}</span>
              <span class="ai-ticker-badge" style="color:${idc};border-color:${idc}55">ID: ${b.intraday_bias||'—'}</span>
              <span class="ai-ticker-badge" style="color:${ndc};border-color:${ndc}55">ND: ${b.next_day_bias||'—'}</span>
              <span class="ai-ticker-badge" style="color:${ltc};border-color:${ltc}55">LT: ${b.long_term_bias||'—'}</span>
            </div>
            <div class="ai-ticker-reason">${b.analysis || ''}</div>
            <div class="ai-ticker-prices">
              <span class="ai-tp-item">Now: <strong>${fmtPrice(cur)}</strong></span>
              <span class="ai-tp-item">2H: <strong style="color:${idc}">${fmtPrice(b.predicted_price_2h)}</strong> <em>${fmtChange(cur, b.predicted_price_2h)}</em></span>
              <span class="ai-tp-item">Next Day: <strong style="color:${ndc}">${fmtPrice(b.predicted_price_nextday)}</strong> <em>${fmtChange(cur, b.predicted_price_nextday)}</em></span>
              <span class="ai-tp-item">30D: <strong style="color:${ltc}">${fmtPrice(b.predicted_price_30d)}</strong> <em>${fmtChange(cur, b.predicted_price_30d)}</em></span>
            </div>`;
          benchEl.appendChild(card);
        });
      }
    }

    // ── Section 2b: Tickers to Watch (three bias columns) ──
    const tickEl = document.getElementById('ai-tickers-grid');
    if (tickEl) {
      const tickers = data.tickers_to_watch || [];
      if (!tickers.length) { tickEl.innerHTML = '<div class="ai-empty">No tickers flagged</div>'; }
      else {
        tickEl.innerHTML = '';
        tickers.forEach(t => {
          const idc = signalColor(t.intraday_bias  || t.short_term_bias);
          const ndc = signalColor(t.next_day_bias);
          const ltc = signalColor(t.long_term_bias);
          const px  = data.prices_at_generation?.[t.ticker];
          const cur = px?.price ?? px;
          const card = document.createElement('div');
          card.className = 'ai-ticker-card';
          card.innerHTML = `
            <div class="ai-ticker-top">
              <span class="ai-ticker-sym">${t.ticker}</span>
              <span class="ai-ticker-badge" style="color:${idc};border-color:${idc}55">ID: ${t.intraday_bias||t.short_term_bias||'—'}</span>
              <span class="ai-ticker-badge" style="color:${ndc};border-color:${ndc}55">ND: ${t.next_day_bias||'—'}</span>
              <span class="ai-ticker-badge" style="color:${ltc};border-color:${ltc}55">LT: ${t.long_term_bias||'—'}</span>
            </div>
            <div class="ai-ticker-reason">${t.reason || ''}</div>
            <div class="ai-ticker-prices">
              <span class="ai-tp-item">Now: <strong>${fmtPrice(cur)}</strong></span>
              <span class="ai-tp-item">2H: <strong style="color:${idc}">${fmtPrice(t.predicted_price_2h)}</strong> <em>${fmtChange(cur, t.predicted_price_2h)}</em></span>
              <span class="ai-tp-item">Next Day: <strong style="color:${ndc}">${fmtPrice(t.predicted_price_nextday)}</strong> <em>${fmtChange(cur, t.predicted_price_nextday)}</em></span>
              <span class="ai-tp-item">30D: <strong style="color:${ltc}">${fmtPrice(t.predicted_price_30d)}</strong> <em>${fmtChange(cur, t.predicted_price_30d)}</em></span>
            </div>`;
          tickEl.appendChild(card);
        });
      }
    }

    // ── Section 3: Trade Ideas ──
    const ideasEl = document.getElementById('ai-ideas-list');
    if (ideasEl) {
      const ideas = data.trade_ideas || [];
      if (!ideas.length) { ideasEl.innerHTML = '<div class="ai-empty">No trade ideas generated</div>'; }
      else {
        ideasEl.innerHTML = '';
        ideas.forEach((idea, i) => {
          const tc = idea.type?.includes('call') ? '#22c55e' : idea.type?.includes('put') ? '#ef4444' : '#f59e0b';
          const card = document.createElement('div');
          card.className = 'ai-idea-card';
          card.innerHTML = `
            <div class="ai-idea-header">
              <span class="ai-idea-num">#${i+1}</span>
              <span class="ai-idea-ticker">${idea.ticker||''}</span>
              <span class="ai-idea-type" style="color:${tc}">${(idea.type||'').toUpperCase()}</span>
              <span class="ai-idea-tf">${idea.timeframe||''}</span>
            </div>
            <div class="ai-idea-thesis"><strong>Thesis:</strong> ${idea.thesis||idea.idea||''}</div>
            <div class="ai-idea-risk"><strong>Risk:</strong> ${idea.risk||'—'}</div>`;
          ideasEl.appendChild(card);
        });
      }
    }

    // ── Section 4: Risks ──
    const risksEl = document.getElementById('ai-risks-list');
    if (risksEl) {
      const risks = data.risks || [];
      if (!risks.length) { risksEl.innerHTML = '<div class="ai-empty">No risks flagged</div>'; }
      else {
        risksEl.innerHTML = risks.map((r, i) =>
          `<div class="ai-risk-item"><span class="ai-risk-num">${i+1}</span><span>${r}</span></div>`).join('');
      }
    }

    // ── Section 5: Accuracy Track Record ──
    const accSection = document.getElementById('ai-accuracy-section');
    if (accSection && stats) {
      const byTf = stats.by_timeframe || {};
      const TFS  = [
        { key: 'intraday',  label: 'Intraday (2H)' },
        { key: 'next_day',  label: 'Next Day'       },
        { key: 'long_term', label: 'Long Term (30D)' },
      ];

      const barsHTML = TFS.map(({ key, label }) => {
        const d = byTf[key] || { total: 0, correct: 0, accuracy_pct: 0 };
        const c = d.accuracy_pct >= 70 ? '#22c55e' : d.accuracy_pct >= 50 ? '#f59e0b' : '#ef4444';
        const pct = d.accuracy_pct || 0;
        return `
          <div class="ai-tf-bar-row">
            <div class="ai-tf-bar-label">${label}</div>
            <div class="ai-tf-bar-track"><div class="ai-tf-bar-fill" style="width:${pct}%;background:${c}"></div></div>
            <div class="ai-tf-bar-stat" style="color:${c}">${pct}% <span class="ai-tf-n">(${d.correct}/${d.total})</span></div>
          </div>`;
      }).join('');

      // Last 10 predictions table
      const last10 = (log || []).slice(-10).reverse();
      const TF_LABEL = { intraday: 'ID', next_day: 'ND', long_term: 'LT' };
      const tableRows = last10.map(e => {
        const dt = new Date(e.prediction_time);
        const label = `${dt.getMonth()+1}/${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`;
        const sig   = e.signal || e.short_term_signal || '—';
        const tf    = TF_LABEL[e.timeframe] || e.timeframe || 'ID';
        const ok    = e.signal_correct ?? e.short_term_correct;
        return `<div class="ai-hist-row">
          <span class="ai-hist-time">${label}</span>
          <span class="ai-hist-tf">${tf}</span>
          <span class="ai-hist-sig" style="color:${signalColor(sig)}">${sig}</span>
          <span class="ai-hist-conf">${e.confidence_at_prediction ?? '—'}%</span>
          <span class="ai-hist-result ${ok ? 'ai-correct' : 'ai-incorrect'}">${ok ? '✓' : '✗'}</span>
        </div>`;
      }).join('');

      accSection.innerHTML = `
        <div class="ai-tf-bars">${barsHTML}</div>
        <div class="ai-acc-sub" style="margin:8px 0 4px">
          Avg price error: ${stats.avg_price_error_pct != null ? stats.avg_price_error_pct + '%' : '—'}
          ${stats.best_ticker ? ` &nbsp;·&nbsp; Best: <strong>${stats.best_ticker}</strong> · Worst: <strong>${stats.worst_ticker||'—'}</strong>` : ''}
        </div>
        <div class="ai-acc-hist-title">Last 10 Predictions</div>
        <div class="ai-acc-hist">${tableRows || '<div class="ai-empty">No predictions yet</div>'}</div>`;
    } else if (accSection) {
      accSection.innerHTML = '<div class="ai-empty">No accuracy data yet — check back after first backcheck run</div>';
    }

    // ── Section 6: Raw Data ──
    const rawEl = document.getElementById('ai-raw-data');
    if (rawEl) {
      const ds = data.data_sources || {};
      const px = data.prices_at_generation || {};
      const pxLines = Object.entries(px).map(([s, v]) => {
        const info = typeof v === 'object' ? v : {price: v};
        const chg  = info.change_pct;
        return `${s}: ${fmtPrice(info.price)} (${chg >= 0 ? '+' : ''}${(chg||0).toFixed(2)}%)`;
      }).join('\n');
      rawEl.innerHTML = `
        <div class="ai-raw-grid">
          <div><span class="ai-raw-label">Headlines</span><span class="ai-raw-val">${ds.headlines_count ?? '—'}</span></div>
          <div><span class="ai-raw-label">Trends</span><span class="ai-raw-val">${ds.trends_count ?? '—'}</span></div>
          <div><span class="ai-raw-label">Top trends</span><span class="ai-raw-val">${(ds.trends_sample||[]).join(', ') || '—'}</span></div>
          <div><span class="ai-raw-label">Options trades</span><span class="ai-raw-val">${ds.flow_trades ?? '—'}</span></div>
          <div><span class="ai-raw-label">Flow sentiment</span><span class="ai-raw-val">${ds.sentiment ?? '—'} (P/C ${ds.pc_ratio ?? '—'})</span></div>
          <div><span class="ai-raw-label">Generated</span><span class="ai-raw-val">${data.generated_at}</span></div>
        </div>
        <pre class="ai-raw-prices">${pxLines}</pre>`;
    }
  }


  // ── Schedule display ─────────────────────────────────────────────

  function renderSchedule() {
    const el = document.getElementById('ai-schedule');
    if (!el) return;
    el.className = 'ai-schedule-sidebar';

    const FLOW_HOURS = [9, 11, 13, 15];
    const SYNTH_HOURS = [9, 11, 13, 15];
    const BACKCHECK_HOURS = [11, 13, 15, 17];

    // Get current ET time
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day   = nowET.getDay(); // 0=Sun, 6=Sat
    const h     = nowET.getHours();
    const m     = nowET.getMinutes();
    const isWeekday = day >= 1 && day <= 5;

    function nextRun(hours, minute) {
      if (!isWeekday) return 'Mon';
      for (const hr of hours) {
        if (h < hr || (h === hr && m < minute)) {
          return `${hr}:${String(minute).padStart(2,'0')} ET`;
        }
      }
      return 'Tomorrow';
    }

    function isNext(hours, minute) {
      if (!isWeekday) return false;
      for (const hr of hours) {
        if (h < hr || (h === hr && m < minute)) {
          const diffMin = (hr - h) * 60 + (minute - m);
          return diffMin <= 15;
        }
      }
      return false;
    }

    const rows = [
      { label: 'Options Flow',  times: '9:30 · 11:30 · 13:30 · 15:30 ET', next: nextRun(FLOW_HOURS, 30),  soon: isNext(FLOW_HOURS, 30)  },
      { label: 'AI Synthesis',  times: '9:40 · 11:40 · 13:40 · 15:40 ET', next: nextRun(SYNTH_HOURS, 40), soon: isNext(SYNTH_HOURS, 40) },
      { label: 'Backcheck',     times: '11:35 · 13:35 · 15:35 · 17:35 ET + 9:35 ET (next-day & 30d)', next: nextRun(BACKCHECK_HOURS, 35), soon: isNext(BACKCHECK_HOURS, 35) },
    ];

    el.innerHTML = rows.map(r => `
      <div class="ai-sched-sb-row">
        <div class="ai-sched-sb-label">${r.label}</div>
        <div class="ai-sched-sb-times">${r.times.replace(/ · /g, '\n').replace(' ET', '').replace(/ \+ /g, '\n')}</div>
        <div class="ai-sched-sb-next ${r.soon ? 'ai-sched-soon' : ''}">Next: ${r.next}${r.soon ? ' ⚡' : ''}</div>
      </div>`).join('');
  }

  // ── Load & dispatch ───────────────────────────────────────────────

  async function load(mode) {
    try {
      const [data, stats, log] = await Promise.allSettled([
        fetchJSON('/data/ai-synthesis.json'),
        fetchJSON('/data/accuracy-stats.json'),
        fetchJSON('/data/accuracy-log.json'),
      ]).then(r => r.map(p => p.status === 'fulfilled' ? p.value : null));

      if (mode === 'strip') renderStrip(data, stats);
      if (mode === 'page')  renderPage(data, stats, log);
    } catch {
      if (mode === 'strip') renderStrip(null, null);
      if (mode === 'page')  renderPage(null, null, null);
    }
  }

  function initStrip() {
    load('strip');
    setInterval(() => load('strip'), REFRESH_MS);
  }

  function initPage() {
    load('page');
    renderSchedule();
    setInterval(renderSchedule, 60000);
    setInterval(() => load('page'), REFRESH_MS);
    document.getElementById('ai-raw-toggle')?.addEventListener('click', () => {
      const el  = document.getElementById('ai-raw-data');
      const btn = document.getElementById('ai-raw-toggle');
      if (!el) return;
      const open = el.style.display !== 'none';
      el.style.display = open ? 'none' : 'block';
      btn.textContent  = open ? '▶ Raw Data Used' : '▼ Raw Data Used';
    });
  }

  return { initStrip, initPage };
})();
