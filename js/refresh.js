/**
 * Refresh — manual trigger for flow + synthesis scripts via local webhook server
 * Requires: python3 ~/scripts/refresh-server.py running on localhost:9001
 */

const Refresh = (() => {
  const WEBHOOK = 'http://localhost:9001';
  const POLL_MS  = 1000;

  function show(el) { if (el) el.style.display = ''; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function initButton(buttonId, modalId) {
    const btn   = document.getElementById(buttonId);
    const modal = document.getElementById(modalId);
    if (!btn) return;

    btn.addEventListener('click', async () => {
      show(modal);
      await refresh();
      hide(modal);
    });
  }

  async function refresh() {
    const logEl = document.getElementById('refresh-log');
    const stepEl = document.getElementById('refresh-step');

    const log = (msg) => {
      const line = document.createElement('div');
      line.className = 'refresh-log-line';
      line.textContent = msg;
      if (logEl) logEl.appendChild(line);
      logEl?.scrollTop = logEl?.scrollHeight;
    };

    // Check server
    try {
      await fetch(`${WEBHOOK}/ping`);
    } catch {
      log('ERROR: Refresh server not running. Start with: python3 ~/scripts/refresh-server.py');
      return;
    }

    // Trigger refresh
    log('[START] Refreshing options flow + AI synthesis…');
    try {
      const res = await fetch(`${WEBHOOK}/refresh`, { method: 'POST' });
      if (res.status !== 202) {
        const err = await res.json();
        log(`ERROR: ${err.error || res.status}`);
        return;
      }
    } catch (e) {
      log(`ERROR: ${e.message}`);
      return;
    }

    // Poll status
    while (true) {
      try {
        const res = await fetch(`${WEBHOOK}/status`);
        const data = await res.json();

        if (stepEl && data.step) stepEl.textContent = data.step;
        data.log.forEach((line, i) => {
          if (!logEl?.querySelector(`.refresh-log-line:nth-child(${i+1})`)) {
            const div = document.createElement('div');
            div.className = 'refresh-log-line';
            div.textContent = line;
            logEl?.appendChild(div);
          }
        });

        if (!data.running) {
          log('[DONE] Data refreshed and pushed to GitHub.');
          log('Dashboard will update in ~30 seconds…');
          // Trigger UI refresh of data
          if (window.Quotes) Quotes.load?.();
          if (window.TopFlow) TopFlow.load?.();
          if (window.AISynthesis) AISynthesis.load?.('strip');
          break;
        }
      } catch (e) {
        log(`Poll error: ${e.message}`);
        break;
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }

  return { initButton };
})();
