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
