# SOFAR — Database Routing Map

**Purpose:** Single source of truth for which Neon database is canonical for each table.
Every script, agent, and API endpoint reads/writes per this map. If you're tempted to
use a default `db=` in `execute_query`, stop and consult this file first.

**Last verified:** 2026-04-20 evening session
**Based on:** Inventory pulled 2026-04-20 + architecture decided in Wed/Thu/Fri handovers + Sat multi-DB migration

---

## The Three Databases

| DB | Role | Owned by |
|----|------|----------|
| `sofar-production` | Live trading state — positions, predictions, portfolio config, accuracy tracking | trading system (sofar-finance repo) |
| `sofar-market-data` | All market data — prices, options, flow, macro, calendars, sectors | ingestion scripts + daemons |
| `sofar-research` | Research artifacts — hypotheses, experiments, signals, director decisions | research agents (sofar-research repo, future) |

**Design rule:** one source of truth per domain. No reads from non-canonical copies.
Cross-DB access (e.g. research reading published_signals, trading consuming same) is
explicit via the signal-registry contract, not via hidden table duplication.

---

## Table → Canonical DB

### sofar-production (live trading state)

| Table | Canonical | Notes |
|-------|-----------|-------|
| `positions` | production | open positions |
| `positions_closed` | production | closed positions, P&L |
| `portfolio_config` | production | risk params, sizing rules |
| `predictions` | production | LGBM + synthesis predictions served to frontend |
| `prediction_tickers` | production | per-ticker prediction breakdowns |
| `prediction_tracking` | production | outcome tracking for predictions |
| `accuracy_log` | production | rolling accuracy stats |

### sofar-market-data (all market data)

| Table | Canonical | Notes |
|-------|-----------|-------|
| `flow_trades` | market | ThetaData websocket stream, sweep_id populated |
| `flow_session_metrics` | market | per-session aggregates, 60s refresh via daemon |
| `flow_sweep_rollups` | market | per-sweep_id aggregates, 60s refresh via daemon |
| `flow_baselines` | market | 20-day rolling pc_mean/std per symbol |
| `flow_analysis` | market | Flow Structure Analyzer output (S2 daemon writes here) |
| `options_eod` | market | daily options chains with IV/Greeks |
| `options_flow_historical` | market | legacy daily flow rollups |
| `prices_daily` | market | OHLCV daily |
| `prices_intraday` | market | intraday bars |
| `dark_pool_volume` | market | ATS volume data |
| `gex_historical` | market | gamma exposure history |
| `vix_daily` | market | VIX daily |
| `vol_regime_historical` | market | vol regime classifications |
| `treasury_rates` | market | yield curve |
| `macro_signals` | market | FRED + Yahoo macro signals |
| `signal_values` | market | computed technical signals (RSI, BB, etc.) |
| `trading_calendar` | market | NYSE calendar with early closes |
| `symbol_sectors` | market | 135 symbols → 21 sector classifications |
| `earnings_calendar` | market | upcoming earnings |
| `ingestion_log` | market | daemon/cron write audit trail |
| `data_source_registry` | market | registered market data sources (also duplicated in research — see note) |

### sofar-research (research artifacts)

| Table | Canonical | Notes |
|-------|-----------|-------|
| `hypotheses` | research | quant-scout output, director queue |
| `experiments` | research | overnight-research-daemon writes here (MULTIDB_DEFAULT_RESEARCH_V1 patch) |
| `experiment_knowledge` | research | meta-insights accumulated across cycles |
| `director_decisions` | research | Research Director veto/accept/defer log |
| `director_questions` | research | open questions for human escalation |
| `daily_summaries` | research | daily research narrative |
| `data_scout_log` | research | Data Scout activity |
| `data_gaps` | research | identified missing datasets |
| `data_source_registry` | research | registered research data sources (also in market — see note) |
| `published_signals` | research | signal registry — validated signals consumed by trading |
| `backtest_runs` | research | walk-forward backtest metadata |
| `backtest_daily_results` | research | per-day backtest outputs |
| `signal_attribution` | research | weight set history |
| `weight_sets` | research | proposed weight configs |
| `weight_change_log` | research | activation/retirement log |

---

## Known Duplicates (shadow tables to retire)

These tables exist in production as leftovers from pre-migration. Production copies are **not** canonical and should not be read from or written to. They will be dropped once a script audit (Phase 2) confirms nothing still touches them.

Production-side shadow copies (all non-canonical, slated for DROP):

