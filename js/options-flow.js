/**
 * Options Flow Page — reads from flow-tape.json (produced by flow-tape-daemon.py)
 * Falls back to options-flow.json if flow-tape.json not available.
 * Panels: Live Tape, Flow Signals (P/C Z-score, CVD, Flips), Sweep Alerts,
 *         Top Tickers, Per-Symbol Detail, Sector Flow, Premium Concentration.
 */
const OptionsFlowPage = (() => {
  const STALE_MIN  = 5;
  const PANEL_TICK = 15 * 1000;  // refresh every 15s
  let allTrades     = [];
  let symbolMetrics = {};
  let sweepData     = [];
  let sectorFlow    = {};
  let concentration = null;
  let isPaused      = false;
  let panelTimer    = null;
  let contractHits  = {};
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
  function fmtTime(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  }

  // ── Filter ─────────────────────────────────────────────────────────────
  function passes(trade) {
    if (filters.ticker && (trade.symbol || '').toUpperCase() !== filters.ticker) return false;
    const r = (trade.right || '').toUpperCase();
    if (filters.type === 'CALL' && r !== 'C') return false;
    if (filters.type === 'PUT'  && r !== 'P') return false;
    if (filters.minPremium > 0 && (trade.premium || 0) < filters.minPremium) return false;
    if (filters.sweepsOnly && !trade.sweep_id) return false;
    if (filters.dte !== 'ANY' && trade.expiration != null) {
      const dte = trade.dte != null ? trade.dte : calcDTE(trade.expiration);
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
    const side    = (trade.side || '').toUpperCase();

    let sideLabel = side || '—';
    const sideClass = (sideLabel === 'BUY') ? 'tf-side-buy'
                    : (sideLabel === 'SELL') ? 'tf-side-sell' : '';

    const isSweep = !!trade.sweep_id;
    const isWhale = (trade.premium || 0) >= 1_000_000;
    const isOTM   = trade.is_otm;
    const flags   = `${isSweep ? '🔥' : ''}${isWhale ? '🐳' : ''}${isOTM ? '' : ''}`;

    const el = document.createElement('div');
    el.className = `tape-row tape-${isCall ? 'call' : 'put'}${isSweep ? ' tape-sweep' : ''}`;
    el.innerHTML = `
      <span class="tape-flags">${flags}</span>
      <span class="tape-sym">${trade.symbol || '—'}</span>
      <span class="tape-strike">${trade.strike != null ? (+trade.strike).toFixed(0) : '—'}</span>
      <span class="tape-expiry">${trade.expiration ? fmtExp(trade.expiration) : '—'}</span>
      <span class="tape-cp tape-cp-${isCall?'c':'p'}">${right}</span>
      <span class="tape-prem">${fmtPrem(trade.premium)}</span>
      <span class="tape-time">${fmtTime(trade.timestamp)}</span>
      <span class="tape-size">${trade.size != null ? `${trade.size}x` : '—'}</span>
      <span class="tape-side ${sideClass}">${sideLabel}</span>
    `;
    return el;
  }

  function rebuildTape(data) {
    const tape = document.getElementById('of-tape');
    if (!tape) return;
    tape.innerHTML = '';

    const since = timeSince(data.fetched_at);
    const stale = isStale(data.fetched_at);

    // Update status elements
    const statusEl = document.getElementById('of-last-update');
    if (statusEl) {
      statusEl.textContent = since || '—';
      statusEl.style.color = stale ? '#f59e0b' : '';
    }

    const countEl = document.getElementById('of-trade-count');
    if (countEl) countEl.textContent = (data.total_trades || 0).toLocaleString();

    const premEl = document.getElementById('of-total-premium');
    if (premEl) premEl.textContent = fmtPrem(data.total_premium || 0);

    const wsEl = document.getElementById('of-ws-status');
    if (wsEl) {
      if (!data.fetched_at) {
        wsEl.textContent = 'No data'; wsEl.style.color = '#9ca3af';
      } else if (stale) {
        wsEl.textContent = 'Stale'; wsEl.style.color = '#f59e0b';
      } else {
        wsEl.textContent = 'Live'; wsEl.style.color = '#22c55e';
      }
    }

    if (!data.fetched_at) {
      tape.innerHTML = '<div class="tape-empty">Awaiting flow tape — daemon starts at market open</div>';
      return;
    }
    if (!data.market_open) {
      tape.insertAdjacentHTML('beforeend', '<div class="tape-empty" style="color:#f59e0b">Market Closed — showing last session data</div>');
    } else if (stale) {
      tape.insertAdjacentHTML('beforeend', '<div class="tape-empty" style="color:#f59e0b">\u26a0 Data may be stale</div>');
    }

    // Sort trades by timestamp descending (newest first)
    const sorted = [...(data.trades || [])].sort((a, b) => {
      if (b.timestamp && a.timestamp) return b.timestamp.localeCompare(a.timestamp);
      return (b.premium || 0) - (a.premium || 0);
    });

    const rows = sorted.filter(passes).slice(0, 500);
    if (!rows.length) {
      tape.insertAdjacentHTML('beforeend', '<div class="tape-empty">No trades match current filters</div>');
      return;
    }
    rows.forEach(t => tape.appendChild(makeRow(t)));
  }

  // ── Flow Signals Panel ─────────────────────────────────────────────────
  function updateFlowSignals() {
    const el = document.getElementById('of-flow-signals');
    if (!el || !symbolMetrics) return;

    const entries = Object.entries(symbolMetrics)
      .filter(([, m]) => m.total_trades > 0)
      .sort((a, b) => Math.abs(b[1].pc_zscore || 0) - Math.abs(a[1].pc_zscore || 0));

    if (!entries.length) {
      el.innerHTML = '<div class="of-empty">Awaiting flow signals…</div>';
      return;
    }

    el.innerHTML = '';
    entries.forEach(([sym, m]) => {
      const z = m.pc_zscore || 0;
      let zClass = 'z-neutral';
      if (Math.abs(z) >= 2.0) zClass = z > 0 ? 'z-hot' : 'z-cool';
      else if (Math.abs(z) >= 1.0) zClass = 'z-warm';

      const cvd = m.cvd || 0;
      const cvdColor = cvd > 0 ? 'var(--green)' : cvd < 0 ? 'var(--red)' : 'var(--text-muted)';

      let flipHtml = '';
      if (m.flip_direction) {
        const flipClass = m.flip_direction.includes('BULL') ? 'flip-bull' : 'flip-bear';
        const flipLabel = m.flip_direction.includes('BULL') ? 'BULL FLIP' : 'BEAR FLIP';
        flipHtml = `<span class="of-signal-flip ${flipClass}">${flipLabel}</span>`;
      }

      const row = document.createElement('div');
      row.className = 'of-signal-row';
      row.innerHTML = `
        <span class="of-signal-sym">${sym}</span>
        <span class="of-signal-pc">${(m.pc_ratio || 0).toFixed(2)}</span>
        <span class="of-signal-zscore ${zClass}">${z >= 0 ? '+' : ''}${z.toFixed(1)}\u03c3</span>
        <span class="of-signal-cvd" style="color:${cvdColor}">${cvd > 0 ? '+' : ''}${cvd.toLocaleString()}</span>
        ${flipHtml}
      `;
      row.addEventListener('click', () => {
        document.getElementById('of-ticker-search').value = sym;
        setFilter('ticker', sym);
        loadDetail(sym);
      });
      el.appendChild(row);
    });
  }

  // ── Sweep Alerts Panel ─────────────────────────────────────────────────
  function updateSweeps() {
    const el = document.getElementById('of-sweeps');
    if (!el) return;

    if (!sweepData || !sweepData.length) {
      el.innerHTML = '<div class="of-empty">No sweeps detected</div>';
      return;
    }

    el.innerHTML = '';
    // Show most recent sweeps first
    const sorted = [...sweepData].sort((a, b) => (b.total_premium || 0) - (a.total_premium || 0));

    sorted.forEach(s => {
      const isBuy = (s.side || '').toUpperCase() === 'BUY';
      const right = (s.right || '').toUpperCase();
      const isCall = right === 'C';
      const premClass = isBuy ? 'sweep-buy' : 'sweep-sell';

      const row = document.createElement('div');
      row.className = 'of-sweep-row';
      row.innerHTML = `
        <span class="of-sweep-icon">\ud83d\udd25</span>
        <span class="of-sweep-sym">${s.symbol || '—'}</span>
        <span class="of-sweep-detail">
          ${(+s.strike).toFixed(0)} ${isCall ? 'C' : 'P'}
          · ${s.num_legs || 0} fills
          · ${(s.exchanges || []).length} exch
          · ${s.duration_ms || 0}ms
        </span>
        <span class="of-sweep-prem ${premClass}">${fmtPrem(s.total_premium)}</span>
      `;
      row.addEventListener('click', () => {
        document.getElementById('of-ticker-search').value = s.symbol;
        setFilter('ticker', s.symbol);
      });
      el.appendChild(row);
    });
  }

  // ── Top Tickers Panel ──────────────────────────────────────────────────
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
    // Calculate recent velocity (last 15 min vs prior 15 min)
    const now = new Date();
    const t15 = new Date(now - 15*60*1000);
    const t30 = new Date(now - 30*60*1000);
    const recentFlow = {};
    const priorFlow = {};
    allTrades.forEach(t => {
      const sym = t.symbol; if (!sym) return;
      const ts = new Date(t.ts);
      const prem = t.premium || 0;
      if (ts >= t15) recentFlow[sym] = (recentFlow[sym]||0) + prem;
      else if (ts >= t30) priorFlow[sym] = (priorFlow[sym]||0) + prem;
    });

    sorted.forEach(({ sym, total, callPct }) => {
      const recent = recentFlow[sym] || 0;
      const prior = priorFlow[sym] || 0;
      let arrow = '';
      let arrowColor = 'var(--text-muted)';
      if (prior > 0) {
        const velocity = (recent - prior) / prior;
        if (velocity > 0.5) { arrow = '⬆'; arrowColor = '#22c55e'; }
        else if (velocity > 0.1) { arrow = '↑'; arrowColor = '#22c55e80'; }
        else if (velocity < -0.5) { arrow = '⬇'; arrowColor = '#ef4444'; }
        else if (velocity < -0.1) { arrow = '↓'; arrowColor = '#ef444480'; }
        else { arrow = '→'; }
      } else if (recent > 0) {
        arrow = '🔥'; // New flow, nothing to compare
      }

      const row = document.createElement('div');
      row.className = 'of-ticker-row';
      row.innerHTML = `
        <span class="of-tk-sym">${sym}</span>
        <span style="font-size:12px;color:${arrowColor};min-width:18px;text-align:center">${arrow}</span>
        <div class="of-tk-bar">
          <div class="of-tk-call" style="width:${(callPct*100).toFixed(0)}%"></div>
          <div class="of-tk-put"  style="width:${((1-callPct)*100).toFixed(0)}%"></div>
        </div>
        <span class="of-tk-total">${fmtPrem(total)}</span>
      `;
      row.addEventListener('click', () => {
        document.getElementById('of-ticker-search').value = sym;
        setFilter('ticker', sym);
        loadDetail(sym);
      });
      el.appendChild(row);
    });
  }

  // ── Per-Symbol Detail Panel ────────────────────────────────────────────
  function loadDetail(ticker) {
    if (window.loadTickerAnalysis) window.loadTickerAnalysis(ticker);
    const el  = document.getElementById('of-greeks');
    const hdr = document.getElementById('of-greeks-ticker');
    if (!el) return;
    if (hdr) hdr.textContent = ticker;

    // Get daemon metrics for this symbol
    const m = symbolMetrics[ticker];
    const tTrades = allTrades.filter(t => t.symbol === ticker);

    if (!tTrades.length && !m) {
      el.innerHTML = '<div class="of-empty">No data for ' + ticker + '</div>';
      return;
    }

    // Calculate from trades if no daemon metrics
    const calls = tTrades.filter(t => (t.right||'').toUpperCase() === 'C');
    const puts  = tTrades.filter(t => (t.right||'').toUpperCase() === 'P');
    const callPrem = calls.reduce((a, t) => a + (t.premium||0), 0);
    const putPrem  = puts.reduce( (a, t) => a + (t.premium||0), 0);

    const pcRatio   = m ? m.pc_ratio : (calls.length ? puts.length / calls.length : 0);
    const pcZscore  = m ? m.pc_zscore : 0;
    const pcBase    = m ? m.pc_baseline : 0.7;
    const cvd       = m ? m.cvd : 0;
    const otmCall   = m ? m.otm_call_premium : 0;
    const otmPut    = m ? m.otm_put_premium : 0;
    const flipDir   = m ? m.flip_direction : '';
    const flipTs    = m ? m.last_flip_ts : '';

    let flipHtml = '';
    if (flipDir) {
      const fc = flipDir.includes('BULL') ? 'var(--green)' : 'var(--red)';
      flipHtml = `
        <div class="of-greek-item" style="grid-column:span 2">
          <div class="of-greek-label">FLOW FLIP</div>
          <div class="of-greek-value" style="color:${fc};font-size:14px">${flipDir.replace('_', ' ')}</div>
          <div style="font-size:10px;color:var(--text-muted)">${flipTs ? timeSince(flipTs) : ''}</div>
        </div>`;
    }

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
          <div class="of-greek-value">${pcRatio.toFixed(2)} <span style="font-size:10px;color:var(--text-muted)">base: ${pcBase.toFixed(2)}</span></div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">Z-Score</div>
          <div class="of-greek-value" style="color:${Math.abs(pcZscore) >= 2 ? 'var(--red)' : Math.abs(pcZscore) >= 1 ? 'var(--accent)' : 'var(--text-primary)'}">${pcZscore >= 0 ? '+' : ''}${pcZscore.toFixed(2)}\u03c3</div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">CVD (Net Buy)</div>
          <div class="of-greek-value" style="color:${cvd > 0 ? 'var(--green)' : cvd < 0 ? 'var(--red)' : 'var(--text-muted)'}">${cvd > 0 ? '+' : ''}${cvd.toLocaleString()}</div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">Trades</div>
          <div class="of-greek-value">${tTrades.length}</div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">OTM Calls</div>
          <div class="of-greek-value greek-pos">${fmtPrem(otmCall)}</div>
        </div>
        <div class="of-greek-item">
          <div class="of-greek-label">OTM Puts</div>
          <div class="of-greek-value greek-neg">${fmtPrem(otmPut)}</div>
        </div>
        ${flipHtml}
      </div>`;
  }

  // ── Sector Flow Strip ──────────────────────────────────────────────────
  function updateSectorFlow() {
    const el = document.getElementById('of-sector-strip');
    if (!el || !sectorFlow) return;

    let html = '<span class="of-sector-label">SECTOR FLOW</span>';
    for (const [name, data] of Object.entries(sectorFlow)) {
      const dir = data.net_direction || 'NEUTRAL';
      const dirClass = dir === 'BULLISH' ? 'dir-bull' : dir === 'BEARISH' ? 'dir-bear' : 'dir-neut';
      html += `
        <div class="of-sector-item">
          <span style="color:var(--text-primary);font-weight:600;text-transform:uppercase">${name}</span>
          <span class="of-sector-dir ${dirClass}">${dir}</span>
          <span class="of-sector-pc">P/C ${(data.pc_ratio || 0).toFixed(2)}</span>
        </div>`;
    }
    el.innerHTML = html;
  }

  // ── Premium Concentration Alert ────────────────────────────────────────
  function updateConcentration() {
    const wrap = document.getElementById('of-concentration-wrap');
    if (!wrap) return;

    if (!concentration || !concentration.symbol) {
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="of-concentration">
        <span class="of-concentration-icon">\u26a0\ufe0f</span>
        <span class="of-concentration-text">
          <strong>Premium Concentration:</strong>
          ${(concentration.concentration_pct || 0).toFixed(0)}% of total flow in
          <strong>${concentration.symbol}</strong>
          (${fmtPrem(concentration.premium)})
        </span>
      </div>`;
  }

  // ── Sentiment Strip ────────────────────────────────────────────────────
  function updateSentiment() {
    // Use aggregated metrics from flow-tape if available
    let totalCallPrem = 0, totalPutPrem = 0;
    allTrades.forEach(t => {
      const r = (t.right || '').toUpperCase();
      if (r === 'C') totalCallPrem += (t.premium || 0);
      else if (r === 'P') totalPutPrem += (t.premium || 0);
    });

    const total = totalCallPrem + totalPutPrem;
    const callPct = total ? (totalCallPrem / total * 100).toFixed(0) : 50;
    const pcRatio = totalCallPrem > 0 ? totalPutPrem / totalCallPrem : 0;

    let sent, sentColor;
    if (pcRatio > 1.2) { sent = 'BEARISH'; sentColor = '#ef4444'; }
    else if (pcRatio < 0.6) { sent = 'BULLISH'; sentColor = '#22c55e'; }
    else { sent = 'NEUTRAL'; sentColor = '#f59e0b'; }

    const pcEl   = document.getElementById('of-sent-ratio');
    const sentEl = document.getElementById('of-sent-text');
    const barEl  = document.getElementById('of-sent-bar');
    if (pcEl)   pcEl.textContent = pcRatio.toFixed(2);
    if (sentEl) { sentEl.textContent = sent; sentEl.style.color = sentColor; }
    if (barEl)  barEl.innerHTML = `<div class="sent-call" style="width:${callPct}%"></div><div class="sent-put" style="width:${100-callPct}%"></div>`;
  }

  // ── Main data load ─────────────────────────────────────────────────────
  async function loadFlowData() {
    let data = null;
    let usingTape = false;

    // Try flow-tape.json first (from daemon)
    try {
      const res = await fetch(`/data/flow-tape.json?v=${Date.now()}`);
      if (res.ok) {
        data = await res.json();
        usingTape = true;
      }
    } catch {}

    // Fallback to options-flow.json
    if (!data) {
      try {
        const res = await fetch(`/data/options-flow.json?v=${Date.now()}`);
        if (res.ok) data = await res.json();
      } catch {}
    }

    if (!data) {
      const tape = document.getElementById('of-tape');
      if (tape) tape.innerHTML = '<div class="tape-empty">Awaiting flow data — check back during market hours</div>';
      return;
    }

    // Extract data — merge new trades instead of replacing
    const incomingTrades = data.trades || [];
    if (allTrades.length === 0) {
      allTrades = incomingTrades;
    } else {
      // Build set of existing trade keys for dedup
      const existingKeys = new Set(allTrades.map(t => 
        (t.symbol||'') + (t.strike||'') + (t.expiration||'') + (t.right||'') + (t.ts||'') + (t.size||'')
      ));
      let newCount = 0;
      for (const t of incomingTrades) {
        const key = (t.symbol||'') + (t.strike||'') + (t.expiration||'') + (t.right||'') + (t.ts||'') + (t.size||'');
        if (!existingKeys.has(key)) {
          allTrades.push(t);
          newCount++;
        }
      }
      // Sort by timestamp descending
      allTrades.sort((a, b) => (b.ts||'').localeCompare(a.ts||''));
      // Cap at 5000 to prevent memory issues
      if (allTrades.length > 5000) allTrades = allTrades.slice(0, 5000);
    }
    symbolMetrics = data.symbol_metrics || {};
    sweepData = data.sweeps || [];
    sectorFlow = data.sector_flow || {};
    concentration = data.premium_concentration || null;

    // Update all panels
    rebuildTape(data);
    updateTopTickers();
    updateFlowSignals();
    updateSweeps();
    updateSectorFlow();
    updateConcentration();
    updateSentiment();
  }

  function setFilter(key, value) {
    filters[key] = value;
    const fakeData = {
      fetched_at: new Date().toISOString(),
      market_open: true,
      trades: allTrades,
      total_trades: allTrades.length,
      total_premium: allTrades.reduce((a, t) => a + (t.premium || 0), 0),
    };
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

    // Top tickers click → load detail
    document.getElementById('of-top-tickers')?.addEventListener('click', e => {
      const sym = e.target.closest('.of-ticker-row')?.querySelector('.of-tk-sym')?.textContent;
      if (sym) loadDetail(sym);
    });

    // Filter toggle (mobile)
    document.getElementById('of-filter-toggle')?.addEventListener('click', () => {
      document.querySelector('.of-filter-bar')?.classList.toggle('filter-open');
    });

    loadFlowData();
    panelTimer = setInterval(() => {
      if (!isPaused) loadFlowData();
    }, PANEL_TICK);
  }

  return { init, setFilter, loadDetail };
})();

