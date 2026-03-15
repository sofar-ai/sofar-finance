/**
 * nav.js — Shared navigation for SOFAR Finance
 * Injects dropdown nav into <div id="nav-root"></div> on each page.
 * Active group + item detected from window.location.pathname.
 *
 * Groups:
 *   Markets  → index, options-flow, vol-regime
 *   AI       → ai-analysis, macro-events, ticker-dives, daily-summary
 *   Performance → performance
 *   Config   → config (standalone)
 */
(function () {
  'use strict';

  const GROUPS = [
    {
      id: 'markets',
      label: 'Markets',
      default: 'index.html',
      items: [
        { href: 'index.html',        label: 'Dashboard'    },
        { href: 'options-flow.html', label: 'Options Flow' },
        { href: 'vol-regime.html',   label: 'Vol Regime'   },
      ],
    },
    {
      id: 'ai',
      label: 'AI',
      default: 'ai-analysis.html',
      items: [
        { href: 'ai-analysis.html',   label: 'AI Analysis'  },
        { href: 'macro-events.html',  label: 'Macro Events' },
        { href: 'ticker-dives.html',  label: 'Deep Dives'   },
        { href: 'daily-summary.html', label: 'Daily Summary'},
      ],
    },
    {
      id: 'performance',
      label: 'Performance',
      default: 'performance.html',
      items: [
        { href: 'performance.html', label: 'Performance' },
        { href: 'audit.html',       label: 'Audit' },
      ],
    },
    {
      id: 'config',
      label: 'Config',
      default: 'config.html',
      items: null,  // standalone — no dropdown
    },
  ];

  // Detect active page
  const pagePath = window.location.pathname.split('/').pop() || 'index.html';

  function isActive(href) {
    return href === pagePath || (pagePath === '' && href === 'index.html');
  }

  function groupIsActive(group) {
    if (!group.items) return isActive(group.default);
    return group.items.some(it => isActive(it.href));
  }

  // ── Build HTML ──────────────────────────────────────────────────────────────
  function buildNav() {
    const groupsHtml = GROUPS.map(g => {
      const active = groupIsActive(g);
      if (!g.items) {
        // Standalone link
        return `<a href="${g.default}" class="snav-group${active ? ' snav-active' : ''}">${g.label}</a>`;
      }
      const dropItems = g.items.map(it => {
        const itemActive = isActive(it.href);
        return `<a href="${it.href}" class="snav-drop-item${itemActive ? ' snav-drop-active' : ''}">${it.label}</a>`;
      }).join('');
      return `
        <div class="snav-group-wrap${active ? ' snav-group-wrap-active' : ''}">
          <a href="${g.default}" class="snav-group${active ? ' snav-active' : ''}">
            ${g.label}<span class="snav-chevron">▾</span>
          </a>
          <div class="snav-dropdown">${dropItems}</div>
        </div>`;
    }).join('');

    return `
      <header class="snav-header" id="snav-header">
        <a href="index.html" class="snav-logo">SOFAR <span>// Finance</span></a>
        <nav class="snav-nav" id="snav-nav">${groupsHtml}</nav>
        <button class="snav-hamburger" id="snav-hamburger" aria-label="Menu">☰</button>
        <div class="snav-meta" id="snav-meta-slot"></div>
      </header>
      <div class="snav-mobile-panel" id="snav-mobile-panel" aria-hidden="true">
        ${GROUPS.map(g => {
          if (!g.items) return `<a href="${g.default}" class="snav-mob-item${groupIsActive(g)?' snav-mob-active':''}">${g.label}</a>`;
          const open = groupIsActive(g);
          return `
            <div class="snav-mob-group">
              <div class="snav-mob-label${open?' snav-mob-open':''}" data-toggle="${g.id}">
                ${g.label} <span class="snav-mob-chevron">${open?'▴':'▾'}</span>
              </div>
              <div class="snav-mob-children${open?'':' snav-mob-hidden'}" id="snav-mob-${g.id}">
                ${(g.items||[]).map(it=>`<a href="${it.href}" class="snav-mob-item${isActive(it.href)?' snav-mob-active':''}">${it.label}</a>`).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ── CSS ─────────────────────────────────────────────────────────────────────
  const CSS = `
    .snav-header {
      display: flex; align-items: center; height: 54px; padding: 0 20px;
      background: #080b10; border-bottom: 1px solid #1a1f28;
      position: sticky; top: 0; z-index: 1000; gap: 0;
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
    }

    /* ── Logo ── */
    .snav-logo {
      font-size: 1.45em; font-weight: 800; color: #f59e0b; text-decoration: none;
      letter-spacing: .04em; white-space: nowrap; margin-right: 28px; line-height: 1;
      text-shadow: 0 0 24px rgba(245,158,11,.25);
    }
    .snav-logo span { color: #475569; font-weight: 400; font-size: .8em; letter-spacing: .02em; }

    /* ── Nav group row ── */
    .snav-nav {
      display: flex; align-items: stretch; gap: 0; flex: 1; height: 54px;
    }

    /* ── Group wrapper ── */
    .snav-group-wrap {
      position: relative; display: inline-flex;
      border-right: 1px solid #1a1f28;
    }
    .snav-group-wrap:first-child { border-left: 1px solid #1a1f28; }

    .snav-group {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
      color: #4b5563; text-decoration: none; padding: 0 18px; height: 54px;
      border-bottom: 3px solid transparent; white-space: nowrap;
      transition: color .15s, border-color .15s, background .15s; cursor: pointer;
      box-sizing: border-box;
    }
    .snav-group:hover  { color: #94a3b8; background: rgba(255,255,255,.025); }
    .snav-active {
      color: #f59e0b !important;
      border-bottom-color: #f59e0b !important;
      background: rgba(245,158,11,.06) !important;
    }
    .snav-chevron { font-size: 10px; opacity: .5; margin-left: 2px; transition: opacity .15s; }
    .snav-group:hover .snav-chevron { opacity: .9; }
    .snav-active .snav-chevron { opacity: .8; color: #f59e0b; }

    /* ── Dropdown ── */
    .snav-dropdown {
      display: none; position: absolute; top: calc(100% + 1px); left: -1px;
      background: #0b0e14; border: 1px solid #252c38; border-radius: 0 0 6px 6px;
      min-width: 168px; padding: 6px 0;
      box-shadow: 0 12px 32px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4);
      z-index: 2000;
    }
    .snav-group-wrap:hover .snav-dropdown { display: block; }
    .snav-drop-item {
      display: block; padding: 10px 18px;
      font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
      color: #64748b; text-decoration: none; white-space: nowrap;
      border-left: 3px solid transparent;
      transition: color .1s, background .1s, border-color .1s;
    }
    .snav-drop-item:hover {
      color: #cbd5e1; background: rgba(255,255,255,.05);
      border-left-color: #334155;
    }
    .snav-drop-active {
      color: #f59e0b !important;
      background: rgba(245,158,11,.08) !important;
      border-left-color: #f59e0b !important;
    }

    /* ── Meta slot (clock, status) ── */
    .snav-meta {
      display: flex; align-items: center; gap: 12px; margin-left: auto; padding-left: 20px;
      font-size: 10px; color: #374151; white-space: nowrap;
    }

    /* ── Hamburger (mobile only) ── */
    .snav-hamburger {
      display: none; background: none; border: 1px solid #1e2433; border-radius: 4px;
      color: #94a3b8; font-size: 16px; cursor: pointer; padding: 4px 10px; margin-left: auto;
    }
    .snav-hamburger:hover { border-color: #374151; color: #e2e8f0; }

    /* ── Mobile panel ── */
    .snav-mobile-panel {
      display: none; flex-direction: column;
      background: #0d1117; border-bottom: 1px solid #1e2433;
      font-family: 'IBM Plex Mono', monospace;
    }
    .snav-mobile-panel.snav-mob-visible { display: flex; }
    .snav-mob-group { border-bottom: 1px solid #1a1f28; }
    .snav-mob-label {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 20px; font-size: 11px; font-weight: 700; letter-spacing: .09em;
      text-transform: uppercase; color: #4b5563; cursor: pointer; user-select: none;
      transition: color .15s;
    }
    .snav-mob-label:hover    { color: #94a3b8; }
    .snav-mob-label.snav-mob-open { color: #f59e0b; }
    .snav-mob-chevron { font-size: 10px; }
    .snav-mob-hidden  { display: none; }
    .snav-mob-children { background: #06080d; }
    .snav-mob-item {
      display: block; padding: 10px 32px;
      font-size: 11px; letter-spacing: .07em; text-transform: uppercase;
      color: #374151; text-decoration: none; border-left: 3px solid transparent;
      transition: color .1s, border-color .1s;
    }
    .snav-mob-item:hover { color: #94a3b8; border-left-color: #374151; }
    .snav-mob-active     { color: #f59e0b !important; border-left-color: #f59e0b !important; }

    /* ── Responsive ── */
    @media (max-width: 820px) {
      .snav-nav        { display: none; }
      .snav-hamburger  { display: inline-flex; }
      .snav-meta       { margin-left: 8px; padding-left: 0; }
      .snav-logo       { font-size: 1.2em; margin-right: 12px; }
    }
  `;

  // ── Mount ───────────────────────────────────────────────────────────────────
  function mount() {
    const root = document.getElementById('nav-root');
    if (!root) return;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root.innerHTML = buildNav();

    // Mobile hamburger toggle
    const ham   = document.getElementById('snav-hamburger');
    const panel = document.getElementById('snav-mobile-panel');
    if (ham && panel) {
      ham.addEventListener('click', e => {
        e.stopPropagation();
        const open = panel.classList.toggle('snav-mob-visible');
        panel.setAttribute('aria-hidden', String(!open));
        ham.textContent = open ? '✕' : '☰';
      });
    }

    // Mobile group toggles
    root.querySelectorAll('.snav-mob-label[data-toggle]').forEach(lbl => {
      lbl.addEventListener('click', () => {
        const id       = lbl.dataset.toggle;
        const children = document.getElementById(`snav-mob-${id}`);
        const isOpen   = !children.classList.contains('snav-mob-hidden');
        children.classList.toggle('snav-mob-hidden', isOpen);
        lbl.classList.toggle('snav-mob-open', !isOpen);
        const chev = lbl.querySelector('.snav-mob-chevron');
        if (chev) chev.textContent = isOpen ? '▾' : '▴';
      });
    });

    // Close mobile panel on outside click
    document.addEventListener('click', e => {
      if (panel && panel.classList.contains('snav-mob-visible') && !root.contains(e.target)) {
        panel.classList.remove('snav-mob-visible');
        panel.setAttribute('aria-hidden', 'true');
        if (ham) ham.textContent = '☰';
      }
    });

    // Each page can call NavComponent.setMeta(html) to populate the meta slot
    window.NavComponent = {
      setMeta(html) {
        const slot = document.getElementById('snav-meta-slot');
        if (slot) slot.innerHTML = html;
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
