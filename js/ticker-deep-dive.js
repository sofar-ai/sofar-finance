/**
 * TickerDeepDive — single-ticker analysis via refresh-trigger mechanism
 * Writes to /api/trigger-ticker, polls every 3s, fetches /data/ticker-analysis.json
 */
const TickerDeepDive = (() => {
  const API       = '/api/trigger-ticker';
  const POLL_MS   = 3000;
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 min — flow refresh + analysis can take 3-4 min

  let polling = false;

  function signalColor(s) {
    s = (s || '').toLowerCase();
    return s === 'bullish' ? '#22c55e' : s === 'bearish' ? '#ef4444' : '#f59e0b';
  }
  function fmtDT(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/New_York', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }) + ' ET';
    } catch { return iso; }
  }

  function setStatus(msg, color) {
    const el = document.getElementById('dd-status');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.style.color   = color || '#9ca3af';
    el.innerHTML     = msg || '';
  }

  function setResult(html) {
    const el = document.getElementById('dd-result');
    if (!el) return;
    el.style.display = html ? 'block' : 'none';
    el.innerHTML     = html || '';
  }

  function setButtonState(disabled, text) {
    const btn = document.getElementById('dd-analyze-btn');
    if (!btn) return;
    btn.disabled     = disabled;
    btn.textContent  = text || 'Analyze';
    btn.style.opacity = disabled ? '0.6' : '1';
  }

  function renderResult(data) {
    const bias  = (data.bias || 'neutral').toLowerCase();
    const col   = signalColor(bias);
    const conf  = data.confidence ?? '—';
    const kd    = Array.isArray(data.key_drivers) ? data.key_drivers.slice(0, 4) : [];

    setResult(`
      <!-- Top row -->
      <div class="ai-dd-top-row">
        <span class="ai-dd-ticker-sym">${data.ticker || '—'}</span>
        <span class="ai-dd-signal-pill" style="color:${col};border-color:${col}55;background:${col}11">
          ${bias.toUpperCase()}
        </span>
        <span class="ai-dd-conf" style="color:${col}">${conf}% confidence</span>
      </div>

      <!-- Three mini-cards -->
      <div class="ai-dd-mini-cards">
        <div class="ai-dd-mini-card">
          <div class="ai-dd-mini-label">Options Flow</div>
          <div class="ai-dd-mini-text">${data.options_flow_summary || '—'}</div>
        </div>
        <div class="ai-dd-mini-card">
          <div class="ai-dd-mini-label">News Sentiment</div>
          <div class="ai-dd-mini-text">${data.news_sentiment_summary || '—'}</div>
        </div>
        <div class="ai-dd-mini-card">
          <div class="ai-dd-mini-label">Market Context</div>
          <div class="ai-dd-mini-text">${data.market_context_summary || '—'}</div>
        </div>
      </div>

      <!-- Key Drivers -->
      ${kd.length ? `
      <div class="ai-dd-drivers">
        <div class="ai-dd-drivers-label">Key Drivers</div>
        <ul class="ai-dd-drivers-list">
          ${kd.map(d => `<li>${d}</li>`).join('')}
        </ul>
      </div>` : ''}

      <!-- Trade Idea -->
      ${data.trade_idea ? `
      <div class="ai-dd-trade-card">
        <div class="ai-dd-trade-label">💡 Trade Idea</div>
        <div class="ai-dd-trade-text">${data.trade_idea}</div>
        <div class="ai-dd-disclaimer">Not financial advice. For informational purposes only.</div>
      </div>` : ''}

      <!-- Data Freshness -->
      <div class="ai-dd-freshness">
        Data as of ${fmtDT(data.data_freshness)}
      </div>
      ${data.not_on_watchlist_note ? `<div class="ai-dd-watchlist-note">⚠️ ${data.not_on_watchlist_note} <a href="config.html" class="ai-dd-watchlist-link">Open Config →</a></div>` : ''}
      `);
  }

  async function submit() {
    if (polling) return;
    const input  = document.getElementById('dd-ticker-input');
    const ticker = (input?.value || '').toUpperCase().trim().replace(/^\$/, '');
    if (!ticker) { setStatus('Enter a ticker symbol first.', '#f59e0b'); return; }

    polling = true;
    setButtonState(true, 'Analyzing…');
    setResult('');
    setStatus(`<span class="ai-dd-spinner">⏳</span> Analyzing <strong>${ticker}</strong>… (may take up to 60s)`, '#60a5fa');

    // POST trigger
    let postOk = false;
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      if (data._note === 'queued') {
        setStatus(`⏳ Queued — another job running. <strong>${ticker}</strong> will run next…`, '#f59e0b');
      }
      postOk = res.ok || res.status === 202;
    } catch (e) {
      setStatus(`❌ Could not reach server: ${e.message}`, '#ef4444');
      setButtonState(false); polling = false; return;
    }

    if (!postOk) {
      setStatus('❌ Failed to queue analysis. Try again.', '#ef4444');
      setButtonState(false); polling = false; return;
    }

    // Poll
    const started = Date.now();
    while (true) {
      await new Promise(r => setTimeout(r, POLL_MS));

      if (Date.now() - started > TIMEOUT_MS) {
        setStatus(`Analysis timed out — another request may be in progress. Please try again.`, '#9ca3af');
        setButtonState(false); polling = false; return;
      }

      let data;
      try {
        const r = await fetch(`${API}?v=${Date.now()}`);
        data = await r.json();
      } catch { continue; }

      const state = data.state;
      const type  = data.type;
      const msg   = data.message || '';

      if (state === 'running') {
        setStatus(`<span class="ai-dd-spinner">⚙️</span> ${msg || `Analyzing ${ticker}…`}`, '#60a5fa');
        continue;
      }

      if (state === 'pending') {
        setStatus(`<span class="ai-dd-spinner">⏳</span> Queued — waiting for poller…`, '#f59e0b');
        continue;
      }

      if (state === 'done' && type === 'ticker-analysis') {
        // Verify the completed result is actually for our ticker before fetching
        if (data.ticker && data.ticker !== ticker) {
          // Different ticker completed — keep polling, ours may be queued next
          continue;
        }
        setStatus(`<span class="ai-dd-spinner">⏳</span> Loading ${ticker} results…`, '#60a5fa');
        try {
          const r2 = await fetch(`/data/ticker-analysis.json?v=${Date.now()}`);
          if (!r2.ok) {
            // Vercel may still be deploying — keep polling up to timeout
            continue;
          }
          const res = await r2.json();
          if (res.ticker === ticker) {
            setStatus('');
            renderResult(res);
            setButtonState(false, 'Analyze');
            polling = false; return;
          }
          // JSON ticker mismatch — keep polling
        } catch (e) {
          // JSON parse error or network — keep retrying until timeout
          continue;
        }
      }

      if (state === 'error') {
        const errMsg = msg.includes('No sufficient data')
          ? `No sufficient data found for <strong>${ticker}</strong> in the current dataset. Try refreshing data first.`
          : `❌ Analysis failed for ${ticker}. Try again.`;
        setStatus(errMsg, '#9ca3af');
        setButtonState(false, 'Analyze');
        polling = false; return;
      }
    }
  }

  function init() {
    const input = document.getElementById('dd-ticker-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
      });
    }
  }

  return { init, submit };
})();
