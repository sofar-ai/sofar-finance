// v2026.03.21.quant
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
  function freshness(dateStr) {
    if (!dateStr) return '<span style="color:#6b7280">No timestamp</span>';
    var d = new Date(dateStr);
    var isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    if (isNaN(d.getTime())) {
      var parts = dateStr.split('-');
      if (parts.length === 3) { d = new Date(parts[0], parts[1]-1, parts[2]); isDateOnly = true; }
      if (isNaN(d.getTime())) return '<span style="color:#6b7280">' + dateStr + '</span>';
    }
    var now = new Date();
    if (isDateOnly) {
      // Parse YYYY-MM-DD as local date, not UTC
      var parts2 = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var dDate = parts2 ? new Date(parseInt(parts2[1]), parseInt(parts2[2])-1, parseInt(parts2[3])) : new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var diffDays = Math.round((today - dDate) / 86400000);
      if (diffDays === 0) return '<span style="color:#22c55e">Today</span>';
      if (diffDays === 1) return '<span style="color:#f59e0b">Yesterday</span>';
      var color = diffDays <= 3 ? '#f59e0b' : '#ef4444';
      return '<span style="color:' + color + '">' + diffDays + 'd ago</span>';
    }
    var diffH = (now - d) / 3600000;
    var label = diffH < 1 ? Math.floor(diffH*60) + 'm ago' : diffH < 24 ? Math.floor(diffH) + 'h ago' : Math.floor(diffH/24) + 'd ago';
    var color = diffH < 4 ? '#22c55e' : diffH < 24 ? '#f59e0b' : '#ef4444';
    return '<span style="color:' + color + '">' + label + '</span>';
  }


  // Returns the next scheduled cron run time: :40 of 9,11,13,15 ET on weekdays
  function nextScheduledRun() {
    const RUN_HOURS_ET = [8, 10, 12, 14, 15, 18]; // synthesis times — must match cron
    const now = new Date();
    // Detect ET offset (EDT=UTC-4, EST=UTC-5) using DST heuristic
    const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
    const isDST = now.getTimezoneOffset() < Math.max(jan, jul);
    const etOffsetHours = isDST ? -4 : -5; // hours behind UTC

    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      for (const h of RUN_HOURS_ET) {
        // Build candidate entirely in UTC: h:40 ET = (h - etOffsetHours):40 UTC
        const candidate = new Date(Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset,
          h - etOffsetHours, 40, 0, 0
        ));
        // Verify weekday in ET (shift candidate back by |etOffset| to get ET date)
        const etDay = new Date(candidate.getTime() + etOffsetHours * 3600000).getUTCDay();
        if (etDay === 0 || etDay === 6) continue; // skip weekends
        if (candidate > now) return candidate;
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

  function nextTradingDayLabel() {
    // Returns "Tomorrow" Mon-Thu, "Mon" on Friday, skips weekends
    const now = new Date();
    const etOff = (() => {
      const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
      const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
      return now.getTimezoneOffset() < Math.max(jan, jul) ? -4 : -5;
    })();
    const etNow = new Date(now.getTime() + (etOff + now.getTimezoneOffset()/60) * 3600000);
    const dayET = etNow.getDay(); // 0=Sun 6=Sat
    if (dayET === 5) return 'Next Trading Day';
    if (dayET === 6) return 'Next Trading Day';
    if (dayET === 0) return 'Next Trading Day';
    return 'Next Trading Day';
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

  function renderPage(data, stats, log, ci) {
    // api_error state — show clean unavailable message, never fake signals
    if (data?.status === 'api_error') {
      const body = document.getElementById('ai-page-body');
      if (body) body.innerHTML = `<div class="ai-pending-box">
        <div class="ai-pending-icon">⚠️</div>
        <div class="ai-pending-title">Analysis Temporarily Unavailable</div>
        <div class="ai-pending-sub">${data.error_message || 'AI synthesis encountered an API error.'}</div>
        <div class="ai-pending-sub" style="color:#6b7280;margin-top:4px">Failed at ${data.failed_at ? new Date(data.failed_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + ' ET' : '—'} · Next run at ${data.next_update ? new Date(data.next_update).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + ' ET' : '—'}</div>
      </div>`;
      return;
    }
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
          ${sig.primary_driver ? `<div class="ai-sc-pdriver"><span class="ai-driver-badge">${sig.primary_driver}</span></div>` : ''}
          ${(sig.predicted_range && sig.predicted_range.length === 2) ? `<div class="ai-sc-range">Range: $${sig.predicted_range[0].toFixed(2)} – $${sig.predicted_range[1].toFixed(2)}</div>` : ''}
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

    // ── Calibration Notes ──
    const calEl = document.getElementById('ai-calibration-notes');
    if (calEl) {
      const rawNotes = data.calibration_notes;
      const regime = data.regime || '';
      // calibration_notes may be a string or a structured dict
      let notesHtml = '';
      if (rawNotes && typeof rawNotes === 'object') {
        const fields = [
          ['Pattern', rawNotes.pattern_acknowledgment],
          ['Conviction', rawNotes.conviction_audit],
          ['Target bias', rawNotes.target_bias_correction],
          ['Regime', rawNotes.regime_adjustment],
        ];
        const parts = fields.filter(([,v]) => v && v.length > 5).map(([k,v]) => `<b>${k}:</b> ${v}`);
        notesHtml = parts.join('<br>');
        if (!notesHtml && rawNotes.specific_changes?.length) notesHtml = rawNotes.specific_changes.join('; ');
      } else if (rawNotes && typeof rawNotes === 'string' && rawNotes.length > 20) {
        notesHtml = rawNotes;
      }
      if (notesHtml) {
        calEl.innerHTML = `
          <div class="ai-cal-header">🧠 Calibration Notes
            ${regime ? `<span class="ai-regime-badge">${regime.replace(/_/g,' ')}</span>` : ''}
          </div>
          <div class="ai-cal-text">${notesHtml}</div>`;
        calEl.style.display = 'block';
      } else { calEl.style.display = 'none'; }
    }

    // ── Quantitative Model & Regime Section ──
    (async () => {
      try {
        const regimeRes = await fetch('data/vol-regime.json?t=' + Date.now());
        if (regimeRes.ok) {
          const regime = await regimeRes.json();
          const badge = document.getElementById('ai-regime-badge');
          const detail = document.getElementById('ai-regime-detail');
          if (badge && regime.regime) {
            const r = regime.regime;
            badge.textContent = r.toUpperCase();
            badge.className = 'ai-regime-badge-large ' + r;
            const conf = regime.regime_confidence ? (regime.regime_confidence * 100).toFixed(0) + '%' : '—';
            const levels = regime.key_levels || {};
            const inp = regime.inputs || {};
            detail.innerHTML = [
              '<div class="qc-stat"><span>Confidence</span><span class="qc-val">' + conf + '</span></div>',
              '<div class="qc-stat"><span>GEX Regime</span><span class="qc-val">' + (inp.gex_regime || '—') + '</span></div>',
              '<div class="qc-stat"><span>VIX</span><span class="qc-val">' + (inp.vix_spot ? inp.vix_spot.toFixed(1) : '—') + '</span></div>',
              '<div class="qc-stat"><span>Term Structure</span><span class="qc-val">' + (inp.term_structure || '—') + '</span></div>',
              levels.put_wall ? '<div class="qc-stat"><span>Put Wall</span><span class="qc-val">$' + levels.put_wall + '</span></div>' : '',
              levels.call_wall ? '<div class="qc-stat"><span>Call Wall</span><span class="qc-val">$' + levels.call_wall + '</span></div>' : '',
              '<div class="qc-stat qc-freshness"><span>Updated</span>' + freshness(regime.date || regime.computed_at || data.generated_at) + '</div>',
            ].filter(Boolean).join('');
          }
        }
      } catch(e) { console.warn('Regime load error:', e); }
      // Load all 3 LightGBM models
      const modelConfigs = [
        { file: 'data/lgbm-prediction.json', sigId: 'ai-lgbm-7d-signal', detId: 'ai-lgbm-7d-detail' },
        { file: 'data/lgbm-prediction-14d.json', sigId: 'ai-lgbm-14d-signal', detId: 'ai-lgbm-14d-detail' },
        { file: 'data/lgbm-prediction-21d.json', sigId: 'ai-lgbm-21d-signal', detId: 'ai-lgbm-21d-detail' },
      ];
      const mColors = {BULLISH:'#22c55e',BEARISH:'#ef4444',NEUTRAL:'#f59e0b'};
      const mEmojis = {BULLISH:'\u{1F7E2}',BEARISH:'\u{1F534}',NEUTRAL:'\u{1F7E1}'};
      // Load Sharpe from metadata files
      const sharpeMeta = [
        { file: 'data/lgbm-metadata-7d.json', elId: 'lgbm-7d-sharpe' },
        { file: 'data/lgbm-metadata-14d.json', elId: 'lgbm-14d-sharpe' },
        { file: 'data/lgbm-metadata-21d.json', elId: 'lgbm-21d-sharpe' },
      ];
      for (const sm of sharpeMeta) {
        try {
          const r = await fetch(sm.file + '?t=' + Date.now());
          if (r.ok) {
            const meta = await r.json();
            const el = document.getElementById(sm.elId);
            if (el && meta.walk_forward_sharpe) {
              el.textContent = '(Sharpe ' + Number(meta.walk_forward_sharpe).toFixed(2) + ')';
            }
          }
        } catch(e) {}
      }
      for (const mc of modelConfigs) {
        try {
          const r = await fetch(mc.file + '?t=' + Date.now());
          if (r.ok) {
            const m = await r.json();
            const sig = document.getElementById(mc.sigId);
            const det = document.getElementById(mc.detId);
            if (sig && m.direction) {
              sig.innerHTML = '<span style="color:' + (mColors[m.direction]||'#f59e0b') + '">' + (mEmojis[m.direction]||'') + ' ' + m.direction + ' (' + m.confidence + '%)</span>';
              det.innerHTML = [
                '<div class="qc-stat"><span>Horizon</span><span class="qc-val">' + (m.horizon || 'unknown') + '</span></div>',
                '<div class="qc-stat"><span>Features</span><span class="qc-val">' + (m.signals_used || 0) + '</span></div>',
                '<div class="qc-stat"><span>Probability</span><span class="qc-val">' + ((m.probability||0)*100).toFixed(1) + '%</span></div>',
                '<div class="qc-stat"><span>Data</span><span class="qc-val">' + (m.date || 'n/a') + '</span></div>',
                '<div class="qc-stat qc-freshness"><span>Updated</span>' + freshness(m.date) + '</div>',
              ].join('');
            }
          }
        } catch(e) { console.warn('Model load error:', mc.file, e); }
      }
      try {
        const dpRes = await fetch('data/dark-pool.json?t=' + Date.now());
        if (dpRes.ok) {
          const dp = await dpRes.json();
          const sig = document.getElementById('ai-darkpool-signal');
          const detail = document.getElementById('ai-darkpool-detail');
          if (sig && dp.tickers) {
            const spy = dp.tickers.SPY;
            const color = spy > 0.55 ? '#ef4444' : spy < 0.40 ? '#22c55e' : '#f59e0b';
            sig.innerHTML = '<span style="color:' + color + '">SPY: ' + (spy*100).toFixed(1) + '% short</span>';
            const rows = Object.entries(dp.tickers).sort((a,b) => b[1] - a[1]).slice(0, 5).map(function(item) {
              const c = item[1] > 0.55 ? 'color:#ef4444' : item[1] < 0.35 ? 'color:#22c55e' : '';
              return '<div class="qc-stat"><span>' + item[0] + '</span><span class="qc-val" style="' + c + '">' + (item[1]*100).toFixed(1) + '%</span></div>';
            }).join('');
            detail.innerHTML = rows + '<div class="qc-stat"><span>Source</span><span class="qc-val">FINRA ADF</span></div>' + '<div class="qc-stat qc-freshness"><span>Updated</span>' + freshness(dp.date) + '</div>';
          }
        }
      } catch(e) { console.warn('Dark pool load error:', e); }
    })();

    // -- Trade Recommendations --
    (async () => {
      try {
        const trRes = await fetch('data/trade-recommendations.json?t=' + Date.now());
        if (trRes.ok) {
          const tr = await trRes.json();
          const grid = document.getElementById('ai-trades-grid');
          if (grid && tr.trades && tr.trades.length > 0) {
            const dir = tr.direction || 'NEUTRAL';
            const dirClass = dir === 'BEARISH' ? 'bearish' : dir === 'BULLISH' ? 'bullish' : '';
            grid.innerHTML = tr.trades.map(function(trade) {
              var legs = (trade.legs || []).map(function(leg) {
                var cls = leg.action === 'BUY' ? 'buy' : 'sell';
                return '<div class="ai-tc-leg"><span class="' + cls + '">' + leg.action + '</span> $' + leg.strike.toFixed(0) + ' ' + leg.right + ' @ $' + leg.premium.toFixed(2) + '</div>';
              }).join('');
              var rr = typeof trade.risk_reward === 'number' ? trade.risk_reward.toFixed(2) + 'x' : 'N/A';
              return '<div class="ai-trade-card ' + dirClass + '">' +
                '<div class="ai-tc-type">' + (trade.type || '').replace(/_/g, ' ').toUpperCase() + '</div>' +
                '<div class="ai-tc-desc">' + (trade.description || '') + '</div>' +
                '<div style="font-size:11px;color:#f59e0b;margin:4px 0 8px;font-family:var(--font-mono)">' + (tr.expiration || '—') + ' (' + (tr.dte || '?') + ' DTE)</div>' +
                '<div class="ai-tc-legs">' + legs + '</div>' +
                '<div class="ai-tc-stats">' +
                  '<div class="ai-tc-stat"><span>Debit</span><span class="ai-tc-val">$' + trade.debit + '</span></div>' +
                  '<div class="ai-tc-stat"><span>Max Profit</span><span class="ai-tc-val green">$' + trade.max_profit + '</span></div>' +
                  '<div class="ai-tc-stat"><span>Max Loss</span><span class="ai-tc-val red">$' + trade.max_loss + '</span></div>' +
                  '<div class="ai-tc-stat"><span>Breakeven</span><span class="ai-tc-val">$' + trade.breakeven + '</span></div>' +
                  '<div class="ai-tc-stat"><span>Risk/Reward</span><span class="ai-tc-val green">' + rr + '</span></div>' +
                  '<div class="ai-tc-stat"><span>Aggressive</span><span class="ai-tc-val">' + (trade.sizing && trade.sizing.aggressive ? trade.sizing.aggressive.pct + '%' : (trade.suggested_size_pct || '?') + '%') + ' portfolio</span></div>' +
                  '<div class="ai-tc-stat"><span>Conservative</span><span class="ai-tc-val">' + (trade.sizing && trade.sizing.conservative ? trade.sizing.conservative.pct + '%' : '1%') + ' portfolio</span></div>' +
                '</div>' +
                '<div class="ai-tc-hold">Hold ' + (tr.exit_rules ? tr.exit_rules.optimal_horizon : '?') + ' days | ' + (tr.exit_rules ? tr.exit_rules.exit_strategy.replace(/_/g,' ') : '') + '</div>' +
              '</div>';
            }).join('');
            // Add freshness indicator
            grid.innerHTML += '<div class="qc-stat qc-freshness" style="margin-top:8px"><span>Updated</span>' + freshness(tr.date) + '</div>';
          }
        }
      } catch(e) { console.warn('Trades load error:', e); }
    })();

    // -- Polymarket Prediction Markets --
    (async () => {
      try {
        var pmRes = await fetch('data/polymarket.json?t=' + Date.now());
        if (pmRes.ok) {
          var pm = await pmRes.json();
          var comp = document.getElementById('ai-pm-composite');
          var detail = document.getElementById('ai-pm-detail');
          var mkts = document.getElementById('ai-pm-markets');
          if (comp && pm.composite !== undefined) {
            var color = pm.composite < -0.1 ? '#ef4444' : pm.composite > 0.1 ? '#22c55e' : '#f59e0b';
            var interp = pm.interpretation || (pm.composite < -0.1 ? 'BEARISH' : pm.composite > 0.1 ? 'BULLISH' : 'NEUTRAL');
            comp.innerHTML = '<span style="color:' + color + '">' + pm.composite.toFixed(4) + ' (' + interp + ')</span>';
            var cats = pm.categories || {};
            detail.innerHTML = Object.entries(cats).map(function(e) {
              return '<div class="qc-stat"><span>' + e[0] + '</span><span class="qc-val">' + (e[1].probability * 100).toFixed(1) + '%</span></div>';
            }).join('');
          }
          if (mkts && pm.markets) {
            mkts.innerHTML = pm.markets.slice(0, 6).map(function(m) {
              return '<div class="qc-stat"><span>' + (m.question || '').substring(0, 45) + '</span><span class="qc-val">' + m.probability + '%</span></div>';
            }).join('');
            // Add freshness indicator
            mkts.innerHTML += '<div class="qc-stat qc-freshness"><span>Updated</span>' + freshness(pm.date) + '</div>';
          }
        }
      } catch(e) { console.warn('Polymarket load error:', e); }
    })();

    // -- Overnight Market Scan --
    (async () => {
      try {
        var onRes = await fetch('data/overnight-scan.json?t=' + Date.now());
        if (onRes.ok) {
          var on = await onRes.json();
          var comp = document.getElementById('ai-on-composite');
          var detail = document.getElementById('ai-on-detail');
          var mkts = document.getElementById('ai-on-markets');
          if (comp && on.composite !== undefined) {
            var color = on.composite < -0.1 ? '#ef4444' : on.composite > 0.1 ? '#22c55e' : '#f59e0b';
            var interp = on.interpretation || (on.composite < -0.1 ? 'BEARISH' : on.composite > 0.1 ? 'BULLISH' : 'NEUTRAL');
            comp.innerHTML = '<span style="color:' + color + '">' + on.composite.toFixed(4) + ' (' + interp + ')</span>';
            if (detail) {
              detail.innerHTML = '<div class="qc-stat"><span>Scan time</span><span class="qc-val">' + (on.scan_time || 'N/A') + '</span></div>' +
                '<div class="qc-stat"><span>Phase</span><span class="qc-val">' + (on.phase || 'N/A') + '</span></div>';
            }
          }
          if (mkts && on.markets) {
            mkts.innerHTML = on.markets.filter(function(m) { return m.change_pct !== null; }).slice(0, 8).map(function(m) {
              var chgColor = m.change_pct > 0 ? '#22c55e' : m.change_pct < 0 ? '#ef4444' : '#f59e0b';
              return '<div class="qc-stat"><span>' + m.name + '</span><span class="qc-val" style="color:' + chgColor + '">' + (m.change_pct > 0 ? '+' : '') + m.change_pct.toFixed(2) + '%</span></div>';
            }).join('');
            // Add freshness indicator
            mkts.innerHTML += '<div class="qc-stat qc-freshness"><span>Updated</span>' + freshness(on.scan_time) + '</div>';
          }
        }
      } catch(e) { console.warn('Overnight load error:', e); }
    })();

    // -- Section 1: News & Flow impact --
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
              <div class="ai-ticker-top-row">
                <span class="ai-ticker-sym ai-bench-sym">${sym}</span>
              </div>
              <div class="ai-ticker-top-row">
                <span class="ai-ticker-badge" style="color:${idc};border-color:${idc}55">ID: ${b.intraday_bias||'—'}</span>
                <span class="ai-ticker-badge" style="color:${ndc};border-color:${ndc}55">ND: ${b.next_day_bias||'—'}</span>
                <span class="ai-ticker-badge" style="color:${ltc};border-color:${ltc}55">LT: ${b.long_term_bias||'—'}</span>
              </div>
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
              <div class="ai-ticker-top-row">
                <span class="ai-ticker-sym">${t.ticker}</span>
              </div>
              <div class="ai-ticker-top-row">
                <span class="ai-ticker-badge" style="color:${idc};border-color:${idc}55">ID: ${t.intraday_bias||t.short_term_bias||'—'}</span>
                <span class="ai-ticker-badge" style="color:${ndc};border-color:${ndc}55">ND: ${t.next_day_bias||'—'}</span>
                <span class="ai-ticker-badge" style="color:${ltc};border-color:${ltc}55">LT: ${t.long_term_bias||'—'}</span>
              </div>
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
            ${idea.instrument ? `<div class="ai-idea-detail"><strong>Instrument:</strong> ${idea.instrument}</div>` : ''}
            ${idea.entry_zone ? `<div class="ai-idea-detail"><strong>Entry:</strong> ${idea.entry_zone}</div>` : ''}
            ${idea.stop_invalidation ? `<div class="ai-idea-detail"><strong>Stop:</strong> ${idea.stop_invalidation}</div>` : ''}
            ${idea.target ? `<div class="ai-idea-detail"><strong>Target:</strong> ${idea.target}</div>` : ''}
            <div class="ai-idea-risk"><strong>Risk:</strong> ${idea.risk||'—'}</div>
            ${idea.risk_reward ? `<div class="ai-idea-rr">R/R: ${idea.risk_reward}</div>` : ''}`;
          ideasEl.appendChild(card);
        });
      }
    }

    // Ensure magnitude-flags container exists
    if (!document.getElementById('ai-magnitude-flags')) {
      const magDiv = document.createElement('div');
      magDiv.id = 'ai-magnitude-flags';
      magDiv.className = 'ai-magnitude-flags';
      const ideasSection = document.getElementById('ai-ideas-list');
      if (ideasSection && ideasSection.parentNode) {
        ideasSection.parentNode.insertBefore(magDiv, ideasSection.nextSibling);
      }
    }
    // ── Section 3b: Magnitude Flags ──
    const magEl = document.getElementById('ai-magnitude-flags');
    if (magEl) {
      const flags = data.magnitude_flags || [];
      if (flags.length) {
        magEl.innerHTML = flags.map(f => `
          <div class="ai-mag-flag">
            <span class="ai-mag-ticker">${f.ticker||''}</span>
            <span class="ai-mag-label">⚡ OUTSIZED MOVE EXPECTED</span>
            <span class="ai-mag-basis">${f.basis||''}</span>
          </div>`).join('');
        magEl.style.display = '';
      } else { magEl.style.display = 'none'; }
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
        { key: 'next_day',  label: nextTradingDayLabel()       },
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

      // Last 10 predictions table — expandable rows
      const last10 = (log || []).slice(-10).reverse();
      const TF_LABEL = { intraday: 'ID', next_day: 'ND', long_term: 'LT' };
      const tableRows = last10.map((e, idx) => {
        const dt = new Date(e.prediction_time);
        const label = `${dt.getMonth()+1}/${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`;
        const sig   = e.signal || e.short_term_signal || '—';
        const tf    = TF_LABEL[e.timeframe] || e.timeframe || 'ID';
        const ok    = e.signal_correct ?? e.short_term_correct ?? (
          e.ticker_results && e.ticker_results.length > 0
            ? e.ticker_results.filter(t => t.correct).length > e.ticker_results.length / 2
            : undefined
        );
        const avgErr = e.overall_price_error_pct != null
          ? `${(+e.overall_price_error_pct).toFixed(2)}%` : '—';
        // Most common grade from ticker_results
        const grades = (e.ticker_results||[]).map(t => t.price_accuracy_grade).filter(Boolean);
        const grade = grades.length
          ? Object.entries(grades.reduce((a,g)=>{a[g]=(a[g]||0)+1;return a},{}))
              .sort((a,b)=>b[1]-a[1])[0][0]
          : (e.price_accuracy_grade || '—');
        // Expanded ticker rows
        const tickerRows = (e.ticker_results||[]).map(t => {
          const tOk = t.correct;
          const tErr = t.price_error_pct != null ? `${(+t.price_error_pct).toFixed(2)}%` : '—';
          const pred = t.predicted_price != null ? `$${(+t.predicted_price).toFixed(2)}` : '—';
          const actVal = t.price_at_backcheck ?? t.actual_price;
          const act  = actVal != null ? `$${(+actVal).toFixed(2)}` : '—';
          return `<div class="ai-hist-expand-row">
            <span>${t.ticker||'?'}</span>
            <span>${pred}</span>
            <span>${act}</span>
            <span>${tErr}</span>
            <span class="${tOk?'ai-correct':'ai-incorrect'}">${tOk?'✓':'✗'}</span>
          </div>`;
        }).join('');
        const expandHtml = tickerRows ? `
          <div class="ai-hist-expand">
            <div class="ai-hist-expand-hdr">
              <span>TICKER</span><span>PRED</span><span>ACTUAL</span><span>ERR%</span><span>DIR</span>
            </div>
            ${tickerRows}
          </div>` : '';
        const wrapId = `ai-hist-wrap-${idx}`;
        return `<div class="ai-hist-wrap" id="${wrapId}" onclick="this.classList.toggle('open')">
          <div class="ai-hist-row">
            <span class="ai-hist-time">${label}</span>
            <span class="ai-hist-tf">${tf}</span>
            <span class="ai-hist-sig" style="color:${signalColor(sig)}">${sig}</span>
            <span class="ai-hist-conf">${e.confidence_at_prediction ?? '—'}%</span>
            <span class="ai-hist-result ${ok===undefined?'':''}${ok?'ai-correct':ok===false?'ai-incorrect':''}">${ok===undefined?'—':ok?'✓':'✗'}</span>
            <span class="ai-hist-err">${avgErr}</span>
            <span class="ai-hist-grade">${grade}</span>
            ${expandHtml ? '<span class="ai-hist-caret">▶</span>' : '<span></span>'}
          </div>
          ${expandHtml}
        </div>`;
      }).join('');

      accSection.innerHTML = `
        <div class="ai-tf-bars">${barsHTML}</div>
        <div class="ai-acc-sub" style="margin:8px 0 4px">
          Avg price error: ${stats.avg_price_error_pct != null ? stats.avg_price_error_pct + '%' : '—'}
          ${stats.best_ticker ? ` &nbsp;·&nbsp; Best: <strong>${stats.best_ticker?.ticker || '—'} (${stats.best_ticker?.directional_accuracy_pct?.toFixed(1) ?? '—'}%)</strong> · Worst: <strong>${stats.worst_ticker?.ticker || '—'} (${stats.worst_ticker?.directional_accuracy_pct?.toFixed(1) ?? '—'}%)</strong>` : ''}
        </div>
        <div class="ai-acc-hist-title">Last 10 Predictions</div>
        <div class="ai-acc-hist">
          <div class="ai-hist-header">
            <span>DATE</span>
            <span>TF</span>
            <span>SIGNAL</span>
            <span>CONF</span>
            <span>RESULT</span>
            <span>AVG ERR</span>
            <span>GRADE</span>
            <span></span>
          </div>
          ${tableRows || '<div class="ai-empty">No predictions yet</div>'}
        </div>`;
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
    renderDivergences(data);
    renderContrarian(ci);
  }


  // ── Schedule display ─────────────────────────────────────────────

  function renderSchedule() {
    const el = document.getElementById('ai-schedule');
    if (!el) return;
    el.className = 'ai-schedule-sidebar';

    const FLOW_HOURS = [10, 12, 14, 15]; // :30 past each (9:50 is pre-open special case)
    const SYNTH_HOURS = [8, 10, 12, 14, 15, 18]; // fixed+conditional — must match cron
    const BACKCHECK_HOURS = [10, 12, 14, 16]; // :35 — must match cron (was 10,12,14,16)

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
      return day === 5 ? 'Mon' : 'Tomorrow';  // Friday → Mon, else Tomorrow
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
      { label: 'Data Feeds',    times: '9:50 · 12:30 · 14:30 · 15:30 ET', next: nextRun(FLOW_HOURS, 30),  soon: isNext(FLOW_HOURS, 30)  },
      { label: 'AI Synthesis',  times: '8:45 · 10:00 · 12:45 · 14:45 · 15:45 · 18:30', next: nextRun(SYNTH_HOURS, 45), soon: isNext(SYNTH_HOURS, 45) },
      { label: 'Backcheck',     times: '9:35 · 10:35 · 12:35 · 14:35 · 16:01 ET', next: nextRun(BACKCHECK_HOURS, 35), soon: isNext(BACKCHECK_HOURS, 35) },
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
      const [data, stats, log, ci] = await Promise.allSettled([
        fetchJSON('/data/ai-synthesis.json?t=' + Date.now()),
        fetchJSON('/data/accuracy-stats.json?t=' + Date.now()),
        fetchJSON('/data/accuracy-log.json?t=' + Date.now()),
        fetchJSON('/data/contrarian-ideas.json?t=' + Date.now()),
      ]).then(r => r.map(p => p.status === 'fulfilled' ? p.value : null));

      if (mode === 'strip') renderStrip(data, stats);
      if (mode === 'page')  renderPage(data, stats, log, ci);
    } catch {
      if (mode === 'strip') renderStrip(null, null);
      if (mode === 'page')  renderPage(null, null, null);
    }
  }


  function renderContrarian(ci) {
    const ideas   = (ci && ci.ideas) ? ci.ideas : [];
    const sidebar = document.getElementById('ai-contrarian-sidebar');
    const compact = document.getElementById('ai-contrarian-compact');
    if (!sidebar || !compact) return;

    const active   = ideas.find(x => x.status === 'active');
    const resolved = ideas.filter(x => x.status === 'resolved').slice(0, 5);

    if (!active && !resolved.length) { sidebar.style.display = 'none'; return; }
    sidebar.style.display = '';

    const fmtPx  = p  => p  != null ? `$${(+p).toFixed(2)}` : '—';
    const fmtRet = r  => r  != null ? `${r >= 0 ? '+' : ''}${r.toFixed(1)}%` : 'pending';
    const retCol = r  => r  == null ? '#9ca3af' : r >= 0 ? '#22c55e' : '#ef4444';

    function miniCard(x, isCurrent) {
      const typeUp  = (x.type || '').toUpperCase();
      const typeCol = typeUp.includes('CALL') ? '#22c55e' : typeUp.includes('PUT') ? '#ef4444' : '#f59e0b';
      const ret     = x.return_pct;
      const issued  = x.generated_at ? new Date(x.generated_at).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '—';
      return `<div class="ai-contra-mini${isCurrent ? ' ai-contra-mini-active' : ''}">
        <div class="ai-contra-mini-top">
          <span class="ai-contra-mini-ticker">${x.ticker}</span>
          <span class="ai-contra-mini-type" style="color:${typeCol}">${typeUp}</span>
          <span class="ai-contra-mini-ret" style="color:${retCol(ret)}">${x.status==='active'?'ACTIVE':fmtRet(ret)}</span>
        </div>
        <div class="ai-contra-mini-thesis">${(x.thesis||'').slice(0,90)}${(x.thesis||'').length>90?'…':''}</div>
        <div class="ai-contra-mini-meta">${fmtPx(x.entry_price)} → ${fmtPx(x.target_price)} · ${issued}</div>
      </div>`;
    }

    // Win/loss summary
    const wins = resolved.filter(x => x.outcome === 'win').length;
    const tot  = resolved.length;
    const scoreLine = tot ? `<div class="ai-contra-mini-score">${wins}/${tot} resolved</div>` : '';

    compact.innerHTML = (active ? miniCard(active, true) : '')
      + (resolved.length ? '<div class="ai-contra-history-label">HISTORY</div>' + resolved.map(x => miniCard(x, false)).join('') : '')
      + scoreLine;
  }

  function renderDivergences(data) {
    const banner = document.getElementById('ai-divergence-banner');
    if (!banner) return;
    const divs = data?.notable_divergences || [];
    if (!divs || !divs.length) { banner.style.display = 'none'; return; }

    // Check localStorage for dismissed items
    const dismissKey = `divDismissed_${data.generated_at || ''}`;
    if (localStorage.getItem(dismissKey)) { banner.style.display = 'none'; return; }

    const high = divs.filter(d => (d.significance || '').toLowerCase() !== 'low');
    if (!high.length) { banner.style.display = 'none'; return; }

    const _detectedAt = data.generated_at
      ? new Date(data.generated_at).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', timeZone:'America/New_York'}) + ' ET'
      : null;

    banner.style.display = '';
    banner.innerHTML = `
      <div class="ai-div-header">
        <span class="ai-div-icon">⚡</span>
        <span class="ai-div-title">Flow Divergence Alert</span>
        ${_detectedAt ? `<span class="ai-div-ts">Detected ${_detectedAt}</span>` : ''}
        <button class="ai-div-dismiss" onclick="(function(){localStorage.setItem('${dismissKey}','1');document.getElementById('ai-divergence-banner').style.display='none'})()">✕</button>
      </div>
      ${high.map(d => {
        const exps = (d.expirations || []).map(e => {
          // Format YYYY-MM-DD → e.g. "Apr 17"
          const dt = new Date(e + 'T12:00:00Z');
          return dt.toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
        });
        return `
        <div class="ai-div-item">
          <span class="ai-div-ticker">${d.ticker}</span>
          <span class="ai-div-detail">${d.description || d.detail || ""}</span>
          ${d.inputs_conflicting ? `<span class="ai-div-conflict">${d.inputs_conflicting}</span>` : ""}
          ${exps.length ? `<span class="ai-div-exp">${exps.join(', ')}</span>` : ''}
          ${d.significance === 'high' ? '<span class="ai-div-sig">HIGH</span>' : ''}
        </div>`;
      }).join('')}
    `;
  }


  function initStrip() {
    load('strip');
    setInterval(() => load('strip'), REFRESH_MS);
  }

  function initPage() {
    load('page');
    renderSchedule();
    // renderContrarian + renderDivergences called inside renderPage() where ci/data are in scope
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
