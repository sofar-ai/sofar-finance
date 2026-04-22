# SOFAR Session Handover — Tuesday April 21, 2026 (evening)

**Session window:** ~3 PM ET through ~11 PM ET
**Continuation from:** SOFAR-SESSION-HANDOFF-MONDAY-APRIL-20-LATE-NIGHT.md
**Next session priority:** observe first-live unusual-flow detector RTH cycle (10:05 AM ET), reconciler + baselines populator, data acquisition HIL exploration

---

## TL;DR

Major shipping session. Built full Unusual Activity infrastructure end-to-end: detector with dynamic percentile thresholds across 5 methods, market-DB persistence, API endpoint, live frontend panel. Self-calibrating thresholds per Chakravarty/Cox/Jiang/Strong literature. Also closed out smart-tags V3→V8 saga, patched db-env.sh for POSIX, documented that the Monday handover's "CURRENT_DATE time-bomb" was misdiagnosed (fn_session_date is already correct CBOE GTH semantics), and discovered + fixed a critical architectural bug: every synthesis (evening/morning/intraday) was writing to the same `ai-synthesis.json`, causing later runs to clobber earlier ones. Fixed with source-qualified filenames + frontend dual-file merge. First live RTH cycle for the detector is tomorrow 10:05 AM ET.

---

## Critical user rules (re-established)

- NO timeboxing, timeframing, or "let's stop for the night" prompts
- NO quizzes / ask_user_input_v0
- Verify with diagnostics before acting — repeatedly proved correct tonight
- Backups with sentinel + timestamp for EVERY patch
- NEVER expose credentials in shell (always `sed 's|://[^@]*@|://REDACTED@|g'`)
- Renaissance framing: dynamic/evolving/measurable over hardcoded

---

## What shipped tonight

### 1. Smart-tags final resolution (V3 → V8)

Eight iterations. Each was a real bug:

- V3 — SMART_TAG_REGEX_V3: `###` regex on raw text
- V4 — SMART_TAG_SCROLL_V4: DOM heading query vs line-math
- V5 — MARKDOWN_RENDER_V5: marked.js (jsdelivr), back-to-top, unified extra-tickers
- V6 — NAV_DETECT_V6: detection against rendered `<h3>` nodes
- V7 — NAV_REFRESH_TRIGGER_V7: explicit `window.__refreshFlowAnalysisNav`
- V8 — SCROLL_INTO_VIEW_V8: native `scrollIntoView()` on internal panel scroll container

Files: `js/options-flow.js`, `options-flow.html`, `css/style.css`

### 2. db-env.sh POSIX safety (S1)

Sentinel POSIX_SAFE_V1. Bash `[[ ]]` → POSIX `case` + `[ ]`. Works in both bash and dash. S2 copy left alone (dead code).

### 3. Synthesis archive persistence

Sentinel SYNTHESIS_ARCHIVE_V1. New table `synthesis_archive` in market DB with JSONB + structured extracts + GIN index on full_json. Module `~/scripts/synthesis_archive.py` with `archive_synthesis()`. Non-blocking — archive failures log but never break synthesis.

Wired into:
- `~/scripts/ai-synthesis.py` (evening + morning + conditional paths)
- `~/scripts/intraday-synthesis-local.py` (intraday)

Overnight-synthesis.py NOT wired (separate script, still Claude, queued for local migration).

### 4. Unusual Flow Detector — end-to-end

Sentinels: UNUSUAL_FLOW_DETECTOR_V1, SESSION_DATE_HELPER_V1, PER_METHOD_FLOOR_V1, UNUSUAL_FLOW_DEDUP_V1.

**Dynamic percentile thresholds.** Nothing hardcoded. Every run computes today's eligible universe, percentile-ranks each symbol's metric, flags top percentile. Self-calibrating. Score = percentile rank. trigger_details JSONB preserves distribution context for forward-return stratification.

**Phase 1 methods (live):**

| method | metric | percentile | guards |
|---|---|---|---|
| iso_size | iso_premium ($) | p98 | — |
| iso_concentration | iso_premium / total | p95 | min $500K iso_premium |
| direction_concentration | \|buy-sell\|/(buy+sell) | p95 | $2M floor + 20 trades min |
| intraday_burst | 15-min / session avg | p95 | $1M session floor |
| sweep_cluster_density | recent/session sweep rate | p95 | min 3 recent sweeps |

**Deferred until baselines mature (~15 trading days):**
- premium_vs_baseline (z-score vs 20d rolling)
- rank_anomaly (rank delta vs 20d median)

**Configuration:** `~/scripts/unusual_flow_config.py` — all thresholds centralized.

**Session resolution:** `~/scripts/session_date_helper.py`:
- `get_real_session_date(conn, min_premium_usd=1e9)`
- `get_real_session_dates(conn, n=5)`
- Avoids 8 PM UTC boundary confusion in analytical queries

**Dedup:** unique on `(session_date, symbol, method)`. Subsequent fires UPDATE with max score, first_detected_at preserved, update_count increments.

