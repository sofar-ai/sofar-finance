/**
 * FX Rates Component — Frankfurter API (free, CORS-enabled)
 * Displays major pairs. Loads once — daily rates don't change intraday.
 */

const FXRates = (() => {
  async function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="fx-loading">Loading…</div>';

    try {
      const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,CNY,KRW,TWD');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const r = data.rates;

      const pairs = [
        { label: 'EUR/USD', value: r.EUR ? 1 / r.EUR : null, dec: 4 },
        { label: 'GBP/USD', value: r.GBP ? 1 / r.GBP : null, dec: 4 },
        { label: 'USD/JPY', value: r.JPY,                     dec: 2 },
        { label: 'USD/CNY', value: r.CNY,                     dec: 4 },
        { label: 'USD/KRW', value: r.KRW,                     dec: 2 },
        { label: 'USD/TWD', value: r.TWD,                     dec: 2 },
      ];

      container.innerHTML = '';
      pairs.forEach(({ label, value, dec }) => {
        const row = document.createElement('div');
        row.className = 'fx-row';
        row.innerHTML = `
          <span class="fx-label">${label}</span>
          <span class="fx-value">${value != null ? value.toFixed(dec) : '—'}</span>
        `;
        container.appendChild(row);
      });
    } catch (err) {
      container.innerHTML = '<div class="fx-error">⚠ FX unavailable</div>';
      console.error('[FX]', err);
    }
  }

  return { init };
})();
