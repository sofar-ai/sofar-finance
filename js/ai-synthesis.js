/**
 * AI Synthesis — reads /data/ai-synthesis.json, /data/accuracy-stats.json, /data/accuracy-log.json
 * Powers both the main dashboard strip and ai-analysis.html page.
 * Handles short_term / long_term dual-signal format.
 */

const AISynthesis = (() => {
  const REFRESH_MS = 5 * 60 * 1000;

  // ── Helpers ────────────────────────────────────────────────────────────

  function timeSince(iso) {
    if (!iso) return null;
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
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

  // ── Strip (main dashboard) ─────────────────────────────────────────────

  function renderStrip(data, stats) {
    const el = document.getElementById('ai-strip');
    if (!el) return;

    if (!data || !data.generated_at) {
      el.innerHTML = `<div class="ai-strip-pending">
        <span>🤖</span><span>AI Analysis pending — next run at market open</span>
      </div>`;
      return;
    }

    const st    = data.short_term || {};
    const lt    = data.long_term  || {};
    const since = timeSince(data.generated_at);

    const accBadge = stats && stats.total_predictions > 0
      ? `<span class="ai-strip-acc">AI Accuracy: ${stats.accuracy_pct}% (${stats.total_predictions} predictions)</span>`
      : '';

    el.innerHTML = `
      <div class="ai-strip-signals">
        <div class="ai-strip-pill" style="border-color:${signalColor(st.signal)}22;background:${signalColor(st.signal)}11">
          <span class="ai-pill-label">SHORT TERM</span>
          <span class="ai-pill-sig" style="color:${signalColor(st.signal)}">${signalEmoji(st.signal)} ${st.signal||'—'}</span>
          <span class="ai-pill-conf">${st.confidence ?? '—'}%</span>
        </div>
        <div class="ai-strip-pill" style="border-color:${signalColor(lt.signal)}22;background:${signalColor(lt.signal)}11">
          <span class="ai-pill-label">LONG TERM</span>
          <span class="ai-pill-sig" style="color:${signalColor(lt.signal)}">${signalEmoji(lt.signal)} ${lt.signal||'—'}</span>
          <span class="ai-pill-conf">${lt.confidence ?? '—'}%</span>
        </div>
      </div>
      <div class="ai-strip-drivers">
        <div class="ai-strip-driver"><span class="ai-driver-label">ST:</span> ${st.key_driver || '—'}</div>
        <div class="ai-strip-driver"><span class="ai-driver-label">LT:</span> ${lt.key_driver || '—'}</div>
      </div>
      <div class="ai-strip-meta">
        ${accBadge}
        <span class="ai-strip-time">Updated ${since}</span>
        <span class="ai-strip-cta">Full analysis →</span>
      </div>`;
  }

  // ── Full analysis page ─────────────────────────────────────────────────

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

    const st = data.short_term || {};
    const lt = data.long_term  || {};

    // ── Header signal cards ──
    const hdr = document.getElementById('ai-header-cards');
    if (hdr) hdr.innerHTML = `
      <div class="ai-signal-card" style="border-color:${signalColor(st.signal)}44">
        <div class="ai-sc-label">SHORT TERM (2H)</div>
        <div class="ai-sc-sig" style="color:${signalColor(st.signal)}">${signalEmoji(st.signal)} ${st.signal}</div>
        <div class="ai-sc-conf" style="color:${signalColor(st.signal)}">${st.confidence}% confidence</div>
        <div class="ai-sc-summary">${st.summary || ''}</div>
        <div class="ai-sc-driver"><strong>Key driver:</strong> ${st.key_driver || ''}</div>
      </div>
      <div class="ai-signal-card" style="border-color:${signalColor(lt.signal)}44">
        <div class="ai-sc-label">LONG TERM (30D)</div>
        <div class="ai-sc-sig" style="color:${signalColor(lt.signal)}">${signalEmoji(lt.signal)} ${lt.signal}</div>
        <div class="ai-sc-conf" style="color:${signalColor(lt.signal)}">${lt.confidence}% confidence</div>
        <div class="ai-sc-summary">${lt.summary || ''}</div>
        <div class="ai-sc-driver"><strong>Key driver:</strong> ${lt.key_driver || ''}</div>
      </div>`;

    const metaEl = document.getElementById('ai-header-meta');
    if (metaEl) metaEl.innerHTML =
      `Generated ${timeSince(data.generated_at)} &nbsp;·&nbsp; Next update in <span id="ai-countdown">${countdown(data.next_update)}</span>`;
    setInterval(() => {
      const c = document.getElementById('ai-countdown');
      if (c) c.textContent = countdown(data.next_update);
    }, 60000);

    // Accuracy badge in header
    const accEl = document.getElementById('ai-header-acc');
    if (accEl && stats && stats.total_predictions > 0) {
      accEl.innerHTML = `<span class="ai-acc-badge">🎯 AI Accuracy: ${stats.accuracy_pct}% over ${stats.total_predictions} predictions</span>`;
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

    // ── Section 2: Tickers to Watch ──
    const tickEl = document.getElementById('ai-tickers-grid');
    if (tickEl) {
      const tickers = data.tickers_to_watch || [];
      if (!tickers.length) { tickEl.innerHTML = '<div class="ai-empty">No tickers flagged</div>'; }
      else {
        tickEl.innerHTML = '';
        tickers.forEach(t => {
          const stc = signalColor(t.short_term_bias);
          const ltc = signalColor(t.long_term_bias);
          const px  = data.prices_at_generation?.[t.ticker];
          const curPrice = px?.price ?? px;
          const card = document.createElement('div');
          card.className = 'ai-ticker-card';
          card.innerHTML = `
            <div class="ai-ticker-top">
              <span class="ai-ticker-sym">${t.ticker}</span>
              <span class="ai-ticker-badge" style="color:${stc};border-color:${stc}55">ST: ${t.short_term_bias||'—'}</span>
              <span class="ai-ticker-badge" style="color:${ltc};border-color:${ltc}55">LT: ${t.long_term_bias||'—'}</span>
            </div>
            <div class="ai-ticker-reason">${t.reason || ''}</div>
            <div class="ai-ticker-prices">
              <span class="ai-tp-item">Now: <strong>${fmtPrice(curPrice)}</strong></span>
              <span class="ai-tp-item">2H: <strong style="color:${signalColor(t.short_term_bias)}">${fmtPrice(t.predicted_price_2h)}</strong> <em>${fmtChange(curPrice, t.predicted_price_2h)}</em></span>
              <span class="ai-tp-item">30D: <strong style="color:${signalColor(t.long_term_bias)}">${fmtPrice(t.predicted_price_30d)}</strong> <em>${fmtChange(curPrice, t.predicted_price_30d)}</em></span>
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
        risksEl.innerHTML = '';
        risks.forEach((r, i) => {
          const li = document.createElement('div');
          li.className = 'ai-risk-item';
          li.innerHTML = `<span class="ai-risk-num">${i+1}</span><span>${r}</span>`;
          risksEl.appendChild(li);
        });
      }
    }

    // ── Section 5: Accuracy Track Record ──
    const accSection = document.getElementById('ai-accuracy-section');
    if (accSection && stats) {
      const pct = stats.accuracy_pct || 0;
      const barColor = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
      const bySignal = stats.by_signal || {};

      // Last 10 from log
      const last10 = (log || []).slice(-10).reverse();
      const tableRows = last10.map(e => {
        const d = new Date(e.prediction_time);
        const label = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        const correct = e.short_term_correct;
        const sig = e.short_term_signal || '—';
        return `<div class="ai-hist-row">
          <span class="ai-hist-time">${label}</span>
          <span class="ai-hist-sig" style="color:${signalColor(sig)}">${sig}</span>
          <span class="ai-hist-conf">${e.confidence_at_prediction ?? '—'}%</span>
          <span class="ai-hist-result ${correct ? 'ai-correct' : 'ai-incorrect'}">${correct ? '✓' : '✗'}</span>
        </div>`;
      }).join('');

      const bySignalHTML = Object.entries(bySignal).map(([sig, d]) => `
        <div class="ai-bs-row">
          <span style="color:${signalColor(sig)}">${sig}</span>
          <div class="ai-bs-bar-wrap"><div class="ai-bs-bar" style="width:${d.accuracy}%;background:${signalColor(sig)}"></div></div>
          <span>${d.accuracy}% (${d.correct}/${d.total})</span>
        </div>`).join('');

      accSection.innerHTML = `
        <div class="ai-acc-overall">
          <div class="ai-acc-pct" style="color:${barColor}">${pct}%</div>
          <div class="ai-acc-label">Overall Accuracy</div>
          <div class="ai-acc-bar-wrap"><div class="ai-acc-bar" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="ai-acc-sub">${stats.correct} correct of ${stats.total_predictions} predictions · Avg price error: ${stats.avg_price_error_pct != null ? stats.avg_price_error_pct + '%' : '—'}</div>
          ${stats.best_ticker ? `<div class="ai-acc-sub">Best: <strong>${stats.best_ticker}</strong> · Worst: <strong>${stats.worst_ticker||'—'}</strong></div>` : ''}
        </div>
        <div class="ai-acc-by-signal">${bySignalHTML}</div>
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
        const chg = info.change_pct;
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

  // ── Load & dispatch ────────────────────────────────────────────────────

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
