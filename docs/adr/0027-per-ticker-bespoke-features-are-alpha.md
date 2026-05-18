# ADR-0027: Per-ticker bespoke features are the alpha source; scale v7 horizontally, not monolithic vertically

**Date:** 2026-05-18
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0001 (three-database split), ADR-0020 (signal-graduation source-agnostic), ADR-0022 (SOFAR ML pipeline architecture), ADR-0023 (lookahead audit — pending substrate ingest), ADR-0024 (lookahead correction — pending substrate ingest), ADR-0025 (sandbox-validator — pending substrate ingest), ADR-0026 (graduation pipeline — pending substrate ingest)
**Sentinel:** PER_TICKER_BESPOKE_FEATURES_ARE_ALPHA_V1

---

## Context

After the ADR-0026 graduation pipeline shipped on 2026-05-15, an immediate
operator concern surfaced: the production champion (`lgbm-predictor.py` v7,
Sharpe 1.403 on 20-year walk-forward) trains and predicts on SPY only,
despite the broader pipeline computing signals across 17 tickers. The
SPY-only limitation throttles the value of any scout-discovered signal
that targets non-SPY assets — scout v2 produces hypotheses tagged
`target_tickers=['SPY','TLT']` or similar, and the production model
ignores everything except SPY rows.

Two candidate architectural responses:

1. **Monolithic panel model** — one LightGBM trained on a long-format
   (date, ticker) panel with cross-sectional features. Renaissance-style
   approach from Gu-Kelly-Xiu (2020) and the Medallion fund's design
   philosophy. Captures cross-asset combination effects natively but
   requires universal feature representations.

2. **Per-ticker specialist models** — one model per asset, optionally
   with a meta-learner aggregator. Princeton-style approach from
   Shu/Yu/Mulvey (2024 JM-XGB paper, MinVar Sharpe 1.12 vs baseline 0.70).
   Captures per-asset microstructure but loses cross-asset combination
   effects.

Both architectures were implemented and validated on 2026-05-15/18
against v7's Sharpe 1.403 baseline.

### Monolithic results (2026-05-15)

Two panel modes built via `panel-builder.py` (see `docs/specs/panel-builder-design.md`):
- **drop-mode** — 35 features (27 cross-rank universal signals +
  6 cross-asset broadcast refs + 2 ticker categoricals), uniform feature
  density across all tickers (17-66% NaN per ticker, mostly ~17%)