**First live test:** 25 detections on 2026-04-21. Top signals:
- IWM iso_size 99.9 ($10.5M ISO on $218M total)
- QQQ iso_size 99.8 ($10.5M ISO on $629M total)
- MDT direction_concentration 99.7 (96% sell-skew, $2.6M)
- CAR iso_size 99.6 ($9.1M ISO on $739M total)
- GDX direction_concentration 98.6 (72% buy-skew, $22.7M — textbook informed flow)
- WOLF iso_concentration 98.2 (83.5% ISO)
- BMNR direction_concentration 99.2 (75% sell-skew, $5.5M)

**Cron entry installed:**
5,20,35,50 10-15 * * 1-5 /usr/bin/python3 /home/bot1/scripts/unusual-flow-detector.py >> /home/bot1/logs/unusual-flow.log 2>&1
24 fires per trading day. First live RTH cycle: tomorrow 10:05 AM ET.

### 5. /api/unusual-flow endpoint

Sentinel UNUSUAL_FLOW_API_V1. Mirrors `flow-aggregates.js` — `@neondatabase/serverless`, `DATABASE_URL_MARKET` env, CORS. fn_session_date(NOW()) for today, separate query for most-recent prior.

Query params:
- `?date=YYYY-MM-DD` — explicit
- `?session=prior` — most recent prior real session
- default — today

Response: symbol-grouped. One row per symbol with `methods[]`, `max_score`, `dominant_direction`, `detections[]` nested with trigger_details. Plus `totals.by_method`, `data_status.phase` (RTH/GTH/AFTER_HOURS_NO_GTH/WEEKEND).

### 6. Unusual Activity frontend panel

Sentinels UNUSUAL_FLOW_PANEL_V1, UNUSUAL_FLOW_POLISH_V1. Replaced vestigial Flow Detail panel.

Features:
- Header: session date + count + phase badge + Today/Prior chip toggle
- Row per symbol: method badges (color-coded), score (tier-colored 99+/97+/95+), direction (↑BUY/↓SELL/◇MIXED), premium
- Multi-method fires get amber left-border highlight
- Click row → expands with trigger_details per method
- Auto-selects Today chip during RTH (user click latches override)
- Global date picker (`FlowData.selectedDate`) takes precedence

### 7. Right-side panel vertical expand

Sentinels PANEL_EXPAND_V1, PANEL_EXPAND_CONTAINER_V1, PANEL_EXPAND_FINAL_V1. Small ⇱ button in each right-side panel header. Click → 80vh with internal scroll. Required three rules to win the CSS fight: `!important` on max-height override, `flex: 1 1 auto` on expanded panel, `.of-main:has(.of-panel-expanded) { overflow: visible }` to unclip.

Works. UF panel grows dramatically when expanded (~747px content visible vs ~66px).

---

## MAJOR DISCOVERY late session — synthesis clobbering architectural bug

Around 22:00, noticed dashboard showed broken panels (SPY & QQQ Analysis all `—`, Tickers to Watch all `—`, Flow Divergence Alert showing `undefined`). Investigation:

**Root cause:** every synthesis source (evening 18:00, morning 08:45/10:00, intraday 10:10-15:10, conditional 12:45/14:45/15:45) was writing to the same file `data/ai-synthesis.json`. Later writes clobbered earlier ones regardless of quality.

**Specific tonight:** our 20:05 manual intraday smoke-test run (during archive wire-in validation) overwrote the 18:00 Opus evening synthesis. Intraday emits thinner per-ticker shape, so panels expecting rich evening fields rendered `—` or `undefined`.

**Field mismatch detail:**
- Evening `benchmarks.SPY` = 13 fields (intraday_bias, next_day_bias, long_term_bias, predicted_price_2h, etc.)
- Intraday `benchmarks.SPY` = 2 fields (price, change_pct only)
- Evening `tickers_to_watch[0]` = flat fields (predicted_price_2h, predicted_price_nextday, etc.)
- Intraday `tickers_to_watch[0]` = nested (predicted_prices.current, predicted_prices.intraday_target, etc.)
- Evening `notable_divergences` = list of dicts with .ticker property
- Intraday `notable_divergences` = list of plain strings

### Fix — tonight

**Step 1: Recovered 18:00 Opus output** from `~/logs/claude-raw-20260421T223051.txt` (raw Claude response preserved by logging), parsed JSON, wrote to `ai-synthesis.json`. Dashboard immediately restored.

**Step 2: Patched intraday-synthesis-local.py** (sentinel INTRADAY_OWN_FILE_V1) — writes to `data/ai-synthesis-intraday.json` instead of `data/ai-synthesis.json`. 3 sites updated (docstring, write path, log message). Never clobbers evening again.

**Step 3: Patched frontend** (sentinel DUAL_FILE_READ_V1 in `js/ai-synthesis.js`) — loads both files, merges with whitelist overlay:
- Evening is base (rich per-symbol fields)
- Intraday overlays only: `intraday`, `regime`, `generated_at`, `next_update`, `signal_snapshot`
- Timestamp gate: intraday only overlays if fresher than evening
- 404 on intraday file handled gracefully (falls through to evening)

