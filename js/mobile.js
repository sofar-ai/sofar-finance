/**
 * mobile.js — Mobile UX enhancements
 * - Options flow filter drawer toggle
 * - Collapsible AI analysis sections (touch-friendly)
 */

(function () {
  const IS_MOBILE = () => window.innerWidth < 768;

  // ── Options Flow: filter drawer ──────────────────────────────
  function initFilterDrawer() {
    const btn = document.getElementById('of-filter-toggle');
    const bar = document.querySelector('.of-filter-bar');
    if (!btn || !bar) return;

    btn.addEventListener('click', () => {
      const open = bar.classList.toggle('mob-open');
      btn.textContent = open ? '✕ Close Filters' : '⚙ Filters & Search';
    });

    // Close drawer when a filter changes
    bar.addEventListener('change', () => {
      if (IS_MOBILE()) {
        bar.classList.remove('mob-open');
        btn.textContent = '⚙ Filters & Search';
      }
    });
  }

  // ── AI Analysis: collapsible sections ───────────────────────
  function initCollapsibleSections() {
    if (!IS_MOBILE()) return;
    document.querySelectorAll('.ai-section').forEach((section, i) => {
      const title = section.querySelector('.ai-section-title');
      if (!title) return;
      // Start with first two sections open, rest collapsed
      if (i > 1) section.classList.add('collapsed');
      title.addEventListener('click', () => {
        section.classList.toggle('collapsed');
      });
    });
  }

  // ── Run on DOM ready ─────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initFilterDrawer();
    // Small delay for AI page to render its sections dynamically
    setTimeout(initCollapsibleSections, 800);
  });

  // Re-run collapse init after window resize crosses breakpoint
  let lastMobile = IS_MOBILE();
  window.addEventListener('resize', () => {
    const nowMobile = IS_MOBILE();
    if (nowMobile && !lastMobile) initCollapsibleSections();
    lastMobile = nowMobile;
  });
})();
