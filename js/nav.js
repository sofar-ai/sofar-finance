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
      display: flex; align-items: center; height: 46px; padding: 0 16px;
      background: #080b10; border-bottom: 1px solid #1a1f28;
      position: sticky; top: 0; z-index: 1000; gap: 0;
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
    }
    .snav-logo {
      font-size: 13px; font-weight: 700; color: #e2e8f0; text-decoration: none;
      letter-spacing: .06em; white-space: nowrap; margin-right: 16px;
    }
    .snav-logo span { color: #f59e0b; font-weight: 400; }
    .snav-nav {
      display: flex; align-items: center; gap: 2px; flex: 1;
    }

    /* ── Group wrapper ── */
    .snav-group-wrap { position: relative; display: inline-flex; }
    .snav-group {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
      color: #64748b; text-decoration: none; padding: 0 12px; height: 46px;
      border-bottom: 2px solid transparent; white-space: nowrap;
      transition: color .15s, border-color .15s; cursor: pointer;
      box-sizing: border-box;
    }
    .snav-group:hover  { color: #94a3b8; }
    .snav-active       { color: #f59e0b !important; border-bottom-color: #f59e0b !important; }
    .snav-chevron      { font-size: 8px; opacity: .6; margin-left: 1px; }

    /* ── Dropdown ── */
    .snav-dropdown {
      display: none; position: absolute; top: 100%; left: 0;
      background: #0d1117; border: 1px solid #1e2433; border-radius: 4px;
      min-width: 148px; padding: 4px 0; box-shadow: 0 8px 24px rgba(0,0,0,.5);
      z-index: 2000;
    }
    .snav-group-wrap:hover .snav-dropdown { display: block; }
    .snav-drop-item {
      display: block; padding: 8px 14px;
      font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
      color: #64748b; text-decoration: none; white-space: nowrap;
      transition: color .1s, background .1s;
    }
    .snav-drop-item:hover    { color: #e2e8f0; background: rgba(255,255,255,.04); }
    .snav-drop-active        { color: #f59e0b !important; background: rgba(245,158,11,.08); }

    /* ── Meta slot (clock, status) ── */
    .snav-meta {
      display: flex; align-items: center; gap: 12px; margin-left: auto;
      font-size: 10px; color: #475569; white-space: nowrap;
    }

    /* ── Hamburger (mobile only) ── */
    .snav-hamburger {
      display: none; background: none; border: none; color: #94a3b8;
      font-size: 18px; cursor: pointer; padding: 4px 8px; margin-left: auto;
    }

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
      padding: 10px 16px; font-size: 10px; font-weight: 700; letter-spacing: .08em;
      text-transform: uppercase; color: #64748b; cursor: pointer; user-select: none;
    }
    .snav-mob-label.snav-mob-open { color: #f59e0b; }
    .snav-mob-chevron { font-size: 9px; }
    .snav-mob-hidden { display: none; }
    .snav-mob-children { background: #080b10; }
    .snav-mob-item {
      display: block; padding: 9px 24px;
      font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
      color: #475569; text-decoration: none;
    }
    .snav-mob-item:hover { color: #94a3b8; }
    .snav-mob-active     { color: #f59e0b !important; }

    /* ── Responsive ── */
    @media (max-width: 780px) {
      .snav-nav        { display: none; }
      .snav-hamburger  { display: inline-flex; }
      .snav-meta       { margin-left: 8px; }
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
