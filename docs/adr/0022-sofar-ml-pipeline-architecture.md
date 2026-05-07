# ADR-0022: SOFAR ML Pipeline Architecture (canonical reference)

**Date:** 2026-05-06
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0001 (three-database split), ADR-0004 (quant-research pause), ADR-0020 (signal-graduation source-agnostic), ADR-0021 (Form 4 as second signal source)
**Sentinel:** N/A — this ADR is informational, anchoring the production architecture

---

## Context

The SOFAR finance project has accumulated multi-layered ML infrastructure across many sessions. The architecture has become large enough that future sessions risk re-discovering pieces (as happened in the 2026-05-06 evening session, where ~90 minutes were spent mapping the full pipeline through direct code reading). This ADR canonicalizes the production architecture as verified at session-end 2026-05-06 so future sessions can reference it directly without re-discovering.

**Strict accuracy commitment:** Every claim in this ADR was verified by direct code/data inspection (cat, grep, psql, substrate queries) in this session. Inferences and educated guesses are explicitly flagged. The ADR's value depends on its accuracy — when in doubt, the bot is expected to re-verify against the live system rather than trust this document blindly.

## The architecture (verified)

### Layer 1: Signal generation

Multiple scripts populate `market.public.signal_values` with per-(ticker, date, signal_name) numeric values, all under `signal_version='v1.0'` (verified: only one version exists in the table as of 2026-05-06 — query returned `count=2,539,788, signals=166, range 1993-01-01 → 2026-05-06`).

Verified scripts that write to signal_values:
- **`feature-engineering.py`** (310 lines per substrate id 1574) — computes BASE technical indicators (RSI, MACD, ATR, EMA, Bollinger, etc.), ENG variants (lags, momentum, cross-asset zscores like `qqq_spy_zscore`), and INT interactions (e.g., `rsi5_x_volratio`, `bb_x_gex`). Reads from `prices_daily` and `options_eod`. Crontabbed via pipeline-runner with `# PIPELINE: 38 18 * * 1-5` prefix (disabled in direct cron, invoked from orchestrator).
- **`ingest-macro-signals.py`** (372 lines per substrate id 1595) — ingests FRED macro features (yield curves, OAS spreads, USD index, breakeven inflation, real yields, financial stress, M2, claims, CFNAI). These appear in the 21-day lightgbm model with names like `hy_oas`, `yield_10y2y`, `breakeven_10y`, `usd_index`, `financial_stress`.
- Other source-specific scripts populate niche signals: `dark_pool_short`, `news_sentiment`, `gex_regime`, etc. Full enumeration not exhaustively traced this session.

Sandbox isolation mechanism: `signal_version` column on signal_values has UNIQUE constraint `(date, signal_name, signal_version, ticker)`. New experimental signals could be inserted with a different `signal_version` value (e.g., `v_research_001`) without touching production v1.0. **As of 2026-05-06 only v1.0 exists** — no convention has been established yet for sandbox versions. Future sandbox work should establish convention first.

### Layer 2: Model layer (consumes signal_values)

#### LightGBM (production prediction models)

Three independent models, one per forecast horizon, all on ticker SPY:

| Script | Model file | Metadata file | Features | Horizon | model_version | walk_forward_accuracy | walk_forward_sharpe |
|---|---|---|---:|---:|---|---:|---:|
| `lgbm-predictor.py` | `lgbm_direction.pkl` | `lgbm_metadata.json` | 75 | 7 days | `v7_7day` | 44.6% | 3.611 |
| `lgbm-predictor-14d.py` | `lgbm_direction_14d.pkl` | `lgbm_metadata_14d.json` | 75 | 14 days | `v7_14day` | 50.0% | 4.343 |
| `lgbm-predictor-21d.py` | `lgbm_direction_21d.pkl` | `lgbm_metadata_21d.json` | 133 | 21 days | `v7_21day_macro` | 52.7% | 4.85 |

All metrics verified via direct `cat` of metadata JSON files at `/home/bot1/scripts/models/`. All three retrained 2026-05-03 (Sunday) at 17:00, 17:15, 17:30 ET respectively — verified via `trained_at` timestamps in each metadata file.

