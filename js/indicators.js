/**
 * Indicators — TA indicator registry for sofar-finance
 * Each indicator in REGISTRY has: id, label, enabled, apply(inst), remove(inst)
 * To add future indicators: push a new entry to REGISTRY with the same shape.
 */

const Indicators = (() => {

  // ── Math helpers ──────────────────────────────────────────────────────────

  function computeMA(candles, period) {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }

  function computeRSI(candles, period = 14) {
    if (candles.length < period + 1) return [];
    const result = [];
    let avgGain = 0, avgLoss = 0;

    // Seed with first `period` changes (simple average)
    for (let i = 1; i <= period; i++) {
      const chg = candles[i].close - candles[i - 1].close;
      if (chg > 0) avgGain += chg; else avgLoss += Math.abs(chg);
    }
    avgGain /= period;
    avgLoss /= period;

    const push = (time) => {
      if (avgLoss === 0) { result.push({ time, value: 100 }); return; }
      const rs = avgGain / avgLoss;
      result.push({ time, value: parseFloat((100 - 100 / (1 + rs)).toFixed(2)) });
    };
    push(candles[period].time);

    // Wilder's smoothing for remaining bars
    for (let i = period + 1; i < candles.length; i++) {
      const chg = candles[i].close - candles[i - 1].close;
      avgGain = (avgGain * (period - 1) + (chg > 0 ? chg : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (chg < 0 ? Math.abs(chg) : 0)) / period;
      push(candles[i].time);
    }
    return result;
  }

  // ── Scale margin presets ──────────────────────────────────────────────────

  function setMargins(inst, hasRSI) {
    if (hasRSI) {
      inst.chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.02, bottom: 0.42 } });
      inst.chart.priceScale('vol').applyOptions(  { scaleMargins: { top: 0.60, bottom: 0.36 } });
    } else {
      inst.chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.25 } });
      inst.chart.priceScale('vol').applyOptions(  { scaleMargins: { top: 0.80, bottom: 0 } });
    }
  }

  // ── MA 50 / 200 ──────────────────────────────────────────────────────────

  function applyMA(inst) {
    if (!inst.candles?.length) return;
    if (!inst._ma50) {
      inst._ma50 = inst.chart.addLineSeries({
        color: '#f59e0b', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }
    if (!inst._ma200) {
      inst._ma200 = inst.chart.addLineSeries({
        color: '#818cf8', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }
    // Clip MA output to the display window so lines don't appear on hidden candles
    const clipMA = (data) => inst.displayFrom
      ? data.filter(p => p.time >= inst.displayFrom)
      : data;
    inst._ma50.setData(clipMA(computeMA(inst.candles, 50)));
    inst._ma200.setData(clipMA(computeMA(inst.candles, 200)));
  }

  function removeMA(inst) {
    if (inst._ma50)  { inst.chart.removeSeries(inst._ma50);  inst._ma50  = null; }
    if (inst._ma200) { inst.chart.removeSeries(inst._ma200); inst._ma200 = null; }
  }

  // ── RSI 14 ───────────────────────────────────────────────────────────────

  function applyRSI(inst) {
    if (!inst.candles?.length) return;
    const rsiData = computeRSI(inst.candles, 14);
    if (!rsiData.length) return;

    setMargins(inst, true);

    if (!inst._rsi) {
      inst._rsi = inst.chart.addLineSeries({
        priceScaleId: 'rsi', color: '#60a5fa', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
      });
      inst.chart.priceScale('rsi').applyOptions({
        scaleMargins: { top: 0.76, bottom: 0.02 },
        borderVisible: false, drawTicks: false,
      });
    }
    if (!inst._rsiOB) {
      inst._rsiOB = inst.chart.addLineSeries({
        priceScaleId: 'rsi', color: 'rgba(239,68,68,0.5)', lineWidth: 1, lineStyle: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }
    if (!inst._rsiOS) {
      inst._rsiOS = inst.chart.addLineSeries({
        priceScaleId: 'rsi', color: 'rgba(34,197,94,0.5)', lineWidth: 1, lineStyle: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }

    const t0 = rsiData[0].time, tN = rsiData[rsiData.length - 1].time;
    // Clip RSI to display window
    const visRSI = inst.displayFrom ? rsiData.filter(p => p.time >= inst.displayFrom) : rsiData;
    const vt0 = visRSI.length ? visRSI[0].time : t0;
    const vtN = visRSI.length ? visRSI[visRSI.length - 1].time : tN;
    inst._rsi.setData(visRSI);
    inst._rsiOB.setData([{ time: vt0, value: 70 }, { time: vtN, value: 70 }]);
    inst._rsiOS.setData([{ time: vt0, value: 30 }, { time: vtN, value: 30 }]);
  }

  function removeRSI(inst) {
    if (inst._rsi)   { inst.chart.removeSeries(inst._rsi);   inst._rsi   = null; }
    if (inst._rsiOB) { inst.chart.removeSeries(inst._rsiOB); inst._rsiOB = null; }
    if (inst._rsiOS) { inst.chart.removeSeries(inst._rsiOS); inst._rsiOS = null; }
    setMargins(inst, false);
  }

  // ── Registry ─────────────────────────────────────────────────────────────
  // To add a new indicator: push { id, label, enabled, apply, remove } here.

  const REGISTRY = [
    { id: 'MA',  label: 'MA 50/200', enabled: false, apply: applyMA,  remove: removeMA  },
    { id: 'RSI', label: 'RSI 14',    enabled: false, apply: applyRSI, remove: removeRSI },
    // { id: 'MACD', label: 'MACD 12/26', enabled: false, apply: applyMACD, remove: removeMACD },
    // { id: 'BB',   label: 'BB 20',      enabled: false, apply: applyBB,   remove: removeBB   },
  ];

  // ── Public API ────────────────────────────────────────────────────────────

  function toggle(id) {
    const ind = REGISTRY.find(i => i.id === id);
    if (!ind) return;
    ind.enabled = !ind.enabled;
    const instances = ChartComponent.getSeries();
    Object.values(instances).forEach(inst => {
      ind.enabled ? ind.apply(inst) : ind.remove(inst);
    });
  }

  // Called after each chart loads new candle data
  function applyAll(inst) {
    REGISTRY.forEach(ind => { if (ind.enabled) ind.apply(inst); });
  }

  return { toggle, applyAll, REGISTRY };
})();
