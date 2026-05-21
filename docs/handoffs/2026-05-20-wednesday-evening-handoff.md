# 2026-05-20 Wednesday Evening Handoff

## Context

Continuation of the multi-day SOFAR finance dev session. This session's spine: a long observability investigation ("does v7 make money in production?") that resolved into discovering daily lgbm predictions were never persisted to the DB — and building/testing/shipping the fix. Plus a scout v2 production-down fix at the top.

Operator uses Claude Desktop with MCP; appended `<system>`/`<functions>` blocks at message tails are the desktop client's tool surface — background only, never acted on. Recurring assistant failure this session: drawing conclusions ahead of evidence (over-alarmed three times during the observability trace before the operator's context corrected each). The discipline that worked: verify-via-query/read BEFORE asserting.

## Shipped

- **Scout v2 UnboundLocalError fix** (committed 7961ee3, sofar-scripts). Scout had written ZERO hypotheses since Monday — 4 dead cron cycles. Root cause: `phase_plan` defined the plan prompt as an f-string containing `{priority_ticker}`, but `select_priority_ticker()` was called AFTER the f-string. f-strings evaluate at definition time → UnboundLocalError → crash at Phase 1. Fix (`patch-phase-plan-priority-unbound.py`, sentinel `PHASE_PLAN_PRIORITY_TICKER_UNBOUND_FIX_V1`): moved priority computation above the f-string, deleted the redundant `.format()` call. Verified end-to-end (`--triggered-by manual`): scout chose TLT (score 0.630), wrote 4 hypotheses, 1 rejected by grounding validator (hallucinated UUID — validator working correctly). Memory persistence confirmed.

- **Daily prediction recording for all 3 horizons** (committed 17c5e74, sofar-scripts) — THE MAIN FIX. `record_prediction()` lived only in the `--train` branch of all three predictor scripts (weekly Sunday cron) → prediction_tracking had only 5 weekly rows per model. The daily predictions from the evening pipeline (pipeline-runner.py steps 11/11b/11c, `lgbm-predictor{,-14d,-21d}.py --predict` at 18:00 M-F) wrote JSON only, never DB → ~4 of 5 daily predictions/model lost. Fix (`patch-daily-prediction-recording-v2.py`, sentinel `DAILY_PREDICTION_RECORDING_IN_PREDICT_BRANCH_V2`): added deduped record_prediction to each `--predict` branch. Verified end-to-end at 22:35 EDT: all 3 record on first run, second run correctly skips, exactly one row per source.

- **ADR-0028 ingestion** (committed 6e7181825 + extract_adrs.py: 1 entity inserted, 3 sentinels ADR-anchored, 7 relationships). Substrate now has full ADR chain 0002→0028.

## Decisions

- **Dedup design: first-write-wins, UTC-safe.** prediction_tracking has NO unique constraint on (source,ticker,date) — only id PK. So dedup is check-then-insert in Python. Keyed on UTC date (`(created_at AT TIME ZONE 'UTC')::date` vs `datetime.now(timezone.utc).date()`) because created_at is stored UTC. V1 used local `date.today()` and FAILED for post-2000-EDT re-runs (produced a duplicate). First-write-wins means the canonical 6pm pipeline prediction stands; manual/intraday re-runs skip — important because the operator observed the 21d prediction differs between the 6pm run (BEARISH 61%) and a 10pm re-run (NEUTRAL 58%) as feature data updates intraday.

- **Observability / Issue C resolved as "tracking works, too young."** Production prediction tracking (prediction_tracking) works and reconciles correctly, but only had 5 weekly all-bullish-in-an-uptrend rows — too few + trend-confounded for a meaningful Sharpe. Re-audit at ~25-30 resolved weekly trades incl. bearish calls + a drawdown. The daily-recording fix now accelerates this: all 3 horizons record daily going forward.

- **ADR-0028 Issue A (Bucket B z-score lookahead) should be retracted.** Code inspection this session: `apply_time_zscore` in panel-builder.py uses `series.shift(1)` before the expanding window (strict no-lookahead, confirmed by docstring + implementation). Target construction (rolling std + full-history median scale) is magnitude-only in-sample scaling, NOT directional lookahead. The 1.537 SPY γ 14d honest non-overlap baseline is clean on the lookahead axis. Issue A was a false alarm in the ADR; should be closed honestly, not quietly edited.

## Sentinels

