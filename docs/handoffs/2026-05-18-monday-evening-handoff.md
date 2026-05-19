# 2026-05-18 Monday Evening Handoff

## TL;DR for next session

Three real measurement bugs uncovered this evening cascading through the v8 ensemble experiment. First trustworthy Sharpe number in project history: SPY γ 14d single = 1.537 under non-overlap protocol. v8 ensemble deferred (not rejected) pending bespoke feature flywheel maturation per ADR-0027. Scout v2 coverage-driven priority shipped earlier — tomorrow 11:30 EDT cron picks first real non-SPY priority. ADR-0028 ingested. V7_BASELINE_LIE_CORRECTED_V1 patcher applied + committed.

## Context

Session focus was per-asset aggregator experiment to test whether multi-asset ensembles produce alpha beyond single-asset models. Initial result: top_k_5 gamma ensemble walk-forward Sharpe 1.751 vs v7 baseline 1.403 — apparent +0.35 Sharpe win. Operator pushed back on Sharpe plausibility ("a Sharpe of 3.6 is phenomenal — like highly unusual"), triggering a bug-discovery cascade that invalidated the comparison framework all session's architectural experiments had used.

The bug-discovery is more valuable than any architectural experiment shipped today — it produces the first trustworthy baseline measurement in the project's history.

## Shipped