The 7-day and 14-day models share the SAME 75-feature list (verified: I diffed the `features` arrays — they're identical). The 21-day model adds 58 macro features on top of the 75 shared (133 total), with `feature_set: "combined_tech_macro"` flag.

Stale models also present in `/home/bot1/scripts/models/` from April 12 2026 (not retrained Sunday 2026-05-03):
- `lgbm_explosive.pkl` — predicts something other than direction; purpose not verified
- `lgbm_pinned.pkl` — purpose not verified
- `lgbm_tension.pkl` — purpose not verified

These are not in the active retrain rotation. Status unknown — could be deprecated, could be on a different cadence, could be manual-only.

#### Strategy framework (linear-composite strategies)

`strategy.py` (373 lines) + `optimize.py` (337 lines) implement a separate weighted-composite strategy framework that ALSO reads from signal_values v1.0. This system is independent of the lightgbm models and serves a different purpose (interpretable named strategies vs ML black box).

`strategy.py` has `AVAILABLE_SIGNALS = ["rsi_14", "ma_position", "vix_level", "yield_curve", "options_flow", "gex_regime", "vol_regime"]` (7 signals) and a `STRATEGIES` dict containing named strategy definitions like `baseline_equal`, `v1.1_optimized`, `v2_longterm`, `crisis_contrarian`. Each strategy is a dict with signals subset, weights, threshold, timeframe, ticker.

`optimize.py` is the underlying engine. `strategy.py` imports it and calls `fetch_all_data`, `backtest_with_weights`, `cpcv_evaluate` (the CPCV name suggests Combinatorially-Purged Cross-Validation per López de Prado is implemented — not verified directly this session).

Outputs land in `production.public.backtest_runs` and `research.public.backtest_runs` (verified — both DBs have identical 25-column schema including `directional_accuracy`, `sharpe_ratio`, `max_drawdown_pct`, `pbo` (Probability of Backtest Overfitting), `deflated_sharpe`, `results_by_regime`, `results_by_signal`).

### Layer 3: Synthesis + frontend output

`pipeline-runner.py` (540 lines, substrate id 1614) is the daily evening orchestrator, crontabbed at `0 18 * * 1-5 UTC`. It subprocess-calls multiple scripts in sequence including:
- `feature-engineering.py` (regenerates signal_values for the day)
- `lgbm-predictor.py --predict` (generates 7-day prediction using the saved Sunday-trained model)
- `ingest-thetadata-options.py --all-symbols --incremental`
- `ingest-thetadata-greeks.py` (loop over major symbols)
- `ingest-finra-darkpool.py`

`ai-synthesis.py` (referenced but not directly read this session) consumes the daily predictions and current weight_set, writes synthesis JSON files. The `activate-weights.py` script (patched this same session for transaction safety + datetime.utcnow deprecation) controls which `weight_set` is active at synthesis time.

Frontend (Vercel-hosted at sofar-finance repo) reads JSON files from `~/sofar-finance/data/` including `accuracy-stats.json`, `attribution-calibration.json`, `active-weights-public.json`, `lgbm-metadata-7d.json`, `lgbm-metadata-14d.json`, `lgbm-metadata-21d.json`, `ai-synthesis.json`, `dark-pool.json`, etc.

Each Sunday at 18:00 UTC, a cron copies the three lgbm metadata files from the scripts directory to `~/sofar-finance/data/`, then `git add -A && git commit && git push` — that's how strategy-lab.html gets fresh model metadata.

## Retrain mechanics (verified)

Sunday cron sequence (all UTC, all on day-of-week 0):

```
0 17 * * 0 . ~/scripts/db-env.sh && python3 /home/bot1/scripts/lgbm-predictor.py --train --ticker SPY >> /home/bot1/logs/lgbm.log 2>&1
15 17 * * 0 . ~/scripts/db-env.sh && python3 /home/bot1/scripts/lgbm-predictor-14d.py --train --ticker SPY >> /home/bot1/logs/lgbm-14d.log 2>&1
30 17 * * 0 . ~/scripts/db-env.sh && python3 /home/bot1/scripts/lgbm-predictor-21d.py --train --ticker SPY >> /home/bot1/logs/lgbm-21d.log 2>&1
0 18 * * 0 cp ~/scripts/models/lgbm_metadata.json ~/sofar-finance/data/lgbm-metadata-7d.json && cp ~/scripts/models/lgbm_metadata_14d.json ~/sofar-finance/data/lgbm-metadata-14d.json && cp ~/scripts/models/lgbm_metadata_21d.json ~/sofar-finance/data/lgbm-metadata-21d.json && cd ~/sofar-finance && git add -A && git commit -m 'Weekly model metadata update' && git push >> /home/bot1/logs/lgbm-meta.log 2>&1
```

## Trainer mechanics (verified by reading lgbm-predictor.py source)

### Feature loading

```python
with open('/home/bot1/scripts/models/lgbm_metadata.json') as _f:
    _meta = json.load(_f)
SIGNALS = _meta['features']
```

The feature list is loaded from the EXISTING metadata file at script-import time. **The trainer does not auto-discover features from signal_values.** To add new features, the metadata JSON file must be edited BEFORE running `--train`.

### Training (single fit)

```python
def train_model(X, y):
    params = {
        'objective': 'binary', 'metric': 'binary_logloss',
        'num_leaves': 15, 'max_depth': 4, 'learning_rate': 0.05,
        'n_estimators': 100, 'min_child_samples': 20,
        'subsample': 0.8, 'colsample_bytree': 0.8,
        'verbose': -1, 'random_state': 42,
    }
    model = lgb.LGBMClassifier(**params)
    model.fit(X, y, feature_name=SIGNALS)
    return model
```

Hand-set hyperparameters. Single fit on full data. No regularization (`reg_alpha=0`, `reg_lambda=0` are LightGBM defaults). No early stopping. Fixed random_state.

### Walk-forward validation

```python
def walk_forward_validate(dates, X, returns_map, min_train=1000, start_year=2005):
    # For each year 2005-present:
    #   train on prior years, predict for that year
    #   accumulate hits and pnls
    # Return aggregate accuracy and Sharpe
```

Per-year walk-forward retraining. Same feature set every iteration. Aggregates hits and PnL across all test years from 2005 onward. This is the source of the `walk_forward_accuracy` and `walk_forward_sharpe` numbers in metadata.

### Feature importance

```python
importance = dict(zip(SIGNALS, model.feature_importances_.tolist()))
```

LightGBM's built-in `feature_importances_` returns the count of times each feature was chosen as a split point across all 100 trees. Higher = more useful to the model. Features with importance=0 were never useful for any tree split (verified: 21-day model has 4 such features: `gex_regime`, `news_sentiment`, `rsi_5`, `financial_stress`, `m2_money_roc5`, etc.).

This is implicit feature value assessment via gradient boosting's internal split selection — NOT explicit IC computation, NOT explicit feature selection, NOT explicit pruning.

### What the trainer does NOT do (verified by absence in code)

- ❌ No hyperparameter tuning (no Optuna, no grid search, no randomized search)
- ❌ No feature selection / pruning (all listed features go in, regardless of historical IC)
- ❌ No regularization (L1/L2 penalties unused)
- ❌ No early stopping (n_estimators fixed at 100)
- ❌ No ensemble across random seeds
- ❌ No probability calibration (raw `predict_proba` consumed directly via `confidence_threshold`)
- ❌ No CPCV / purged cross-validation (year-bucketed walk-forward only; label leakage from overlapping forward returns not addressed)
- ❌ No transaction-cost-aware loss
- ❌ No regime-aware training or sample-time-weighting

## Integration pathway for new signal sources

To add a new signal source (e.g., the form4 / CFTC / unusual_flow tracks built earlier this session) into the lightgbm pipeline:

1. **Generate per-(ticker, date) features** from the source events. For form4: counts and dollar volumes of P-purchases and S-sales over rolling lookback windows. For CFTC: current z-score on the trader category most relevant to the contract's tracking ETF. For unusual_flow: recency/intensity of detector firings per ticker.

2. **Insert features into `signal_values`** with `signal_version='v1.0'` and the appropriate ticker. Use the same UPSERT pattern as feature-engineering.py.

3. **Edit the relevant `lgbm_metadata_*.json` features list** to include new signal names. Choice: modify only one horizon's metadata as A/B test, or all three.

4. **Trigger retrain** — either wait for next Sunday's cron, or manually `python3 /home/bot1/scripts/lgbm-predictor.py --train --ticker SPY`.

5. **Verify** — read the updated metadata file's `feature_count`, `feature_importance`, `walk_forward_accuracy`, `walk_forward_sharpe`. Compare against pre-change baseline to assess whether the new features added value.

6. **Promote or remove** — if metrics improved meaningfully, leave new features in. If neutral or worse, remove from metadata and retrain.

For the strategy.py framework (parallel to lightgbm), integration is independent:

1. Same step 1-2 above (signal_values must contain the new signals)
2. Add new signals to `AVAILABLE_SIGNALS` constant in strategy.py
3. Define new entries in `STRATEGIES` dict that include the new signals + weights
4. Run strategies through optimize/backtest framework — produces backtest_runs rows

Both pathways can proceed independently or in parallel.

## Improvement opportunities backlog (from analysis 2026-05-06)

Ordered by rough impact-to-effort ratio. None of these are committed to do — they're an analysis snapshot:

| # | Improvement | Approx effort | Rationale |
|---|---|---|---|
| 1 | Early stopping in trainer | ~30 min | Reduces overfit; LightGBM standard practice |
| 2 | L2 regularization | ~15 min | Single param change; helps with 75-133 feature space |
| 3 | Compute portfolio_sim live in trainer | ~2 hr | **HIGH PRIORITY: see hardcoded-metrics issue below** |
| 4 | Seed ensemble (5-10 seeds, average predictions) | ~1 hr | Reduces variance |
| 5 | Probability calibration (isotonic/Platt) | ~1.5 hr | Better confidence_threshold semantics |
| 6 | Auto-discover-with-validation feature pipeline | ~2-3 hr | Enables systematic new-signal evaluation; pre-screens by IC before adding to metadata |
| 7 | Feature pre-filtering by historical IC | ~2 hr | Prevents noise features from diluting colsample_bytree subsampling |
| 8 | Hyperparameter tuning (Optuna) | ~3-4 hr | Potentially significant accuracy gains |
| 9 | Sample-time-weighting (recent observations weighted higher) | ~1 hr | Helps adapt to regime changes |
| 10 | CPCV / purged cross-validation | ~4-6 hr | More honest validation, addresses label leakage |
| 11 | Multi-horizon multi-task learning (one model, three outputs) | ~1-2 days | Shares representations; reduces 21d model variance |
| 12 | Transaction-cost-aware loss / portfolio metric in training | ~2-3 hr | Aligns optimization with reality |
| 13 | Regime-aware training (per-regime models or detector + ensemble) | ~2-3 days | Addresses regime instability across decades |

**The hardcoded-metrics issue (issue #3 above) deserves immediate attention.** Inspecting the trainer's metadata-write step:

```python
'portfolio_sim': {
    'cagr': 19.68,
    'sharpe': 1.403,
    'max_drawdown': 21.93,
    'win_rate': 57.3,
    'profit_factor': 2.61,
    ...
}
```

These are CONSTANTS in the trainer code, not values computed from the model being saved. The metadata JSON file shows portfolio metrics that don't necessarily reflect the actually-saved model — they reflect some prior validation run that produced those specific numbers. This violates the project rule (per operator 2026-05-06: "ANY HARDCODED CAGR or SHARPE shoudl NOT be there. also keep that as a general rule, we dont hardcode if we acn avoid it").

A sentinel `LGBM_TRAINER_HARDCODES_PORTFOLIO_METRICS_V1` is filed in the same handoff as this ADR.

## Open strategic question

Tonight's analysis surfaced a sequencing question that has not been resolved: **trainer improvements vs new-source integration sequencing.**

- Argument for **trainer-first**: the existing trainer has substantial low-hanging fruit (#1-#5 in the backlog above could happen in a single focused half-day session). Improving the trainer captures more accuracy gain per unit effort than adding new features to a sub-optimally-trained model.
- Argument for **new-sources-first**: the project's recent investments (form4, CFTC, unusual_flow ingesters + reconcilers shipped this session) only pay off when their signals enter the model. Without integration, they sit as orphaned data.
- Argument for **parallel**: integration is conceptually independent from trainer mechanics. They could happen simultaneously without conflict, since signal_values is the shared interface.

This ADR does not resolve the question — it's flagged for a future strategic conversation. Future ADR or session decision will set sequencing.

## Auto-discover-with-validation (deferred design)

Per operator 2026-05-06, an auto-discover feature for new signals is desirable but should NOT add untested signals automatically (they could degrade model accuracy). The proposed safe pattern:

1. **Periodically scan signal_values for distinct signal_names** not currently in any model's metadata
2. **Compute IC** (rank correlation between feature value and forward return at the model's horizon) over historical data
3. **Filter candidates** to those with |IC| above some threshold (e.g., 0.02)
4. **A/B test** by training a model with the candidate added vs without; compare walk_forward_sharpe
5. **Promote** to production metadata only if A/B improves materially

Estimated effort: 2-3 hours to build first version, then ongoing operational use.

This is deferred. Filed for future implementation when it becomes a priority.

## Consequences

### Positive

- Future sessions have a canonical reference for the production ML architecture without re-discovery
- Integration pathway for new signal sources is documented step-by-step
- Improvement opportunities are catalogued and prioritized for future planning
- The hardcoded-metrics bug is durably surfaced as a sentinel
- The trainer's actual mechanics (single-fit, no auto-discover, no IC-based selection) are clearly stated to prevent overestimation of its sophistication

### Negative

- ADR is long. Acceptable trade-off — the architecture IS large.
- Some claims are likely to drift as the system evolves. Future sessions must verify against live system rather than trust this document blindly. The accuracy commitment in the Context section is the operator-facing guarantee.

### Open questions (already noted above)

- Trainer-improvements vs new-source-integration sequencing
- Whether the stale models (`lgbm_explosive.pkl`, `lgbm_pinned.pkl`, `lgbm_tension.pkl`) should be retired, retrained, or are intentionally manual
- Whether sandbox `signal_version` convention should be established before any experimental signal work
- Whether `ai-synthesis.py` and the synthesis layer should be similarly canonicalized in a sibling ADR

## References

- `/home/bot1/scripts/lgbm-predictor.py` — 7-day model trainer (verified via cat 2026-05-06)
- `/home/bot1/scripts/lgbm-predictor-14d.py` — 14-day model trainer
- `/home/bot1/scripts/lgbm-predictor-21d.py` — 21-day model trainer
- `/home/bot1/scripts/feature-engineering.py` — daily feature regeneration (substrate id 1574)
- `/home/bot1/scripts/strategy.py` — strategy framework (substrate id 1633, verified 2026-05-06)
- `/home/bot1/scripts/optimize.py` — strategy weight optimizer (substrate id 1610)
- `/home/bot1/scripts/pipeline-runner.py` — daily orchestrator (substrate id 1614)
- `/home/bot1/scripts/models/lgbm_metadata.json` — 7-day model metadata
- `/home/bot1/scripts/models/lgbm_metadata_14d.json` — 14-day metadata
- `/home/bot1/scripts/models/lgbm_metadata_21d.json` — 21-day metadata (133 features incl. macro)
- `production.public.backtest_runs` and `research.public.backtest_runs` — strategy backtest results
- `market.public.signal_values` — canonical feature store, signal_version='v1.0' currently the only version
- ADR-0020 (signal-graduation source-agnostic) — graduator vision this ML pipeline must integrate with
- ADR-0021 (Form 4 as second signal source) — first signal source candidate for integration
