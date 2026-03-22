'use strict';
(function () {
  const DATA_URL    = '/data/strategy-comparison.json';
  const WEIGHTS_URL = '/data/active-weights-public.json';
  const SYNTH_URL   = '/data/ai-synthesis.json';

  function fmtAge(iso) {
    if (!iso) return '—';
    const m = (Date.now() - new Date(iso)) / 60000;
    return m < 60 ? `${Math.round(m)}m ago` : `${(m/60).toFixed(1)}h ago`;
  }
  function pct(v)    { return v != null ? (+v).toFixed(1) + '%' : '—'; }
  function num(v,d=2){ return v != null ? (+v).toFixed(d) : '—'; }
  function clsAcc(v) { return v == null ? '' : v > 55 ? 'sl-green' : v >= 50 ? 'sl-amber' : 'sl-red'; }
  function clsPbo(v) { return v == null ? '' : v < 0.1  ? 'sl-green' : v <= 0.3  ? 'sl-amber' : 'sl-red'; }

  async function fetchJSON(url) {
    try { const r = await fetch(url + '?t=' + Date.now()); return r.ok ? r.json() : null; }
    catch { return null; }
  }

  let strategies = [], sortKey = 'sharpe', sortDir = -1, expandedRow = null;

  const COLS = [
    { key: 'rank',          label: '#',        fmt:(s,i)=>i+1 },
    { key: 'name',          label: 'Strategy', fmt:s=>`<span class="sl-name">${s.name}</span>` },
    { key: 'ticker',        label: 'Ticker',   fmt:s=>s.ticker },
    { key: 'timeframe',     label: 'TF',       fmt:s=>(s.timeframe||'').replace('_day','d').replace('intraday','ID') },
    { key: 'accuracy',      label: 'Acc%',     fmt:s=>`<span class="${clsAcc(s.accuracy)}">${pct(s.accuracy)}</span>` },
    { key: 'cpcv_accuracy', label: 'CPCV%',    fmt:s=>`<span class="${clsAcc(s.cpcv_accuracy)}">${pct(s.cpcv_accuracy)}</span>` },
    { key: 'sharpe',        label: 'Sharpe',   fmt:s=>num(s.sharpe) },
    { key: 'cpcv_pbo',      label: 'PBO',      fmt:s=>`<span class="${clsPbo(s.cpcv_pbo)}">${num(s.cpcv_pbo)}</span>` },
    { key: 'n_scored',      label: 'Days',     fmt:s=>s.n_scored??'—' },
    { key: 'neutral_pct',   label: 'Neutral%', fmt:s=>pct(s.neutral_pct) },
    { key: 'bull_acc',      label: 'Bull%',    fmt:s=>`<span class="${clsAcc(s.bull_acc)}">${pct(s.bull_acc)}</span>` },
    { key: 'bear_acc',      label: 'Bear%',    fmt:s=>`<span class="${clsAcc(s.bear_acc)}">${pct(s.bear_acc)}</span>` },
  ];

  function renderWeightBar(weights, maxW=280) {
    if (!weights || !Object.keys(weights).length) return '<span style="color:#374151">No weight data</span>';
    const total = Object.values(weights).reduce((a,b)=>a+b,0)||1;
    return Object.entries(weights).map(([k,v])=>{
      const barW = Math.round((v/total)*maxW);
      return `<div class="sl-wbar-row">
        <span class="sl-wbar-lbl">${k.replace(/_/g,' ')}</span>
        <div class="sl-wbar-track"><div class="sl-wbar-fill" style="width:${barW}px"></div></div>
        <span class="sl-wbar-pct">${((v/total)*100).toFixed(1)}%</span>
      </div>`;
    }).join('');
  }

  function renderLeaderboard() {
    const tbody = document.getElementById('sl-tbody');
    if (!tbody) return;
    const sorted = [...strategies].sort((a,b)=>{
      const av=a[sortKey]??( sortDir>0?-1/0:1/0);
      const bv=b[sortKey]??( sortDir>0?-1/0:1/0);
      return sortDir*((bv>av)?1:(bv<av)?-1:0);
    });
    tbody.innerHTML = sorted.map((s,i)=>{
      const exp = expandedRow===s.key;
      return `<tr class="sl-row${exp?' sl-expanded':''}" data-key="${s.key}" onclick="SL.toggleRow('${s.key}')">
        ${COLS.map(c=>`<td>${c.fmt(s,i)}</td>`).join('')}
      </tr>${exp?`<tr class="sl-detail-row"><td colspan="${COLS.length}">
        <div class="sl-detail-inner">
          <div class="sl-detail-title">Signal Weights — ${s.name}</div>
          <div class="sl-wbars">${renderWeightBar(s.weights,320)}</div>
          <div style="margin-top:6px;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#475569">
            Threshold: ${s.threshold??'—'} &nbsp;·&nbsp; n=${s.n_scored??'—'} days &nbsp;·&nbsp; Sharpe ${num(s.sharpe)} &nbsp;·&nbsp; CPCV PBO ${num(s.cpcv_pbo)}
          </div>
        </div></td></tr>`:''}`;
    }).join('');
  }

  function renderHeaders() {
    const thead = document.getElementById('sl-thead');
    if (!thead) return;
    thead.innerHTML = '<tr>'+COLS.map(c=>{
      const active=c.key===sortKey;
      return `<th class="sl-th${active?' sl-th-active':''}" onclick="SL.sort('${c.key}')">${c.label}${active?(sortDir<0?' ▼':' ▲'):''}</th>`;
    }).join('')+'</tr>';
  }

  function renderActiveWeights(data) {
    const el = document.getElementById('sl-active-weights');
    if (!el) return;
    if (!data) { el.innerHTML='<div class="sl-empty">active-weights-public.json not found</div>'; return; }
    const w=data.weights||{}, perf=data.performance||{};
    el.innerHTML=`
      <div class="sl-aw-meta">
        <span class="sl-aw-version">v${data.version||'?'}</span>
        <span class="sl-aw-stat">Acc: <b class="${clsAcc(data.backtest_accuracy)}">${pct(data.backtest_accuracy)}</b></span>
        <span class="sl-aw-stat">Sharpe: <b>${num(data.backtest_sharpe)}</b></span>
        <span class="sl-aw-stat">PBO: <b class="${clsPbo(perf.pbo)}">${num(perf.pbo)}</b></span>
        <span class="sl-aw-stat">${data.sample_size??'?'} days &nbsp;·&nbsp; ${data.date_range||''}</span>
      </div>
      <div class="sl-wbars" style="margin-top:12px">${renderWeightBar(w,340)}</div>
      ${data.regime_guidance?`<div class="sl-rg-title">Regime Guidance</div>`+
        Object.entries(data.regime_guidance).map(([k,v])=>`<div class="sl-rg-row"><b>${k}:</b> ${v}</div>`).join(''):''}`;
  }

  function renderSignalReading(synth, activeW) {
    const el = document.getElementById('sl-signal-reading');
    if (!el) return;
    if (!synth || synth.status==='api_error') { el.innerHTML='<div class="sl-empty">Synthesis data unavailable</div>'; return; }
    const prices=synth.prices_at_generation||{};
    const id=synth.intraday||{};
    const w=(activeW||{}).weights||{};
    const signals=[
      {label:'RSI-14',       value: prices.SPY_RSI??'—',                    weight:w.rsi_14 },
      {label:'VIX Level',    value: prices.VIX??'—',                         weight:w.vix_level },
      {label:'SPY vs MA',    value: `$${(+(prices.SPY||0)).toFixed(2)}`,      weight:w.ma_position },
      {label:'10Y Yield',    value: prices['10Y_YIELD']?`${(+prices['10Y_YIELD']).toFixed(2)}%`:'—', weight:w.yield_curve },
    ];
    el.innerHTML=`
      <div class="sl-sr-header">
        <span>Latest Signal Reading</span>
        <span class="sl-sr-meta">${fmtAge(synth.generated_at)}${activeW?` · v${activeW.version} weights`:''}</span>
      </div>
      <div class="sl-sr-grid">${signals.map(sig=>`
        <div class="sl-sr-card">
          <div class="sl-sr-label">${sig.label}</div>
          <div class="sl-sr-value">${sig.value}</div>
          <div class="sl-sr-weight">Weight: ${sig.weight!=null?pct(sig.weight*100):'—'}</div>
        </div>`).join('')}
      </div>
      <div class="sl-sr-signal">
        Composite: <span class="${id.signal==='BULLISH'?'sl-green':id.signal==='BEARISH'?'sl-red':'sl-amber'}">${id.signal||'—'}</span>
        &nbsp;<span class="sl-sr-conf">${id.confidence??'—'}% confidence</span>
      </div>`;
  }

  async function load() {
    const [data, synth, activeW] = await Promise.all([
      fetchJSON(DATA_URL), fetchJSON(SYNTH_URL), fetchJSON(WEIGHTS_URL)
    ]);
    if (data?.strategies) {
      strategies = data.strategies;
      const ts = document.getElementById('sl-ts');
      if (ts) ts.textContent = 'Updated ' + fmtAge(data.generated_at);
    }
    renderHeaders(); renderLeaderboard(); renderActiveWeights(activeW);
    document.getElementById('sl-regime-heatmap').innerHTML =
      '<div class="sl-placeholder">⏳ Regime heatmap coming — per-regime breakdown not yet in strategy export</div>';
    renderSignalReading(synth, activeW);
  }

  window.SL = {
    sort(key){ sortKey===key ? (sortDir*=-1) : (sortKey=key,sortDir=-1); renderHeaders(); renderLeaderboard(); },
    toggleRow(key){ expandedRow = expandedRow===key ? null : key; renderLeaderboard(); },
  };

  document.addEventListener('DOMContentLoaded', ()=>{ load(); setInterval(load, 5*60*1000); });
})();
