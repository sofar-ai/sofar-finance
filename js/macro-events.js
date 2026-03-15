// macro-events.js — Macro Event Catalyst Tracker frontend
'use strict';

const TRIGGER_API = '/api/trigger-event-tree';
const TREES_PATH  = 'data/event-trees.json';
const ANALYSIS_PATH = 'data/event-analysis.json';
const POLL_MS     = 8000;

let trees    = { events: [] };
let analysis = { active_events: [] };
let activeEventId = null;
let pendingChanges = [];   // [{node_id, review_status, label, parent_id, tickers}]
let pollTimer = null;
const expandedTrees = new Set(); // persists expand/collapse state across re-renders

// ── State preservation across re-renders ─────────────────────────────────────
function captureInteractiveState() {
  const state = {
    newInput: $('me-new-input')?.value || '',
    openForms: [],
  };
  // Capture all open add-branch forms and their typed content
  document.querySelectorAll('[data-form="1"]').forEach(form => {
    const parentId = form.id.replace('me-add-', '');
    state.openForms.push({
      parentId,
      label:   document.getElementById(`me-add-label-${parentId}`)?.value   || '',
      tickers: document.getElementById(`me-add-tickers-${parentId}`)?.value || '',
    });
  });
  return state;
}

function restoreInteractiveState(state) {
  if (!state) return;
  // Restore the "new event" input text
  const ni = $('me-new-input');
  if (ni && state.newInput) ni.value = state.newInput;
  // Re-open any branch forms and restore typed text
  for (const { parentId, label, tickers } of state.openForms) {
    showAddBranch(parentId); // recreates the form DOM
    const li = document.getElementById(`me-add-label-${parentId}`);
    const ti = document.getElementById(`me-add-tickers-${parentId}`);
    if (li && label)   li.value = label;
    if (ti && tickers) ti.value = tickers;
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function setStatus(msg, color) {
  const el = $('me-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || 'var(--text-secondary)';
  el.style.display = msg ? '' : 'none';
}

function dirColor(d)  { return d==='bullish'?'#22c55e':d==='bearish'?'#ef4444':'#f59e0b'; }
function magClass(m)  { return m==='high'?'me-tag-mag-h':m==='medium'?'me-tag-mag-m':'me-tag-mag-l'; }
function statusDot(s) { const m={stable:'●',developing:'◉',escalating:'⚡',de_escalating:'↘'}; return m[s]||'●'; }
function statusClass(s){const m={stable:'me-status-dot-s',developing:'me-status-dot-d',escalating:'me-status-dot-e',de_escalating:'me-status-dot-de'}; return m[s]||'me-status-dot-s'; }
function nodeCategory(nodeId) {
  const id = (nodeId || '').toLowerCase();
  if (/oil|energy|gas|petroleum|lng|hormuz|crude|opec|fuel|pipeline/.test(id))    return 'energy';
  if (/defense|military|weapon|nato|war|strike|conflict|security|army|navy/.test(id)) return 'defense';
  if (/inflation|fed|dollar|rate|macro|economic|gdp|currency|yield|treasury|debt|fiscal/.test(id)) return 'macro';
  if (/cyber|hack|tech|semi|chip|digital|silicon|compute|software|ai|data/.test(id))  return 'cyber';
  if (/ship|freight|logistic|supply.chain|port|container|cargo|transport/.test(id))   return 'shipping';
  if (/vix|volatil|flight|safe|hedge|crash|panic|selloff|risk|equity/.test(id))      return 'volatility';
  return 'default';
}
function nodeBadge(nodeId) {
  const cat = nodeCategory(nodeId);
  return `<span class="me-node-badge me-badge-${cat}">${nodeId||'?'}</span>`;
}
function chipColor(status){ return {active:'#22c55e',draft:'#f59e0b',archived:'#64748b'}[status]||'#94a3b8'; }

// ── Data fetching ─────────────────────────────────────────────────────────────
async function loadTrees() {
  try {
    const r = await fetch(`${TREES_PATH}?t=${Date.now()}`);
    if (!r.ok) throw new Error(r.status);
    trees = await r.json();
  } catch(e) { console.warn('loadTrees:', e); }
}

async function loadAnalysis() {
  try {
    const r = await fetch(`${ANALYSIS_PATH}?t=${Date.now()}`);
    if (!r.ok) return;
    analysis = await r.json();
  } catch(e) { /* silent */ }
}

async function pollTrigger() {
  try {
    const r = await fetch(`${TRIGGER_API}?t=${Date.now()}`);
    if (!r.ok) return;
    const trig = await r.json();
    if (trig.state === 'pending' || trig.state === 'running') {
      setStatus(`⚙️ Processing: ${trig.action}…`, '#f59e0b');
    } else if (trig.state === 'done') {
      setStatus('✅ Done', '#22c55e');
      clearInterval(pollTimer); pollTimer = null;
      await loadTrees(); await loadAnalysis();
      render();
    } else if (trig.state === 'error') {
      setStatus('⚠️ Processing error — check logs', '#ef4444');
      clearInterval(pollTimer); pollTimer = null;
    }
  } catch(e) { /* silent */ }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollTrigger, POLL_MS);
}

// ── Generate tree ─────────────────────────────────────────────────────────────
async function generateTree() {
  const input = $('me-new-input');
  const label = (input?.value || '').trim();
  if (!label) { setStatus('Enter a macro event name first', '#ef4444'); return; }
  try {
    setStatus('Submitting tree generation request…', '#60a5fa');
    const r = await fetch(TRIGGER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', root_label: label }),
    });
    const data = await r.json();
    if (r.status === 202 || data.state === 'pending') {
      setStatus(`⚙️ Generating tree for "${label}" — usually 30–60 seconds…`, '#f59e0b');
      if (input) input.value = '';
      startPolling();
    } else {
      setStatus(data._note || 'Request submitted', '#94a3b8');
    }
  } catch(e) { setStatus('Error: ' + e.message, '#ef4444'); }
}

// ── Submit curation changes ───────────────────────────────────────────────────
async function submitChanges() {
  if (!activeEventId || !pendingChanges.length) return;
  try {
    setStatus('Submitting changes…', '#60a5fa');
    const r = await fetch(TRIGGER_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'curate', event_id: activeEventId, changes: pendingChanges }),
    });
    const data = await r.json();
    if (r.status === 202 || data.state === 'pending') {
      setStatus('⚙️ Enriching changes — bot will update shortly…', '#f59e0b');
      pendingChanges = [];
      startPolling();
    }
  } catch(e) { setStatus('Error: ' + e.message, '#ef4444'); }
}

