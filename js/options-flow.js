/**
 * Options Flow Page — full-page dashboard
 * Browser-direct to ThetaData Pro at localhost:25503 / localhost:25520
 */

const OptionsFlowPage = (() => {
  const THETA_REST  = 'http://localhost:25503/v3';
  const THETA_WS    = 'ws://localhost:25520';
  const MAX_TRADES  = 3000;
  const SENT_WIN_MS = 30 * 60 * 1000; // 30-min sentiment window
  const PANEL_TICK  = 5000;            // update right panels every 5s

  let allTrades    = [];
  let isPaused     = false;
  let ws           = null;
  let reconnTimer  = null;
  let panelTimer   = null;
  let contractHits = {}; // sweep detection: key -> { count, firstTime }
  let tickerStats  = {}; // { sym: { callPrem, putPrem, count, recent[] } }

  let filters = {
    ticker: '', type: 'ALL', minPremium: 0, dte: 'ANY', sweepsOnly: false,
  };

  // ── Helpers ────────────────────────────────────────────────────────────

  function calcDTE(exp) {
    const s = String(exp);
    if (s.length !== 8) return null;
    const d = new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8));
    const t = new Date(); t.setHours(0,0,0,0);
    return Math.ceil((d - t) / 86400000);
  }

  function fmtPrem(p) {
    if (!p) return '—';
    if (p >= 1e6)  return `$${(p/1e6).toFixed(2)}M`;
    if (p >= 1000) return `$${(p/1000).toFixed(0)}K`;
    return `$${p.toFixed(0)}`;
  }

  function fmtExp(exp) {
    const s = String(exp);
    return s.length === 8 ? `${s.slice(4,6)}/${s.slice(6,8)}/${s.slice(2,4)}` : s;
  }

  function detectSweep(trade) {
    if (trade.sweep) return true;
    const key = `${trade.symbol}_${trade.expiration}_${trade.strike}_${trade.right}`;
    const now = Date.now();
    if (!contractHits[key] || now - contractHits[key].firstTime > 60000) {
      contractHits[key] = { count: 1, firstTime: now };
    } else {
      contractHits[key].count++;
    }
    return contractHits[key].count >= 3;
  }

  // ── Filter ─────────────────────────────────────────────────────────────

  function passes(trade) {
    if (filters.ticker && trade.symbol !== filters.ticker) return false;
    const r = (trade.right || '').toUpperCase();
    if (filters.type === 'CALL' && r !== 'C') return false;
    if (filters.type === 'PUT'  && r !== 'P') return false;
    if (filters.minPremium > 0 && (trade.premium || 0) < filters.minPremium) return false;
    if (filters.sweepsOnly && !trade.isSweep) return false;
    if (filters.dte !== 'ANY' && trade.expiration != null) {
      const dte = calcDTE(trade.expiration);
      if (dte == null) return true;
      if (filters.dte === '0-7'  && !(dte >= 0 && dte <= 7))   return false;
      if (filters.dte === '7-30' && !(dte > 7  && dte <= 30))  return false;
      if (filters.dte === '30+'  && dte <= 30)                  return false;
    }
    return true;
  }

  // ── Tape rendering ─────────────────────────────────────────────────────

  function makeRow(trade) {
    const right   = (trade.right || '?').toUpperCase();
    const isCall  = right === 'C' || right === 'CALL';
    const side    = (trade.side || trade.condition || '').toUpperCase();
    const sideLabel = side === 'A' || side === 'BUY' ? 'BUY' : side === 'B' || side === 'SELL' ? 'SELL' : side || '—';
    const sideClass = sideLabel === 'BUY' ? 'tf-side-buy' : sideLabel === 'SELL' ? 'tf-side-sell' : '';
    const flags   = `${trade.isSweep ? '🔥' : ''}${(trade.premium||0) >= 500000 ? '🐳' : ''}`;

    const el = document.createElement('div');
    el.className = `tape-row tape-${isCall ? 'call' : 'put'}`;
    el.innerHTML = `
      <span class="tape-flags">${flags}</span>
      <span class="tape-sym">${trade.symbol || '—'}</span>
      <span class="tape-strike">${trade.strike != null ? trade.strike.toFixed(0) : '—'}</span>
      <span class="tape-expiry">${trade.expiration ? fmtExp(trade.expiration) : '—'}</span>
      <span class="tape-cp tape-cp-${isCall?'c':'p'}">${right}</span>
      <span class="tape-prem">${fmtPrem(trade.premium)}</span>
      <span class="tape-size">${trade.size != null ? `${trade.size}x` : '—'}</span>
      <span class="tape-side ${sideClass}">${sideLabel}</span>
      <span class="tape-exch">${trade.exchange || ''}</span>
    `;
    return el;
  }

  function prependToTape(trade) {
    if (!passes(trade)) return;
    const tape = document.getElementById('of-tape');
    if (!tape || isPaused) return;
    tape.insertBefore(makeRow(trade), tape.firstChild);
    while (tape.children.length > 600) tape.removeChild(tape.lastChild);
  }

  function rebuildTape() {
    const tape = document.getElementById('of-tape');
    if (!tape) return;
    tape.innerHTML = '';
    const rows = allTrades.filter(passes).slice(0, 400);
    rows.forEach(t => tape.appendChild(makeRow(t)));
    if (!rows.length) tape.innerHTML = '<div class="tape-empty">No trades match current filters</div>';
  }

  // ── Ticker stats ───────────────────────────────────────────────────────

  function accStats(trade) {
    const sym = trade.symbol; if (!sym) return;
    if (!tickerStats[sym]) tickerStats[sym] = { callPrem: 0, putPrem: 0, count: 0, recent: [] };
    const s = tickerStats[sym];
    const r = (trade.right || '').toUpperCase();
    const p = trade.premium || 0;
    if (r === 'C') s.callPrem += p; else if (r === 'P') s.putPrem += p;
    s.count++;
    s.recent.push({ t: Date.now(), p });
    if (s.recent.length > 2000) s.recent.shift();
  }

  // ── Top Tickers panel ──────────────────────────────────────────────────

  function updateTopTickers() {
    const el = document.getElementById('of-top-tickers');
    if (!el) return;
    const sorted = Object.entries(tickerStats)
      .map(([sym, s]) => {
        const total = s.callPrem + s.putPrem;
        return { sym, total, callPct: total ? s.callPrem / total : 0.5 };
      })
      .sort((a, b) => b.total - a.total).slice(0, 10);

    if (!sorted.length) { el.innerHTML = '<div class="of-empty">Collecting…</div>'; return; }
    el.innerHTML = '';
    sorted.forEach(({ sym, total, callPct }) => {
      const row = document.createElement('div');
      row.className = 'of-ticker-row';
      row.innerHTML = `
        <span class="of-tk-sym">${sym}</span>
        <div class="of-tk-bar">
          <div class="of-tk-call" style="width:${(callPct*100).toFixed(1)}%"></div>
          <div class="of-tk-put"  style="width:${((1-callPct)*100).toFixed(1)}%"></div>
        </div>
        <span class="of-tk-total">${fmtPrem(total)}</span>
      `;
      row.addEventListener('click', () => {
        document.getElementById('of-ticker-search').value = sym;
        setFilter('ticker', sym);
        OptionsFlowPage.loadGreeks(sym);
      });
      el.appendChild(row);
    });
  }

  // ── Unusual Activity panel ─────────────────────────────────────────────

  function updateUnusual() {
    const el = document.getElementById('of-unusual');
    if (!el) return;
    const now = Date.now();
    const win = 5 * 60 * 1000;
    const rates = Object.entries(tickerStats).map(([sym, s]) => {
      const recent = s.recent.filter(r => now - r.t < win).reduce((a, r) => a + r.p, 0);
      return { sym, recent, total: s.callPrem + s.putPrem };
    });
    const avg = rates.length ? rates.reduce((a, r) => a + r.recent, 0) / rates.length : 0;
    const unusual = rates.filter(r => r.recent > avg * 2 && r.recent > 5000)
      .sort((a, b) => b.recent - a.recent).slice(0, 8);

    if (!unusual.length) { el.innerHTML = '<div class="of-empty">No unusual activity detected</div>'; return; }
    el.innerHTML = '';
    unusual.forEach(({ sym, recent }) => {
      const mult  = avg > 0 ? (recent / avg).toFixed(1) : '—';
      const heat  = recent > avg * 10 ? '#ef4444' : recent > avg * 5 ? '#f97316' : '#eab308';
      const row   = document.createElement('div');
      row.className = 'of-unusual-row';
      row.innerHTML = `
        <span class="of-unu-dot" style="background:${heat};box-shadow:0 0 4px ${heat}88"></span>
        <span class="of-unu-sym">${sym}</span>
        <span class="of-unu-dev">${mult}× avg</span>
        <span class="of-unu-prem">${fmtPrem(recent)}/5m</span>
      `;
      row.addEventListener('click', () => {
        document.getElementById('of-ticker-search').value = sym;
        setFilter('ticker', sym);
        OptionsFlowPage.loadGreeks(sym);
      });
      el.appendChild(row);
    });
  }

  // ── Greeks Snapshot panel ──────────────────────────────────────────────

  async function loadGreeks(ticker) {
    const el = document.getElementById('of-greeks');
    const hdr = document.getElementById('of-greeks-ticker');
    if (!el) return;
    if (hdr) hdr.textContent = ticker;
    el.innerHTML = '<div class="of-empty">Loading…</div>';
    try {
      const res = await fetch(`${THETA_REST}/option/snapshot/greeks?symbol=${encodeURIComponent(ticker)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data.rows || data.data || data.results || [];
      if (!rows.length) throw new Error('No data');

      let netDelta = 0, ivSum = 0, ivCount = 0, maxGamma = 0, calls = 0, puts = 0;
      rows.forEach(r => {
        if (r.delta != null) netDelta += r.delta;
        if (r.iv    != null) { ivSum += r.iv; ivCount++; }
        if (r.gamma != null && Math.abs(r.gamma) > maxGamma) maxGamma = Math.abs(r.gamma);
        const rt = (r.right || '').toUpperCase();
        if (rt === 'C') calls++; else if (rt === 'P') puts++;
      });
      const avgIV  = ivCount ? (ivSum / ivCount * 100).toFixed(1) : '—';
      const pcRatio = calls ? (puts / calls).toFixed(2) : '—';

      el.innerHTML = `
        <div class="of-greeks-grid">
          <div class="of-greek-item">
            <div class="of-greek-label">Net Delta</div>
            <div class="of-greek-value ${netDelta >= 0 ? 'greek-pos':'greek-neg'}">${netDelta.toFixed(0)}</div>
          </div>
          <div class="of-greek-item">
            <div class="of-greek-label">Avg IV</div>
            <div class="of-greek-value">${avgIV}%</div>
          </div>
          <div class="of-greek-item">
            <div class="of-greek-label">P/C Ratio</div>
            <div class="of-greek-value">${pcRatio}</div>
          </div>
          <div class="of-greek-item">
            <div class="of-greek-label">Peak Gamma</div>
            <div class="of-greek-value">${maxGamma.toFixed(4)}</div>
          </div>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="of-empty">⚠ ${err.message}</div>`;
    }
  }

  // ── Sentiment Strip ────────────────────────────────────────────────────

  function updateSentiment() {
    const now = Date.now();
    const recent = allTrades.filter(t => now - (t._at || 0) < SENT_WIN_MS);
    let callP = 0, putP = 0;
    recent.forEach(t => {
      const r = (t.right || '').toUpperCase();
      if (r === 'C') callP += t.premium || 0;
      else if (r === 'P') putP += t.premium || 0;
    });
    const total = callP + putP;
    if (!total) return;

    const pc = putP / (callP || 1);
    const callPct = (callP / total * 100).toFixed(0);
    let sent, sentColor;
    if (pc > 1.2)       { sent = '▼ BEARISH'; sentColor = '#ef4444'; }
    else if (pc < 0.8)  { sent = '▲ BULLISH'; sentColor = '#22c55e'; }
    else                { sent = '◆ NEUTRAL'; sentColor = '#f59e0b'; }

    const pcEl   = document.getElementById('of-sent-ratio');
    const sentEl = document.getElementById('of-sent-text');
    const barEl  = document.getElementById('of-sent-bar');
    const timeEl = document.getElementById('of-sent-time');

    if (pcEl)   pcEl.textContent  = pc.toFixed(2);
    if (sentEl) { sentEl.textContent = sent; sentEl.style.color = sentColor; }
    if (barEl)  barEl.innerHTML   = `<div class="sent-call" style="width:${callPct}%"></div><div class="sent-put" style="width:${100-callPct}%"></div>`;
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }

  // ── Filter setter ──────────────────────────────────────────────────────

  function setFilter(key, value) {
    filters[key] = value;
    rebuildTape();
  }

  // ── WebSocket ──────────────────────────────────────────────────────────

  function connectWS() {
    if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    const statusEl = document.getElementById('of-ws-status');
    try {
      ws = new WebSocket(THETA_WS);
      ws.onopen = () => {
        if (statusEl) { statusEl.textContent = '● LIVE'; statusEl.style.color = '#22c55e'; }
        ws.send(JSON.stringify({ req_type: 'TRADE', sec_type: 'OPTION', root: '' }));
      };
      ws.onmessage = (e) => {
        try {
          const raw = JSON.parse(e.data);
          const trade = { ...raw, isSweep: detectSweep(raw), _at: Date.now() };
          allTrades.unshift(trade);
          if (allTrades.length > MAX_TRADES) allTrades.length = MAX_TRADES;
          accStats(trade);
          prependToTape(trade);
          document.getElementById('of-last-update').textContent =
            new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        } catch {}
      };
      ws.onerror = () => {
        if (statusEl) { statusEl.textContent = '⚠ WS error'; statusEl.style.color = '#f59e0b'; }
      };
      ws.onclose = () => {
        if (statusEl) { statusEl.textContent = '○ Reconnecting…'; statusEl.style.color = '#4a5060'; }
        reconnTimer = setTimeout(connectWS, 5000);
      };
    } catch (err) {
      if (statusEl) statusEl.textContent = `⚠ ${err.message}`;
      reconnTimer = setTimeout(connectWS, 10000);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init() {
    // URL params
    const params = new URLSearchParams(location.search);
    const pre = params.get('ticker');
    if (pre) {
      filters.ticker = pre.toUpperCase();
      const inp = document.getElementById('of-ticker-search');
      if (inp) inp.value = pre.toUpperCase();
    }

    // Filter bar wiring
    document.getElementById('of-ticker-search')?.addEventListener('input', e => {
      setFilter('ticker', e.target.value.trim().toUpperCase());
    });
    document.querySelectorAll('.of-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.of-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setFilter('type', btn.dataset.type);
      });
    });
    document.getElementById('of-min-premium')?.addEventListener('change', e => setFilter('minPremium', +e.target.value));
    document.getElementById('of-dte')?.addEventListener('change', e => setFilter('dte', e.target.value));
    document.getElementById('of-sweeps-only')?.addEventListener('change', e => setFilter('sweepsOnly', e.target.checked));

    // Tape pause on hover
    const tape = document.getElementById('of-tape');
    if (tape) {
      tape.addEventListener('mouseenter', () => isPaused = true);
      tape.addEventListener('mouseleave', () => isPaused = false);
    }

    // Panel refresh
    panelTimer = setInterval(() => {
      updateTopTickers();
      updateUnusual();
      updateSentiment();
    }, PANEL_TICK);

    connectWS();

    // Bootstrap snapshot
    const sym = filters.ticker || 'SPY';
    fetch(`${THETA_REST}/option/snapshot/quote?symbol=${encodeURIComponent(sym)}`)
      .then(r => r.json())
      .then(data => {
        const rows = Array.isArray(data) ? data : data.rows || data.data || data.results || [];
        rows.forEach(raw => {
          const trade = { symbol: sym, ...raw, isSweep: false, _at: Date.now() - Math.random() * 120000 };
          allTrades.push(trade);
          accStats(trade);
        });
        rebuildTape();
        updateTopTickers();
        updateUnusual();
        updateSentiment();
        if (rows.length) loadGreeks(sym);
      })
      .catch(() => {
        if (tape) tape.innerHTML = '<div class="tape-empty">Waiting for live stream from ThetaData…</div>';
      });
  }

  return { init, setFilter, loadGreeks };
})();
