/**
 * AI Synthesis — reads /data/ai-synthesis.json
 * Powers both the main dashboard strip and the full ai-analysis.html page.
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
    if (s === 'BULLISH')  return '🟢';
    if (s === 'BEARISH')  return '🔴';
    return '🟡';
  }

  function signalColor(s) {
    if (s === 'BULLISH')  return '#22c55e';
    if (s === 'BEARISH')  return '#ef4444';
    return '#f59e0b';
  }

  function biasColor(b) {
    const u = (b || '').toUpperCase();
    if (u === 'BULLISH')  return '#22c55e';
    if (u === 'BEARISH')  return '#ef4444';
    return '#f59e0b';
  }

  function fmtPrice(p) {
    return typeof p === 'number'
      ? (p > 1000 ? `$${p.toLocaleString('en-US', {maximumFractionDigits:2})}` : `$${p.toFixed(2)}`)
      : '—';
  }

  // ── Strip (main dashboard) ─────────────────────────────────────────────

  function renderStrip(data) {
    const el = document.getElementById('ai-strip');
    if (!el) return;

    if (!data || !data.generated_at) {
      el.innerHTML = `
        <div class="ai-strip-pending">
          <span class="ai-strip-icon">🤖</span>
          <span>AI Analysis pending — next run at market open</span>
        </div>`;
      return;
    }

    const sig   = data.signal    || 'NEUTRAL';
    const conf  = data.confidence ?? 0;
    const since = timeSince(data.generated_at);
    const color = signalColor(sig);
    const summ  = (data.summary || '').slice(0, 160) + ((data.summary||'').length > 160 ? '…' : '');

    el.innerHTML = `
      <div class="ai-strip-left">
        <span class="ai-strip-signal" style="color:${color}">${signalEmoji(sig)} ${sig}</span>
        <span class="ai-strip-conf">${conf}%</span>
      </div>
      <div class="ai-strip-summary">${summ}</div>
      <div class="ai-strip-right">
        <span class="ai-strip-time">Updated ${since}</span>
        <span class="ai-strip-cta">View full analysis →</span>
      </div>`;
  }

  // ── Full analysis page ─────────────────────────────────────────────────

  function renderPage(data) {
    if (!data || !data.generated_at) {
      const body = document.getElementById('ai-page-body');
      if (body) body.innerHTML = `
        <div class="ai-pending-box">
          <div class="ai-pending-icon">🤖</div>
          <div class="ai-pending-title">AI Analysis Pending</div>
          <div class="ai-pending-sub">First run scheduled at market open (9:30 AM ET)</div>
        </div>`;
      return;
    }

    const sig   = data.signal     || 'NEUTRAL';
    const conf  = data.confidence ?? 0;
    const color = signalColor(sig);

    // ── Signal header ──
    const sigEl = document.getElementById('ai-signal-display');
    if (sigEl) sigEl.innerHTML = `
      <span class="ai-page-signal" style="color:${color}">${signalEmoji(sig)} ${sig}</span>
      <span class="ai-page-conf" style="color:${color}">${conf}%</span>
      <span class="ai-page-conf-label">confidence</span>`;

    const metaEl = document.getElementById('ai-signal-meta');
    if (metaEl) metaEl.innerHTML =
      `Generated ${timeSince(data.generated_at)} &nbsp;·&nbsp; Next update in <span id="ai-countdown">${countdown(data.next_update)}</span>`;

    // Update countdown every minute
    setInterval(() => {
      const el = document.getElementById('ai-countdown');
      if (el) el.textContent = countdown(data.next_update);
    }, 60000);

    // ── Summary ──
    const summEl = document.getElementById('ai-summary-text');
    if (summEl) summEl.textContent = data.summary || '—';

    // ── Tickers to watch ──
    const tickEl = document.getElementById('ai-tickers-grid');
    if (tickEl && data.tickers_to_watch?.length) {
      tickEl.innerHTML = '';
      data.tickers_to_watch.forEach(t => {
        const bc = biasColor(t.bias);
        const card = document.createElement('div');
        card.className = 'ai-ticker-card';
        card.innerHTML = `
          <div class="ai-ticker-top">
            <span class="ai-ticker-sym">${t.ticker}</span>
            <span class="ai-ticker-bias" style="color:${bc};border-color:${bc}88">${t.bias || '—'}</span>
          </div>
          <div class="ai-ticker-reason">${t.reason || ''}</div>`;
        tickEl.appendChild(card);
      });
    } else if (tickEl) tickEl.innerHTML = '<div class="ai-empty">No tickers flagged</div>';

    // ── Trade ideas ──
    const ideasEl = document.getElementById('ai-ideas-list');
    if (ideasEl && data.trade_ideas?.length) {
      ideasEl.innerHTML = '';
      data.trade_ideas.forEach((idea, i) => {
        const typeColor = idea.type?.includes('call') ? '#22c55e' : idea.type?.includes('put') ? '#ef4444' : '#f59e0b';
        const card = document.createElement('div');
        card.className = 'ai-idea-card';
        card.innerHTML = `
          <div class="ai-idea-header">
            <span class="ai-idea-num">#${i+1}</span>
            <span class="ai-idea-ticker">${idea.ticker || ''}</span>
            <span class="ai-idea-type" style="color:${typeColor}">${(idea.type||'').toUpperCase()}</span>
          </div>
          <div class="ai-idea-thesis"><strong>Thesis:</strong> ${idea.thesis || idea.idea || ''}</div>
          <div class="ai-idea-risk"><strong>Risk:</strong> ${idea.risk || '—'}</div>`;
        ideasEl.appendChild(card);
      });
    } else if (ideasEl) ideasEl.innerHTML = '<div class="ai-empty">No trade ideas generated</div>';

    // ── Risks ──
    const risksEl = document.getElementById('ai-risks-list');
    if (risksEl && data.risks?.length) {
      risksEl.innerHTML = '';
      data.risks.forEach((r, i) => {
        const li = document.createElement('div');
        li.className = 'ai-risk-item';
        li.innerHTML = `<span class="ai-risk-num">${i+1}</span><span>${r}</span>`;
        risksEl.appendChild(li);
      });
    } else if (risksEl) risksEl.innerHTML = '<div class="ai-empty">No risks flagged</div>';

    // ── Raw data used ──
    const rawEl = document.getElementById('ai-raw-data');
    if (rawEl) {
      const ds  = data.data_sources || {};
      const px  = data.prices_at_analysis || {};
      const pxLines = Object.entries(px).map(([s, v]) =>
        `${s}: ${fmtPrice(v?.price ?? v)} (${v?.change_pct >= 0 ? '+' : ''}${(v?.change_pct ?? 0).toFixed(2)}%)`
      ).join('\n');
      rawEl.innerHTML = `
        <div class="ai-raw-grid">
          <div><span class="ai-raw-label">Headlines fed</span><span class="ai-raw-val">${ds.headlines_count ?? '—'}</span></div>
          <div><span class="ai-raw-label">Trending topics</span><span class="ai-raw-val">${ds.trends_count ?? '—'}</span></div>
          <div><span class="ai-raw-label">Options trades</span><span class="ai-raw-val">${ds.flow_trades ?? '—'}</span></div>
          <div><span class="ai-raw-label">Top flow picks</span><span class="ai-raw-val">${ds.top_trades ?? '—'}</span></div>
          <div><span class="ai-raw-label">Flow sentiment</span><span class="ai-raw-val">${ds.sentiment ?? '—'} (P/C ${ds.pc_ratio ?? '—'})</span></div>
          <div><span class="ai-raw-label">Analysis time</span><span class="ai-raw-val">${data.generated_at}</span></div>
        </div>
        <pre class="ai-raw-prices">${pxLines}</pre>`;
    }
  }

  // ── Fetch & dispatch ───────────────────────────────────────────────────

  async function load(mode) {
    try {
      const res  = await fetch(`/data/ai-synthesis.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mode === 'strip') renderStrip(data);
      if (mode === 'page')  renderPage(data);
    } catch {
      if (mode === 'strip') renderStrip(null);
      if (mode === 'page')  renderPage(null);
    }
  }

  function initStrip() {
    load('strip');
    setInterval(() => load('strip'), REFRESH_MS);
  }

  function initPage() {
    load('page');
    setInterval(() => load('page'), REFRESH_MS);

    // Collapsible raw data section
    document.getElementById('ai-raw-toggle')?.addEventListener('click', () => {
      const el = document.getElementById('ai-raw-data');
      if (!el) return;
      const open = el.style.display !== 'none';
      el.style.display = open ? 'none' : 'block';
      document.getElementById('ai-raw-toggle').textContent =
        open ? '▶ Raw Data Used' : '▼ Raw Data Used';
    });
  }

  return { initStrip, initPage };
})();