// ── Activate / Archive ────────────────────────────────────────────────────────
async function activateEvent(event_id) {
  try {
    const r = await fetch(TRIGGER_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate', event_id }),
    });
    if (r.status === 202) { setStatus('⚙️ Activating…', '#f59e0b'); startPolling(); }
  } catch(e) { setStatus('Error: ' + e.message, '#ef4444'); }
}

async function deleteEvent(event_id, root_label) {
  if (!confirm(`Permanently DELETE "${root_label}"?\n\nThis removes the tree and all its nodes. It cannot be undone.`)) return;
  try {
    const r = await fetch(TRIGGER_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', event_id }),
    });
    if (r.status === 202) {
      setStatus('⚙️ Deleting…', '#ef4444');
      trees.events = trees.events.filter(e => e.event_id !== event_id);
      if (activeEventId === event_id) activeEventId = null;
      startPolling();
      renderAll();
    }
  } catch(e) { setStatus('Error: ' + e.message, '#ef4444'); }
}

async function archiveEvent(event_id) {
  if (!confirm('Archive this event? It will stop being monitored.')) return;
  try {
    const r = await fetch(TRIGGER_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive', event_id }),
    });
    if (r.status === 202) { setStatus('⚙️ Archiving…', '#94a3b8'); startPolling(); }
  } catch(e) { setStatus('Error: ' + e.message, '#ef4444'); }
}

// ── Node helpers ──────────────────────────────────────────────────────────────
function acceptNode(nid) {
  // Update local state
  const event = trees.events.find(e => e.event_id === activeEventId);
  if (!event) return;
  const node = event.nodes.find(n => n.id === nid);
  if (node) node.review_status = 'accepted';
  pendingChanges = pendingChanges.filter(c => c.node_id !== nid);
  pendingChanges.push({ node_id: nid, review_status: 'accepted' });
  renderTree(event);
  updateSubmitBtn();
}