- `DAILY_PREDICTION_RECORDING_IN_PREDICT_BRANCH_V2` — committed 17c5e74, verified.
- `PHASE_PLAN_PRIORITY_TICKER_UNBOUND_FIX_V1` — committed 7961ee3, verified.
- `PREDICTION_DEDUP_TZ_EDGE_AFTER_2000_EDT_V1` — RESOLVED by V2 (was the V1 bug).
- `COVERAGE_PRIORITY_THROTTLED_BY_NON_SPY_CORPUS_POVERTY_V1` — scout coverage-priority mechanically works but steers weakly: only 1/4 hypotheses hit the TLT priority because non-SPY corpus is thin (corpus=1 doc). Grounding requires real docs so TLT hypotheses can't be fabricated. Bottleneck = corpus coverage; needs scraper expansion (research-lab-scraper.py source list → TLT/rates/single-stock research).
- `BUCKET_B_TIME_ZSCORE_EXPANDING_WINDOW_LOOKAHEAD_SUSPECTED_V1` — should be CLOSED (resolved by inspection; non-issue).
- `THRESHOLD_MEDIAN_USES_FULL_HISTORY_SCALE_V1` — informational; target threshold uses full-history median (magnitude-only, not directional). Low priority; would be `.expanding().median()` if ever made strictly walk-forward.
- `SCOUT_LLM_OCCASIONALLY_DROPS_UUID_SEGMENT_IN_CITATIONS_V1` — informational; LLM sometimes mangles a real doc UUID (drops the 4th segment), validator catches it.
- Still open from prior: `ALPHA_TARGET_NEGATIVE_SHARPE_SYSTEMATIC_V1`, `SCOUT_V2_WRITE_HYPOTHESES_DROPS_TARGET_TICKERS_V1`, `MACRO_SIGNALS_VIX_LEVEL_YIELD_CURVE_CONSTANT_PLACEHOLDER_V1`, `CRON_SCHEDULE_USES_LOCAL_TIMEZONE_NOT_UTC_V1`.

## Known issues

- **UTC-vs-EDT date semantics in reconciliation (verify next session).** created_at is UTC (6pm EDT pipeline = 22:00 UTC, one calendar day ahead of the EDT trading date), while the prediction JSON's `date` field is the EDT trading date. reconcile-predictions.py (runs 19:00 M-F) should join on the correct date when maturing actual_price/correct/pnl_pct. Not verified — worth a quick check that the reconciler handles the off-by-one correctly.

- **strategy-lab.html is a genesis-era fossil.** ~17KB, mostly hardcoded fake numbers (regime perf 91-92%, confidence calibration 98.9%/867-preds which reuses the dead March-19 prediction_tickers count, timeline "Sharpe 1.40" fiction, hardcoded hold-Sharpes 0.99/1.71/0.52). Only 3 live hooks: fetch lgbm-metadata.json, lgbm-prediction.json, walk_forward_accuracy. The blank "WF: %" = line 222 reads `pred.walk_forward_accuracy` which doesn't exist in lgbm-prediction.json (it's in lgbm-metadata.json as 44.7). NOTE: lgbm-metadata.json's walk_forward_sharpe:3.636 is the over-annualized number; walk_forward_accuracy:44.7 is sub-coin-flip (consistent with α anti-predict). The data/ copy of metadata still has the deleted portfolio_sim fiction until next Sunday's metadata-copy cron.

- **The March-19 prediction tables are genesis scaffolding, NOT broken production.** `predictions`/`prediction_tickers`/`accuracy_log` (production DB) are frozen at 2026-03-19 (project genesis, pre-pre-prealpha), superseded. The "1/308 correct" alarm during the session was a false alarm — those are abandoned genesis rows, not a live reconciliation bug. IGNORE these tables. Current production tracking = prediction_tracking only.

## Next session

- **Dashboard rebuild (strategy-lab.html) — make everything dynamic + honest.** Path chosen: build a `compute-dashboard-stats.py` that reads prediction_tracking and emits `prediction-performance.json`; dashboard fetches it; sections show small-n/"accumulating" states until n≥30. Sections 1-3 + timeline can be honest now; regime/confidence sections CANNOT be honestly populated yet (only ~5 live rows + now daily accumulation). This was deferred pending the daily-recording fix landing — which it now has, so data starts accumulating tonight. The daily-recording fix is the foundation that unblocks this.
- **Close ADR-0028 Issue A honestly** (retraction per Decisions above).
- **Verify reconcile-predictions.py UTC/EDT date join** (Known issues above).
- **Scout corpus expansion** — research-lab-scraper.py source list for non-SPY tickers (the COVERAGE_PRIORITY_THROTTLED sentinel).
- 4 scout hypotheses in `proposed` awaiting director-evening gate (the TLT cycle + Wednesday's).

## Rationale

The whole observability thread was the assistant repeatedly over-concluding (tracking broken → works; predictions vanish → stored in 3 tables; reconciliation-bug → actually-genesis-fossil) and the operator's domain context correcting each. The verified end state: production observability is a single young table (prediction_tracking); the dashboard displays superseded genesis numbers; the real gap was that daily predictions weren't persisted. That gap is now fixed and shipped. Every honest production number downstream (dashboard, audit, v7-vs-candidate comparison) depends on these daily rows, which now accumulate.

## Production state

v7 untouched (SPY α-classifier, real production Sharpe still unmeasured — too young, ~5 weeks). Scout v2 FIXED + live + committed (TLT priority working, throttled by corpus). Daily prediction recording FIXED + committed + verified — all 3 horizons (7/14/21d) now persist one deduped UTC-safe row per day via the 18:00 pipeline. reconcile-predictions.py 19:00 M-F matures outcomes. Director morning(brief)/evening(PSR≥0.80 gate) 07:30/16:30 EDT weekday. Daemon STOPPED (empty queue). 4 scout hypotheses in `proposed`.