- `experiments`, `experiment_knowledge`, `backtest_runs`, `backtest_daily_results`,
  `weight_sets`, `weight_change_log`, `signal_attribution`
  → canonical is **research**
- `flow_trades`, `flow_session_metrics`, `flow_sweep_rollups`, `flow_baselines`,
  `flow_analysis`, `options_eod`, `options_flow_historical`, `prices_daily`,
  `prices_intraday`, `dark_pool_volume`, `gex_historical`, `vix_daily`,
  `vol_regime_historical`, `treasury_rates`, `signal_values`, `trading_calendar`,
  `symbol_sectors`, `earnings_calendar`, `ingestion_log`
  → canonical is **market**

### `data_source_registry` — intentional duplication

Present in both `market` and `research`. These are different registries:
- `market.data_source_registry`: sources of raw market data (FRED, Yahoo, FMP, ThetaData, etc.)
- `research.data_source_registry`: sources Data Scout has discovered/piloted for hypothesis testing

They share a name but have different semantics. Keep both. Scripts must always specify `db=` explicitly for this table.

---

## Script → Canonical DB Matrix

Every script that calls `execute_query` / `execute_many` must pass the correct `db=`.
Default (no `db=` arg) routes to `production` — this is a footgun.

| Script | Writes to | Reads from | Current status |
|--------|-----------|------------|----------------|
| `flow-tape-daemon.py` | market (flow_trades) | market | ✓ correct |
| `flow-intelligence.py` | ? | ? | NEEDS AUDIT |
| `flow-structure-analyzer.py` (S2) | market (flow_analysis) | market | ✓ correct |
| `refresh-flow-aggregates.py` | market (flow_session_metrics, flow_sweep_rollups) | market | NEEDS VERIFICATION — sweep_rollups is 0 rows today |
| `overnight-research-daemon.py` | research (experiments) | research | ✓ correct (MULTIDB_DEFAULT_RESEARCH_V1) |
| `quant-research-scout.py` | research (hypotheses, scout log) | research + market | ✓ verified 2026-04-19 |
| `data-scout.py` | research (data_scout_log), market (for ingest) | both | ✓ verified 2026-04-19 |
| `pipeline-runner.py` | orchestrator — delegates | delegates | NEEDS AUDIT per-step |
| `ai-synthesis.py` | production (predictions via archive file) | production + market | NEEDS AUDIT |
| `market-monitor.py` | ? | ? | NEEDS AUDIT |
| `synthesis-trigger.py` | ? | ? | NEEDS AUDIT |
| `intraday-guardian.py` | ? | ? | NEEDS AUDIT |
| `ingest-macro-signals.py` | market (macro_signals) | market | NEEDS VERIFICATION |
| `score-news-sentiment.py` | ? | ? | NEEDS AUDIT (broken 3 days pre-audit) |
| Director scripts (all) | research | research | ✓ verified 2026-04-19 |

---

## API Endpoints → DB Matrix

| Endpoint | DB | Notes |
|----------|-----|-------|
| `/api/flow-trades` | market | flow_trades queries |
| `/api/flow-aggregates` | market | reads session_metrics + sweep_rollups + baselines + symbol_sectors |
| `/api/flow-analysis` | market | flow_analysis table |
| `/api/experiments` | research | post Sat migration |
| `/api/hypotheses` | research | |
| `/api/director` | research | |
| `/api/predictions` (if exists) | production | |
| `/api/positions` (if exists) | production | |

---

## Rules Going Forward

1. **Always pass `db=` explicitly** in `execute_query` / `execute_many`. No defaults.
2. **Schema migrations produce a script audit checklist** — every migration deliverable includes "here are the scripts that write to these tables, here's what they need to pass."
3. **When in doubt, read this file.** When this file is ambiguous, flag it in the session notes — don't guess.
4. **New table? Add it here first**, then write the script that uses it.
5. **Silent failure = design failure.** Every write path should log its DB target on startup. Every read path should raise loudly if the expected DB doesn't have the table.

---

## Open Items (from this map)

Priority order:

1. Audit the NEEDS AUDIT scripts above — 7 scripts, probably 30-60 min to verify each.
2. Drop production-side shadow copies once audit is complete. pg_dump first.
3. Make `db.py` warn/error on missing `db=` kwarg instead of silently defaulting.
4. Fix `flow_sweep_rollups` population (separate issue — SQL logic in refresh-flow-aggregates.py).
5. Fix `flow_session_metrics.sweep_count` (0 everywhere despite sweep_ids present) — same root cause likely.
