/**
 * Health Check — System diagnostics for all SOFAR data feeds and pipelines
 */
const HealthCheck = (() => {
  'use strict';

  const THRESHOLDS = {
    ai_synthesis:   { warn: 150, err: 300, label: 'AI Synthesis', emoji: '🤖' },
    options_flow:   { warn: 150, err: 300, label: 'Options Flow', emoji: '🌊' },
    flow_sentiment: { warn: 150, err: 300, label: 'Flow Sentiment', emoji: '📊' },
    top_flow:       { warn: 150, err: 300, label: 'Top Flow (AI)', emoji: '🏆' },
    gex_data:       { warn: 150, err: 300, label: 'GEX Data', emoji: '⚡' },
    vix_structure:  { warn: 150, err: 300, label: 'VIX Term Structure', emoji: '📈' },
    vol_regime:     { warn: 150, err: 300, label: 'Vol Regime', emoji: '🎯' },
    headlines:      { warn: 400, err: 800, label: 'Headlines (RSS)', emoji: '📰' },
    headlines_x:    { warn: 400, err: 800, label: 'Headlines (X)', emoji: '🐦' },
    daily_summary:  { warn: 1500, err: 2900, label: 'Daily Summary', emoji: '📋' },
    accuracy_log:   { warn: 1500, err: 2900, label: 'Accuracy Log', emoji: '✅' },
    accuracy_stats: { warn: 1500, err: 2900, label: 'Accuracy Stats', emoji: '📊' },
    attribution_cal:{ warn: 1500, err: 2900, label: 'Attribution Calibration', emoji: '🔬' },
    audit_latest:   { warn: 1500, err: 2900, label: 'Audit Latest', emoji: '🏛️' },
    research_scout: { warn: 1500, err: 2900, label: 'Research Scout', emoji: '🔍' },
    research_lab:   { warn: 1500, err: 2900, label: 'Research Lab', emoji: '🧪' },
    pred_archive:   { warn: 1500, err: 2900, label: 'Prediction Archive', emoji: '📦' },
  };

  const FEEDS = [
    { key: 'ai_synthesis',   url: 'data/ai-synthesis.json',           tsField: 'generated_at' },
    { key: 'options_flow',   url: 'data/options-flow.json',           tsField: 'fetched_at' },
    { key: 'flow_sentiment', url: 'data/flow-sentiment.json',         tsField: 'fetched_at' },
    { key: 'top_flow',       url: 'data/top-flow.json',               tsField: 'fetched_at' },
    { key: 'gex_data',       url: 'data/gex-data.json',               tsField: 'generated_at', altTs: 'fetched_at' },
    { key: 'vix_structure',  url: 'data/vix-structure.json',          tsField: 'generated_at', altTs: 'fetched_at' },
    { key: 'vol_regime',     url: 'data/vol-regime.json',             tsField: 'generated_at', altTs: 'fetched_at' },
    { key: 'headlines',      url: 'headlines.json',                    tsField: 'fetched_at' },
    { key: 'headlines_x',    url: 'headlines-x.json',                  tsField: 'fetched_at' },
    { key: 'accuracy_log',   url: 'data/accuracy-log.json',           tsField: '_last_entry' },
    { key: 'accuracy_stats', url: 'data/accuracy-stats.json',         tsField: 'last_updated' },
    { key: 'attribution_cal',url: 'data/attribution-calibration.json', tsField: 'last_updated' },
    { key: 'audit_latest',   url: 'data/audit-latest.json',           tsField: 'generated_at' },
    { key: 'pred_archive',   url: 'data/prediction-archive.json',     tsField: '_last_entry' },
  ];

  function todayStr() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }

  function isMarketHours() {
    var now = new Date();
    var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var day = et.getDay();
    var hour = et.getHours();
    var min = et.getMinutes();
    var timeNum = hour * 60 + min;
    if (day === 0 || day === 6) return false;
    return timeNum >= 570 && timeNum <= 960;
  }

  function fmtAge(mins) {
    if (mins < 1) return 'just now';
    if (mins < 60) return Math.round(mins) + 'm ago';
    if (mins < 1440) return Math.round(mins / 60) + 'h ago';
    return Math.round(mins / 1440) + 'd ago';
  }

  function fmtTs(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }) + ' ET';
    } catch { return iso; }
  }

  function statusClass(ageMins, th, isMarketFeed) {
    if (ageMins === null) return 'stale';
    if (isMarketFeed && !isMarketHours() && ageMins < 1200) return 'ok';
    if (ageMins > th.err) return 'err';
    if (ageMins > th.warn) return 'warn';
    return 'ok';
  }

  function statusLabel(cls) {
    return { ok: 'OK', warn: 'STALE', err: 'DOWN', stale: 'N/A' }[cls] || '?';
  }

  async function fetchFeed(feed) {
    try {
      const r = await fetch(feed.url + '?t=' + Date.now());
      if (!r.ok) return { key: feed.key, status: 'missing', age: null, ts: null, extra: {} };
      const data = await r.json();
      let ts = null;
      let extra = {};

      if (feed.tsField === '_last_entry') {
        const arr = Array.isArray(data) ? data : (data.summaries || data.predictions || []);
        if (arr.length > 0) {
          const last = arr[arr.length - 1];
          ts = last.generated_at || last.check_time || last.prediction_time || last.date || null;
          extra.count = arr.length;
        }
      } else {
        ts = data[feed.tsField] || (feed.altTs ? data[feed.altTs] : null);
      }

      if (feed.key === 'ai_synthesis') {
        extra.signal = data.intraday?.signal;
        extra.confidence = data.intraday?.confidence;
        extra.regime = data.regime;
        extra.hasError = data.status === 'api_error';
      }
      if (feed.key === 'options_flow') {
        extra.trades = data.total_trades || (Array.isArray(data.trades) ? data.trades.length : 0);
        extra.marketOpen = data.market_open;
      }
      if (feed.key === 'flow_sentiment') {
        extra.sentiment = data.sentiment;
        extra.pcRatio = data.pc_ratio;
      }
      if (feed.key === 'gex_data') {
        extra.netGex = data.net_gex;
        extra.regime = data.gex_regime;
        extra.flipPoint = data.gex_flip_point;
      }
      if (feed.key === 'vix_structure') {
        extra.spotVix = data.spot_vix;
        extra.structure = data.structure;
        extra.contango = data.contango_pct;
      }
      if (feed.key === 'vol_regime') {
        extra.regime = data.regime;
        extra.confidence = data.confidence;
      }
      if (feed.key === 'headlines') {
        extra.count = data.count || (data.items ? data.items.length : 0);
      }
      if (feed.key === 'headlines_x') {
        extra.count = Array.isArray(data) ? data.length : (data.items ? data.items.length : 0);
      }
      if (feed.key === 'accuracy_stats') {
        extra.totalPredictions = data.total_predictions;
        extra.accuracy = data.accuracy_pct;
      }
      if (feed.key === 'attribution_cal') {
        extra.cycles = data.history ? data.history.length : 0;
      }

      let ageMins = null;
      if (ts) { ageMins = (Date.now() - new Date(ts).getTime()) / 60000; }
      return { key: feed.key, status: 'loaded', age: ageMins, ts: ts, extra: extra };
    } catch (e) {
      return { key: feed.key, status: 'error', age: null, ts: null, extra: {}, error: e.message };
    }
  }

  async function fetchResearch() {
    const date = todayStr();
    const results = [];
    for (const prefix of ['scout', 'lab']) {
      try {
        const r = await fetch('data/research-scored/' + prefix + '-scored-' + date + '.json?t=' + Date.now());
        if (r.ok) {
          const data = await r.json();
          const items = data.items || (Array.isArray(data) ? data : []);
          results.push({ key: 'research_' + prefix, status: 'loaded', age: 0, ts: data.scored_at || date, extra: { count: items.length, date: date } });
        } else {
          results.push({ key: 'research_' + prefix, status: 'missing', age: null, ts: null, extra: { date: date } });
        }
      } catch (e) {
        results.push({ key: 'research_' + prefix, status: 'error', age: null, ts: null, extra: {} });
      }
    }
    return results;
  }

  async function fetchQuoteHealth() {
    try {
      const start = Date.now();
      const r = await fetch('/api/quote?symbol=SPY&t=' + Date.now());
      const latency = Date.now() - start;
      if (!r.ok) return { status: 'error', source: null, latency: null };
      const data = await r.json();
      return { status: 'ok', source: data.source || 'unknown', price: data.price, latency: latency };
    } catch (e) {
      return { status: 'error', source: null, latency: null, error: e.message };
    }
  }

  function renderCard(title, badge, rows) {
    return '<div class="health-card">' +
      '<div class="hc-header">' +
        '<span class="hc-title">' + title + '</span>' +
        '<span class="hc-badge hc-badge-' + badge.cls + '">' + badge.text + '</span>' +
      '</div>' +
      rows.map(function(r) {
        return '<div class="hc-row">' +
          '<span class="hc-label">' + r.label + '</span>' +
          '<span class="hc-value ' + (r.cls || '') + '">' + r.value + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderFeedCard(result) {
    var th = THRESHOLDS[result.key];
    if (!th) return '';
    var MARKET_FEEDS = ['ai_synthesis','options_flow','flow_sentiment','top_flow','gex_data','vix_structure','vol_regime'];
    var isMarketFeed = MARKET_FEEDS.indexOf(result.key) >= 0;
    var cls = result.status === 'missing' ? 'stale'
            : result.status === 'error' ? 'err'
            : statusClass(result.age, th, isMarketFeed);
    var badge = { cls: cls, text: statusLabel(cls) };
    var rows = [];

    rows.push({
      label: '<span class="hc-dot hc-dot-' + cls + '"></span>Status',
      value: result.status === 'missing' ? 'File not found' : result.status === 'error' ? 'Fetch error' : 'Available',
      cls: 'hc-value-' + cls
    });

    if (result.ts) {
      rows.push({ label: 'Last updated', value: fmtTs(result.ts) });
      rows.push({ label: 'Age', value: fmtAge(result.age), cls: 'hc-value-' + cls });
    }

    var e = result.extra || {};
    if (e.signal) rows.push({ label: 'Signal', value: e.signal + ' ' + (e.confidence || '') + '%' });
    if (e.regime) rows.push({ label: 'Regime', value: e.regime });
    if (e.hasError) rows.push({ label: 'API Error', value: 'Yes', cls: 'hc-value-err' });
    if (e.trades !== undefined) rows.push({ label: 'Trades', value: e.trades.toLocaleString() });
    if (e.marketOpen !== undefined) rows.push({ label: 'Market', value: e.marketOpen ? 'Open' : 'Closed' });
    if (e.sentiment) rows.push({ label: 'Sentiment', value: e.sentiment + ' (P/C: ' + (e.pcRatio || '—') + ')' });
    if (e.netGex !== undefined) rows.push({ label: 'Net GEX', value: (e.netGex / 1e9).toFixed(2) + 'B' });
    if (e.flipPoint) rows.push({ label: 'Flip Point', value: '$' + e.flipPoint });
    if (e.spotVix !== undefined) rows.push({ label: 'Spot VIX', value: e.spotVix });
    if (e.structure) rows.push({ label: 'Structure', value: e.structure + ' (' + (e.contango || '—') + '%)' });
    if (e.count !== undefined) rows.push({ label: 'Items', value: e.count.toLocaleString() });
    if (e.totalPredictions) rows.push({ label: 'Total checks', value: e.totalPredictions });
    if (e.accuracy !== undefined) rows.push({ label: 'Dir accuracy', value: e.accuracy + '%' });
    if (e.cycles !== undefined) rows.push({ label: 'Cal cycles', value: e.cycles });

    if (isMarketFeed && !isMarketHours() && cls === 'ok' && result.age > th.warn) {
      rows.push({ label: 'Note', value: 'Market closed — data from last session', cls: 'hc-value-muted' });
    }
    return renderCard(th.emoji + ' ' + th.label, badge, rows);
  }

  function renderQuoteCard(qr) {
    var cls = qr.status === 'ok' ? 'ok' : 'err';
    var rows = [
      { label: '<span class="hc-dot hc-dot-' + cls + '"></span>API Status', value: qr.status === 'ok' ? 'Connected' : 'Error', cls: 'hc-value-' + cls }
    ];
    if (qr.source) rows.push({ label: 'Source', value: qr.source });
    if (qr.price) rows.push({ label: 'SPY Price', value: '$' + qr.price });
    if (qr.latency) rows.push({ label: 'Latency', value: qr.latency + 'ms' });
    if (qr.error) rows.push({ label: 'Error', value: qr.error, cls: 'hc-value-err' });
    return renderCard('💹 Quote API (Finnhub)', { cls: cls, text: cls === 'ok' ? 'OK' : 'DOWN' }, rows);
  }

  function renderThetaCard(flowResult) {
    var th = THRESHOLDS.options_flow;
    var cls = !flowResult || flowResult.status !== 'loaded' ? 'err' : statusClass(flowResult.age, th, true);
    var e = flowResult ? flowResult.extra || {} : {};
    var rows = [
      { label: '<span class="hc-dot hc-dot-' + cls + '"></span>Inferred Status', value: cls === 'ok' ? 'Healthy (flow fresh)' : cls === 'warn' ? 'Possibly stale' : 'Check terminal', cls: 'hc-value-' + cls }
    ];
    if (e.trades !== undefined) rows.push({ label: 'Trades in flow', value: e.trades.toLocaleString() });
    if (e.marketOpen !== undefined) rows.push({ label: 'Market', value: e.marketOpen ? 'Open' : 'Closed' });
    if (flowResult && flowResult.ts) rows.push({ label: 'Last flow fetch', value: fmtTs(flowResult.ts) });
    rows.push({ label: 'Note', value: 'Direct health requires local access', cls: 'hc-value-muted' });
    return renderCard('🖥️ ThetaData Terminal', { cls: cls, text: statusLabel(cls) }, rows);
  }

  function renderCronCard(cronData) {
    if (!cronData) return renderCard('⏰ Cron Health', { cls: 'stale', text: 'N/A' }, [{ label: 'Status', value: 'No cron-health.json', cls: 'hc-value-muted' }]);
    var age = (Date.now() - new Date(cronData.checked_at).getTime()) / 60000;
    var cls = age > 60 ? 'err' : age > 35 ? 'warn' : 'ok';
    var rows = [
      { label: '<span class="hc-dot hc-dot-' + cls + '"></span>Heartbeat', value: fmtAge(age), cls: 'hc-value-' + cls },
      { label: 'Cron service', value: cronData.cron_service || '?', cls: cronData.cron_service === 'active' ? 'hc-value-ok' : 'hc-value-err' },
      { label: 'ThetaData', value: cronData.thetadata_service || '?', cls: cronData.thetadata_service === 'active' ? 'hc-value-ok' : 'hc-value-err' },
      { label: 'Flow daemon', value: cronData.daemon_status || '?', cls: cronData.daemon_status === 'streaming' ? 'hc-value-ok' : 'hc-value-warn' },
      { label: 'Trades today', value: (cronData.daemon_trades_today || 0).toLocaleString() },
      { label: 'Cron entries', value: cronData.cron_entry_count || '?' },
    ];
    var logs = cronData.log_age_minutes || {};
    if (logs.ai_synthesis !== undefined) rows.push({ label: 'Synthesis log age', value: logs.ai_synthesis + 'm', cls: logs.ai_synthesis > 300 ? 'hc-value-warn' : '' });
    if (logs.flow_fetch !== undefined) rows.push({ label: 'Flow log age', value: logs.flow_fetch + 'm', cls: logs.flow_fetch > 300 ? 'hc-value-warn' : '' });
    return renderCard('⏰ Cron Health', { cls: cls, text: cls === 'ok' ? 'OK' : cls === 'warn' ? 'STALE' : 'DOWN' }, rows);
  }

  function renderOverall(results, qr) {
    var MARKET_FEEDS = ['ai_synthesis','options_flow','flow_sentiment','top_flow','gex_data','vix_structure','vol_regime'];
    var statuses = results.map(function(r) {
      var th = THRESHOLDS[r.key];
      if (!th) return 'ok';
      if (r.status === 'missing' || r.status === 'error') return 'err';
      return statusClass(r.age, th, MARKET_FEEDS.indexOf(r.key) >= 0);
    });
    var ok = statuses.filter(function(s){return s==='ok'}).length;
    var warn = statuses.filter(function(s){return s==='warn'}).length;
    var err = statuses.filter(function(s){return s==='err'||s==='stale'}).length;
    var total = statuses.length + (qr ? 1 : 0);
    var okTotal = ok + (qr && qr.status === 'ok' ? 1 : 0);
    var pct = Math.round(okTotal / total * 100);
    var cls = pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'err';

    return '<div class="health-overall">' +
      '<div>' +
        '<div class="health-overall-score hc-value-' + cls + '">' + pct + '%</div>' +
        '<div class="health-overall-label">System Health</div>' +
      '</div>' +
      '<div style="flex:1">' +
        '<div class="health-overall-detail">' +
          '<span class="hc-value-ok">' + okTotal + ' healthy</span> · ' +
          '<span class="hc-value-warn">' + warn + ' stale</span> · ' +
          '<span class="hc-value-err">' + err + ' down/missing</span> · ' +
          total + ' total feeds' +
        '</div>' +
        '<div class="hc-bar-wrap" style="margin-top:6px"><div class="hc-bar hc-bar-' + cls + '" style="width:' + pct + '%"></div></div>' +
      '</div>' +
    '</div>';
  }

  async function run() {
    var grid = document.getElementById('health-grid');
    var overall = document.getElementById('health-overall');
    var tsEl = document.getElementById('health-ts');
    if (!grid) return;

    grid.innerHTML = '<div class="health-card health-card-full" style="text-align:center;color:#4b5563;padding:40px">Running diagnostics...</div>';

    var cronPromise = fetch('data/cron-health.json?t=' + Date.now()).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    var feedResults = await Promise.all(FEEDS.map(function(f){return fetchFeed(f)}));
    var researchResults = await fetchResearch();
    var quoteResult = await fetchQuoteHealth();
    var cronResult = await cronPromise;
    var allResults = feedResults.concat(researchResults);
    var flowResult = allResults.find(function(r){return r.key==='options_flow'});

    if (overall) overall.innerHTML = renderOverall(allResults, quoteResult);

    var cards = [];
    cards.push(renderQuoteCard(quoteResult));
    cards.push(renderThetaCard(flowResult));
    cards.push(renderCronCard(cronResult));

    ['ai_synthesis','options_flow','flow_sentiment','top_flow','gex_data','vix_structure','vol_regime'].forEach(function(k) {
      var r = allResults.find(function(x){return x.key===k});
      if (r) cards.push(renderFeedCard(r));
    });

    ['headlines','headlines_x'].forEach(function(k) {
      var r = allResults.find(function(x){return x.key===k});
      if (r) cards.push(renderFeedCard(r));
    });

    ['accuracy_log','accuracy_stats','attribution_cal','audit_latest','pred_archive'].forEach(function(k) {
      var r = allResults.find(function(x){return x.key===k});
      if (r) cards.push(renderFeedCard(r));
    });

    ['research_scout','research_lab'].forEach(function(k) {
      var r = allResults.find(function(x){return x.key===k});
      if (r) cards.push(renderFeedCard(r));
    });

    grid.innerHTML = cards.join('');
    if (tsEl) tsEl.textContent = 'Last check: ' + new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) + ' ET';
  }

  return { run: run };
})();