// ── Neon DB Integration (persistent flow queries) ──────────────────────
(function wireNeonFlow() {
  async function fetchFromNeon(params) {
    const qs = new URLSearchParams(params).toString();
    try {
      const res = await fetch('/api/flow-trades?' + qs);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  function renderNeonTrades(data, filterLabel) {
    const tape = document.getElementById('of-tape');
    if (!tape) return;
    tape.innerHTML = '';
    if (filterLabel) {
      tape.insertAdjacentHTML('beforeend',
        '<div class="tape-empty" style="color:#22c55e;font-size:11px;padding:4px 8px;border-bottom:1px solid var(--border)">' +
        '🔍 Showing: ' + filterLabel + ' (' + (data.trades || []).length + ' trades from DB)' +
        ' <span style="cursor:pointer;color:#f59e0b;margin-left:8px" onclick="OptionsFlowPage._clearNeonFilter()">✕ Clear</span></div>');
    }
    const statusEl = document.getElementById('of-trade-count');
    if (statusEl) statusEl.textContent = (data.total_trades || 0).toLocaleString();
    const premEl = document.getElementById('of-total-premium');
    if (premEl) {
      const p = data.total_premium || 0;
      premEl.textContent = p >= 1e9 ? '$' + (p/1e9).toFixed(2) + 'B' : p >= 1e6 ? '$' + (p/1e6).toFixed(1) + 'M' : '$' + p.toLocaleString();
    }
    if (!data.trades || !data.trades.length) {
      tape.insertAdjacentHTML('beforeend', '<div class="tape-empty">No trades found for this filter</div>');
      return;
    }
    data.trades.forEach(t => {
      // Map DB fields to expected format for makeRow
      const trade = {
        symbol: t.symbol,
        strike: t.strike,
        expiration: t.expiration ? String(t.expiration).slice(0,10).replace(/-/g, '') : null,
        right: t.right,
        premium: t.premium,
        timestamp: t.timestamp,
        size: t.size,
        side: t.side,
        sweep_id: t.sweep_id
      };
      const right = (trade.right || '').toUpperCase();
      const isCall = right === 'C' || right === 'CALL';
      const side = (trade.side || '').toUpperCase();
      const isSweep = !!trade.sweep_id;
      const isWhale = (trade.premium || 0) >= 1000000;
      const flags = (isSweep ? '🔥' : '') + (isWhale ? '🐳' : '');
      const sideClass = side === 'BUY' ? 'tf-side-buy' : side === 'SELL' ? 'tf-side-sell' : '';
      const fmtPrem = (p) => {
        if (!p) return '—';
        if (p >= 1e6) return '$' + (p/1e6).toFixed(2) + 'M';
        if (p >= 1000) return '$' + (p/1000).toFixed(0) + 'K';
        return '$' + p.toFixed(0);
      };
      const fmtExp = (exp) => {
        const s = String(exp);
        return s.length === 8 ? s.slice(4,6) + '/' + s.slice(6,8) + '/' + s.slice(2,4) : s;
      };
      const fmtTime = (ts) => {
        if (!ts) return '';
        try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
        catch { return ''; }
      };
      const el = document.createElement('div');
      el.className = 'tape-row tape-' + (isCall ? 'call' : 'put') + (isSweep ? ' tape-sweep' : '');
      el.innerHTML =
        '<span class="tape-flags">' + flags + '</span>' +
        '<span class="tape-sym">' + (trade.symbol || '—') + '</span>' +
        '<span class="tape-strike">' + (trade.strike != null ? (+trade.strike).toFixed(0) : '—') + '</span>' +
        '<span class="tape-expiry">' + (trade.expiration ? fmtExp(trade.expiration) : '—') + '</span>' +
        '<span class="tape-cp tape-cp-' + (isCall ? 'c' : 'p') + '">' + right + '</span>' +
        '<span class="tape-prem">' + fmtPrem(trade.premium) + '</span>' +
        '<span class="tape-time">' + fmtTime(trade.timestamp) + '</span>' +
        '<span class="tape-size">' + (trade.size != null ? trade.size + 'x' : '—') + '</span>' +
        '<span class="tape-side ' + sideClass + '">' + (side || '—') + '</span>';
      tape.appendChild(el);
    });
  }

  // Override flow signal click to fetch from Neon
  const origSignals = OptionsFlowPage.updateFlowSignals;
  const signalEl = document.getElementById('of-flow-signals');
  if (signalEl) {
    signalEl.addEventListener('click', async function(e) {
      const row = e.target.closest('.of-signal-row');
      if (!row) return;
      const sym = row.querySelector('.of-signal-sym')?.textContent?.trim();
      if (!sym) return;
      const data = await fetchFromNeon({ symbol: sym, min_premium: 50000 });
      if (data) renderNeonTrades(data, sym + ' flow');
      OptionsFlowPage.loadDetail(sym);
    });
  }

  // Override sweep click to fetch from Neon
  const sweepEl = document.getElementById('of-sweeps');
  if (sweepEl) {
    sweepEl.addEventListener('click', async function(e) {
      const row = e.target.closest('.of-sweep-row');
      if (!row) return;
      const sym = row.querySelector('.of-sweep-sym')?.textContent?.trim();
      if (!sym) return;
      const data = await fetchFromNeon({ symbol: sym, min_premium: 100000 });
      if (data) renderNeonTrades(data, sym + ' sweeps');
      OptionsFlowPage.loadDetail(sym);
    });
  }

  // Clear filter — reload live tape
  OptionsFlowPage._clearNeonFilter = function() {
    document.getElementById('of-ticker-search').value = '';
    OptionsFlowPage.setFilter('ticker', '');
  };
})();
