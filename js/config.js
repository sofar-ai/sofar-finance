/**
 * Config page — watchlist management
 */
const Config = (() => {
  const API = '/api/update-watchlist';
  const ALWAYS_LOCKED = ['SPY', 'QQQ'];

  let currentTickers = [];
  let dirty = false;

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, color, persist) {
    const el = $('cfg-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color  = color || '#9ca3af';
    el.style.opacity = '1';
    if (!persist) setTimeout(() => { el.style.opacity = '0'; }, 4000);
  }

  function setSaveState(saving) {
    const btn = $('cfg-save-btn');
    if (!btn) return;
    btn.disabled    = saving;
    btn.textContent = saving ? 'Saving…' : 'Save Watchlist';
    btn.style.opacity = saving ? '0.6' : '1';
  }

  function renderTickers() {
    const container = $('cfg-ticker-chips');
    if (!container) return;
    container.innerHTML = '';
    currentTickers.forEach(ticker => {
      const locked = ALWAYS_LOCKED.includes(ticker);
      const chip   = document.createElement('span');
      chip.className = 'cfg-chip' + (locked ? ' cfg-chip-locked' : '');
      chip.innerHTML = `${ticker}${locked ? '' : `<button class="cfg-chip-remove" onclick="Config.removeTicker('${ticker}')" title="Remove">✕</button>`}`;
      container.appendChild(chip);
    });
    $('cfg-ticker-count').textContent = `${currentTickers.length} tickers`;
    const saveBtn = $('cfg-save-btn');
    if (saveBtn) saveBtn.disabled = !dirty;
  }

  function markDirty() {
    dirty = true;
    const btn = $('cfg-save-btn');
    if (btn) { btn.disabled = false; btn.style.borderColor = '#f59e0b'; btn.style.color = '#f59e0b'; }
  }

  async function load() {
    try {
      const r = await fetch(`${API}?v=${Date.now()}`);
      const data = await r.json();
      currentTickers = data.tickers || [];
      dirty = false;
      renderTickers();
      const updated = data.updated_at ? new Date(data.updated_at).toLocaleString('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }) + ' ET' : '';
      if (updated) setStatus(`Last saved: ${updated}`, '#4b5563', true);
    } catch (e) {
      setStatus('Could not load watchlist', '#ef4444', true);
    }
  }

  function addTicker() {
    const input = $('cfg-add-input');
    if (!input) return;
    const val = input.value.toUpperCase().trim().replace(/^\$/, '');
    if (!val) return;
    if (!/^[A-Z]{1,6}(\.[A-Z]{1,2})?$/.test(val)) {
      setStatus(`Invalid ticker: ${val}`, '#ef4444');
      return;
    }
    if (currentTickers.includes(val)) {
      setStatus(`${val} already in watchlist`, '#f59e0b');
      input.value = '';
      return;
    }
    if (currentTickers.length >= 30) {
      setStatus('Max 30 tickers', '#ef4444');
      return;
    }
    currentTickers.push(val);
    input.value = '';
    markDirty();
    renderTickers();
  }

  function removeTicker(ticker) {
    if (ALWAYS_LOCKED.includes(ticker)) return;
    currentTickers = currentTickers.filter(t => t !== ticker);
    markDirty();
    renderTickers();
  }

  async function save() {
    if (!dirty) return;
    setSaveState(true);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: currentTickers }),
      });
      const data = await r.json();
      if (!r.ok) {
        setStatus(data.error || 'Save failed', '#ef4444', true);
        setSaveState(false);
        return;
      }
      currentTickers = data.tickers;
      dirty = false;
      renderTickers();
      setSaveState(false);
      const btn = $('cfg-save-btn');
      if (btn) { btn.style.borderColor = ''; btn.style.color = ''; }
      setStatus('✅ Saved — scraper will use new watchlist on next run', '#22c55e', true);
    } catch (e) {
      setStatus('Save failed: ' + e.message, '#ef4444', true);
      setSaveState(false);
    }
  }

  function init() {
    load();
    const input = $('cfg-add-input');
    if (input) {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') addTicker(); });
      input.addEventListener('input', () => {
        input.value = input.value.toUpperCase().replace(/[^A-Z.]/g, '');
      });
    }
  }

  return { init, addTicker, removeTicker, save };
})();
