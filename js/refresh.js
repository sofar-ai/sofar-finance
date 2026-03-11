/**
 * Refresh — GitHub-trigger based manual refresh
 * POST /api/trigger-refresh  → sets state to "pending"
 * GET  /api/trigger-refresh  → polls state (pending/running/done/error)
 * Local poller picks up "pending" within ~1 minute and runs the scripts
 */

const Refresh = (() => {
  const API      = '/api/trigger-refresh';
  const POLL_MS  = 5000;
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  function initButton(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    const handler = async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      await runRefresh(btn);
      btn.disabled = false;
    };

    btn.addEventListener('click',    handler);
    btn.addEventListener('touchend', (e) => { e.preventDefault(); handler(); });
  }

  function setState(btn, state, extra) {
    const labels = {
      posting:  { text: '⏳ Queuing…',      color: '#f59e0b' },
      pending:  { text: '⏳ Queued…',        color: '#f59e0b' },
      running:  { text: '⚙️ Running…',       color: '#60a5fa' },
      done:     { text: `✅ Done`,            color: '#22c55e' },
      error:    { text: '❌ Error — try again', color: '#ef4444' },
      timeout:  { text: '❌ Timed out — try again', color: '#ef4444' },
    };
    const s = labels[state] || { text: state, color: '#9ca3af' };
    btn.textContent  = extra ? `${s.text} — ${extra}` : s.text;
    btn.style.color  = s.color;
    btn.style.borderColor = s.color;
  }

  async function runRefresh(btn) {
    setState(btn, 'posting');

    // POST to trigger
    let res;
    try {
      res = await fetch(API, { method: 'POST' });
    } catch (e) {
      setState(btn, 'error');
      console.error('[Refresh] POST failed:', e);
      return;
    }

    if (!res.ok && res.status !== 202 && res.status !== 200) {
      const err = await res.json().catch(() => ({}));
      console.error('[Refresh] API error:', err);
      // If GITHUB_TOKEN not set, show helpful message
      if (err.error?.includes('GITHUB_TOKEN')) {
        btn.textContent = '❌ GITHUB_TOKEN not set in Vercel';
        btn.style.color = '#ef4444';
      } else {
        setState(btn, 'error');
      }
      return;
    }

    // Poll for completion
    const started = Date.now();
    while (true) {
      await new Promise(r => setTimeout(r, POLL_MS));

      if (Date.now() - started > TIMEOUT_MS) {
        setState(btn, 'timeout');
        return;
      }

      let data;
      try {
        const r = await fetch(`${API}?v=${Date.now()}`);
        data = await r.json();
      } catch {
        continue; // transient error, keep polling
      }

      const state = data.state;
      setState(btn, state);

      if (state === 'done') {
        const ago = data.completed_at
          ? Math.round((Date.now() - new Date(data.completed_at).getTime()) / 1000)
          : null;
        setState(btn, 'done', ago != null ? `${ago}s ago` : '');
        // Reload data widgets after a short pause
        setTimeout(() => {
          try { if (window.AISynthesis) { AISynthesis.initStrip?.() || AISynthesis.load?.('strip'); } } catch {}
          try { if (window.TopFlow) TopFlow.load?.(); } catch {}
          // Reset button after 8s
          setTimeout(() => {
            setState(btn, 'idle');
            btn.textContent = '🔄 Rerun Options Flow + AI Synthesis';
            btn.style.color = '';
            btn.style.borderColor = '';
          }, 8000);
        }, 1500);
        return;
      }

      if (state === 'error') {
        setState(btn, 'error');
        return;
      }
    }
  }

  return { initButton };
})();
