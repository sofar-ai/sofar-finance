/**
 * Rates & Dollar — Treasury yields, yield curve, DXY
 * Fetches live data from Yahoo Finance via /api/chart endpoint
 */
const RatesPage = (() => {
  'use strict';

  const TICKERS = [
    { sym: '^TNX', label: '10Y Yield', suffix: '%' },
    { sym: '^TYX', label: '30Y Yield', suffix: '%' },
    { sym: '^IRX', label: '3M Yield', suffix: '%' },
    { sym: 'DX-Y.NYB', label: 'DXY', suffix: '' },
  ];

  function fmtTs(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }) + ' ET';
    } catch (e) { return iso; }
  }

  async function fetchQuote(sym) {
    try {
      var url = '/api/chart?ticker=' + encodeURIComponent(sym) + '&timeframe=1D';
      var r = await fetch(url);
      if (!r.ok) return null;
      var d = await r.json();
      var candles = d.candles || [];
      if (candles.length === 0) return null;
      var last = candles[candles.length - 1];
      var first = candles[0];
      var price = last.close;
      var prevClose = first.open;
      var change = price - prevClose;
      var changePct = prevClose ? (change / prevClose * 100) : null;
      return {
        price: price,
        prevClose: prevClose,
        change: change,
        changePct: changePct,
        ts: last.time ? new Date(last.time * 1000).toISOString() : null
      };
    } catch (e) {
      return null;
    }
  }

  function changeClass(val) {
    if (val === null || val === undefined) return 'rate-change-flat';
    if (Math.abs(val) < 0.01) return 'rate-change-flat';
    return val > 0 ? 'rate-change-up' : 'rate-change-down';
  }

  function renderCards(quotes) {
    var grid = document.getElementById('rates-grid');
    if (!grid) return;
    var html = '';
    TICKERS.forEach(function(t) {
      var q = quotes[t.sym];
      if (!q) {
        html += '<div class="rate-card"><div class="rate-label">' + t.label + '</div><div class="rate-value">—</div></div>';
        return;
      }
      var chgStr = q.change !== null ? (q.change >= 0 ? '+' : '') + q.change.toFixed(3) + ' (' + (q.changePct >= 0 ? '+' : '') + q.changePct.toFixed(2) + '%)' : '';
      html += '<div class="rate-card">' +
        '<div class="rate-label">' + t.label + '</div>' +
        '<div class="rate-value">' + q.price.toFixed(t.sym === 'DX-Y.NYB' ? 2 : 3) + t.suffix + '</div>' +
        '<div class="rate-change ' + changeClass(q.change) + '">' + chgStr + '</div>' +
      '</div>';
    });
    grid.innerHTML = html;
  }

  function renderSpread(quotes) {
    var el = document.getElementById('spread-section');
    if (!el) return;
    var tenY = quotes['^TNX'];
    var threeM = quotes['^IRX'];
    if (!tenY || !threeM) {
      el.innerHTML = '<div class="spread-card"><div class="spread-title">Yield Curve</div><div style="color:#4b5563;font-size:11px">Insufficient data</div></div>';
      return;
    }
    var spread = (tenY.price - threeM.price).toFixed(3);
    var status = spread < 0 ? 'INVERTED' : (Math.abs(spread) < 0.2 ? 'FLAT' : 'NORMAL');
    var badgeClass = status === 'INVERTED' ? 'spread-inverted' : (status === 'FLAT' ? 'spread-flat' : 'spread-normal');

    var thirtyY = quotes['^TYX'];
    var tenThirty = thirtyY ? (thirtyY.price - tenY.price).toFixed(3) : '—';

    el.innerHTML = '<div class="spread-card">' +
      '<div class="spread-header">' +
        '<span class="spread-title">📐 Yield Curve Analysis</span>' +
        '<span class="spread-badge ' + badgeClass + '">' + status + '</span>' +
      '</div>' +
      '<div class="spread-row"><span class="spread-label">10Y - 3M Spread (Fed Model)</span><span class="spread-val">' + spread + '%</span></div>' +
      '<div class="spread-row"><span class="spread-label">30Y - 10Y Spread</span><span class="spread-val">' + tenThirty + '%</span></div>' +
      '<div class="spread-row"><span class="spread-label">10Y Yield</span><span class="spread-val">' + tenY.price.toFixed(3) + '%</span></div>' +
      '<div class="spread-row"><span class="spread-label">30Y Yield</span><span class="spread-val">' + (thirtyY ? thirtyY.price.toFixed(3) + '%' : '—') + '</span></div>' +
      '<div class="spread-row"><span class="spread-label">3M T-Bill</span><span class="spread-val">' + threeM.price.toFixed(3) + '%</span></div>' +
      '<div class="spread-row"><span class="spread-label">Curve Shape</span><span class="spread-val">' +
        (spread < 0 ? '⚠️ Inverted — recession signal' : spread < 0.2 ? '⚠️ Flattening — watch closely' : '✅ Normal — healthy economy') +
      '</span></div>' +
    '</div>';
  }

  function renderDXY(quotes) {
    var el = document.getElementById('dxy-section');
    if (!el) return;
    var dxy = quotes['DX-Y.NYB'];
    if (!dxy) {
      el.innerHTML = '';
      return;
    }
    var strength = dxy.price > 104 ? 'STRONG' : (dxy.price > 100 ? 'MODERATE' : (dxy.price > 96 ? 'WEAK' : 'VERY WEAK'));
    var equityImpact = dxy.change > 0 ? 'Equity headwind (dollar strengthening)' : (dxy.change < 0 ? 'Equity tailwind (dollar weakening)' : 'Neutral');
    var impactClass = dxy.change > 0 ? 'rate-change-down' : (dxy.change < 0 ? 'rate-change-up' : 'rate-change-flat');

    el.innerHTML = '<div class="spread-card dxy-section">' +
      '<div class="spread-header">' +
        '<span class="spread-title">💵 US Dollar Index (DXY)</span>' +
        '<span class="spread-badge ' + (strength === 'STRONG' ? 'spread-inverted' : strength === 'WEAK' || strength === 'VERY WEAK' ? 'spread-normal' : 'spread-flat') + '">' + strength + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px">' +
        '<span class="dxy-value">' + dxy.price.toFixed(2) + '</span>' +
        '<span class="rate-change ' + changeClass(dxy.change) + '">' +
          (dxy.change !== null ? (dxy.change >= 0 ? '+' : '') + dxy.change.toFixed(2) + ' (' + (dxy.changePct >= 0 ? '+' : '') + dxy.changePct.toFixed(2) + '%)' : '') +
        '</span>' +
      '</div>' +
      '<div class="spread-row"><span class="spread-label">Dollar Strength</span><span class="spread-val">' + strength + '</span></div>' +
      '<div class="spread-row"><span class="spread-label">Equity Impact</span><span class="spread-val ' + impactClass + '">' + equityImpact + '</span></div>' +
      '<div class="spread-row"><span class="spread-label">Correlation</span><span class="spread-val">SPY: ~-0.26 avg (can reach -0.95 in stress)</span></div>' +
    '</div>';
  }

  function renderSignals(quotes) {
    var el = document.getElementById('signal-section');
    if (!el) return;
    var signals = [];
    var tenY = quotes['^TNX'];
    var threeM = quotes['^IRX'];
    var dxy = quotes['DX-Y.NYB'];

    if (tenY && threeM) {
      var spread = tenY.price - threeM.price;
      if (spread < 0) signals.push({ text: '⚠️ YIELD CURVE INVERTED — recession watch', cls: 'rate-change-down' });
      else if (spread < 0.2) signals.push({ text: '⚠️ YIELD CURVE FLAT — monitor closely', cls: 'rate-change-down' });
      else signals.push({ text: '✅ Yield curve normal', cls: 'rate-change-up' });
    }
    if (tenY && tenY.change !== null) {
      if (Math.abs(tenY.change) > 0.05) {
        signals.push({
          text: tenY.change > 0 ? '📈 10Y rising sharply — tech/growth headwind' : '📉 10Y falling sharply — tech/growth tailwind',
          cls: tenY.change > 0 ? 'rate-change-down' : 'rate-change-up'
        });
      }
    }
    if (dxy && dxy.changePct !== null) {
      if (Math.abs(dxy.changePct) > 0.3) {
        signals.push({
          text: dxy.changePct > 0 ? '💪 Dollar strengthening — equity headwind' : '📉 Dollar weakening — equity tailwind',
          cls: dxy.changePct > 0 ? 'rate-change-down' : 'rate-change-up'
        });
      }
    }

    if (signals.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<div class="spread-card">' +
      '<div class="spread-title" style="margin-bottom:10px">📡 Rate Signals</div>' +
      '<div class="signal-row">' +
        signals.map(function(s) {
          return '<span class="signal-pill ' + s.cls + '">' + s.text + '</span>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  async function init() {
    var tsEl = document.getElementById('rates-ts');
    if (tsEl) tsEl.textContent = 'Fetching rates...';

    var quotes = {};
    var results = await Promise.all(TICKERS.map(function(t) {
      return fetchQuote(t.sym).then(function(q) { return { sym: t.sym, data: q }; });
    }));
    results.forEach(function(r) { if (r.data) quotes[r.sym] = r.data; });

    renderCards(quotes);
    renderSpread(quotes);
    renderDXY(quotes);
    renderSignals(quotes);

    var latestTs = null;
    results.forEach(function(r) {
      if (r.data && r.data.ts) {
        if (!latestTs || r.data.ts > latestTs) latestTs = r.data.ts;
      }
    });
    if (tsEl) tsEl.textContent = 'Last updated: ' + fmtTs(latestTs);

    setInterval(function() { init(); }, 300000);
  }

  return { init: init };
})();
