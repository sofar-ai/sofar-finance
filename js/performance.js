/**
 * Performance — prediction accuracy tracker (directional accuracy focus)
 * Data: accuracy-log.json, accuracy-stats.json, prediction-archive.json, pending-backchecks.json
 */

const Performance = (() => {

  function signalColor(s) {
    return s === 'BULLISH' ? '#22c55e' : s === 'BEARISH' ? '#ef4444' : '#f59e0b';
  }
  function tfColor(tf) {
    return { intraday: '#f59e0b', next_day: '#60a5fa', long_term: '#a78bfa' }[tf] || '#9ca3af';
  }
  function tfLabel(tf) {
    return { intraday: 'INTRADAY', next_day: 'NEXT DAY', long_term: '30-DAY' }[tf] || (tf||'').toUpperCase();
  }
  function fmtPrice(p) {
    if (p == null) return '—';
    return `$${(+p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function fmtDT(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }) + ' ET';
  }
  function countdown(iso) {
    if (!iso) return '';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'overdue';
    const m = Math.floor(diff / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`;
  }
  function barHtml(pct, color) {
    return `<div class="perf-bar-track"><div class="perf-bar-fill" style="width:${Math.min(pct,100)}%;background:${color}"></div></div>`;
  }
  function accColor(pct) {
    return pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  }
  function gradeColor(grade) {
    return { Excellent: '#22c55e', Good: '#86efac', Fair: '#f59e0b', Poor: '#ef4444' }[grade] || '#9ca3af';
  }
  async function fetchJSON(url) {
    const res = await fetch(`${url}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Section 1: Accuracy Overview ────────────────────────────────────────

  function renderOverview(stats, log) {
    const el = document.getElementById('perf-overview');
    if (!el || !stats) return;

    const ov   = stats.overall || stats;
    const dpct = ov.directional_accuracy_pct ?? ov.accuracy_pct ?? 0;
    const col  = accColor(dpct);
    const bt   = stats.by_trigger   || {};
    const btf  = stats.by_timeframe || {};
    const bs   = stats.by_signal    || {};

    const sched = bt.scheduled || { count:0, correct:0, directional_accuracy_pct:0 };
    const man   = bt.manual    || { count:0, correct:0, directional_accuracy_pct:0 };
    const schedPct = sched.directional_accuracy_pct ?? sched.accuracy_pct ?? 0;
    const manPct   = man.directional_accuracy_pct   ?? man.accuracy_pct   ?? 0;

    const bestT  = stats.best_ticker;
    const worstT = stats.worst_ticker;
    const bestSym  = typeof bestT === 'object'  ? (bestT?.ticker  || '—') : (bestT  || '—');
    const worstSym = typeof worstT === 'object' ? (worstT?.ticker || '—') : (worstT || '—');
    const bestDPct  = typeof bestT  === 'object' ? (bestT?.directional_accuracy_pct  ?? '') : '';
    const worstDPct = typeof worstT === 'object' ? (worstT?.directional_accuracy_pct ?? '') : '';

    const tfRows = ['intraday','next_day','long_term'].map(tf => {
      const d = btf[tf] || { count:0, directional_accuracy_pct:0, correct:0 };
      const pct = d.directional_accuracy_pct ?? d.accuracy_pct ?? 0;
      const n   = d.count || d.total || 0;
      const c   = accColor(pct);
      return `<div class="perf-tf-bar-row">
        <span class="perf-tf-bar-label" style="color:${tfColor(tf)}">${tfLabel(tf)}</span>
        ${barHtml(pct, c)}
        <span class="perf-tf-bar-stat" style="color:${c}">${pct}% <span class="perf-tf-n">(${d.correct||0}/${n})</span></span>
      </div>`;
    }).join('');

    const sigRows = Object.entries(bs).map(([sig, d]) => {
      const pct = d.directional_accuracy_pct ?? d.accuracy_pct ?? 0;
      const n   = d.count || d.total || 0;
      const c   = signalColor(sig);
      return `<div class="perf-tf-bar-row">
        <span class="perf-tf-bar-label" style="color:${c}">${sig}</span>
        ${barHtml(pct, c)}
        <span class="perf-tf-bar-stat" style="color:${c}">${pct}% <span class="perf-tf-n">(${d.correct||0}/${n})</span></span>
      </div>`;
    }).join('');

    // Price accuracy section
    const avgErr   = stats.avg_price_error_pct;
    const avgGrade = stats.avg_price_accuracy_grade;
    const errColor = avgGrade ? gradeColor(avgGrade) : '#9ca3af';

    const priceRows = ['intraday','next_day','long_term'].map(tf => {
      const d = btf[tf] || {};
      const err   = d.avg_price_error_pct;
      const grade = d.avg_price_accuracy_grade;
      if (err == null) return '';
      return `<div class="perf-tf-bar-row">
        <span class="perf-tf-bar-label" style="color:${tfColor(tf)}">${tfLabel(tf)}</span>
        <span class="perf-price-err">${err}% avg error</span>
        <span class="perf-price-grade" style="color:${gradeColor(grade)}">${grade || '—'}</span>
      </div>`;
    }).filter(Boolean).join('');

    el.innerHTML = `
      <!-- Top scorecard -->
      <div class="perf-scorecard">
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:${col}">${dpct}%</div>
          <div class="perf-score-label">Directional Accuracy</div>
          <div class="perf-score-sub">${ov.correct||0} correct / ${ov.count||ov.total||0} total</div>
        </div>
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:${errColor}">${avgErr != null ? avgErr+'%' : '—'}</div>
          <div class="perf-score-label">Avg Price Error</div>
          <div class="perf-score-sub" style="color:${errColor}">${avgGrade || 'across all tickers'}</div>
        </div>
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:#22c55e">${bestSym}</div>
          <div class="perf-score-label">Best Ticker</div>
          <div class="perf-score-sub">${bestDPct !== '' ? bestDPct+'% dir. accuracy' : 'best directional accuracy'}</div>
        </div>
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:#ef4444">${worstSym}</div>
          <div class="perf-score-label">Worst Ticker</div>
          <div class="perf-score-sub">${worstDPct !== '' ? worstDPct+'% dir. accuracy' : 'worst directional accuracy'}</div>
        </div>
      </div>

      <!-- Explanatory note -->
      <div class="perf-explain-note">
        ℹ️ <strong>Directional Accuracy</strong> measures whether the signal predicted the correct price direction (UP/DOWN/NEUTRAL).
        <strong>Price Accuracy</strong> measures how close the predicted price target was to the actual price.
      </div>

      <!-- Scheduled vs Manual -->
      <div class="perf-trigger-compare">
        <div class="perf-trigger-card">
          <div class="perf-trigger-icon">⏰</div>
          <div class="perf-trigger-pct" style="color:${accColor(schedPct)}">${schedPct}%</div>
          <div class="perf-trigger-label">Scheduled</div>
          <div class="perf-trigger-sub">${sched.correct||0}/${sched.count||sched.total||0} correct</div>
        </div>
        <div class="perf-trigger-vs">vs</div>
        <div class="perf-trigger-card">
          <div class="perf-trigger-icon">👆</div>
          <div class="perf-trigger-pct" style="color:${accColor(manPct)}">${manPct}%</div>
          <div class="perf-trigger-label">Manual</div>
          <div class="perf-trigger-sub">${man.correct||0}/${man.count||man.total||0} correct</div>
        </div>
      </div>

      <!-- By timeframe + by signal side by side -->
      <div class="perf-bars-grid">
        <div class="perf-bars-col">
          <div class="perf-bars-title">Directional Accuracy by Timeframe</div>
          <div class="perf-tf-bars">${tfRows || '<div class="perf-empty">No data yet</div>'}</div>
        </div>
        <div class="perf-bars-col">
          <div class="perf-bars-title">Directional Accuracy by Signal</div>
          <div class="perf-tf-bars">${sigRows || '<div class="perf-empty">No data yet</div>'}</div>
        </div>
      </div>

      <!-- Price accuracy by timeframe -->
      ${priceRows ? `
      <div class="perf-price-accuracy-section">
        <div class="perf-bars-title">Price Accuracy by Timeframe</div>
        <div class="perf-price-note">Lower % error = more accurate price target predictions</div>
        <div class="perf-tf-bars">${priceRows}</div>
      </div>` : ''}`;
  }

  // ── Section 2: Pending Backchecks ────────────────────────────────────────

  function renderPending(bcData) {
    const el = document.getElementById('perf-pending');
    if (!el) return;

    const pending = bcData?.pending || [];
    if (!pending.length) {
      el.innerHTML = '<div class="perf-empty-msg">No pending backchecks.</div>';
      return;
    }

    el.innerHTML = pending.map(e => {
      const status  = e.status || 'pending';
      const isPend  = status === 'pending';
      const isDone  = status === 'completed';
      const cd      = isPend ? countdown(e.check_due_at) : null;
      const overdue = cd === 'overdue';

      const statusBadge = isPend
        ? `<span class="perf-bc-status perf-bc-pending">${overdue ? '⚠️ Overdue' : `⏳ Due in ${cd}`}</span>`
        : isDone
          ? `<span class="perf-bc-status perf-bc-done">✅ Completed ${fmtDT(e.completed_at)}</span>`
          : `<span class="perf-bc-status perf-bc-missed">⚠️ Missed</span>`;

      return `<div class="perf-bc-row">
        <span class="perf-bc-tf" style="color:${tfColor(e.timeframe)}">${tfLabel(e.timeframe)}</span>
        <span class="perf-bc-time"><span class="perf-ts-label">Predicted:</span> ${fmtDT(e.prediction_time)}</span>
        <span class="perf-bc-trigger">${e.trigger_type === 'manual' ? '👆 Manual' : '⏰ Scheduled'}</span>
        <span class="perf-bc-due"><span class="perf-ts-label">Due:</span> ${fmtDT(e.check_due_at)}</span>
        ${statusBadge}
        ${e.late_by_min ? `<span class="perf-bc-late">+${e.late_by_min}m late</span>` : ''}
      </div>`;
    }).join('');
  }

  // ── Section 3: Last 20 Predictions Table ─────────────────────────────────

  function renderHistoryTable(log, archive) {
    const el = document.getElementById('perf-history-table');
    if (!el) return;

    const byPred = {};
    log.forEach(e => {
      const pt = e.prediction_time;
      if (!byPred[pt]) byPred[pt] = {};
      byPred[pt][e.timeframe || 'intraday'] = e;
    });

    const allTimes = new Set();
    [...archive].reverse().forEach(a => allTimes.add(a.generated_at));
    log.forEach(e => allTimes.add(e.prediction_time));
    const last20 = [...allTimes].slice(0, 20);

    const fullyChecked = last20.filter(pt => byPred[pt] && Object.keys(byPred[pt]).length >= 1).length;
    const covPct = last20.length ? Math.round(fullyChecked / last20.length * 100) : 0;

    const archiveMap = {};
    archive.forEach(a => archiveMap[a.generated_at] = a);

    function resultCell(entry) {
      if (!entry) return '<td class="perf-td perf-td-muted">⏳</td>';
      const ok = entry.signal_correct ?? (entry.overall_directional_accuracy >= 0.5);
      return `<td class="perf-td"><span class="${ok ? 'perf-correct' : 'perf-incorrect'}">${ok ? '✅' : '❌'}</span></td>`;
    }

    function directionCell(entry) {
      if (!entry) return '<td class="perf-td perf-td-muted">—</td>';
      const trs = entry.ticker_results || [];
      if (!trs.length) return '<td class="perf-td perf-td-muted">—</td>';
      const correct  = trs.filter(r => r.directional_correct ?? r.correct).length;
      const total    = trs.length;
      const pct      = Math.round(correct / total * 100);
      const c        = accColor(pct);
      return `<td class="perf-td" style="color:${c}">${correct}/${total} <span class="perf-tf-n">(${pct}%)</span></td>`;
    }

    function priceErrCell(entry) {
      if (!entry) return '<td class="perf-td perf-td-muted">—</td>';
      const err = entry.overall_price_error_pct;
      if (err == null) {
        // fallback: compute from ticker_results
        const errs = (entry.ticker_results || []).map(r => r.price_error_pct).filter(e => e != null);
        if (!errs.length) return '<td class="perf-td perf-td-muted">—</td>';
        const avg = errs.reduce((a,b)=>a+b,0)/errs.length;
        return `<td class="perf-td">${avg.toFixed(2)}%</td>`;
      }
      return `<td class="perf-td">${err.toFixed ? err.toFixed(2) : err}%</td>`;
    }

    function bestCallCell(entry) {
      if (!entry) return '<td class="perf-td perf-td-muted">—</td>';
      const trs = (entry.ticker_results || []).filter(r => r.directional_correct ?? r.correct);
      if (!trs.length) return '<td class="perf-td" style="color:#ef4444">none</td>';
      // Best call: pick ticker with smallest price error among correct ones
      const best = trs.reduce((a,b) => {
        const ae = a.price_error_pct ?? 999;
        const be = b.price_error_pct ?? 999;
        return ae <= be ? a : b;
      });
      return `<td class="perf-td" style="color:#22c55e">${best.ticker}</td>`;
    }

    const rows = last20.map(pt => {
      const checks  = byPred[pt] || {};
      const arch    = archiveMap[pt] || {};
      const intra   = checks['intraday'];
      const nd      = checks['next_day'];
      const lt      = checks['long_term'];
      const conf    = (intra || nd || lt)?.confidence_at_prediction ?? (intra || nd || lt)?.confidence ?? arch?.intraday?.confidence ?? '—';
      const trigType = (intra || nd || lt)?.trigger_type || 'scheduled';

      const sigCell = (tf) => {
        const c = checks[tf];
        if (!c) {
          const tfKey = tf === 'next_day' ? 'next_day' : tf;
          const archBlock = arch[tfKey] || {};
          const sig = archBlock.signal;
          return sig
            ? `<td class="perf-td" style="color:${signalColor(sig)};opacity:0.5">${sig} <span style="font-size:9px">(pending)</span></td>`
            : '<td class="perf-td perf-td-muted">—</td>';
        }
        const sig = c.short_term_signal || c.signal || '—';
        return `<td class="perf-td" style="color:${signalColor(sig)}">${sig}</td>`;
      };

      // Use most recent checked entry for direction/price cells
      const anyChecked = intra || nd || lt;

      return `<tr class="perf-tr">
        <td class="perf-td perf-td-ts">${fmtDT(pt)}</td>
        <td class="perf-td"><span class="perf-trigger-badge">${trigType === 'manual' ? '👆 Manual' : '⏰ Sched'}</span></td>
        ${sigCell('intraday')}
        ${resultCell(intra)}
        ${sigCell('next_day')}
        ${resultCell(nd)}
        ${sigCell('long_term')}
        <td class="perf-td">${conf}%</td>
        ${directionCell(anyChecked)}
        ${priceErrCell(anyChecked)}
        ${bestCallCell(anyChecked)}
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="perf-coverage">
        <span class="perf-cov-label">Backtest Coverage (last ${last20.length} predictions):</span>
        ${barHtml(covPct, accColor(covPct))}
        <span class="perf-cov-pct" style="color:${accColor(covPct)}">${covPct}%</span>
        <span class="perf-cov-sub">${fullyChecked}/${last20.length} checked</span>
      </div>
      <div class="perf-table-scroll">
        <table class="perf-table">
          <thead>
            <tr>
              <th class="perf-th">Predicted At</th>
              <th class="perf-th">Trigger</th>
              <th class="perf-th" style="color:#f59e0b">Intraday Signal</th>
              <th class="perf-th" style="color:#f59e0b">Result</th>
              <th class="perf-th" style="color:#60a5fa">Next Day Signal</th>
              <th class="perf-th" style="color:#60a5fa">Result</th>
              <th class="perf-th" style="color:#a78bfa">30-Day Signal</th>
              <th class="perf-th">Conf</th>
              <th class="perf-th">Direction ✓</th>
              <th class="perf-th">Avg Price Err</th>
              <th class="perf-th">Best Call</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="11" class="perf-td perf-td-muted" style="text-align:center">No predictions yet</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  // ── Section 4: Ticker Performance Table ──────────────────────────────────

  function renderTickerTable(log) {
    const el = document.getElementById('perf-ticker-table');
    if (!el) return;

    const tickers = {};
    log.forEach(e => {
      const tf = e.timeframe || 'intraday';
      (e.ticker_results || []).forEach(tr => {
        const sym = tr.ticker;
        if (!sym) return;
        if (!tickers[sym]) tickers[sym] = { dirCorrect:0, total:0, errors:[], byTf:{} };
        tickers[sym].total++;
        if (tr.directional_correct ?? tr.correct) tickers[sym].dirCorrect++;
        const err = tr.price_error_pct;
        if (err != null) tickers[sym].errors.push(err);
        if (!tickers[sym].byTf[tf]) tickers[sym].byTf[tf] = {correct:0, total:0};
        tickers[sym].byTf[tf].total++;
        if (tr.directional_correct ?? tr.correct) tickers[sym].byTf[tf].correct++;
      });
    });

    if (!Object.keys(tickers).length) {
      el.innerHTML = '<div class="perf-empty-msg">No ticker data yet.</div>';
      return;
    }

    const rows = Object.entries(tickers).sort((a,b) => b[1].total - a[1].total).map(([sym, d]) => {
      const pct    = d.total ? Math.round(d.dirCorrect/d.total*100) : 0;
      const avgErr = d.errors.length ? (d.errors.reduce((a,b)=>a+b,0)/d.errors.length).toFixed(2) : '—';
      const grade  = avgErr !== '—' ? (['Excellent','Good','Fair','Poor'][
        parseFloat(avgErr) < 0.5 ? 0 : parseFloat(avgErr) < 1 ? 1 : parseFloat(avgErr) < 2 ? 2 : 3]) : null;
      const c  = accColor(pct);
      const ec = grade ? gradeColor(grade) : '#9ca3af';

      const tfCells = ['intraday','next_day','long_term'].map(tf => {
        const td = d.byTf[tf];
        if (!td) return '<td class="perf-td perf-td-muted">—</td>';
        const tp = Math.round(td.correct/td.total*100);
        return `<td class="perf-td" style="color:${accColor(tp)}">${tp}% <span class="perf-td-n">(${td.correct}/${td.total})</span></td>`;
      }).join('');

      return `<tr class="perf-tr">
        <td class="perf-td perf-td-sym">${sym}</td>
        <td class="perf-td" style="color:${c}">${pct}%</td>
        <td class="perf-td">${d.dirCorrect}/${d.total}</td>
        ${tfCells}
        <td class="perf-td perf-td-err" style="color:${ec}">${avgErr !== '—' ? avgErr+'%' : '—'}${grade ? ` <span class="perf-grade-badge" style="color:${ec}">${grade}</span>` : ''}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="perf-table-scroll">
        <table class="perf-table">
          <thead><tr>
            <th class="perf-th">Ticker</th>
            <th class="perf-th">Dir. Accuracy</th>
            <th class="perf-th">Correct/Total</th>
            <th class="perf-th" style="color:#f59e0b">Intraday</th>
            <th class="perf-th" style="color:#60a5fa">Next Day</th>
            <th class="perf-th" style="color:#a78bfa">30-Day</th>
            <th class="perf-th">Price Accuracy</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Section 5: Detailed history (filter bar) ─────────────────────────────

  let allLog = [];
  let activeFilters = { tf: 'all', correct: null };

  function renderHistoryDetail(log) {
    const el = document.getElementById('perf-history-detail');
    const titleEl = document.getElementById('perf-history-detail-title');
    if (!el) return;

    let filtered = [...log].reverse();
    if (activeFilters.tf !== 'all') filtered = filtered.filter(e => e.timeframe === activeFilters.tf);
    if (activeFilters.correct !== null) filtered = filtered.filter(e => {
      const ok = e.signal_correct ?? (e.overall_directional_accuracy >= 0.5);
      return String(ok) === activeFilters.correct;
    });

    if (titleEl) titleEl.textContent = `Prediction Detail Log (${filtered.length} entries)`;

    if (!filtered.length) {
      el.innerHTML = '<div class="perf-empty-msg">No entries match.</div>'; return;
    }

    el.innerHTML = filtered.map(entry => {
      const tf    = entry.timeframe || 'intraday';
      const sig   = entry.short_term_signal || entry.signal || '—';
      const ok    = entry.signal_correct ?? (entry.overall_directional_accuracy >= 0.5);
      const ttype = entry.trigger_type || 'scheduled';
      const dirAcc = entry.overall_directional_accuracy ?? entry.overall_accuracy;
      const priceErr = entry.overall_price_error_pct;

      const tickerRows = (entry.ticker_results || []).map(tr => {
        const dc  = tr.directional_correct ?? tr.correct;
        const err = tr.price_error_pct;
        const grade = tr.price_accuracy_grade;
        const ec  = err != null ? gradeColor(grade || (err < 0.5 ? 'Excellent' : err < 1 ? 'Good' : err < 2 ? 'Fair' : 'Poor')) : '#9ca3af';
        const actualDir  = tr.actual_direction  || '—';
        const predSig    = tr.predicted_signal  || tr.predicted_direction || '—';
        const movePct    = tr.actual_move_pct;
        return `<div class="perf-hist-ticker ${dc ? 'perf-tick-ok':'perf-tick-bad'}">
          <span class="perf-ht-sym">${tr.ticker}</span>
          <span class="perf-ht-pred" style="color:${signalColor(predSig)}">pred: ${predSig}</span>
          <span class="perf-ht-actual" style="color:${actualDir==='UP'?'#22c55e':actualDir==='DOWN'?'#ef4444':'#f59e0b'}">actual: ${actualDir}${movePct!=null?' ('+( movePct>=0?'+':'')+movePct.toFixed(2)+'%)':''}</span>
          <span class="perf-ht-prices">${fmtPrice(tr.price_at_prediction ?? tr.predicted_price)} → ${fmtPrice(tr.price_at_backcheck ?? tr.actual_price)}
            <span class="perf-ht-err" style="color:${ec}">(Δ${err != null ? err.toFixed(2)+'%' : '—'}${grade ? ' '+grade : ''})</span>
          </span>
          <span class="perf-ht-result ${dc?'perf-correct':'perf-incorrect'}">${dc?'✓':'✗'}</span>
        </div>`;
      }).join('');

      return `<div class="perf-hist-entry ${ok?'perf-entry-ok':'perf-entry-bad'}">
        <div class="perf-hist-header">
          <span class="perf-hist-tf" style="color:${tfColor(tf)}">${tfLabel(tf)}</span>
          <span class="perf-trigger-badge">${ttype==='manual'?'👆 Manual':'⏰ Sched'}</span>
          <span class="perf-hist-sig" style="color:${signalColor(sig)}">${sig}</span>
          <span class="perf-hist-conf">${entry.confidence_at_prediction ?? entry.confidence ?? '—'}% conf</span>
          <span class="perf-hist-result ${ok?'perf-correct':'perf-incorrect'}">${ok?'✓ CORRECT':'✗ WRONG'}</span>
          ${dirAcc != null ? `<span class="perf-hist-acc">${Math.round(dirAcc*100)}% dir. accuracy</span>` : ''}
          ${priceErr != null ? `<span class="perf-hist-acc" style="color:#9ca3af">${priceErr.toFixed ? priceErr.toFixed(2) : priceErr}% price err</span>` : ''}
          <span class="perf-hist-spacer"></span>
          <span class="perf-hist-ts">
            <span class="perf-ts-label">Predicted:</span> ${fmtDT(entry.prediction_time)}
            &nbsp;·&nbsp;
            <span class="perf-ts-label">Checked:</span> ${fmtDT(entry.check_time)}
          </span>
        </div>
        <div class="perf-hist-tickers">${tickerRows}</div>
      </div>`;
    }).join('');
  }

  function setupFilters(log) {
    document.querySelectorAll('.perf-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tf = btn.dataset.tf; const correct = btn.dataset.correct;
        if (tf) {
          document.querySelectorAll('[data-tf]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active'); activeFilters.tf = tf;
        }
        if (correct !== undefined) {
          const was = btn.classList.contains('active');
          document.querySelectorAll('[data-correct]').forEach(b => b.classList.remove('active'));
          if (!was) { btn.classList.add('active'); activeFilters.correct = correct; }
          else activeFilters.correct = null;
        }
        renderHistoryDetail(log);
      });
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    try {
      const [log, stats, archive, bcData] = await Promise.all([
        fetchJSON('/data/accuracy-log.json').catch(() => []),
        fetchJSON('/data/accuracy-stats.json').catch(() => ({})),
        fetchJSON('/data/prediction-archive.json').catch(() => []),
        fetchJSON('/data/pending-backchecks.json').catch(() => ({ pending: [] })),
      ]);
      allLog = Array.isArray(log) ? log : [];
      renderOverview(stats, allLog);
      renderPending(bcData);
      renderHistoryTable(allLog, Array.isArray(archive) ? archive : []);
      renderTickerTable(allLog);
      renderHistoryDetail(allLog);
      setupFilters(allLog);
    } catch (e) {
      console.error('Performance init error:', e);
    }
  }

  return { init };
})();