**Verified working** in browser: `undefined count in page: 0`, Opus 18:00 data rendering correctly, intraday 404 handled silently.

### What happens tomorrow

- 07:00 overnight-synthesis.py (Claude, still writes ai-synthesis.json) — NOT YET FIXED, need to migrate
- 08:45 / 10:00 morning ai-synthesis.sh → ai-synthesis.py writes `ai-synthesis.json` (full schema, fine)
- 10:05, 10:20, 10:35, 10:50, 11:05... unusual-flow-detector.py fires every 15 min during RTH
- 10:10, 11:10, 12:10, 13:10, 14:10, 15:10 intraday-synthesis-local.py writes `ai-synthesis-intraday.json` (never clobbers morning/evening)
- 12:45 / 14:45 / 15:45 synthesis-trigger.py conditional (Claude) — ALSO writes `ai-synthesis.json`, unclear if this should be separated
- 18:00 evening pipeline → Opus writes `ai-synthesis.json`

**Remaining clobber risk:** conditional Claude synthesis-trigger.py still writes `ai-synthesis.json`. If it fires during RTH it could overwrite morning. Should probably move to `ai-synthesis-conditional.json`. Low priority — conditional fires rarely (only in extreme regime shifts) and emits full schema.

---

## CORRECTED from Monday handover — CURRENT_DATE is NOT a bug

Monday late-night handover flagged "CURRENT_DATE → fn_session_date(NOW()) in flow-tape-daemon.py" as a priority fix. **Investigation tonight showed both return the same value** at the GTH rollover boundary because `fn_session_date()` already correctly implements CBOE GTH semantics (8 PM ET rollover to next trading day).

"Phantom rows" observed earlier are legitimate GTH session-start trades correctly tagged with tomorrow's session_date per CBOE semantics.

**Real issue is session_date semantics ambiguity across consumers.** Ingestion writes CBOE GTH (correct). Analysis wants "most recent completed real session" (different need). `session_date_helper.get_real_session_date()` is the right primitive for analytical queries.

Correction appended to `docs/database-routing-addendum-2026-04-20.md`. Removed from queued-fixes.

**Consumers using the helper:** unusual-flow-detector.py ✓, api/flow-aggregates.js ✓, ai-synthesis.py ✓ (prior_real CTE).

**Consumers needing review:** flow-intelligence.py line 213 (per-symbol last-seen, probably fine).

---

## System state at session end

### Services running ✓
- ThetaData terminal, sofar-flow-tape, sofar-flow-intel, sofar-monitor, sofar-research (S1)
- sofar-flow-analyzer (S2), Ollama with qwen3.6:35b-a3b (S2)
- Ollama with qwen3:235b (Mac)

### Database (sofar-market-data)
- 4 new tables: synthesis_archive, unusual_flow_signals, unusual_flow_returns, migrations_applied
- Migration sentinels applied: SYNTHESIS_UNUSUAL_FLOW_V1, UNUSUAL_FLOW_DEDUP_V1
- synthesis_archive has 1 test row; unusual_flow_signals has 25 rows from 2026-04-21

### Cron
- unusual-flow-detector: every 15 min during RTH weekdays
- Crontab backup: `~/crontab-backups/crontab.backup-20260421-203332.txt`

