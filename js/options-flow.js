/**
 * Options Flow Page — reads from static JSON files updated by cron job.
 * No localhost / WebSocket / ThetaData direct calls.
 * Data files: /data/options-flow.json, /data/flow-sentiment.json
 */

const OptionsFlowPage = (() => {
  const STALE_MIN  = 10;
  const PANEL_TICK = 30 * 1000;  // refresh panels every 30s (re-reads JSON)

  let allTrades   = [];
  let isPaused    = false;
  let panelTimer  = null;
  let contractHits = {};

  let filters = {
    ticker: '', type: 'ALL', minPremium: 0, dte: 'ANY', sweepsOnly: false,
  };

  // ── Helpers ────────────────────────────────────────────────────────────

  function timeSince(isoStr) {
    if (!isoStr) return null;
    const diffMin = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const h = Math.floor(diffMin / 60);
    return `${h}h ${diffMin % 60}m ago`;
  }

  function isStale(isoStr) {
    if (!isoStr) return false;
    return (Date.now() - new Date(isoStr).getTime()) > STALE_MIN * 60000;
  }

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
    return `$${(+p).toFixed(0)}`;
  }

  function fmtExp(exp) {
    const s = String(exp);
    return s.length === 8 ? `${s.slice(4,6)}/${s.slice(6,8)}/${s.slice(2,4)}` : s;
  }

  function detectSweep(trade) {
    if (trade.sweep) return true;
    const key = `${trade.symbol}_${trade.expiration}_${trade.strike}_${trade.right}`;
    if (!contractHits[key]) contractHits[key] = { count: 1, firstTime: Date.now() };
    else if (Date.now() - contractHits[key].firstTime > 60000) {
      contractHits[key] = { count: 1, firstTime: Date.now() };
    } else contractHits[key].count++;
    return contractHits[key].count >= 3;
  }

  // ── Filter ─────────────────────────────────────────────────────────────

  function passes(trade) {
    if (filters.ticker && (trade.symbol || '').toUpperCase() !== filters.ticker) return false;
    const r = (trade.right || '').toUpperCase();
    if (filters.type === 'CALL' && r !== 'C') return false;
    if (filters.type === 'PUT'  && r !== 'P') return false;
    if (filters.minPremium > 0 && (trade.premium || 0) < filters.minPremium) return false;
    if (filters.sweepsOnly && !trade.isSweep) return false;
    if (filters.dte !== 'ANY' && trade.expiration != null) {
      const dte = calcDTE(trade.expiration);
      if (dte != null) {
        if (filters.dte === '0-7'  && !(dte >= 0 && dte <= 7))  return false;
        if (filters.dte === '7-30' && !(dte > 7  && dte <= 30)) return false;
        if (filters.dte === '30+'  && dte <= 30)                 return false;
      }
    }
    return true;
  }

  // ── Tape ───────────────────────────────────────────────────────────────

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
      <span class="tape-strike">${trade.strike != null ? (+trade.strike).toFixed(0) : '—'}</span>
      <span class="tape-expiry">${trade.expiration ? fmtExp(trade.expiration) : '—'}</span>
      <span class="tape-cp tape-cp-${isCall?'c':'p'}">${right}</span>
      <span class="tape-prem">${fmtPrem(trade.premium)}</span>
      <span class="tape-size">${trade.size != null ? `${trade.size}x` : '—'}</span>
      <span class="tape-side ${sideClass}">${sideLabel}</span>
      <span class="tape-exch">${trade.exchange || ''}</span>
    `;
    return el;
  }

  function rebuildTape(data) {
    const tape = document.getElementById('of-tape');
    if (!tape) return;
    tape.innerHTML = '';

    // Status bar above tape
    const since = timeSince(data.fetched_at);
    const stale = isStale(data.fetched_at);
    const statusEl = document.getElementById('of-last-update');
    if (statusEl) {
      statusEl.textContent = since || '—';
      statusEl.style.color = stale ? '#f59e0b' : '';
    }

    if (!data.fetched_at) {
      tape.innerHTML = '<div class="tape-empty">Awaiting first data fetch — check back during market hours</div>';
      return;
    }

    if (!data.market_open) {
      tape.insertAdjacentHTML('beforeend', '<div class="tape-empty" style="color:#f59e0b">Market Closed — showing last session data</div>');
    } else if (stale) {
      tape.insertAdjacentHTML('beforeend', '<div class="tape-empty" style="color:#f59e0b">⚠ Data may be stale — next update at next scheduled fetch</div>');
    }

    const rows = (data.trades || []).filter(passes).slice(0, 400);
    if (!rows.length) {
      tape.insertAdjacentHTML('beforeend', '<div class="tape-empty">No trades match current filters</div>');
      return;
    }
    rows.forEach(t => tape.appendChild(makeRow(t)));
  }

  // ── Right panels ───────────────────────────────────────────────────────

  function updateTopTickers() {
    const el = document.getElementById('of-top-tickers');
    if (!el) return;
    const stats = {};
    allTrades.forEach(t => {
      const sym = t.symbol; if (!sym) return;
      if (!stats[sym]) stats[sym] = { c: 0, p: 0 };
      const r = (t.right || '').toUpperCase();
      const prem = t.premium || 0;
      if (r === 'C') stats[sym].c += prem;
      else if (r === 'P') stats[sym].p += prem;
    });
    const sorted = Object.entries(stats)
      .map(([sym, s]) => ({ sym, total: s.c + s.p, callPct: s.c / (s.c + s.p || 1) }))
      .sort((a, b) => b.total - a.total).slice(0, 10);

    if (!sorted.length) { el.innerHTML = '<div class="of-empty">No data yet</div>'; return; }
    el.innerHTML = '';
    sorted.forEach(({ sym, total, callPct }) => {
      const row = document.createElement('div');
      row.className = 'of-ticker-row';
      row.innerHTML = `
        <span class="of-tk-sym">${sym}</span>
        <div class="of-tk-bar">
          <div class="of-tk-call" style="width:${(callPct*100).toFixed(0)}%"></div>
          <div class="of-tk-put"  style="width:${((1-callPct)*100).toFixed(0)}%"></div>
        </div>
        <span class="of-tk-total">${fmtPrem(total)}</span>
      `;
      row.addEventListener('click', () => {
        document.getElementById('of-ticker-search').value = sym;
        setFilter('ticker', sym);
      });
      el.appendChild(row);
    });
  }

  function updateUnusual() {
    const el = document.getElementById('of-unusual');
    if (!el) return;
    const stats = {};
    allTrades.forEach(t => {
      const sym = t.symbol; if (!sym) return;
      if (!stats[sym]) stats[sym] = { total: 0, count: 0 };
      stats[sym].total += t.premium || 0;
      stats[sym].count++;
    });
    const avg = Object.values(stats).reduce((a, s) => a + s.total, 0) / (Object.keys(stats).length || 1);
    const unusual = Object.entries(stats)
      .filter(([,s]) => s.total > avg * 2 && s.total > 10000)
      .sort((a, b) => b[1].total - a[1].total).slice(0, 8);

    if (!unusual.length) { el.innerHTML = '<div class="of-empty">No unusual activity detected</div>'; return; }
    el.innerHTML = '';
    unusual.forEach(([sym, s]) => {
      const mult = avg > 0 ? (s.total / avg).toFixed(1) : '—';
      const heat = s.total > avg * 10 ? '#ef4444' : s.total > avg * 5 ? '#f97316' : '#eab308';
      const row = document.createElement('div');
      row.className = 'of-unusual-row';
      row.innerHTML = `
        <span class="of-unu-dot" style="background:${heat};box-shadow:0 0 4px ${heat}88"></span>
        <span class="of-unu-sym">${sym}</span>
        <span class="of-unu-dev">${mult}× avg</span>
        <span class="of-unu-prem">${fmtPrem(s.total)}</span>
      `;
      row.addEventListener('click', () => {
        document.getElementById('of-ticker-search').value = sym;
        setFilter('ticker', sym);
      });
      el.appendChild(row);
    });
  }

  async function loadGreeks(ticker) {
    const el  = document.getElementById('of-greeks');
    const hdr = document.getElementById('of-greeks-ticker');
    if (!el) return;
    if (hdr) hdr.textContent = ticker;
    // Greeks computed from local trade data (no live API)
    const tTrades = allTrades.filter(t => t.symbol === ticker);
    if (!tTrades.length) { el.innerHTML = '<div class="of-empty">No data for ' + ticker + '</div>'; return; }
    const calls = tTrades.filter(t => (t.right||'').toUpperCase() === 'C');
    const puts  = tTrades.filter(t => (t.right||'').toUpperCase() === 'P');
    const pcRatio = calls.length ? (puts.length / calls.length).toFixed(2) : '—';
    const callPrem = calls.reduce((a, t) => a + (t.premium||0), 0);
    const putPrem  = puts.reduce( (a, t) => a + (t.premium||0), 0);
    el.innerHTML = `
      <div class="of-greeks-grid">
        <div class="of-greek-item">
          <div class="of-greek-label">Call Premium</div>
          <div class="of-greek-value greek-pos">${fmtPrem(callPrem)}</div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">Put Premium</div>
          <div class="of-greek-value greek-neg">${fmtPrem(putPrem)}</div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">P/C Ratio</div>
          <div class="of-greek-value">${pcRatio}</div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">Total Trades</div>
          <div class="of-greek-value">${tTrades.length}</div>
        </div>
      </div>`;
  }

  // ── Sentiment ──────────────────────────────────────────────────────────

  async function loadSentiment() {
    try {
      const res  = await fetch(`/data/flow-sentiment.json?v=${Date.now()}`);
      const data = await res.json();
      const pc   = data.pc_ratio;
      const since = timeSince(data.fetched_at);

      let sent = data.sentiment || 'NEUTRAL', sentColor;
      if (sent === 'BEARISH')      sentColor = '#ef4444';
      else if (sent === 'BULLISH') sentColor = '#22c55e';
      else                         sentColor = '#f59e0b';

      const callP = data.call_premium || 0;
      const putP  = data.put_premium  || 0;
      const total = callP + putP;
      const callPct = total ? (callP / total * 100).toFixed(0) : 50;

      const pcEl   = document.getElementById('of-sent-ratio');
      const sentEl = document.getElementById('of-sent-text');
      const barEl  = document.getElementById('of-sent-bar');
      const timeEl = document.getElementById('of-sent-time');

      if (pcEl)   pcEl.textContent  = pc != null ? pc.toFixed(2) : '—';
      if (sentEl) { sentEl.textContent = `${data.market_open ? '' : '⏸ '}${sent}`; sentEl.style.color = sentColor; }
      if (barEl)  barEl.innerHTML   = `<div class="sent-call" style="width:${callPct}%"></div><div class="sent-put" style="width:${100-callPct}%"></div>`;
      if (timeEl) timeEl.textContent = since ? `Updated ${since}` : '';
    } catch {}
  }

  // ── Main data load ─────────────────────────────────────────────────────

  async function loadFlowData() {
    try {
      const res  = await fetch(`/data/options-flow.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allTrades = (data.trades || []).map(t => ({ ...t, isSweep: detectSweep(t) }));
      rebuildTape(data);
      updateTopTickers();
      updateUnusual();
    } catch {
      const tape = document.getElementById('of-tape');
      if (tape) tape.innerHTML = '<div class="tape-empty">Awaiting first data fetch — check back during market hours</div>';
    }
    loadSentiment();
  }

  function setFilter(key, value) {
    filters[key] = value;
    // Rebuild tape from cached allTrades (no re-fetch)
    const fakeData = { fetched_at: null, market_open: false, trades: allTrades };
    rebuildTape(fakeData);
  }

  function init() {
    // URL params
    const params = new URLSearchParams(location.search);
    const pre = params.get('ticker');
    if (pre) {
      filters.ticker = pre.toUpperCase();
      const inp = document.getElementById('of-ticker-search');
      if (inp) inp.value = pre.toUpperCase();
    }

    // Filter wiring
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

    // Top tickers click → load Greeks
    document.getElementById('of-top-tickers')?.addEventListener('click', e => {
      const sym = e.target.closest('.of-ticker-row')?.querySelector('.of-tk-sym')?.textContent;
      if (sym) loadGreeks(sym);
    });

    loadFlowData();
    panelTimer = setInterval(loadFlowData, PANEL_TICK);
  }

  return { init, setFilter, loadGreeks };
})();