function declineNode(nid) {
  const event = trees.events.find(e => e.event_id === activeEventId);
  if (!event) return;
  const node = event.nodes.find(n => n.id === nid);
  if (node) node.review_status = 'declined';
  pendingChanges = pendingChanges.filter(c => c.node_id !== nid);
  pendingChanges.push({ node_id: nid, review_status: 'declined' });
  renderTree(event);
  updateSubmitBtn();
}

function showAddBranch(parentId) {
  // Check for an OPEN form (has data-form="1"), not just any element with that ID
  const existing = document.getElementById(`me-add-${parentId}`);
  if (existing && existing.dataset.form === '1') { existing.remove(); return; }

  const form = document.createElement('div');
  form.id = `me-add-${parentId}`;
  form.className = 'me-add-branch';
  form.dataset.form = '1';  // marks this as an open form, not a placeholder
  form.innerHTML = `
    <div class="me-add-row">
      <input class="me-add-input" id="me-add-label-${parentId}" placeholder="Branch label (e.g. Oil shipping route impact)" maxlength="80">
      <input class="me-add-input" id="me-add-tickers-${parentId}" placeholder="Tickers (optional, comma-sep)" maxlength="60" style="max-width:160px">
      <button class="me-btn me-btn-primary me-btn-sm" onclick="addBranch('${parentId}')">Add</button>
      <button class="me-btn me-btn-ghost me-btn-sm" onclick="document.getElementById('me-add-${parentId}').remove()">Cancel</button>
    </div>`;

  // For root: insert into the me-add-root placeholder container
  // For child nodes: insert after the node row
  if (parentId === 'root') {
    const container = document.getElementById('me-add-root');
    if (container) container.appendChild(form);
  } else {
    const nodeEl = document.getElementById(`me-noderow-${parentId}`);
    if (nodeEl && nodeEl.parentNode) nodeEl.parentNode.insertBefore(form, nodeEl.nextSibling);
  }
}

function addBranch(parentId) {
  const labelInput   = document.getElementById(`me-add-label-${parentId}`);
  const tickerInput  = document.getElementById(`me-add-tickers-${parentId}`);
  const label = (labelInput?.value || '').trim();
  if (!label) return;
  const tickers = tickerInput?.value ? tickerInput.value.split(',').map(t=>t.trim().toUpperCase()).filter(Boolean) : [];

  const event = trees.events.find(e => e.event_id === activeEventId);
  if (!event) return;

  const tmpId = 'usr-' + Date.now();
  const newNode = {
    id: tmpId, parent_id: parentId, label, description: '(enriching…)',
    review_status: 'pending', node_type: 'second_order', tickers, sector: '',
    expected_direction: 'mixed', magnitude: 'medium', confidence_note: '',
    keywords: [], headline_matches: [], node_status: 'stable', last_headline_match: null,
    sensitivity_data: { avg_ticker_move_on_match: null, match_count: 0, last_5_moves: [] }
  };
  event.nodes.push(newNode);
  pendingChanges.push({ node_id: tmpId, label, parent_id: parentId, tickers, review_status: 'pending' });
  document.getElementById(`me-add-${parentId}`)?.remove();
  renderTree(event);
  updateSubmitBtn();
}

