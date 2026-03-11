/**
 * Refresh — manual trigger for flow + synthesis via local webhook server
 * Requires: python3 ~/scripts/refresh-server.py running on localhost:9001
 */

const Refresh = (() => {
  const WEBHOOK = 'http://localhost:9001';
  const POLL_MS  = 1000;

  function initButton(buttonId, modalId) {
    const btn   = document.getElementById(buttonId);
    const modal = document.getElementById(modalId);
    if (!btn) return;

    const handler = async () => {
      btn.disabled = true;
      btn.textContent = '⏳ Running…';
      btn.style.opacity = '0.7';
      clearLog();
      showModal(modal);

      await refresh(modal);

      btn.disabled = false;
      btn.textContent = '🔄 Rerun Options Flow + AI Synthesis';
      btn.style.opacity = '';
    };
    btn.addEventListener('click', handler);
    btn.addEventListener('touchend', (e) => { e.preventDefault(); handler(); });
  }

  function showModal(modal) {
    if (modal) modal.style.display = 'flex';
  }

  function hideModal(modal) {
    if (modal) modal.style.display = 'none';
  }

  function clearLog() {
    const el = document.getElementById('refresh-log');
    const step = document.getElementById('refresh-step');
    if (el) el.innerHTML = '';
    if (step) step.textContent = 'Starting…';
  }

  function appendLog(msg, color) {
    const logEl = document.getElementById('refresh-log');
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = 'refresh-log-line';
    if (color) line.style.color = color;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStep(text) {
    const el = document.getElementById('refresh-step');
    if (el) el.textContent = text;
  }

  async function refresh(modal) {
    // Check server is up
    try {
      const ping = await fetch(`${WEBHOOK}/ping`, { signal: AbortSignal.timeout(3000) });
      if (!ping.ok) throw new Error('bad response');
    } catch {
      appendLog('❌ Refresh server not responding on localhost:9001.', '#ef4444');
      appendLog('   It may have restarted. Try again in a few seconds or run:', '#ef4444');
      appendLog('   python3 ~/scripts/refresh-server.py', '#9ca3af');
      // Auto-close after 6s on error
      setTimeout(() => hideModal(modal), 6000);
      return;
    }

    // Check not already running
    try {
      const statusRes = await fetch(`${WEBHOOK}/status`);
      const statusData = await statusRes.json();
      if (statusData.running) {
        appendLog(`⏳ Already running: ${statusData.step || '…'}`, '#f59e0b');
        appendLog('   Close this and check back shortly.', '#9ca3af');
        pollUntilDone(modal);
        return;
      }
    } catch { /* ignore */ }

    // Trigger
    appendLog('[START] Sending trigger…', '#9ca3af');
    try {
      const res = await fetch(`${WEBHOOK}/refresh`, { method: 'POST' });
      if (res.status === 409) {
        appendLog('⚠ Already running — tailing progress…', '#f59e0b');
      } else if (res.status !== 202) {
        const err = await res.json().catch(() => ({}));
        appendLog(`❌ Server error: ${err.error || res.status}`, '#ef4444');
        setTimeout(() => hideModal(modal), 5000);
        return;
      } else {
        appendLog('[START] Options flow + AI synthesis running…', '#22c55e');
      }
    } catch (e) {
      appendLog(`❌ Network error: ${e.message}`, '#ef4444');
      setTimeout(() => hideModal(modal), 5000);
      return;
    }

    pollUntilDone(modal);
  }

  let knownLogLen = 0;

  async function pollUntilDone(modal) {
    knownLogLen = 0;
    while (true) {
      await new Promise(r => setTimeout(r, POLL_MS));
      try {
        const res  = await fetch(`${WEBHOOK}/status`);
        const data = await res.json();

        if (data.step) setStep(data.step);

        // Append only new log lines
        const lines = data.log || [];
        for (let i = knownLogLen; i < lines.length; i++) {
          const line = lines[i];
          const color = line.startsWith('[START]') || line.includes('✓') ? '#22c55e'
                      : line.includes('ERROR') || line.includes('error') ? '#ef4444'
                      : '#9ca3af';
          appendLog(line, color);
        }
        knownLogLen = lines.length;

        if (!data.running) {
          appendLog('', null);
          appendLog('✓ Done! Data updated and pushed to GitHub.', '#22c55e');
          appendLog('Dashboard will reload in 5 seconds…', '#9ca3af');
          setStep('Complete');
          setTimeout(() => {
            hideModal(modal);
            // Reload data widgets
            try { AISynthesis.initStrip?.() || AISynthesis.load?.('strip'); } catch {}
            try { TopFlow.load?.(); } catch {}
          }, 5000);
          break;
        }
      } catch (e) {
        appendLog(`Poll error: ${e.message}`, '#ef4444');
        break;
      }
    }
  }

  return { initButton };
})();
