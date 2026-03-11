/**
 * Performance — prediction accuracy tracker
 * Reads /data/accuracy-log.json, /data/accuracy-stats.json, /data/prediction-archive.json
 */

const Performance = (() => {

  function signalColor(s) {
    if (s === 'BULLISH') return '#22c55e';
    if (s === 'BEARISH') return '#ef4444';
    return '#f59e0b';
  }

  function fmtDT(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    }) + ' ET';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    }) + ' ET';
  }

  function tfLabel(tf) {
    return { intraday: 'INTRADAY', next_day: 'NEXT DAY', long_term: '30-DAY' }[tf] || tf?.toUpperCase() || '—';
  }

  function tfColor(tf) {
    return { intraday: '#f59e0b', next_day: '#60a5fa', long_term: '#a78bfa' }[tf] || '#9ca3af';
  }

  function fmtPrice(p) {
    if (p == null) return '—';
    return `$${(+p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  async function fetchJSON(url) {
    const res = await fetch(`${url}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  let allLog = [];
  let activeFilters = { tf: 'all', correct: null };

  function renderScorecard(stats) {
    const el = document.getElementById('perf-scorecard');
    if (!el) return;
    if (!stats || !stats.total_predictions) {
      el.innerHTML = '<div class="perf-score-loading">No prediction data yet — check back after the first backcheck run.</div>';
      return;
    }
    const pct = stats.accuracy_pct || 0;
    const barColor = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';

    el.innerHTML = `
      <div class="perf-score-card">
        <div class="perf-score-big" style="color:${barColor}">${pct}%</div>
        <div class="perf-score-label">Overall Accuracy</div>
        <div class="perf-score-sub">${stats.correct} correct / ${stats.total_predictions} total</div>
      </div>
      <div class="perf-score-card">
        <div class="perf-score-big">${stats.avg_price_error_pct != null ? stats.avg_price_error_pct + '%' : '—'}</div>
        <div class="perf-score-label">Avg Price Error</div>
        <div class="perf-score-sub">across all tickers & timeframes</div>
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
      </div>`;
  }

  function renderTFBars(stats) {
    const el = document.getElementById('perf-tf-bars');
    if (!el || !stats) return;
    const byTf = stats.by_timeframe || {};
    const TFS = [
      { key: 'intraday',  label: 'Intraday (2H)',   desc: 'checked ~2h after synthesis' },
      { key: 'next_day',  label: 'Next Day',         desc: 'checked at 9:35am following day' },
      { key: 'long_term', label: 'Long Term (30D)',  desc: 'checked 30 days after prediction' },
    ];

    el.innerHTML = TFS.map(({ key, label, desc }) => {
      const d   = byTf[key] || { total: 0, correct: 0, accuracy_pct: 0, by_signal: {} };
      const pct = d.accuracy_pct || 0;
      const c   = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
      const byS = d.by_signal || {};

      const sigBreakdown = Object.entries(byS).map(([sig, sd]) => `
        <span class="perf-sig-pill" style="color:${signalColor(sig)};border-color:${signalColor(sig)}44">
          ${sig}: ${sd.accuracy}% (${sd.correct}/${sd.total})
        </span>`).join('');

      return `
        <div class="perf-tf-card">
          <div class="perf-tf-header">
            <span class="perf-tf-name" style="color:${tfColor(key)}">${label}</span>
            <span class="perf-tf-desc">${desc}</span>
          </div>
          <div class="perf-tf-row">
            <div class="perf-tf-pct" style="color:${c}">${pct}%</div>
            <div class="perf-tf-bar-wrap">
              <div class="perf-tf-bar-fill" style="width:${pct}%;background:${c}"></div>
            </div>
            <div class="perf-tf-count">${d.correct}/${d.total} correct</div>
          </div>
          <div class="perf-sig-pills">${sigBreakdown || '<span class="perf-empty">No data yet</span>'}</div>
        </div>`;
    }).join('');
  }

  function renderTickerTable(log) {
    const el = document.getElementById('perf-ticker-table');
    if (!el) return;

    // Aggregate per-ticker stats
    const tickers = {};
    log.forEach(entry => {
      const tf = entry.timeframe || 'intraday';
      (entry.ticker_results || []).forEach(tr => {
        const sym = tr.ticker;
        if (!tickers[sym]) tickers[sym] = { total: 0, correct: 0, errors: [], byTf: {} };
        tickers[sym].total++;
        if (tr.correct) tickers[sym].correct++;
        if (tr.price_error_pct != null) tickers[sym].errors.push(tr.price_error_pct);
        if (!tickers[sym].byTf[tf]) tickers[sym].byTf[tf] = { total: 0, correct: 0 };
        tickers[sym].byTf[tf].total++;
        if (tr.correct) tickers[sym].byTf[tf].correct++;
      });
    });

    if (!Object.keys(tickers).length) {
      el.innerHTML = '<div class="perf-empty-msg">No ticker data yet.</div>';
      return;
    }

    const rows = Object.entries(tickers).sort((a, b) => b[1].total - a[1].total).map(([sym, d]) => {
      const pct      = d.total ? Math.round(d.correct / d.total * 100) : 0;
      const avgErr   = d.errors.length ? (d.errors.reduce((a,b)=>a+b,0)/d.errors.length).toFixed(2) : '—';
      const c        = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';

      const tfCells = ['intraday','next_day','long_term'].map(tf => {
        const td = d.byTf[tf];
        if (!td) return '<td class="perf-td perf-td-muted">—</td>';
        const tp = Math.round(td.correct / td.total * 100);
        const tc = tp >= 70 ? '#22c55e' : tp >= 50 ? '#f59e0b' : '#ef4444';
        return `<td class="perf-td" style="color:${tc}">${tp}% <span class="perf-td-n">(${td.correct}/${td.total})</span></td>`;
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
          <thead>
            <tr>
              <th class="perf-th">Ticker</th>
              <th class="perf-th">Overall</th>
              <th class="perf-th">Correct/Total</th>
              <th class="perf-th" style="color:#f59e0b">Intraday</th>
              <th class="perf-th" style="color:#60a5fa">Next Day</th>
              <th class="perf-th" style="color:#a78bfa">30-Day</th>
              <th class="perf-th">Avg Δ%</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderHistory(log) {
    const el = document.getElementById('perf-history');
    const titleEl = document.getElementById('perf-history-title');
    if (!el) return;

    let filtered = [...log].reverse();
    if (activeFilters.tf !== 'all')   filtered = filtered.filter(e => e.timeframe === activeFilters.tf);
    if (activeFilters.correct !== null) filtered = filtered.filter(e => String(e.signal_correct ?? e.short_term_correct) === activeFilters.correct);

    if (titleEl) titleEl.textContent = `Full Prediction History (${filtered.length} records)`;

    if (!filtered.length) {
      el.innerHTML = '<div class="perf-empty-msg">No predictions match the current filter.</div>';
      return;
    }

    el.innerHTML = filtered.map(entry => {
      const tf      = entry.timeframe || 'intraday';
      const sig     = entry.signal || entry.short_term_signal || '—';
      const ok      = entry.signal_correct ?? entry.short_term_correct;
      const acc     = entry.overall_accuracy != null ? Math.round(entry.overall_accuracy * 100) + '%' : '—';
      const tickers = entry.ticker_results || [];

      const tickerRows = tickers.map(tr => {
        const dirColor = signalColor(tr.actual_direction);
        const errColor = tr.price_error_pct < 0.5 ? '#22c55e' : tr.price_error_pct < 1.5 ? '#f59e0b' : '#ef4444';
        return `
          <div class="perf-hist-ticker ${tr.correct ? 'perf-tick-ok' : 'perf-tick-bad'}">
            <span class="perf-ht-sym">${tr.ticker}</span>
            <span class="perf-ht-pred" style="color:${signalColor(tr.predicted_direction)}">pred: ${tr.predicted_direction}</span>
            <span class="perf-ht-actual" style="color:${dirColor}">actual: ${tr.actual_direction}</span>
            <span class="perf-ht-prices">
              ${fmtPrice(tr.predicted_price)} → ${fmtPrice(tr.actual_price)}
              <span class="perf-ht-err" style="color:${errColor}">(Δ${tr.price_error_pct != null ? tr.price_error_pct.toFixed(2)+'%' : '—'})</span>
            </span>
            <span class="perf-ht-result ${tr.correct ? 'perf-correct' : 'perf-incorrect'}">${tr.correct ? '✓' : '✗'}</span>
          </div>`;
      }).join('');

      return `
        <div class="perf-hist-entry ${ok ? 'perf-entry-ok' : 'perf-entry-bad'}">
          <div class="perf-hist-header">
            <span class="perf-hist-tf" style="color:${tfColor(tf)}">${tfLabel(tf)}</span>
            <span class="perf-hist-sig" style="color:${signalColor(sig)}">${sig}</span>
            <span class="perf-hist-conf">${entry.confidence_at_prediction ?? '—'}% conf</span>
            <span class="perf-hist-result ${ok ? 'perf-correct' : 'perf-incorrect'}">${ok ? '✓ CORRECT' : '✗ WRONG'}</span>
            <span class="perf-hist-acc">${acc} ticker accuracy</span>
            <span class="perf-hist-spacer"></span>
            <span class="perf-hist-ts">
              <span class="perf-ts-label">Predicted:</span> ${fmtDate(entry.prediction_time)}
              &nbsp;·&nbsp;
              <span class="perf-ts-label">Checked:</span> ${fmtDate(entry.check_time)}
            </span>
          </div>
          <div class="perf-hist-tickers">${tickerRows}</div>
        </div>`;
    }).join('');
  }

  function setupFilters(log) {
    document.querySelectorAll('.perf-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tf      = btn.dataset.tf;
        const correct = btn.dataset.correct;

        if (tf) {
          document.querySelectorAll('[data-tf]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeFilters.tf = tf;
        }
        if (correct !== undefined) {
          const wasActive = btn.classList.contains('active');
          document.querySelectorAll('[data-correct]').forEach(b => b.classList.remove('active'));
          if (!wasActive) { btn.classList.add('active'); activeFilters.correct = correct; }
          else activeFilters.correct = null;
        }
        renderHistory(log);
      });
    });
  }

  async function init() {
    try {
      const [log, stats] = await Promise.all([
        fetchJSON('/data/accuracy-log.json').catch(() => []),
        fetchJSON('/data/accuracy-stats.json').catch(() => ({})),
      ]);
      allLog = Array.isArray(log) ? log : [];
      renderScorecard(stats);
      renderTFBars(stats);
      renderTickerTable(allLog);
      renderHistory(allLog);
      setupFilters(allLog);
    } catch (e) {
      console.error('Performance init error:', e);
    }
  }

  return { init };
})();