function updateSubmitBtn() {
  const btn = $('me-submit-btn');
  if (btn) {
    btn.disabled = pendingChanges.length === 0;
    btn.textContent = pendingChanges.length ? `Submit Changes (${pendingChanges.length})` : 'No Changes';
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
// ── Render active event hero ─────────────────────────────────────────────────
function renderHero(event) {
  const el = $('me-event-hero');
  if (!el) return;
  if (!event) { el.innerHTML = ''; return; }
  const statusColor = {active:'#22c55e', draft:'#f59e0b', archived:'#64748b'}[event.status] || '#94a3b8';
  const activeSince = event.activated_at
    ? new Date(event.activated_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
    : null;
  const accepted = (event.nodes||[]).filter(n=>n.review_status==='accepted').length;
  el.innerHTML = `
    <div style="margin-bottom:4px;padding:16px 20px;background:var(--bg-secondary);border:1px solid var(--border);border-left:3px solid ${statusColor};border-radius:4px">
      <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${statusColor};margin-bottom:6px">
        ${event.status === 'active' ? '● Live' : event.status === 'draft' ? '◌ Draft' : '○ Archived'}
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;line-height:1.2;margin-bottom:8px">
        <span style="font-size:24px;font-weight:700;color:var(--text-primary)">${event.root_label}</span>
        <span style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:${statusColor};background:${statusColor}18;border:1px solid ${statusColor}44;border-radius:3px;padding:2px 7px;vertical-align:middle">[${event.status}]</span>
      </div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);display:flex;gap:16px;flex-wrap:wrap">
        <span>${(event.nodes||[]).length} nodes · ${accepted} accepted</span>
        ${activeSince ? `<span>Active since ${activeSince}</span>` : ''}
        <span>v${event.version}</span>
        <span id="me-hero-ts" style="margin-left:auto;opacity:.6"></span>
      </div>
    </div>`;
}

let _archiveExpanded = false;
function renderEventList() {
  const el = $('me-event-list');
  if (!el) return;
  const events = trees.events || [];
  const nonArchived = events.filter(e => e.status !== 'archived');
  const archived    = events.filter(e => e.status === 'archived');
  // Hide if only one non-archived and no archived — hero handles it
  if (events.length <= 1 && !archived.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';

  const chip = e => {
    const sel = e.event_id === activeEventId;
    const tag = e.status === 'draft' ? ` <span style="color:#f59e0b;font-size:9px">[draft]</span>` : '';
    return `<span class="me-event-chip ${sel?'active':''}" onclick="selectEvent('${e.event_id}')" style="${e.status==='archived'?'opacity:.6;':''}" >
      <span class="me-chip-status" style="background:${chipColor(e.status)}"></span>
      ${e.root_label}${tag}
    </span>`;
  };

  const divider = (nonArchived.length && archived.length)
    ? `<span style="display:inline-block;width:1px;height:20px;background:#1e2433;margin:0 6px;vertical-align:middle"></span>` : '';

  const archivedHtml = archived.length ? `
    <span class="me-event-chip me-archive-toggle" onclick="_archiveExpanded=!_archiveExpanded;renderEventList();"
      style="border-style:dashed;color:#475569;cursor:pointer">
      ${_archiveExpanded ? '▾' : '▸'} Archived (${archived.length})
    </span>
    ${_archiveExpanded ? archived.map(chip).join('') : ''}` : '';

  el.innerHTML = `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-secondary);margin-bottom:6px;letter-spacing:.08em;text-transform:uppercase">Switch Event</div>`
    + nonArchived.map(chip).join('') + divider + archivedHtml;
}

function selectEvent(event_id) {
  activeEventId = event_id;
  pendingChanges = [];
  renderAll();
}

function renderNodeTree(nodes, parentId, depth) {
  const children = nodes.filter(n => n.parent_id === parentId);
  if (!children.length) return '';
  return children.map(node => {
    const status   = node.review_status || 'pending';
    const dir      = node.expected_direction || 'mixed';
    const mag      = node.magnitude || 'medium';
    const nsStatus = node.node_status || 'stable';
    const hlCount  = (node.headline_matches || []).length;
    const tickers  = (node.tickers || []).slice(0,4);
    const hasChildren = nodes.some(n => n.parent_id === node.id);

    const indent = depth > 0 ? `<div class="me-node-connector"></div>` : '';
    const dirTag = `<span class="me-tag ${dir==='bullish'?'me-tag-bull':dir==='bearish'?'me-tag-bear':'me-tag-mixed'}">${dir}</span>`;
    const magTag = `<span class="me-tag ${magClass(mag)}">${mag}</span>`;
    const secTag = node.sector ? `<span class="me-tag me-tag-sector">${node.sector}</span>` : '';
    const tickerTags = tickers.map(t=>`<span class="me-tag me-tag-ticker">${t}</span>`).join('');
    const typeLabels = {direct_impact:'Direct Impact',second_order:'2nd Order',third_order:'3rd Order',policy:'Policy',policy_response:'Policy',market_mechanics:'Market Mech'};
    const typeTag = node.node_type ? `<span class="me-tag" style="background:rgba(148,163,184,.08);color:#64748b;border:1px solid rgba(148,163,184,.2)">${typeLabels[node.node_type]||node.node_type}</span>` : '';
    const hlBadge = hlCount ? `<span class="me-headline-count">📰 ${hlCount}</span>` : '';
    const nsDot = `<span class="${statusClass(nsStatus)}" title="${nsStatus}">${statusDot(nsStatus)}</span>`;

    const acceptBtn = status === 'pending' ? `<button class="me-btn me-btn-success me-btn-sm" onclick="acceptNode('${node.id}')">✓</button>` : '';
    const declineBtn = status !== 'declined' ? `<button class="me-btn me-btn-danger me-btn-sm" onclick="declineNode('${node.id}')">✗</button>` : '';
    const addBtn = (status === 'accepted' || status === 'pending')
      ? `<button class="me-btn me-btn-ghost me-btn-sm" onclick="showAddBranch('${node.id}')">+ Branch</button>` : '';

    const childrenHtml = renderNodeTree(nodes, node.id, depth + 1);
    const hasChildrenHtml = childrenHtml ? `<div style="padding-left:${depth>0?20:16}px">${childrenHtml}</div>` : '';

    return `
      <div class="me-node">
        <div class="me-node-row status-${status}" id="me-noderow-${node.id}">
          ${indent}
          <div class="me-node-body">
            <div class="me-node-label">${nsDot} ${node.label} ${hlBadge}</div>
            ${node.description && node.description !== '(enriching…)' ? `<div class="me-node-desc">${node.description}</div>` : ''}
            <div class="me-node-meta">${typeTag}${dirTag}${magTag}${secTag}${tickerTags}</div>
            ${node.confidence_note ? `<div class="me-node-desc" style="color:#60a5fa;margin-top:3px">💡 ${node.confidence_note}</div>` : ''}
          </div>
          <div class="me-node-btns">${acceptBtn}${declineBtn}${addBtn}</div>
        </div>
        ${hasChildrenHtml}
      </div>`;
  }).join('');
}

function renderTree(event) {
  const panel = $('me-tree-panel');
  if (!panel || !event) return;

  const nodes     = event.nodes || [];
  const scenarios = event.scenarios || [];
  const isDraft   = event.status === 'draft';
  const isActive  = event.status === 'active';

  const pending   = nodes.filter(n=>n.review_status==='pending').length;
  const accepted  = nodes.filter(n=>n.review_status==='accepted').length;
  const declined  = nodes.filter(n=>n.review_status==='declined').length;

  // Get analysis for this event
  const evAnalysis = (analysis.active_events || []).find(a => a.event_id === event.event_id);

  // ── Section 1: Live Analysis (top — this is the daily view) ──────────────
  const hasSector = Object.keys(evAnalysis?.sector_exposure || {}).length > 0;
  const analysisHtml = evAnalysis ? `
    <div class="me-analysis">
      <div class="me-section-title">📡 Live Event Analysis
        <span style="font-size:9px;color:var(--text-secondary);font-weight:400;margin-left:8px">
          Updated ${evAnalysis.last_updated ? new Date(evAnalysis.last_updated).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}) + ' ET' : '—'} · ${evAnalysis.new_matches_this_cycle||0} new matches last cycle
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr ${hasSector ? '200px' : ''};gap:12px;align-items:start">
        <div>
          <div class="me-analysis-card">
            <div class="me-analysis-label">Dominant Narrative</div>
            <div class="me-narrative">${evAnalysis.dominant_narrative||'Monitoring active — no narrative generated yet.'}</div>
            ${evAnalysis.scenario_update?.probability_shift ? `<div style="font-size:10px;color:#60a5fa;margin-top:6px">↻ ${evAnalysis.scenario_update.probability_shift}</div>` : ''}
          </div>
          ${(evAnalysis.recent_developments||[]).length ? `
          <div class="me-analysis-card">
            <div class="me-analysis-label">Recent Headline Matches</div>
            ${evAnalysis.recent_developments.slice(0,8).map(d=>{
              const fmtTs = d.timestamp ? (() => {
                try {
                  const dt = new Date(d.timestamp);
                  return dt.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/New_York'}).replace(/,/g,'') + ' ET';
                } catch(e) { return ''; }
              })() : '';
              const hlText = d.link
                ? `<a href="${d.link}" target="_blank" rel="noopener" class="me-dev-link">${d.headline}</a>`
                : d.headline;
              return `<div class="me-dev-item">
                <div class="me-dev-meta">${nodeBadge(d.matched_node)}${d.source ? ` <span class="me-dev-source">${d.source}</span>` : ''}${fmtTs ? ` <span class="me-dev-ts">${fmtTs}</span>` : ''}</div>
                <div class="me-dev-headline">${hlText}</div>
              </div>`;
            }).join('')}
          </div>` : ''}
        </div>
        ${hasSector ? (() => {
          const sectorEntries = Object.entries(evAnalysis.sector_exposure).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
          const maxAbs = Math.max(...sectorEntries.map(([,v])=>Math.abs(v)), 0.1);
          const BAR_MAX = 52; // px — safe max that fits within 200px sidebar card
          return `
        <div class="me-analysis-card">
          <div class="me-analysis-label">Sector Exposure</div>
          <div class="me-sector-grid" style="flex-direction:column">
            ${sectorEntries.map(([sec,score])=>{
              const bw = Math.max(3, Math.round((Math.abs(score)/maxAbs)*BAR_MAX));
              return `
              <div class="me-sector-bar">
                <span style="color:var(--text-secondary);font-family:var(--font-mono);font-size:9px;width:72px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sec}</span>
                <div class="me-bar" style="width:${bw}px;flex-shrink:0;background:${score>0?'#22c55e':'#ef4444'}"></div>
                <span style="font-size:9px;color:${score>0?'#22c55e':'#ef4444'}">${score>0?'+':''}${score.toFixed(1)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
        })() : ''}
      </div>
    </div>` : (isActive ? `
    <div class="me-analysis-card" style="color:var(--text-secondary);font-size:11px;text-align:center;padding:20px;margin-bottom:16px">
      📡 Monitoring active — analysis will appear after next event-monitor cycle (runs every 2h market hours)
    </div>` : '');

  // ── Section 2: Scenarios ──────────────────────────────────────────────────
  const scenariosHtml = scenarios.length ? `
    <div class="me-scenarios">
      <div class="me-section-title">⚖️ Scenarios</div>
      <div class="me-scenario-grid">
        ${scenarios.map(sc => `
          <div class="me-scenario-card">
            <div class="me-sc-label">${sc.label}</div>
            <div class="me-sc-prob">${Math.round((sc.probability||0)*100)}%</div>
            <div class="me-sc-impact">${sc.market_impact||''}</div>
            <div class="me-sc-tags">
              ${(sc.primary_beneficiaries||[]).map(s=>`<span class="me-tag me-tag-bull">↑${s}</span>`).join('')}
              ${(sc.primary_losers||[]).map(s=>`<span class="me-tag me-tag-bear">↓${s}</span>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // ── Section 3: Collapsible Event Tree (collapsed by default) ─────────────
  const treeSummary = `${nodes.length} nodes · ${accepted} accepted · ${pending} pending${declined ? ` · ${declined} declined` : ''}${event.activated_at ? ` · Active since ${new Date(event.activated_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : ''}`;
  const treeHtml = `
    <div class="me-tree">
      <div class="me-tree-header" style="cursor:pointer;user-select:none" onclick="toggleTree('${event.event_id}')">
        <div>
          <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--text-primary)">
            <span id="me-tree-toggle-icon-${event.event_id}" style="color:var(--accent);margin-right:6px">▶</span>
            Impact Tree
          </div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${treeSummary}</div>
        </div>
        <div class="me-tree-actions" onclick="event.stopPropagation()">
          ${pending > 0 || accepted > 0 ? `
            <button id="me-submit-btn" class="me-btn me-btn-primary" onclick="submitChanges()" disabled>No Changes</button>` : ''}
          ${isDraft ? `<button class="me-btn me-btn-success" onclick="activateEvent('${event.event_id}')">▶ Activate</button>` : ''}
          ${isActive ? `<button class="me-btn me-btn-ghost" onclick="archiveEvent('${event.event_id}')">Archive</button>` : ''}
          ${event.status === 'archived' ? `<button class="me-btn me-btn-danger me-btn-sm" onclick="deleteEvent('${event.event_id}', '${event.root_label.replace(/'/g,'\\&apos;')}')">🗑 Delete</button>` : ''}
        </div>
      </div>

      <div id="me-tree-body-${event.event_id}" style="display:none">
        <div style="margin:12px 0 16px">
          <div class="me-node-row" style="background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.3)">
            <div class="me-node-body">
              <div class="me-node-label" style="color:var(--accent)">🌐 ${event.root_label} <span style="font-size:9px;color:var(--accent)">ROOT</span></div>
              <div class="me-node-desc">Macro event root — all branches below are impact pathways</div>
            </div>
            <div class="me-node-btns">
              <button class="me-btn me-btn-ghost me-btn-sm" onclick="showAddBranch('root')">+ Direct Impact</button>
            </div>
          </div>
          <div id="me-add-root"></div>
        </div>
        <div id="me-tree-nodes">
          ${renderNodeTree(nodes, 'root', 0)}
        </div>
      </div>
    </div>`;

  // ── Create New Event input (always visible, between scenarios and tree) ──
  const createHtml = `
    <div style="margin-bottom:8px">
      <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:8px">Track a New Macro Event</div>
      <div class="me-toolbar" style="margin-bottom:0;border-bottom:none;padding-bottom:0">
        <input id="me-new-input" class="me-input" placeholder="e.g. Fed Rate Cut, Taiwan Conflict…" maxlength="60"
          onkeydown="if(event.key==='Enter') generateTree()">
        <button id="me-generate-btn" class="me-btn me-btn-primary" onclick="generateTree()">Generate Tree</button>
      </div>
      <div id="me-status" class="me-status-bar" style="display:none"></div>
    </div>`;

  // Capture full interactive state before wiping the DOM
  const _savedState = captureInteractiveState();

  panel.innerHTML = analysisHtml + scenariosHtml + createHtml + treeHtml;

  // Restore tree expand/collapse
  if (expandedTrees.has(event.event_id)) {
    const body = document.getElementById(`me-tree-body-${event.event_id}`);
    const icon = document.getElementById(`me-tree-toggle-icon-${event.event_id}`);
    if (body) body.style.display = 'block';
    if (icon) icon.textContent = '▼';
  }

  // Restore open forms + any text the user had typed
  restoreInteractiveState(_savedState);

  updateSubmitBtn();
}

function toggleTree(eventId) {
  const body = document.getElementById(`me-tree-body-${eventId}`);
  const icon = document.getElementById(`me-tree-toggle-icon-${eventId}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▶' : '▼';
  // Persist state so re-renders don't collapse it
  if (open) expandedTrees.delete(eventId);
  else expandedTrees.add(eventId);
}


function renderAll() {
  renderEventList();
  const events = trees.events || [];
  const panel = $('me-tree-panel');
  if (!events.length) {
    if (panel) panel.innerHTML = `<div class="me-empty">No event trees yet.<br>Enter a macro event name below and click Generate Tree.</div><div id="me-status" class="me-status-bar" style="display:none"></div>`;
    setStatus('No events — create one above');
    return;
  }
  // Never auto-select an archived event
  const isSelectable = id => { const e = events.find(x=>x.event_id===id); return e && e.status !== 'archived'; };
  if (!activeEventId || !isSelectable(activeEventId)) {
    const first = events.find(e=>e.status==='active') || events.find(e=>e.status==='draft') || null;
    activeEventId = first?.event_id ?? null;
  }
  renderEventList();
  const event = events.find(e=>e.event_id===activeEventId);
  renderHero(event || null);
  if (event) renderTree(event);
  const tsStr = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}) + ' ET';
  const heroTs = $('me-hero-ts');
  if (heroTs) heroTs.textContent = 'Updated ' + tsStr;
  setStatus(''); // clear status bar — timestamp lives in hero
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadTrees(), loadAnalysis()]);
  renderAll();
  // generate btn and input use onclick/onkeydown (rendered dynamically into tree panel)
  // Refresh data every 30s
  setInterval(async () => {
    await Promise.all([loadTrees(), loadAnalysis()]);
    // Skip re-render if user is actively typing in any input on the page
    const focused = document.activeElement;
    const userTyping = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');
    if (!pollTimer && !userTyping) renderAll();
    else if (!pollTimer && userTyping) {
      // Data updated but user is typing — silently update background state,
      // render will happen on next cycle or when they blur
      console.debug('[macro-events] refresh deferred — user is typing');
    }
  }, 30000);
}

init();
