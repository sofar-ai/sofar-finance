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

// ── Utility ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function setStatus(msg, color) {
  const el = $('me-status');
  if (el) { el.textContent = msg; el.style.color = color || 'var(--text-secondary)'; }
}

function dirColor(d)  { return d==='bullish'?'#22c55e':d==='bearish'?'#ef4444':'#f59e0b'; }
function magClass(m)  { return m==='high'?'me-tag-mag-h':m==='medium'?'me-tag-mag-m':'me-tag-mag-l'; }
function statusDot(s) { const m={stable:'●',developing:'◉',escalating:'⚡',de_escalating:'↘'}; return m[s]||'●'; }
function statusClass(s){const m={stable:'me-status-dot-s',developing:'me-status-dot-d',escalating:'me-status-dot-e',de_escalating:'me-status-dot-de'}; return m[s]||'me-status-dot-s'; }
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
    <div style="margin-bottom:20px;padding:16px 20px;background:var(--bg-secondary);border:1px solid var(--border);border-left:3px solid ${statusColor};border-radius:4px">
      <div style="font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${statusColor};margin-bottom:6px">
        ${event.status === 'active' ? '● Live' : event.status === 'draft' ? '◌ Draft' : '○ Archived'}
      </div>
      <div style="font-size:24px;font-weight:700;color:var(--text-primary);line-height:1.2;margin-bottom:8px">${event.root_label}</div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);display:flex;gap:16px;flex-wrap:wrap">
        <span>${(event.nodes||[]).length} nodes · ${accepted} accepted</span>
        ${activeSince ? `<span>Active since ${activeSince}</span>` : ''}
        <span>v${event.version}</span>
      </div>
    </div>`;
}

function renderEventList() {
  const el = $('me-event-list');
  if (!el) return;
  const events = trees.events || [];
  if (!events.length) { el.innerHTML = ''; return; }
  el.innerHTML = events.map(e => {
    const active = e.event_id === activeEventId;
    return `<span class="me-event-chip ${active?'active':''}" onclick="selectEvent('${e.event_id}')">
      <span class="me-chip-status" style="background:${chipColor(e.status)}"></span>
      ${e.root_label} <span style="color:${chipColor(e.status)};font-size:9px">[${e.status}]</span>
    </span>`;
  }).join('');
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
            ${evAnalysis.recent_developments.slice(0,6).map(d=>`
              <div class="me-dev-item">
                <span class="me-dev-node">[${d.matched_node||'?'}]</span>
                <span>${d.headline}</span>
              </div>`).join('')}
          </div>` : ''}
        </div>
        ${hasSector ? `
        <div class="me-analysis-card">
          <div class="me-analysis-label">Sector Exposure</div>
          <div class="me-sector-grid" style="flex-direction:column">
            ${Object.entries(evAnalysis.sector_exposure).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).map(([sec,score])=>`
              <div class="me-sector-bar">
                <span style="color:var(--text-secondary);font-family:var(--font-mono);font-size:9px;width:72px;flex-shrink:0">${sec}</span>
                <div class="me-bar" style="width:${Math.min(Math.abs(score)*50,90)}px;background:${score>0?'#22c55e':'#ef4444'}"></div>
                <span style="font-size:9px;color:${score>0?'#22c55e':'#ef4444'}">${score>0?'+':''}${score.toFixed(1)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}
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
    </div>`;

  panel.innerHTML = analysisHtml + scenariosHtml + createHtml + treeHtml;
  updateSubmitBtn();
}

function toggleTree(eventId) {
  const body = document.getElementById(`me-tree-body-${eventId}`);
  const icon = document.getElementById(`me-tree-toggle-icon-${eventId}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▶' : '▼';
}


function renderAll() {
  renderEventList();
  const events = trees.events || [];
  const panel = $('me-tree-panel');
  if (!events.length) {
    if (panel) panel.innerHTML = `<div class="me-empty">No event trees yet.<br>Enter a macro event name below and click Generate Tree.</div>`;
    setStatus('No events — create one above');
    return;
  }
  if (!activeEventId || !events.find(e=>e.event_id===activeEventId)) {
    // Auto-select first non-archived event
    const first = events.find(e=>e.status!=='archived') || events[0];
    activeEventId = first?.event_id;
  }
  renderEventList();
  const event = events.find(e=>e.event_id===activeEventId);
  renderHero(event || null);
  if (event) renderTree(event);
  setStatus(`Last loaded: ${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'})} ET`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadTrees(), loadAnalysis()]);
  renderAll();
  // generate btn and input use onclick/onkeydown (rendered dynamically into tree panel)
  // Refresh data every 30s
  setInterval(async () => {
    await Promise.all([loadTrees(), loadAnalysis()]);
    if (!pollTimer) renderAll();
  }, 30000);
}

init();
