# Session Handover — Fri Apr 17, 2026 (5:50 PM → 11:55 PM ET)

## TL;DR

Six-hour session on S1. Major scope completed: robust aggregate architecture from daemon → Neon → API → frontend panels. Session_date now CBOE GTH-aware via Postgres function + trigger. 21-sector classification table drives sector flow intelligence. All panels work on any historical date.

Production currently healthy. Daemon running clean with DBWriter + AggregatesRefresher threads.

## Completed

### Timezone fix (critical)
- **Root cause:** ThetaData WebSocket sent naked ET strings; psycopg2 passed them to Postgres timestamptz which parsed as UTC. Stored timestamps were 4 hours earlier than reality.
- **Fix applied to:** `flow-tape-daemon.py` (both ts_str and ms_of_day paths) and `rebuild-flow-history.py` — now parse naked ET, explicitly convert to UTC.
- **One-time UPDATE:** `UPDATE flow_trades SET ts = ts + INTERVAL '4 hours'` on all 259,314 rows.
- Verified: TSLA Apr 16 last trade at 15:59 ET (correct 3:59 PM close).

### Batched DB writer (critical)
- Replaced synchronous per-trade blocking writes with `DBWriter` class in daemon
- Flush every 2s or 500 rows, buffer overflow of 10000 with oldest-drop
- Rate-limited error logging (60s cooldown per error type)
- Replaced silent `except: pass` with structured logging

### Frontend pagination + historical view
- `/api/flow-trades` rewritten with cursor pagination (`before_ts`/`after_ts`), server-side filters (symbol, right, side, min_premium, min_size, dte, is_sweep), total_matching count
- `js/options-flow.js`: FlowData controller, scroll-based IntersectionObserver, debounced filters, date selector
- Removed 500-row `.slice(0,500)` cap in rebuildTape — full-day pagination works
- Historical date dropdown (last 10 trading days + Today)
- Fixed: orphan wireNeonFlow IIFE (was wiping tape), `loadTickerAnalysis` infinite recursion, `rebuildTape` missing `fetched_at`

### Aggregate architecture
Three new tables in Neon:
- `flow_session_metrics` — per (session_date, symbol): trades, premium, call/put/buy/sell, CVD, P/C, sweeps, first/last ts, last_refreshed
- `flow_sweep_rollups` — per sweep_id: premium, legs, direction, duration, exchanges
- `flow_baselines` — per (symbol, as_of_date): 20-day rolling pc_mean/std, premium_mean/std