- **include-mode** — 174 features (35 above + 139 SPY-bespoke
  single-ticker signals from v7's feature set), highly uneven density
  (SPY 37% NaN, all other tickers 83-93% NaN)

Each panel × 9 cells (3 horizons × 3 target variants α/β/γ) walk-forward
validated. Results (all 18 cells):

| panel | best cell | best Sharpe | vs v7 (1.403) |
|---|---|---|---|
| drop-mode | 7d gamma | 0.470 | -0.93 |
| include-mode | 7d gamma | 0.470 | -0.93 |

Bucket B drop changed Sharpe by less than 0.06 across all 9 cells.
NaN imbalance was not the limiting factor.

### Per-asset results (2026-05-18)

Same two panels, but trained per ticker (15 tickers × 3 horizons × 3
variants = 135 cells per panel) using v7's exact hyperparameters
(num_leaves=15, max_depth=4, n_estimators=100, min_child_samples=20).

Drop-mode top cells (Sharpe / accuracy):
- SPY 14d γ: 0.911 / 61.1%
- DIA 14d γ: 0.896 / 59.6%
- DIA 21d γ: 0.878 / 61.4%
- NVDA 7d γ: 0.852 / 55.2%
- SPY 7d γ: 0.818 / 56.8%

Include-mode top cells (Sharpe / accuracy):
- **SPY 7d γ:  1.295 / 60.3%**
- **SPY 14d γ: 1.246 / 64.1%**
- **SPY 21d γ: 1.151 / 66.9%**
- DIA 14d γ: 0.896 / 59.6%   ← unchanged from drop-mode
- DIA 21d γ: 0.878 / 61.4%   ← unchanged from drop-mode
- NVDA 7d γ: 0.852 / 55.2%   ← unchanged from drop-mode
- DIA 7d γ:  0.791 / 56.4%   ← unchanged from drop-mode

**Critical observation:** SPY's per-asset Sharpe jumped from 0.911 →
1.246 (14d horizon) purely from adding the 139 SPY-bespoke features.
Every other ticker is byte-identical between drop-mode and include-mode
because those features are NaN-padded for non-SPY rows. Adding NaN
columns doesn't change LightGBM's predictions for non-SPY tickers.

The +0.34 Sharpe jump for SPY came from features, not architecture.

### What the data forces us to conclude

Per-asset SPY include-mode (1.295) approaches but does not fully match
v7's 1.403 — the remaining 0.108 Sharpe gap is plausibly:
- Walk-forward CV protocol detail (annualization factor, fold boundary)
- Different feature engineering preserved in v7's `models/lgbm_metadata.json`
  vs panel-builder's pivot
- Noise (n_scored=5,369 with Sharpe 1.3 has wide confidence band)

This is small enough that v7's production validation IS the per-asset
result for SPY. We have not found an architecture that produces alpha
on non-SPY tickers comparable to what v7 produces on SPY.

The decisive finding: **the 139 SPY-bespoke features (iv_rank, iv_roc_5d,
pc_iv_skew, gex_regime_lag1/2/5, bb_x_gex, iwm_spy_zscore, qqq_spy_zscore,
es_spy_gap, vix_roc_5d, willr_x_range, and 129 others) ARE v7's alpha
source.** Without them, even per-asset SPY underperforms by 0.49 Sharpe.

Other tickers do not have these features in `market.signal_values`
because the underlying signal-computation scripts that produce them are
SPY-only (most depend on SPY-specific options data, SPY-specific dealer
gamma estimates, SPY-specific positioning indicators).

## Decision

**Adopt the per-asset specialist architecture going forward, but the
strategic priority is to commission scout v2 (and the broader
signal-compute layer) to produce per-ticker bespoke features for
non-SPY trading-universe tickers.**

Specifically:

1. **Keep v7 as the SPY production champion.** Validated Sharpe 1.403,
   3 horizons (7d/14d/21d), graduation pipeline integrated. No
   replacement.

2. **Per-ticker champions are the architectural pattern for expanding
   trading universe.** Each ticker gets its own LightGBM model trained
   on that ticker's own bespoke features + the universal cross-rank
   features + the broadcast macro features. Same v7 hyperparameters
   (num_leaves=15, max_depth=4, n_estimators=100, min_child=20). Same
   target shape (vol-adjusted binary at minimum, γ regression
   optionally). Same walk-forward CV (annual splits, min_train=1000,
   start_test_year=2005).

3. **Bespoke feature generation is the gating work.** Per-ticker
   champions only beat universal-feature baselines (0.7-0.9 Sharpe)
   when the ticker has its own bespoke features (1.2+ Sharpe). Scout v2
   currently has a SPY bias in its hypothesis generation; ADR-0027
   commissions scout to produce equal volumes of bespoke hypotheses
   for QQQ, IWM, NVDA, TLT, GLD (priority order).

4. **No monolithic model in production.** The 2026-05-15 validation
   conclusively ruled out monolithic as a production candidate at our
   scale (15 trading tickers, 35-174 features). Best monolithic Sharpe
   0.47 vs v7's 1.403 — a -0.93 gap that didn't close under either
   feature-density mode. This decision can be revisited if the trading
   universe expands to 50+ tickers (the regime where Gu-Kelly-Xiu's
   cross-sectional approach gives statistical power).

5. **No portfolio meta-learner yet.** Position sizing across per-ticker
   champions deferred to a future ADR. Until at least 3 non-SPY tickers
   have validated champions at Sharpe > 0.8, the production system trades
   SPY only via v7. As champions are validated they enter production one
   at a time, sized via vol-target weighting (operator-managed initially).

## Alternatives Considered

### Alternative 1: Replace v7 with monolithic panel model

- **Pros:** Single artifact, captures cross-asset combinations natively,
  scales linearly to wider universe, panel data approach is well-studied
  (Gu-Kelly-Xiu 2020, Renaissance design).
- **Cons:** Validated 2026-05-15: best monolithic Sharpe 0.47 across 18
  walk-forward cells. -0.93 Sharpe gap vs v7 is not noise. Renaissance
  uses monolithic at sub-second horizons on thousands of instruments;
  our daily horizon with 15 tickers gives the model insufficient
  cross-sectional discrimination to learn universal patterns.
- **Why not:** The empirical Sharpe gap is decisive. Cannot ship a
  production model that loses 67% of v7's risk-adjusted return.

### Alternative 2: Stacked ensemble (per-asset + monolithic as features)

- **Pros:** Combines both architectures, lets walk-forward decide weights.
- **Cons:** More complex production infrastructure (3+ artifacts per ticker
  + meta-learner), monolithic underperformance suggests it won't add
  signal to per-asset, increased overfit risk from stacking.
- **Why not:** No evidence monolithic contributes signal that per-asset
  + cross-asset-features doesn't already capture. Adds complexity for
  unclear gain. Revisit if monolithic validates at Sharpe > 0.8 on a
  future iteration.

### Alternative 3: Add cross-asset features to v7 instead of multi-ticker target

- **Pros:** Smaller scope change. v7 keeps SPY target but adds TLT/VIX/
  dollar features.
- **Cons:** Doesn't expand trading universe — still only trades SPY.
  Operator's 2026-05-15 concern was specifically: SPY-only consumption
  caps alpha discovery from scout v2's multi-ticker hypotheses.
- **Why not:** Solves a narrower problem than ADR-0027 needs to solve.
  Cross-asset features ARE already in the panel (Bucket C broadcasts);
  v7's failure to use them is operator-managed feature-list scope, not
  architectural.

### Alternative 4: Wait for wider trading universe before expanding architecture

- **Pros:** Avoids over-engineering for current scale.
- **Cons:** SPY-only consumption is the throttle on scout v2's alpha
  output today. Every scout cycle produces multi-ticker hypotheses
  that can't reach production. Throughput cost compounds.
- **Why not:** The decision to expand to per-ticker champions doesn't
  depend on universe scale — it depends on whether per-ticker champions
  validate when given bespoke features. Today's data shows v7's pattern
  works for SPY; the framework should let us test it on QQQ, IWM, TLT
  as their bespoke features come online.

## Consequences

### Positive

- v7's validated Sharpe 1.403 is preserved as the SPY champion. No
  regression risk.
- Per-asset architecture inherits v7's already-validated walk-forward CV
  protocol, graduation gates (ADR-0026), and prediction tracking. No
  new architectural surface area beyond per-ticker parameterization.
- Scout v2 hypothesis output gets a real consumption path for non-SPY
  tickers. Multi-ticker hypotheses can now graduate to per-ticker
  champion training sets.
- The per-asset framework is built (`lgbm-per-asset-predictor.py` shipped
  2026-05-18). Already operational on 135 cells. Adding bespoke features
  for QQQ doesn't require new modeling code, just new signals in
  `market.signal_values`.

### Negative / trade-offs

- Cross-asset combination effects (Renaissance's gold-silver pair effect)
  are not captured by per-asset specialists. We rely on the universal
  cross-rank features + cross-asset broadcast refs to give each champion
  partial visibility into other tickers' state.
- Higher production maintenance: N champions = N walk-forward retraining
  pipelines, N model artifacts, N prediction tracking sources. Mitigated
  by templatized retrain scripts and per-asset metadata convention
  established in `lgbm-per-asset-predictor.py`.
- Portfolio-level position sizing across N champions becomes its own
  problem (future ADR).

### Risks

- **Risk:** Scout v2's bespoke hypothesis generation may produce
  lower-quality features for non-SPY tickers because the underlying
  research corpus is SPY-heavy. Mitigation: scout v2's research pipeline
  already accepts target_tickers from the user; commission first-pass
  hypothesis sets explicitly tagged for QQQ, IWM, TLT.
- **Risk:** Per-asset champions on small-history tickers (META 2012+,
  TSLA 2010+) may have insufficient training data for stable
  walk-forward CV. Mitigation: gate champion graduation on minimum
  walk-forward folds (>10) and minimum n_scored (>2000). Established
  precedent from ADR-0026.
- **Risk:** The α negative-Sharpe pattern observed in 2026-05-18
  validation (consistent -0.5 Sharpe across 45 α cells at 40-47%
  accuracy) suggests the threshold-binary target may have a structural
  issue. γ (regression) works cleanly. Mitigation: per-ticker champions
  default to γ target; α target investigation tracked as separate work
  item (sentinel ALPHA_TARGET_NEGATIVE_SHARPE_SYSTEMATIC_V1).
- **Risk:** SPY include-mode per-asset Sharpe 1.295 doesn't fully match
  v7's 1.403. Mitigation: investigate the gap before promoting any
  per-asset SPY model to production; v7 stays canonical until per-asset
  SPY validates at ≥1.4. Tracked as PER_ASSET_SPY_GAMMA_BELOW_V7_INVESTIGATION_V1.

## Implementation notes

### Files shipped 2026-05-18 (this ADR's foundation)

- `/home/bot1/scripts/panel-builder.py` — Multi-asset feature panel
  builder. Three feature buckets (cross-rank, time-zscore, cross-asset
  broadcast) + ticker categorical. CLI: `--rebuild`, `--inspect`,
  `--bucket-b include|drop`, `--as-of`. Outputs parquet cache + manifest.
- `/home/bot1/scripts/lgbm-monolithic-predictor.py` — Monolithic
  validator. 9-cell walk-forward CV (3 horizons × 3 variants).
  Retained for future revisit if universe scales.
- `/home/bot1/scripts/lgbm-per-asset-predictor.py` — Per-ticker
  validator. 135-cell walk-forward CV. Foundation for ADR-0027
  per-ticker champions.
- Cached parquet panels:
  - `feature_panel_c4c73d13abbfd714.parquet` — drop-mode, 35 features
  - `feature_panel_43e79fed97fb17c3.parquet` — include-mode, 174 features
- Per-panel metadata files:
  - `per_asset_metadata_c4c73d13abbfd714.json` — drop-mode results
  - `per_asset_metadata_43e79fed97fb17c3.json` — include-mode results

### Production champion roadmap

| ticker | feature status | champion status | priority |
|---|---|---|---|
| SPY  | 165 bespoke features (v7's set) | v7 canonical Sharpe 1.403 | (baseline) |
| QQQ  | 32 universal features only | not started | P1 |
| IWM  | 31 universal features only | not started | P2 |
| TLT  | not in current universe | needs ticker-universe expansion + bespoke features | P3 |
| NVDA | 30 universal features only | not started | P4 |
| DIA  | 27 universal features only | not started | P5 |

P1-P2 work begins when scout v2 has produced ≥40 bespoke hypotheses
per target ticker (matches the order-of-magnitude SPY had pre-v7).

### Scout v2 commission for bespoke feature expansion

Scout v2's `phase_plan` already accepts target_tickers. The plan-prompt
needs an explicit instruction to vary target_tickers across plan cycles
so non-SPY hypotheses get equal scout cycles. Operator-managed via the
plan prompt rotation. Tracked as separate work; not blocking this ADR's
acceptance.

### Validation gate before promoting per-ticker champion

A per-ticker champion graduates to production only when:
1. Walk-forward Sharpe ≥ 0.8 (lower than v7's 1.4 because non-SPY
   tickers have less mature bespoke feature sets initially)
2. Accuracy ≥ 55% (γ variant) or ≥ 53% (α variant after the α bug is fixed)
3. n_scored ≥ 3000 across walk-forward folds
4. Out-of-sample period covers ≥ 10 years
5. Per-ticker delta-PSR ≥ 0.9 vs the production baseline (per ADR-0026)

These thresholds inherit ADR-0026's graduation pipeline. The per-ticker
champion is treated as a graduated production model under that
framework.

## References

- Gu, Kelly, Xiu (2020) "Empirical Asset Pricing via Machine Learning"
  — https://dachxiu.chicagobooth.edu/download/ML.pdf
- Shu, Yu, Mulvey (2024) "Dynamic Asset Allocation with Asset-Specific
  Regime Forecasts" — https://arxiv.org/abs/2406.09578
- Pagliaro (2026) "Regime-Aware LightGBM" — https://www.mdpi.com/2079-9292/15/6/1334
- 2026-05-18 monolithic validation log: `models/per_asset_metadata_c4c73d13abbfd714.json`
- 2026-05-18 per-asset validation log: `models/per_asset_metadata_43e79fed97fb17c3.json`
- v7 production baseline: `models/lgbm_metadata.json`
  (trained_at=2026-04-14, walk_forward_sharpe=1.403, 75-feature set)
- ADR-0022 (SOFAR ML Pipeline Architecture) — anchored the production
  pipeline this ADR refines.