### Git
- All auto-pushed via auto-pusher throughout session
- Large backup set in ~/scripts/*.pre-* and ~/sofar-finance/*.pre-*

---

## Things to watch tomorrow

1. **10:05 AM ET — first live unusual-flow detector RTH cycle.** Check `~/logs/unusual-flow.log`. Detection counts should scale with market activity (expect 5-30/method). intraday_burst and sweep_cluster_density fire for first time (market-closed tests had 0).

2. **Unusual Activity panel during RTH.** Auto-flips to Today chip. Watch for multi-method fires (amber border) — strongest signals.

3. **Morning ai-synthesis archive writes** — 08:45/10:00 each archive a row. Verify:
```sql
   SELECT archive_id, archived_at, source, model_used, regime FROM synthesis_archive ORDER BY archived_at DESC LIMIT 5;
```

4. **Intraday archive writes** — 6 cycles 10:10-15:10.

5. **Dashboard rendering** — morning should populate `ai-synthesis.json` with full schema. Panels should render correctly without `undefined`. Then intradays write own file, panels stay stable, signal cards refresh every hour.

6. **18:00 evening pipeline** — Claude Opus 4.7 writes `ai-synthesis.json`. Archive row with source='evening'.

---

## Sentinel inventory (tonight)

| Sentinel | File | Purpose |
|---|---|---|
| SMART_TAG_REGEX_V3 | js/options-flow.js | Ticker heading regex |
| SMART_TAG_SCROLL_V4 | js/options-flow.js | DOM query scroll |
| MARKDOWN_RENDER_V5 | options-flow.html + js + css | marked.js + back-to-top |
| NAV_DETECT_V6 | js/options-flow.js | DOM-based nav detection |
| NAV_REFRESH_TRIGGER_V7 | options-flow.html + js/options-flow.js | Explicit nav refresh |
| SCROLL_INTO_VIEW_V8 | js/options-flow.js + css/style.css | Native scrollIntoView |
| POSIX_SAFE_V1 | ~/scripts/db-env.sh | Bash/dash compat |
| SYNTHESIS_ARCHIVE_V1 | ~/scripts/ai-synthesis.py, ~/scripts/intraday-synthesis-local.py | Market DB persistence |
| SESSION_DATE_HELPER_V1 | ~/scripts/session_date_helper.py, ~/scripts/unusual-flow-detector.py | Real session resolver |
| UNUSUAL_FLOW_DETECTOR_V1 | ~/scripts/unusual-flow-detector.py | Detector marker |
| PER_METHOD_FLOOR_V1 | ~/scripts/unusual-flow-detector.py | Direction method floor |
| SYNTHESIS_UNUSUAL_FLOW_V1 | market DB migrations_applied | Schema migration |
| UNUSUAL_FLOW_DEDUP_V1 | market DB migrations_applied | Dedup constraint |
| UNUSUAL_FLOW_API_V1 | api/unusual-flow.js | API endpoint |
| UNUSUAL_FLOW_PANEL_V1 | options-flow.html + js + css | Frontend panel |
| UNUSUAL_FLOW_POLISH_V1 | js/options-flow.js + css/style.css | Auto-RTH + taller panel |
| PANEL_EXPAND_V1 | options-flow.html + js + css | Base expand button |
| PANEL_EXPAND_CONTAINER_V1 | css/style.css | Right-column scroll-on-expand |
| PANEL_EXPAND_FINAL_V1 | css/style.css | Specificity/flex/clip fix |
| INTRADAY_OWN_FILE_V1 | ~/scripts/intraday-synthesis-local.py | Write ai-synthesis-intraday.json |
| DUAL_FILE_READ_V1 | js/ai-synthesis.js | Merge evening + intraday overlay |

---

## Running list carry-forward (ordered for next session)

### Priority — do these first

1. **Frontend merge verification in live RTH** — watch tomorrow 10:10 first intraday write. Confirm dashboard overlays intraday signal card without losing evening's rich panels. Check DevTools for `_merge_source` trace.

2. **Conditional synthesis-trigger.py separation** — should also write own file (`ai-synthesis-conditional.json`) to eliminate last clobber risk. Same pattern as INTRADAY_OWN_FILE_V1. ~15 min.

3. **`unusual-flow-reconciler.py`** — daily job filling `unusual_flow_returns` from `prices_daily` at literature-backed horizons per method. Without this the alpha measurement loop doesn't close. Detections accrue tomorrow; reconciler can start Thursday.

4. **`flow-baselines-compute.py`** — daily cron computing 20-day rolling baselines. Unlocks premium_vs_baseline and rank_anomaly detectors. 0 rows currently.

5. **FLOW DIVERGENCE ALERT panel** — may still render as empty or blank (Opus emitted `notable_divergences: []`). Check rendering tomorrow. If broken, fix JS to handle empty array gracefully. Very low effort.

### Should do

6. **Centralized model config** — `/etc/sofar-models.env` + `~/scripts/sofar_models.py`. Model names hardcoded in ~10 places. User flagged tonight that local models rotate frequently.

7. **Script inventory markdown** — `docs/SCRIPT-INVENTORY.md` from crontab + systemd unit grep.

8. **Kill switches** — flag-file based on/off for research + finance pipelines.

9. **Intraday prompt unification** — evening prompt has ~80 lines of calibration scaffolding. Intraday prompt has none. Refactor into shared DISCIPLINE_BLOCK + SCHEMA_BLOCK + DATA_BLOCK modules. If done, intraday would emit the rich schema matching evening — removes the shape mismatch entirely.

10. **overnight-synthesis.py (07:00) local migration + archive wire-in + own file separation** — bundle all three. Same pattern as intraday. ~20 min.

### Queued but lower priority

11. Director `ingestion_attempts` column fix (morning brief WARNING)
12. gex_historical / vol_regime_historical staleness (since 2026-03-19)
13. `datetime.utcnow()` sweep in ai-synthesis.py (3 callsites, cosmetic)
14. `from db import` shim capture-time bug audit across ~/scripts/*.py
15. FMP ingest rewrite (deprecated endpoint → /stable/profile, priority queue, 200/day cap)
16. Flow-intelligence.py line 213 session_date review
17. Session semantics consistency audit (sweep MAX(session_date) patterns)

### User-guided HIL (explicit deferral)

18. Data acquisition roadmap (HIL exploration with Claude, not autonomous Data Explorer)

---

## Open questions for next session

1. **Reconciler or baselines first?** Both daily. Reconciler measures what alpha we're capturing. Baselines unlock more detectors. Probably reconciler — measure live detectors first.

2. **UF panel per-method accuracy display?** Once reconciler accumulates, panel could tooltip "iso_size: 62% directional accuracy, 5d horizon, n=127" per badge. Deferred until data accrues.

3. **Data acquisition first pass — which sources?** HIL exploration. Natural targets: Treasury Direct, BLS, EIA, NOAA. Each ~100 lines following FRED pattern. Batch or incremental?

4. **Unusual Activity Discord alerts?** Very-high-score multi-method fires (score > 99 AND methods >= 2) could push to Discord for real-time awareness. Nice-to-have.

5. **Should morning synthesis write to own file too?** Currently morning and evening both write `ai-synthesis.json`, morning then evening in the same day. That's actually fine since both emit full schema, but for symmetry with intraday, morning could write `ai-synthesis-morning.json` and the frontend's dual-read becomes a triple-read with most-recent-wins per-field. Overkill or hygiene? Decision point.

---

## Reference files

- `~/sofar-finance/docs/DEFERRED_METHODS.md` — research-backed methodology doctrine
- `~/sofar-finance/docs/database-routing.md` + `database-routing-addendum-2026-04-20.md` (with 2026-04-21 correction)
- `~/scripts/session_date_helper.py` — use this for "current analytical session"
- `~/scripts/unusual_flow_config.py` — all detector thresholds here
- `~/logs/unusual-flow.log` — populates 10:05 AM ET tomorrow
- `~/logs/claude-raw-*.txt` — raw Claude responses (saved us tonight; keep enabled)
- Backup files: `~/scripts/*.pre-*`, `~/sofar-finance/*.pre-*`

---

*Session ends with dashboard correct, intraday clobber architecture fixed, unusual-flow detection live in DB + panel, first live RTH detector cycle tomorrow 10:05 AM ET.*

---

## Late-session addition: PANEL_REFRESH_V1

User reported right-side panels (flow signals, sweeps, top tickers, sector flow, sentiment) never updated except on page refresh. Investigation: `panelTimer` interval already existed at 15s cadence (`PANEL_TICK`) but only called `FlowData.refreshNewer()` for the tape — never called `loadPanelData()` for the right-side panels.

Fix: one-line addition inside the existing interval body. Kept existing guards (`isPaused`, `FlowData.selectedDate`), added two new ones (`document.hidden` to skip backgrounded tabs, clean early-return pattern vs nested conditionals).

Sentinel: `PANEL_REFRESH_V1` in `js/options-flow.js`.

Cadence: 15s (matches existing tape refresh rate). If visual jitter is too much tomorrow during RTH, bump `PANEL_TICK` constant (line 9) to 30s.

## Also noticed earlier/late session — for carry-forward

Two unconventional-data-source conversations happened toward end of session. User interested in Renaissance-style data acquisition. Candidate sources discussed:
- WARN Act layoff notices (state DOL filings, leading earnings indicator)
- ERCOT grid data (wholesale electricity, industrial demand proxy)
- USPTO bulk patent filings (R&D velocity, tech theme emergence)
- Plus larger list covering SEC EDGAR amendments, GitHub repo dynamics, job postings, shipping/AIS, satellite, regulatory/FDA, prediction markets, and "high-weird" tier (night lights, academic citations, app review velocity)

Next session: if user wants to start building data source handlers, these are the pre-ranked candidates. Each ~100-200 lines of handler code following FRED pattern. WARN + ERCOT + USPTO is a natural starter set.

---

## Late-night: deep dive on signal pipeline + LightGBM integration gap

User asked three architectural questions that led to a real discovery about the existing research/signal infrastructure:

1. Should unusual-flow be wired into synthesis?
2. How does dynamic signal weighting improve over time? Should LLMs be in the loop?
3. Can user-originated research strategies flow through the system as signals?

### What we found

The quant research infrastructure is substantially built — not scaffolding:

- **`hypotheses` table** — 10 rows, 7 `proposed` + 3 `rejected`. Full state machine: proposed → check_data → needs_data → pending_experiment → experimenting → results_ready → promoted | rejected
- **`experiments` table** — 638 rows. `experiment-orchestrator.py` runs autonomously, LLM-generated signals. 7 `decision='promoted'` (note: past tense, not `'promote'`). Promotion gates: MIN_ACCURACY 50, MIN_SHARPE 0.5, MAX_PBO 0.4, MIN_CPCV_PATHS 5, MIN_SCORED_DAYS 100
- **`experiment_knowledge`** — 546 rows of learned patterns (460 failure, 55 marginal, 7 success)
- **`weight_sets`** — 12 sets, v5 active per DB (61% acc, 4.79 Sharpe, 116 samples, activated 2026-03-20). `live_predictions_count: 0` — counter not incrementing, OR weight set isn't being queried at prediction time
- **`published_signals`** — 0 rows. **Orphan table.** Nothing copies promoted experiments into it.
- **`signal_attribution`** — 0 rows. **Also orphaned.**
- **`backtest_daily_results`** — 0 rows. **Also orphaned.**

### The 7 promoted signals

All SPY-focused, all with knowledge rows explaining the hypothesis:
- spy_atr_vol_of_vol (vol-of-vol regime instability)
- spy_bond_vol_lead_ratio (bond term premium leads equity vol)
- spy_qqq_corr_zscore (tech regime breakdown)
- sp_vol_atr_divergence_zscore (effort vs result anomaly)
- spy_atr_spread_vol_divergence (macro vs equity vol decoupling)
- spy_momentum_vol_decoupling
- spy_vol_price_coherence

Files exist at `~/scripts/signals/experimental/sig_<name>_exp-<hash>.py` but are NOT imported by the production compute pipeline. They only exist in shadow-experimental space.

### The gap in one sentence

**Promoted experimental signals never get imported into production: no row in `published_signals`, no daily compute filling `signal_attribution`/`signal_values`, no addition to `active-weights.json` features[] list, no LightGBM retrain to include them as features.**

### `active-weights.json` — the actual model config

Current state:
version: v4_lgbm_24sig
activated_at: 2026-03-21T22:00:00Z
features[]: 24 baseline signals (rsi_14, macd, bb_position, atr_regime, dark_pool_short, news_sentiment, etc.)
backtest_accuracy: 83.6
backtest_sharpe: 4.7921

None of the 7 promoted experimental signals appear in this list. Model doesn't know about them. Even if they were being computed daily (they're not), LightGBM wouldn't consume them.

**Version drift:** DB `weight_sets` shows v5 active (from 2026-03-20). `active-weights.json` shows v4 active (from 2026-03-21). These are out of sync — worth investigating which is ground truth.

### Compute pipeline status

Baseline signals compute via `~/scripts/signals/compute_fast.py` (uses hardcoded `from db import` then computes rsi, ma_position, vix_level, etc. in one pass). Fills `signal_values` table.

`~/scripts/signals/base.py` has `register_signal()` + `list_signals()` — a registry pattern. Signals self-register when imported. But `compute_fast.py` doesn't use the registry — it computes specific signals inline, not iterating `list_signals()`.

`compute_batch_signals.py` uses the registry pattern for a subset (BB, ATR, MACD, EMA).

**Critical: the production signal cron is commented out in crontab.** The `# PIPELINE:` lines for `compute_fast.py`, `compute_batch_signals.py`, and `sig_multi_timeframe.py` are all disabled. Only `compute-cag.py` runs at 18:35 daily. Baseline signals don't appear to be refreshed by a live cron — either they're computed on-demand by something else, or the `signal_values` table is stale.

### The LightGBM batch-validation gap (user flagged)

**Current system is sequential/greedy:** each experiment tests "signal X vs current baseline." If 5 signals get promoted over a month, each was validated in the context of whatever the ensemble was at its promotion time, not validated together as a set.

**Known failure modes of sequential testing:**
- **Collinearity** — signals A and B individually helpful but redundant together
- **Interaction effects** — A+C negative, A+B+C neutral, sequentially missed
- **Regime dependence** — signals tested in one regime may be redundant with other promoted signals once regime shifts
- **Promotion drift** — signals promoted months ago may no longer earn their keep in current ensemble; nobody checks

**What should happen:**
- Promoted signals go into "candidate pool" (not auto-activated)
- Periodic batch validation: retrain LightGBM with full candidate pool + baseline, measure feature importance + permutation importance
- Active `active-weights.json` updates based on contribution threshold
- Underperforming features deprecate with logged reasoning
- Regime-conditional analysis: some signals may earn inclusion only in specific regimes, triggering multi-weight-set architecture

This is a legitimate architectural gap to address before promoting many more signals.

### The three original questions — answers with full context

**1. Unusual-flow into synthesis?** Not yet. Unusual-flow has zero forward-return data. Route it through the existing pipeline:
- Each method (iso_size, direction_concentration, etc.) becomes a candidate experiment
- `unusual-flow-reconciler.py` (pending build) measures forward returns per method per horizon
- After ≥30 observations, method qualifies to enter `experiments` table via automated job
- Gets evaluated against baseline, possibly promoted
- Then flows through the rest of the pipeline like any other signal
- Only enters synthesis prompt AFTER promotion with accuracy weight attached

**2. Dynamic weighting / LLM role?** Infrastructure exists (`weight_sets`, `weight_change_log`, `experiment_knowledge`) but the live-retrain loop isn't automated. Weight set v5 has 0 live predictions counted — either counter broken or v5 isn't being consulted. LLMs already in ideation loop (orchestrator calls Claude); should NOT be in weighting decisions (deterministic math only). LLM value-add: regime characterization, narrative/context for humans reviewing promotions, failure-pattern synthesis from `experiment_knowledge` → new hypothesis generation.

**3. User research strategies as signals?** Path exists via research.html textarea. Your hypothesis enters `hypotheses` with `proposer='<your-handle>'`. Either LLM orchestrator auto-generates signal code OR you write it directly (need `source='human'` tag). Goes through identical pipeline. No special path needed.

One enhancement worth considering: `hypothesis_source` tracking so you can measure "which ideation source (LLM autogen, you, academic paper) produces the highest-Sharpe signals over time."

### What to build (ordered, next session)

**Build 1 — `promote-signal-to-production.py`**  
Finds `experiments.decision='promoted' AND signal_name NOT IN active-weights.features`. For each:
- Reads signal_code from DB, writes canonical file `~/scripts/signals/sig_<name>.py` (graduates from experimental/)
- Inserts `published_signals` row
- Backfills `signal_values` historically (2y window) via compute helper
- Appends to `active-weights-proposed.json` (NOT active-weights.json — requires human bless)
- Logs action

**Build 2 — `bless-weights-proposal.py`**  
Archives current `active-weights.json`, activates proposal, logs to `weight_change_log`. Explicit gate. Human (you) runs it after reviewing.

**Build 3 — Re-enable signal compute cron**  
Uncomment `# PIPELINE:` lines. Verify `compute_fast.py` picks up graduated signals (either via registry or by updating its import block during graduation in Build 1).

**Build 4 — `batch-validate-candidates.py`**  
Addresses the sequential/greedy gap. Takes all candidate signals (promoted but not yet in active-weights), retrains LightGBM with baseline + full candidate pool, measures feature importance + permutation importance, produces report. Gates subsequent Build 1 promotions based on batch results.

**Build 5 — `unusual-flow-reconciler.py`**  
Separate track. Accumulates forward returns for unusual-flow detections. Gates unusual-flow methods entering `experiments` for formal promotion.

**Build 6 — LightGBM retrain cron**  
Once Builds 1-5 flow, a periodic (weekly?) retrain job that reads active-weights.features + signal_values for that period → new weight_set → compared to current active → automatic or human-gated activation. Closes the loop.

### Other items to note for next session

- **research.html needs reorganization** — user said current layout isn't useful, will come back to it. Likely touches: Hypothesis Pipeline counters, Awaiting Gate list, Experiments list, Signal Discovery form. Defer until discussed.

- **Version drift audit** — `weight_sets.v5` (DB) vs `active-weights.json.v4_lgbm_24sig` (disk). Determine ground truth and reconcile.

- **`weight_sets.live_predictions_count=0`** — investigate why counter never increments. Either dead code or disconnected from prediction path.

- **`compute-cag.py` runs daily, other compute scripts commented** — is baseline signal refresh actually happening? If only CAG is cron'd but 24 features in active-weights.json, how are the other 23 getting fresh values? Either another script computes them or the data is stale.


---

## Future architecture — ensemble search at scale

Conversation thread: user observed that sequential/greedy signal promotion doesn't test combinations. Proposed: "system constantly experimenting with combinations of signals or weightings to achieve highest predictive rate." Answer: that's exactly how Renaissance-style systematic funds operate. Laying out the trajectory here so next session has forward view.

### The problem at scale

At ~100 signals: sequential/greedy testing mostly works, human review catches obvious issues, batch re-validation (Build 4 in queue) is sufficient.

At ~1000 signals: combinatorial explosion (2^1000 subsets). All-pairs is 500k combinations, all-triples is 166M. Cannot grid-search. Need directed search algorithms.

At ~10000+ signals: requires multi-tier infrastructure. LLM-assisted exploration, genetic search, bandit allocation across models.

### Three-tier build trajectory

**Tier 1 — Continuous batch re-validation (near-term)**
Already queued as Build 4. Weekly cron takes current active weight set + all candidate signals → retrains model with superset → measures:
- Gain-based importance (LightGBM native, but fragile with correlated features)
- Permutation importance (shuffle column, measure accuracy drop — honest about correlation)
- SHAP values (per-prediction contributions — reveals interaction patterns)

Features below threshold drop from active weights. Features above threshold from candidate pool get added. Human review gate. Sufficient for up to ~100-200 signals.

**Tier 2 — Evolutionary feature subset search (mid-term, when 500+ signals)**
Shifts from "test individual features" to "test subsets." Genetic algorithm:
- Initial population: 100 variants of current active weight set (mutate: add/remove/swap signals)
- Evaluate each variant via CPCV backtest → Sharpe, PBO-adjusted
- Keep top K, breed (combine features from two parents), mutate, repeat for M generations
- Output: best subset by out-of-sample Sharpe

Computational cost: each "individual" requires a full backtest. 1000 generations × 100 individuals × 10-path CPCV = 1M backtest runs. Either serious compute budget or use two-tier evaluation (fast-screen for search, full-CPCV for finalists only).

LLM role here: propose semantically sensible candidate subsets. Random genetic search doesn't know that "bond term premium vol + ATR-vol-of-vol" is theoretically sound while "RSI_14 + RSI_21" is redundant. LLM proposes 20 novel subsets per generation faster than random search finds them. Evaluation stays pure math (CPCV → Sharpe → decision).

**Tier 3 — Online bandit allocation across models (long-term)**
Don't pick ONE active weight set. Maintain portfolio of N weight sets, each optimized for different regimes/horizons. At prediction time:
- Each model makes prediction
- Bandit algorithm (Thompson sampling, UCB) allocates capital/confidence by recent live performance
- Regime-aware: different models dominate in different vol regimes

Benefits: graceful regime transitions (underperforming models get less weight without retirement), rewards model diversity (uncorrelated models both earn allocation), survives individual model decay.

Infrastructure required: parallel prediction pipelines, regime classification service, bandit state tracking, per-model P&L attribution, cross-model correlation monitoring. Big build. Aspirational until the system is deeply mature.

### Critical tradeoffs to address as system scales

**Search vs exploit** — More compute searching = better models, slower to deploy. Less compute searching = faster deployment but stuck in local optima where promoted signals reinforce a single regime's patterns.

**Meta-overfitting** — Running 10,000 ensemble searches and picking best by out-of-sample Sharpe overfits your search procedure to the out-of-sample data. PBO handles individual-backtest overfit; need meta-level version (e.g., hold out a "search-validation" period entirely separate from backtest train/test).

**Computational budget** — LightGBM retrains cheap (seconds). CPCV backtests expensive (minutes). Hierarchical evaluation essential at scale: fast screen (single-fold backtest, ~10 seconds) to eliminate obvious losers, full CPCV (10 paths, ~minutes) only for finalists.

**Regime collapse** — Search run over 5 years where 4 are single regime → "best" ensemble is regime-specific but doesn't know it. Regime-conditional evaluation (require min performance in EACH regime band) prevents this. This is why Tier 3 bandit portfolio matters.

### Signal lifecycle — explicit decay tracking

Every promoted signal must have rolling accuracy tracking. When a signal's rolling-30d accuracy crosses threshold downward, flag for re-evaluation even without new candidates in pool. Renaissance operates under assumption that ALL signals decay; constantly searching for new ones because existing ones will eventually stop working.

Concrete mechanism to add:
- `signal_health` table: (signal_name, eval_date, rolling_30d_accuracy, rolling_90d_accuracy, vs_baseline_delta, status)
- Daily update job computes from signal_attribution + prediction outcomes
- Dashboard panel: "Signal Health" showing decay trajectories, flags, time-since-promotion
- Auto-deprecate signals whose 90d rolling accuracy falls below 50% or baseline-delta below threshold

### Renaissance principles observed from public sources

1. **Many small edges.** Individual signals at 51-52% accuracy. Portfolio construction is where alpha compounds.
2. **Relentless decay assumption.** Continuously search for new signals because existing ones will stop working.
3. **Trade the residuals.** After model prediction, "what did we miss" becomes next signal's target. Hierarchical error correction.
4. **Heavily regime-aware.** Different models for different vol/liquidity/microstructure conditions.
5. **Execution quality is half the edge.** 51% predictive accuracy + 2bps market impact = breakeven. Optimize signals AND execution jointly.

### What to track from the start

Even before Tier 2/3 builds, structure data so future builds are possible:

- **Every experiment tagged with training-data regime composition** — so later we can ask "did this signal get promoted because the search period was 70% one regime?"
- **Every experiment tagged with baseline version** — so we know what "baseline" meant at promotion time (baseline drifts as other signals promote)
- **Every prediction logged with per-regime context** — regime classification at prediction time, not just training time
- **`hypothesis_source` column on experiments/hypotheses** — tag where the idea came from (llm_autogen, user_ryan, academic_paper, unusual_flow_reconciler, etc.) so we can measure "which ideation source produces highest-Sharpe survivors"

These are all cheap to add now; expensive to retrofit later.

### Additional queued builds reflecting this vision

**Build 7 — `signal-decay-tracker.py`**
Daily cron. Computes rolling accuracy per published signal. Updates `signal_health` table. Flags underperformers. Ties into eventual auto-deprecation.

**Build 8 — `regime-conditional-evaluator.py`**
Takes a weight_set, evaluates per-regime Sharpe/accuracy. Produces report. Enables Tier 3 multi-model portfolio later.

**Build 9 — `evolutionary-subset-search.py`** (Tier 2 entrypoint)
Not immediate. Requires Tier 1 infrastructure mature first. Flagged here so the need is documented.

**Build 10 — `llm-subset-proposer.py`**
When Tier 2 is active. Calls LLM with current weight set + candidate pool + `experiment_knowledge` failure/success patterns. Returns N semantically-reasoned subset proposals for genetic search initial population or mutation candidates. Reduces search iterations significantly vs pure random.

### The big picture

Your instinct ("constantly experimenting with combinations or weightings") is the production architecture of modern systematic funds. It is not exotic; it is the standard at scale. The path from current state (sequential/greedy promotion) → Tier 1 (batch re-validation) → Tier 2 (evolutionary search) → Tier 3 (bandit portfolio) is well-understood and executable.

The right order is:
1. Fix the current gap (promote → published → compute → features → retrain loop) with Builds 1-6
2. Layer on decay tracking (Build 7) and regime conditioning (Build 8) early even at small signal counts
3. When signal count justifies it, add Tier 2 evolutionary search
4. When maturity justifies it, add Tier 3 bandit portfolio

Doesn't all need to ship at once. But the data structures and tags you put in place NOW determine what's possible later. Structure for the future; build for the present.