Backfill script `refresh-flow-aggregates.py` with three modes:
- `--mode backfill` (all dates, ~1.5s for 259K rows → 2,906 metric rows)
- `--mode refresh-today` (today's session only, called every 60s by daemon)
- `--mode refresh-date --date YYYY-MM-DD`

Daemon `AggregatesRefresher` class (background thread, 60s interval) loads refresh module via importlib, rate-limited error logging.

### Trading calendar + session_date (CBOE GTH-aware)
- `trading_calendar` table populated from `pandas_market_calendars` NYSE calendar
- 4,018 calendar days, 2,763 trading days from 2020 through 2030
- 2026 early closes verified: Nov 27 + Dec 24 at 13:00 ET
- `fn_session_date(ts timestamptz)` Postgres function implementing CBOE rule: ET hour ≥ 20 → next trading day, else current ET date (falls forward to next trading day if not a trading day)
- `tr_set_session_date()` trigger BEFORE INSERT OR UPDATE OF ts on flow_trades
- 12 test cases all pass (Jul 3 closed→Jul 6, Fri 8pm→Monday, etc.)
- Daemon INSERT left with `CURRENT_DATE` placeholder — trigger overrides

### Symbol sectors table (Tier B architecture)
- `symbol_sectors` table (symbol, sector, is_primary, source, updated_at)
- 135 symbols across 21 sectors, no multi-tag duplicates
- Sectors: indices, volatility, megacap_tech, semiconductors, memory, ai_infra, quantum, ev_auto, nuclear_smr, crypto, software_saas, financials, fintech, energy, commodities_metals, bonds_macro, biotech_pharma, industrials, retail_consumer, reits_utilities, space

### /api/flow-aggregates endpoint
- Reads `flow_session_metrics`, `flow_sweep_rollups`, `flow_baselines`, JOINs `symbol_sectors`
- Returns per_symbol (with z-scores when baselines exist), session_totals, top_tickers (top 10), sweeps (top 50), sector_flow (all sectors with BULL/BEAR/LEAN_ direction)
- Edge-cached 20s for today, 5min historical

### Frontend panel rewiring
- `loadPanelData()` now fetches from `/api/flow-aggregates` instead of `flow-tape.json`
- Panels work on any date (historical banner removed)
- Sector strip renders all 21 sectors sorted by premium, color-coded, horizontal scroll
- Top Tickers uses `symbolMetrics` (full session) instead of 500-row tape slice
- Flow Signals field fix (`trade_count` vs `total_trades`)

### Documentation
- `/home/bot1/sofar-finance/docs/architecture-notes.md` — aggregate refresh architecture, pg_cron migration path, TimescaleDB constraints, session_date edge cases
- `/home/bot1/sofar-finance/docs/pending-work.md` — priority-ordered work list
- This handover file

## Current production state

- Daemon: `sofar-flow-tape.service` running on S1, restarted 23:03 ET with all fixes
- Neon database: 259,314 flow_trades rows across Apr 15-17
- 2,906 flow_session_metrics rows, 0 flow_sweep_rollups (sweep_id not populated on historical), 0 flow_baselines (no cron yet)
- All frontend changes deployed to Vercel
- Last git commit: `2b77f7982 fix: top tickers uses session aggregates; flow signals field fix; sector strip scrollable`

## Known issues / incomplete work

### Flow Detail panel broken
Clicking a ticker row shows "FLOW DETAIL — NDX" header but body still says "Click a ticker above to load detail". `loadDetail()` function appears to read from `allTrades` (500-row tape slice) rather than from API or `symbolMetrics`. User wants to redesign this panel — possibly repurpose as sector drill-down or per-symbol deep-dive with strike breakdown. Design call for next session.

### Sweep rollups empty
`flow_sweep_rollups` has 0 rows because historical `flow_trades` don't have `sweep_id` populated (daemon's sweep detection is in-memory and doesn't persist to DB). Would need either:
- Backfill SQL to retroactively identify sweeps (trades clustered within 500ms, same contract)
- Or change daemon to persist sweep_ids to flow_trades when detected

### No baselines cron
`flow_baselines` empty. No z-scores in Flow Signals yet (all show +0.0σ). Need nightly job at ~5 PM ET that computes 20-day rolling per-symbol pc_mean/std and writes to table.

### Afternoon gap Apr 17
Daemon crashed ~13:15 ET Apr 17 (pre-DBWriter). ~3 hours of flow missing. ThetaData historical endpoint locks today's data until midnight ET — can rebuild Saturday morning via `rebuild-flow-history.py --date 20260417 --symbols <top_30> --wipe`. Then re-run aggregate backfill.

### Daemon broken backfill_today
`backfill_today()` in daemon uses deprecated ThetaData v2 endpoint. Needs rewrite to use v3 `option/history/trade_quote` (same logic as rebuild-flow-history.py), scoped to top 30 symbols. Systemd unit still has `--backfill` flag which should be removed once fixed or deprecated.

## Pending work (priority order)

### High
1. **Staging environment** — Vercel preview branch + Neon DB branch. Blocker: check Neon plan allows branching. Prevents live-prod debug cycles like tonight.
2. **Rebuild Apr 17 afternoon gap** — after midnight ET.
3. **Flow Detail panel redesign** — user wants either ticker drill-down, sector drill-down, or both. Design pass when fresh.

### Medium
4. Fix `backfill_today()` in daemon (v3 endpoint, top 30 symbols, <5min at startup).
5. Remove `--backfill` flag from `/etc/systemd/system/sofar-flow-tape.service`.
6. **Baselines cron** — nightly at 22:00 UTC (5 PM ET) to populate `flow_baselines` from last 20 trading days of `flow_session_metrics`. Enables real z-scores in Flow Signals.
7. Yearly trading_calendar refresh (December, via `pandas_market_calendars` → trading_calendar table).
8. Persist sweep_ids to `flow_trades` when daemon detects them (or backfill SQL to identify retroactively).

### Low
9. Periodic DBWriter.stats() + AggregatesRefresher.stats() log line for Monday-open visibility.
10. Aggregate-staleness indicator on frontend (show "data refreshed N sec ago" when `last_refreshed_at > 120s`).
11. Monday morning: verify WebSocket keepalive ping timeouts resolved now that DB writes are non-blocking.

## Architecture decisions made

### Daemon-triggered refresh (vs pg_cron)
Chose Option B (daemon runs refresh in background thread) because Neon's pg_cron has `cron.database_name` hardcoded to `postgres` DB but our data lives in `neondb`. Documented full pg_cron migration path in architecture-notes.md — non-urgent since daemon-triggered produces identical aggregates.

### Sector table (vs hardcoded list)
Chose Tier B (Neon table) over Tier A (hardcoded constants) so sector mapping can be updated via SQL without code deploys. Leaves room for Tier C (automated classification via GICS/Finviz API) in the future.

### Compute-on-write (vs compute-on-read)
Chose compute-on-write (materialized aggregate tables refreshed every 60s) over compute-on-read (SQL aggregation on every request with HTTP cache) because:
- Sub-10ms API response time
- Sets up infrastructure for z-scores/flips that need historical aggregates anyway
- Cleaner place for future computed columns

### CBOE GTH session boundary at 20:00 ET
Per CBOE official docs: "All activity during the Curb session will have the same Trade Date as the preceding RTH session." And GTH (8:15 PM ET → 9:25 AM ET) is assigned to NEXT trading day. So our rule is: ET hour ≥ 20 → next trading day; else current ET date (with trading_calendar lookup for weekends/holidays).

## Files modified this session
/home/bot1/scripts/flow-tape-daemon.py              (DBWriter, AggregatesRefresher, TZ fix)
/home/bot1/scripts/rebuild-flow-history.py          (TZ fix)
/home/bot1/scripts/refresh-flow-aggregates.py       (new, 3 modes)
/home/bot1/sofar-finance/api/flow-trades.js         (cursor pagination, server filters)
/home/bot1/sofar-finance/api/flow-aggregates.js     (new, reads 3 aggregate tables + sectors)
/home/bot1/sofar-finance/js/options-flow.js         (FlowData controller, panel rewiring)
/home/bot1/sofar-finance/options-flow.html          (date selector, sector strip CSS)
/home/bot1/sofar-finance/docs/architecture-notes.md (new)
/home/bot1/sofar-finance/docs/pending-work.md       (new)
/home/bot1/sofar-finance/docs/session-handover-2026-04-17.md (this file)

## Database objects created
trading_calendar                 (4,018 rows)
flow_session_metrics             (2,906 rows)
flow_sweep_rollups               (0 rows)
flow_baselines                   (0 rows)
symbol_sectors                   (135 rows)
fn_session_date(timestamptz)     function
tr_set_session_date()            trigger on flow_trades

## Hard-won rules locked in

- UTC is 4h AHEAD of EDT; ET = UTC - 4 (not the other way)
- Use actual current date in searches — tool snapshot was Apr 18 2026 not 2025
- Neon pg_cron is DB-scoped to `postgres`, can't install in other DBs
- TimescaleDB on Neon = Apache-2 only; no continuous aggregates
- Vercel deploy takes ~45s to fully propagate; don't panic at initial 404
- `auto-bot` commits+pushes every minute; any local change in repo will get committed
- User's preference: batch fixes, avoid Q&A churn, quality over speed, search before assuming
- Never use heredoc for multi-patch scripts without verifying the file exists after

## Next session kickoff

Start with:
1. Read this handover + `architecture-notes.md` + `pending-work.md`
2. Check daemon health: `sudo systemctl status sofar-flow-tape` + recent logs
3. Run rebuild for Apr 17 afternoon gap if ThetaData has unlocked
4. Ask user: Flow Detail redesign direction (ticker drill / sector drill / both)
5. Proceed with staging env setup or baselines cron based on priority

