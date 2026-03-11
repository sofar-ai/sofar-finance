/**
 * Performance — prediction accuracy tracker
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
    return `<div class="perf-bar-track"><div class="perf-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
  }
  function accColor(pct) {
    return pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
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

    const ov  = stats.overall || stats;
    const pct = ov.accuracy_pct || 0;
    const col = accColor(pct);
    const bt  = stats.by_trigger   || {};
    const btf = stats.by_timeframe || {};
    const bs  = stats.by_signal    || {};

    const sched = bt.scheduled || { total:0, correct:0, accuracy_pct:0 };
    const man   = bt.manual    || { total:0, correct:0, accuracy_pct:0 };

    const tfRows = ['intraday','next_day','long_term'].map(tf => {
      const d = btf[tf] || { total:0, accuracy_pct:0, correct:0 };
      const c = accColor(d.accuracy_pct);
      return `<div class="perf-tf-bar-row">
        <span class="perf-tf-bar-label" style="color:${tfColor(tf)}">${tfLabel(tf)}</span>
        ${barHtml(d.accuracy_pct, c)}
        <span class="perf-tf-bar-stat" style="color:${c}">${d.accuracy_pct}% <span class="perf-tf-n">(${d.correct}/${d.total})</span></span>
      </div>`;
    }).join('');

    const sigRows = Object.entries(bs).map(([sig, d]) => {
      const c = signalColor(sig);
      return `<div class="perf-tf-bar-row">
        <span class="perf-tf-bar-label" style="color:${c}">${sig}</span>
        ${barHtml(d.accuracy_pct, c)}
        <span class="perf-tf-bar-stat" style="color:${c}">${d.accuracy_pct}% <span class="perf-tf-n">(${d.correct}/${d.total})</span></span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <!-- Top scorecard -->
      <div class="perf-scorecard">
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:${col}">${pct}%</div>
          <div class="perf-score-label">Overall Accuracy</div>
          <div class="perf-score-sub">${ov.correct||0} correct / ${ov.total||0} total</div>
        </div>
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:#9ca3af">${stats.avg_price_error_pct != null ? stats.avg_price_error_pct+'%' : '—'}</div>
          <div class="perf-score-label">Avg Price Error</div>
          <div class="perf-score-sub">across all tickers</div>
        </div>
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:#22c55e">${stats.best_ticker || '—'}</div>
          <div class="perf-score-label">Best Ticker</div>
          <div class="perf-score-sub">lowest avg price error</div>
        </div>
        <div class="perf-score-card">
          <div class="perf-score-big" style="color:#ef4444">${stats.worst_ticker || '—'}</div>
          <div class="perf-score-label">Worst Ticker</div>
          <div class="perf-score-sub">highest avg price error</div>
        </div>
      </div>

      <!-- Scheduled vs Manual -->
      <div class="perf-trigger-compare">
        <div class="perf-trigger-card">
          <div class="perf-trigger-icon">⏰</div>
          <div class="perf-trigger-pct" style="color:${accColor(sched.accuracy_pct)}">${sched.accuracy_pct}%</div>
          <div class="perf-trigger-label">Scheduled</div>
          <div class="perf-trigger-sub">${sched.correct}/${sched.total} correct</div>
        </div>
        <div class="perf-trigger-vs">vs</div>
        <div class="perf-trigger-card">
          <div class="perf-trigger-icon">👆</div>
          <div class="perf-trigger-pct" style="color:${accColor(man.accuracy_pct)}">${man.accuracy_pct}%</div>
          <div class="perf-trigger-label">Manual</div>
          <div class="perf-trigger-sub">${man.correct}/${man.total} correct</div>
        </div>
      </div>

      <!-- By timeframe + by signal side by side -->
      <div class="perf-bars-grid">
        <div class="perf-bars-col">
          <div class="perf-bars-title">By Timeframe</div>
          <div class="perf-tf-bars">${tfRows || '<div class="perf-empty">No data yet</div>'}</div>
        </div>
        <div class="perf-bars-col">
          <div class="perf-bars-title">By Signal</div>
          <div class="perf-tf-bars">${sigRows || '<div class="perf-empty">No data yet</div>'}</div>
        </div>
      </div>`;
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
      const isMiss  = status === 'missed';
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

  // ── Section 3: Last 20 Predictions Table ────────────────────────────────

  function renderHistoryTable(log, archive) {
    const el = document.getElementById('perf-history-table');
    if (!el) return;

    // Group log entries by prediction_time
    const byPred = {};
    log.forEach(e => {
      const pt = e.prediction_time;
      if (!byPred[pt]) byPred[pt] = {};
      byPred[pt][e.timeframe || 'intraday'] = e;
    });

    // Get last 20 unique prediction times (from archive + log)
    const allTimes = new Set();
    [...archive].reverse().forEach(a => allTimes.add(a.generated_at));
    log.forEach(e => allTimes.add(e.prediction_time));
    const last20 = [...allTimes].slice(0, 20);

    // Coverage stats
    const fullyChecked = last20.filter(pt => byPred[pt] && Object.keys(byPred[pt]).length >= 1).length;
    const covPct = last20.length ? Math.round(fullyChecked / last20.length * 100) : 0;

    const archiveMap = {};
    archive.forEach(a => archiveMap[a.generated_at] = a);

    function resultCell(entry) {
      if (!entry) return '<td class="perf-td perf-td-muted">⏳</td>';
      const ok = entry.signal_correct;
      return `<td class="perf-td"><span class="${ok ? 'perf-correct' : 'perf-incorrect'}">${ok ? '✅' : '❌'}</span></td>`;
    }

    const rows = last20.map(pt => {
      const checks = byPred[pt] || {};
      const arch   = archiveMap[pt] || {};
      const intra  = checks['intraday'];
      const nd     = checks['next_day'];
      const lt     = checks['long_term'];
      const conf   = (intra || nd || lt)?.confidence_at_prediction ?? arch?.intraday?.confidence ?? '—';
      const trigType = (intra || nd || lt)?.trigger_type || 'scheduled';

      const sigCell = (tf) => {
        const c = checks[tf];
        if (!c) {
          const archBlock = arch[tf === 'intraday' ? 'intraday' : tf === 'next_day' ? 'next_day' : 'long_term'] || {};
          const sig = archBlock.signal;
          return sig
            ? `<td class="perf-td" style="color:${signalColor(sig)};opacity:0.5">${sig} <span style="font-size:9px">(pending)</span></td>`
            : '<td class="perf-td perf-td-muted">—</td>';
        }
        return `<td class="perf-td" style="color:${signalColor(c.signal)}">${c.signal}</td>`;
      };

      return `<tr class="perf-tr">
        <td class="perf-td perf-td-ts">${fmtDT(pt)}</td>
        <td class="perf-td"><span class="perf-trigger-badge">${trigType === 'manual' ? '👆 Manual' : '⏰ Sched'}</span></td>
        ${sigCell('intraday')}
        ${resultCell(intra)}
        ${sigCell('next_day')}
        ${resultCell(nd)}
        ${sigCell('long_term')}
        <td class="perf-td">${conf}%</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="perf-coverage">
        <span class="perf-cov-label">Backtest Coverage (last ${last20.length} predictions):</span>
        <div class="perf-bar-track perf-cov-bar">${barHtml(covPct, accColor(covPct)).replace('perf-bar-track', '')}</div>
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
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8" class="perf-td perf-td-muted" style="text-align:center">No predictions yet</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  // ── Section 4: Ticker Performance Table ────────────────────────────────

  function renderTickerTable(log) {
    const el = document.getElementById('perf-ticker-table');
    if (!el) return;

    const tickers = {};
    log.forEach(e => {
      const tf = e.timeframe || 'intraday';
      (e.ticker_results || []).forEach(tr => {
        const sym = tr.ticker;
        if (!tickers[sym]) tickers[sym] = { total:0, correct:0, errors:[], byTf:{} };
        tickers[sym].total++;
        if (tr.correct) tickers[sym].correct++;
        if (tr.price_error_pct != null) tickers[sym].errors.push(tr.price_error_pct);
        if (!tickers[sym].byTf[tf]) tickers[sym].byTf[tf] = {total:0,correct:0};
        tickers[sym].byTf[tf].total++;
        if (tr.correct) tickers[sym].byTf[tf].correct++;
      });
    });

    if (!Object.keys(tickers).length) {
      el.innerHTML = '<div class="perf-empty-msg">No ticker data yet.</div>';
      return;
    }

    const rows = Object.entries(tickers).sort((a,b) => b[1].total - a[1].total).map(([sym, d]) => {
      const pct    = d.total ? Math.round(d.correct/d.total*100) : 0;
      const avgErr = d.errors.length ? (d.errors.reduce((a,b)=>a+b,0)/d.errors.length).toFixed(2) : '—';
      const c      = accColor(pct);

      const tfCells = ['intraday','next_day','long_term'].map(tf => {
        const td = d.byTf[tf];
        if (!td) return '<td class="perf-td perf-td-muted">—</td>';
        const tp = Math.round(td.correct/td.total*100);
        return `<td class="perf-td" style="color:${accColor(tp)}">${tp}% <span class="perf-td-n">(${td.correct}/${td.total})</span></td>`;
      }).join('');

      return `<tr class="perf-tr">
        <td class="perf-td perf-td-sym">${sym}</td>
        <td class="perf-td" style="color:${c}">${pct}%</td>
        <td class="perf-td">${d.correct}/${d.total}</td>
        ${tfCells}
        <td class="perf-td perf-td-err">${avgErr}%</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="perf-table-scroll">
        <table class="perf-table">
          <thead><tr>
            <th class="perf-th">Ticker</th>
            <th class="perf-th">Overall</th>
            <th class="perf-th">Correct/Total</th>
            <th class="perf-th" style="color:#f59e0b">Intraday</th>
            <th class="perf-th" style="color:#60a5fa">Next Day</th>
            <th class="perf-th" style="color:#a78bfa">30-Day</th>
            <th class="perf-th">Avg Δ%</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Section 5: Detailed history (filter bar) ────────────────────────────

  let allLog = [];
  let activeFilters = { tf: 'all', correct: null };

  function renderHistoryDetail(log) {
    const el = document.getElementById('perf-history-detail');
    const titleEl = document.getElementById('perf-history-detail-title');
    if (!el) return;

    let filtered = [...log].reverse();
    if (activeFilters.tf !== 'all') filtered = filtered.filter(e => e.timeframe === activeFilters.tf);
    if (activeFilters.correct !== null) filtered = filtered.filter(e =>
      String(e.signal_correct ?? e.short_term_correct) === activeFilters.correct);

    if (titleEl) titleEl.textContent = `Prediction Detail Log (${filtered.length} entries)`;

    if (!filtered.length) {
      el.innerHTML = '<div class="perf-empty-msg">No entries match.</div>'; return;
    }

    el.innerHTML = filtered.map(entry => {
      const tf  = entry.timeframe || 'intraday';
      const sig = entry.signal || '—';
      const ok  = entry.signal_correct ?? entry.short_term_correct;
      const ttype = entry.trigger_type || 'scheduled';

      const tickerRows = (entry.ticker_results || []).map(tr => {
        const ec = tr.price_error_pct < 0.5 ? '#22c55e' : tr.price_error_pct < 1.5 ? '#f59e0b' : '#ef4444';
        return `<div class="perf-hist-ticker ${tr.correct ? 'perf-tick-ok':'perf-tick-bad'}">
          <span class="perf-ht-sym">${tr.ticker}</span>
          <span class="perf-ht-pred" style="color:${signalColor(tr.predicted_direction)}">pred: ${tr.predicted_direction}</span>
          <span class="perf-ht-actual" style="color:${signalColor(tr.actual_direction)}">actual: ${tr.actual_direction}</span>
          <span class="perf-ht-prices">${fmtPrice(tr.predicted_price)} → ${fmtPrice(tr.actual_price)}
            <span class="perf-ht-err" style="color:${ec}">(Δ${tr.price_error_pct != null ? tr.price_error_pct.toFixed(2)+'%':'—'})</span>
          </span>
          <span class="perf-ht-result ${tr.correct?'perf-correct':'perf-incorrect'}">${tr.correct?'✓':'✗'}</span>
        </div>`;
      }).join('');

      return `<div class="perf-hist-entry ${ok?'perf-entry-ok':'perf-entry-bad'}">
        <div class="perf-hist-header">
          <span class="perf-hist-tf" style="color:${tfColor(tf)}">${tfLabel(tf)}</span>
          <span class="perf-trigger-badge">${ttype==='manual'?'👆 Manual':'⏰ Sched'}</span>
          <span class="perf-hist-sig" style="color:${signalColor(sig)}">${sig}</span>
          <span class="perf-hist-conf">${entry.confidence_at_prediction??'—'}% conf</span>
          <span class="perf-hist-result ${ok?'perf-correct':'perf-incorrect'}">${ok?'✓ CORRECT':'✗ WRONG'}</span>
          <span class="perf-hist-acc">${Math.round((entry.overall_accuracy||0)*100)}% ticker acc</span>
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

  // ── Init ────────────────────────────────────────────────────────────────

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