- **PLAN_PRIORITY_COVERAGE_SCORING_V1** — `quant-research-scout.py` coverage-driven priority ticker patcher applied, committed, pushed. After 4 rounds of schema bug fixes (SIGNAL_VERSION undefined, target_tickers column doesn't exist, experiments-hypotheses join broken), patcher landed clean. 16-ticker universe weighted by graduated-feature-count + corpus-freshness + stagnation + failure-rate. Pipeline-component weight=0 pending ADR-0028 target_tickers persistence. Live for tomorrow 11:30 EDT cycle.

- **V7_BASELINE_LIE_CORRECTED_V1** — patcher applied to 5 files. `lgbm-predictor.py:301` deleted hardcoded `portfolio_sim: {'sharpe': 1.403, ...}` dict. `_load_v7_baseline_sharpe()` helper inserted in `lgbm-monolithic-predictor.py`, `lgbm-per-asset-predictor.py`, `lgbm-per-asset-aggregator.py`, `lgbm-v8-portfolio-sim.py`. Per-patch sentinel bug required manual fixup for body patches in monolithic + per-asset (4 + 6 string replacements). All dynamic loads verified working: `V7_BASELINE = {'7d': 3.636, '14d': 4.372, '21d': 4.892, 'best': 4.892}`.

- **Aggregator infrastructure** — `lgbm-per-asset-predictor.py` `--save-predictions` flag added (saves per-(date, ticker, horizon, variant) predictions to parquet). Re-ran 135-cell validation, saved 625,842 prediction rows to `models/per_asset_predictions/per_asset_predictions_43e79fed97fb17c3.parquet`. New `lgbm-per-asset-aggregator.py` tests 7 aggregation rules (484 lines). New `lgbm-v8-portfolio-sim.py` runs aggregator predictions through v7-replicated portfolio framework (387 lines).

- **v7 archive** — complete 6-file snapshot at `models/v7-archive-20260518/` (3 SPY classifier .pkl + 3 metadata.json). Tarball force-added (~203KB). v7 retrained 2026-05-17 with `train_end=2026-05-06` (drift from April baseline confirmed). Real rollback target preserved before any v8 work.

- **ADR-0028: Measurement framework correction** — written, committed, ingested via `extract_adrs.py`. Captures three bugs + four corrections + open issues + v8 deferral logic. Sentinel: `MEASUREMENT_FRAMEWORK_CORRECTION_V1`. 10 entities inserted, 5 updated, 40 relationships, 55 events.

## Decisions

- **v7 baseline reference number changed.** Project-wide reference to "v7 Sharpe 1.403" is deprecated; that number was never computed. Real comparable is SPY γ 14d single-model honest non-overlap Sharpe = 1.537. v7's real production P&L still unaudited (Issue C).

- **v8 ensemble deferred, not rejected.** Multi-asset ensemble underperforms single γ 14d (1.398 vs 1.537) under honest measurement only because non-SPY tickers have feature poverty (DIA: 27 universal features vs SPY: 165 bespoke). ADR-0027 thesis preserved: ensemble math is sound, current data is premature. Re-evaluate v8 in 4-8 weeks when ≥2 non-SPY tickers reach honest individual Sharpe ≥ 1.2 via scout v2 bespoke commissioning.

- **Honest non-overlap Sharpe is new measurement standard.** Per-trade returns from every Nth row (where N=horizon) for true independent observations. Per-asset predictor + aggregator + future v8 evaluations all use this protocol going forward.

- **Pipeline-component weight in PLAN_PRIORITY_WEIGHTS stays at 0** until ADR-0028 (target_tickers persistence) ships. Weights redistributed: features=0.40, corpus=0.30, stagnation=0.20, failure=0.10.

- **Daemon stays stopped** until first real graduation_proposal lands. Empty queue right now; spy_atr_vol_of_vol dismissed tonight by director-evening (delta_PSR 0.762 < 0.80 threshold per ADR-0026).

## Sentinels

Active (open):

- `MEASUREMENT_FRAMEWORK_CORRECTION_V1` (proposed, ADR-0028)
- `V7_BASELINE_LIE_CORRECTED_V1` (applied, this session)
- `PLAN_PRIORITY_COVERAGE_SCORING_V1` (live for tomorrow's cron)
- `PER_TICKER_BESPOKE_FEATURES_ARE_ALPHA_V1` (ADR-0027, active)
- `BUCKET_B_TIME_ZSCORE_EXPANDING_WINDOW_LOOKAHEAD_SUSPECTED_V1` (ADR-0028 Issue A — untested)
- `ALPHA_TARGET_NEGATIVE_SHARPE_SYSTEMATIC_V1` (ADR-0028 Issue B — α/β anti-predict)
- `V7_PRODUCTION_PNL_AUDIT_REQUIRED_V1` (ADR-0028 Issue C — never measured)
- `SCOUT_V2_WRITE_HYPOTHESES_DROPS_TARGET_TICKERS_V1` (schema migration candidate)
- `WALK_FORWARD_SHARPE_OVERLAP_INDEPENDENCE_INFLATION_V1` (documented in ADR-0028)
- `MACRO_SIGNALS_VIX_LEVEL_YIELD_CURVE_CONSTANT_PLACEHOLDER_V1` (signal_values broken values)
- `CRON_SCHEDULE_USES_LOCAL_TIMEZONE_NOT_UTC_V1` (active reminder, from Friday)

Resolved Friday:

- `DIRECTOR_PROMOTER_FILTER_EXCLUDES_QUANT_RESEARCH_SCOUT_V1`
- `DIRECTOR_DUPLICATE_GRADUATION_PROPOSAL_V1`
- `GRADUATIONS_DISCORD_403_USER_AGENT_V1`

## Known issues

- **Bucket B z-score lookahead suspected (Issue A).** `panel-builder.py` time z-score uses expanding window across full history. Expanding-window mean/std incorporate test-period values when normalizing test-period z-scores. Real lookahead candidate. Even after non-overlap correction, real edge could still be partly artifact. Real test: rebuild panel with strictly walk-forward z-score, re-measure honest non-overlap Sharpe. If γ 14d stays ≥ 1.0, edge confirmed.

- **α/β targets systematically anti-predict (Issue B).** Across 90 cells today, alpha at -0.286 honest non-overlap Sharpe with 41% accuracy. Beta worse (-0.6 to -0.8). Either threshold construction has sign bug, class labels have lookahead, or rolling-median baseline computed with lookahead. v7 production trades α — real concern.

- **v7 production P&L not audited (Issue C).** v7 trades SPY α-classifier with 0.60 confidence threshold. Reported metrics (1.403 fiction, 3.636 over-annualized walk-forward) tell us nothing about real production performance. Real audit: query `predictions` table for v7's actual recorded predictions vs realized SPY returns since deployment.

- **Working-tree hygiene:** 40+ untracked files in `/home/bot1/scripts` from prior sessions (substrate extractors, form4-ingester, cot-detector, multiple `.bak` files). Separate housekeeping work, not part of today's commits.

## Pending

- **ADR-0027 amendment** — multiple references to 1.403 as v7 baseline. Real correction needed: cite SPY γ 14d single honest non-overlap = 1.537 OR v7 production P&L when Issue C audit produces it. Short amendment, architectural conclusions unchanged.

- **target_tickers schema migration** — add `target_tickers TEXT[]` column to `public.hypotheses`, patch scout v2 `write_to_hypotheses_table`, back-populate existing rows. Unblocks pipeline-component weight in coverage scoring.

- **lgbm-predictor.py annualization fix** — Bug 2 (walk-forward Sharpe over-annualized by sqrt(horizon)) acknowledged but not patched. Behavior change: `walk_forward_sharpe` metadata field would shift from 3.636 → ~1.37 on next v7 retrain. Decision deferred — diagnostic field, doesn't affect production trades.

## Next session

In priority order:

1. **Tomorrow morning** — verify scout v2 coverage-driven cycle picked first real non-SPY priority. Expected first winner: TLT (features=0) or AMD (corpus=9) per today's scoring. Check `~/.quant-research-scout-memory.json` priority_history after 11:30 EDT cycle.

2. **Issue A — Bucket B z-score lookahead test.** Rebuild panel with strictly walk-forward z-score normalization. Re-measure SPY γ 14d honest non-overlap Sharpe. Determines whether 1.537 is real edge or partly lookahead artifact.

3. **Issue C — v7 production P&L audit.** Query `predictions` table for v7's actual recorded predictions since deployment. Compute real P&L vs SPY returns. Tells us whether v7 has been making money or losing under metrics that mask it.

4. **Issue B — α/β anti-predict root cause.** Read `panel-builder.py:build_target()` for α/β shapes. Test threshold sign convention. Production-relevant because v7 IS an α-classifier.

5. **ADR-0028 candidate — target_tickers persistence.** Schema migration + scout v2 patch + back-population. Re-enable pipeline weight in coverage scoring.

6. **ADR-0027 number amendment.** Short fix-up pass replacing 1.403 references with 1.537 + footnote about Issue A risk.

## Rationale

Today produced more value from bug discovery than from architectural work shipped:

- The 1.403 baseline was a typed fiction propagated across every architectural comparison in the project's history. Every v* vs v7 delta computed has been against a number that was never measured.
- Walk-forward Sharpe was over-annualized by sqrt(horizon). Reported 3.636 (7d) → real ~1.37.
- Per-trade Sharpe assumed IID; overlapping 7/14/21 day forward windows violated it severely. Inflated by 3-5x.

After all three corrections, SPY γ 14d single produces 1.537 honest non-overlap Sharpe on 384 truly-independent trades over 21 years with 67% win rate. Real, believable, working-quant-fund territory. First honest baseline in project history.

Two related celebratory-then-walked-back cycles this session: v8 ensemble looked like clear winner (Sharpe 1.751 walk-forward, 3.099 portfolio sim) → after honest measurement, lost to single γ 14d by -0.139 Sharpe. Operator correctly pushed back on premature dismissal: ensemble math is sound, current non-SPY ticker feature poverty is the real bottleneck. ADR-0028 captures the deferral rather than rejection — re-test in 4-8 weeks.

Coverage-driven priority for scout v2 represents the real production change this session. Tomorrow's cron picks first non-SPY priority based on real DB-state scoring (graduated features per ticker, recent corpus, days since last priority). Over the next weeks, scout v2 generates non-SPY hypothesis flow that feeds the bespoke feature flywheel that ADR-0027 + ADR-0028 both depend on for future v8 viability.
