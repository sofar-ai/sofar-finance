# ADR-0028: Measurement framework correction and v8 ensemble deferred pending bespoke feature flywheel

**Date:** 2026-05-18
**Status:** proposed
**Deciders:** bot1
**Related:** ADR-0024 (promoted-signal correction — lookahead patterns), ADR-0026 (graduation gates — delta_PSR ≥ 0.80), ADR-0027 (per-asset specialists + bespoke features)
**Sentinel:** `MEASUREMENT_FRAMEWORK_CORRECTION_V1`

---

## Context

The 2026-05-18 evening session ran the per-asset aggregator experiment whose original motivation was to test whether multi-asset ensembles produce alpha beyond single-asset models. The experiment shipped successfully and produced apparent results: top_k_5 gamma ensemble walk-forward Sharpe 1.751, portfolio-sim Sharpe 3.099, both showing apparent +0.35 to +1.70 wins over a quoted "v7 baseline" of Sharpe 1.403.

Three real bugs were uncovered during the celebration-and-correction cycle that followed, in order of discovery:

**Bug 1 — The 1.403 v7 baseline was a typed-in fiction, never computed.**

`lgbm-predictor.py` line 299-310 writes a hardcoded `portfolio_sim` dict to v7's metadata on every retrain:

```python
'portfolio_sim': {
    'cagr': 19.68,
    'sharpe': 1.403,
    ...
    'transaction_cost_bps': 5,
    'test_period': '2005-2026',
}
```

These values are literal constants. They are not the output of any computation. The `transaction_cost_bps: 5` field documents a cost model that `multi-horizon-validation.py:portfolio_sim()` never applies — the function as implemented uses zero costs throughout. The 1.403 number appears to have been copy-pasted from an early v6 → v7 transition validation and propagated across every architectural comparison in the project as "v7's real baseline." Every "vs v7" delta computed this session — monolithic, per-asset, aggregator, v8 portfolio sim — used the fiction as its comparison point.

**Bug 2 — v7's walk-forward Sharpe is over-annualized by sqrt(horizon).**

The same v7 metadata reports `walk_forward_sharpe: 3.636` for 7d, 4.372 for 14d, 4.892 for 21d. These come from `lgbm-predictor.py:walk_forward_validate()` which annualizes via `np.sqrt(252)`. That formula assumes daily observations. The model's underlying observation unit is per-trade returns over a 7/14/21 day forward window, not daily returns. Correct annualization is `np.sqrt(252/horizon)`. The over-annualization factor is sqrt(7) ≈ 2.65 for 7d, sqrt(14) ≈ 3.74 for 14d, sqrt(21) ≈ 4.58 for 21d.

Confirmation: per-asset predictor's SPY 7d gamma Sharpe (using correct sqrt(252/7) annualization) measured 1.361. v7's reported 3.636 / sqrt(7) = 1.374. Match within 0.013.

**Bug 3 — Per-trade Sharpe assumes independence; overlapping windows violate it severely.**

The per-asset predictor's "correct annualization" still produces inflated numbers. SPY gamma 14d showed Sharpe 5.104 when annualized as `(per_trade_mean / per_trade_std) × sqrt(trades_per_year)`. The bug: with 252 trades per year and 14-day forward windows, consecutive trades observe heavily overlapping forward periods. Trades 1, 2, 3 all share 13/14 of their forward observation window. Per-trade returns are not independent. The sqrt(N) annualization formula assumes IID returns — wildly violated.

Real test: take every Nth trade (where N=horizon) for genuinely independent observations. SPY gamma 14d non-overlap: Sharpe **1.537** on 18 independent trades/year over 21 years (384 trades total, 67% win rate).

The overlap-independence violation inflated reported Sharpe by 3-5x across the entire per-asset framework.

## Decision

**Four real corrections are adopted simultaneously.**

### Correction 1 — Delete the fictional portfolio_sim dict from v7 metadata writes

`lgbm-predictor.py:301-310` no longer writes the hardcoded portfolio_sim dict. Only `walk_forward_sharpe` (computed) and `walk_forward_accuracy` (computed) remain in metadata. Any downstream code that needs portfolio-simulation numbers must compute them, not read fiction.

### Correction 2 — All downstream scripts load v7 baseline dynamically from metadata

`lgbm-monolithic-predictor.py`, `lgbm-per-asset-predictor.py`, `lgbm-per-asset-aggregator.py`, and `lgbm-v8-portfolio-sim.py` previously hardcoded `1.403` as `V7_BASELINE_SHARPE` constant. Replaced with `_load_v7_baseline_sharpe()` helper that reads `walk_forward_sharpe` from current metadata at import time. Future v7 retrains propagate automatically; no staleness.

Note: this exposes Bug 2 — the loaded value (currently 4.892 best across horizons) is itself over-annualized. Downstream comparisons still wrong in absolute magnitude. Real fix is Correction 3.

### Correction 3 — Honest non-overlap Sharpe is the project's measurement standard

For any new architectural decision, the trustworthy Sharpe measurement protocol is:

```python
# Non-overlap independent observations
non_overlap = predictions.sort_values('date').iloc[::horizon]
trade_returns = sign(prediction) * fwd_return  # for gamma; threshold for alpha/beta
trades_per_year = n_trades / years_observed
sharpe_honest = (trade_returns.mean() / trade_returns.std(ddof=1)) * sqrt(trades_per_year)
```

Real honest non-overlap measurements as of 2026-05-18, on include-mode panel `43e79fed97fb17c3`:

| Strategy | Sharpe | Win Rate | Trades/year | Note |
|---|---|---|---|---|
| SPY γ 14d single | **1.537** | 67.4% | 18.0 | best single model |
| SPY γ 7d single | 1.333 | 59.9% | 36.0 | |
| SPY γ 21d single | 1.090 | 63.7% | 12.0 | |
| v8 candidate (top_k_5 γ 14d ensemble) | 1.398 | 66.7% | 18.0 | SPY×2 + DIA×2 cells |
| v8 candidate (top_k_5 γ 7d ensemble) | 1.333 | 59.9% | 36.0 | SPY only at this horizon |
| SPY α 7d (v7-comparable variant) | -0.286 | 41.5% | 32.9 | anti-predicts |
| SPY α 14d | -0.323 | 38.0% | 16.3 | anti-predicts |

The SPY γ 14d single-model at honest Sharpe 1.537 is the strongest measured strategy in the project's history under trustworthy measurement. It is the new architectural reference baseline. v7's actual production Sharpe — separate audit work — is not yet measured under this protocol.

### Correction 4 — v8 ensemble production decision deferred pending ADR-0027 flywheel

Under honest non-overlap measurement, the v8 candidate (top_k_5 γ ensemble) Sharpe is 1.398 for 14d, vs SPY γ 14d single at 1.537. **The ensemble underperforms the single best model by 0.139 Sharpe.**

This does NOT invalidate the multi-asset ensemble architecture. The ensemble's drag comes from DIA 14d (individual honest Sharpe ~0.90) and DIA 21d (~0.88) averaging in against SPY's strongest cells. DIA's lower individual Sharpe is a direct consequence of its feature poverty: 27 universal cross-rank features vs SPY's 165 bespoke features.

ADR-0027 established that bespoke per-ticker features are the alpha lever. Today's ensemble result confirms it: until DIA, NVDA, QQQ, and other non-SPY tickers have feature flywheels approaching SPY's, ensembling them is dilution rather than diversification.

**Production decision:** v8 ensemble does NOT graduate to production this cycle. v7 remains champion. Scout v2's coverage-driven priority (shipped earlier this session) drives non-SPY bespoke feature commissioning. Re-test v8 ensemble in 4-8 weeks when at least 2 non-SPY tickers have individual honest Sharpe ≥ 1.2. If ensemble math then produces ≥ 1.7 honest Sharpe, v8 graduates per ADR-0026's delta_PSR ≥ 0.80 gate.

## Open issues not resolved by this ADR

**Issue A — Bucket B z-score lookahead suspicion not yet tested.** `panel-builder.py` computes time z-scores using expanding window across full history. The expanding window's mean/std incorporate test-period values when normalizing test-period z-scores. Real lookahead candidate. Even after non-overlap correction, real edge could still be partly artifact. Sentinel: `BUCKET_B_TIME_ZSCORE_EXPANDING_WINDOW_LOOKAHEAD_SUSPECTED_V1`. Real test: rebuild panel with strictly walk-forward z-score (only use stats up to date t for date t's value), re-measure honest non-overlap Sharpe. If γ 14d stays ≥ 1.0, edge is real. If it collapses to noise, the apparent edge was lookahead.

**Issue B — Alpha/Beta targets systematically anti-predict.** SPY α/β honest non-overlap Sharpes are uniformly negative (-0.3 to -0.6). Either target threshold construction has a sign bug, or the binary class labeling has subtle look-ahead, or the rolling-median baseline is computed with lookahead. Sentinel: `ALPHA_TARGET_NEGATIVE_SHARPE_SYSTEMATIC_V1`. v7 production trades α — real production audit needed to determine whether production P&L is also negative or whether v7's specific feature set escapes the pattern.

**Issue C — v7 production P&L not audited.** v7 trades SPY α with 0.60 confidence threshold. Reported metrics (1.403 fiction, 3.636 over-annualized walk-forward) tell us nothing about real production performance. ADR-0024 graduated v7 to production based on the broken metrics. Real audit: query `predictions` table for v7's actual recorded predictions vs realized SPY returns since deployment. If real P&L is positive, v7 has real edge not captured by these measurement frameworks. If negative, v7 has been losing money under metrics that mask it.

## Consequences

### Positive

- **First trustworthy Sharpe number in project history.** SPY γ 14d single = 1.537 is the first honestly-measured number this project can build on. All future architectural decisions reference this baseline.
- **Three real measurement bugs documented.** Future work avoids the same traps. The patcher (sentinel `V7_BASELINE_LIE_CORRECTED_V1`) prevents the 1.403 fiction from re-emerging on retrain.
- **ADR-0027 architectural conclusions preserved.** Per-asset specialists are still the path. Bespoke features are still the alpha lever. The specific number references in ADR-0027 (1.403) are correctible via a brief amendment, not invalidated.
- **Scout v2 coverage-driven priority unblocked.** Shipped earlier this session; tomorrow's 11:30 EDT cycle picks first real non-SPY priority. The flywheel that v8 ensemble depends on is now running.
- **Premature production migration prevented.** Without these corrections, v8 ensemble would have graduated to production based on +0.35 Sharpe delta vs fictional baseline. Honest measurement reveals -0.139 delta — production would have regressed.

### Negative

- **Project's reported historical metrics are all suspect.** Every Sharpe number in journal entries, prior ADRs, and synthesis briefs predating 2026-05-18 was computed under the broken frameworks. Honest re-measurement of historical claims is real backfill work. Lean: don't audit retroactively; build forward with honest measurement.
- **No v8 candidate ready for production right now.** Session began with v8 ensemble looking like clear winner. After corrections, no candidate beats v7-comparable single SPY γ 14d (1.537). The "v8 graduation" milestone slides to whenever bespoke feature flywheel produces ≥ 2 non-SPY tickers at honest Sharpe ≥ 1.2.
- **v7 production trust degraded pending audit.** Until v7's real production P&L is measured against honest protocol, the project does not actually know whether its sole production strategy makes money.

### Risks accepted

- The "1.537 honest Sharpe" baseline could itself be partially inflated by Bucket B z-score lookahead (Issue A). Accepted: even at 0.8-1.0 after that correction, SPY γ 14d single remains the strongest measured edge. Architectural plan unchanged.
- v8 ensemble re-evaluation in 4-8 weeks may still underperform if bespoke features improve non-SPY individual Sharpes but cross-asset correlations remain too high for diversification math. Accepted: if ensemble fails after flywheel matures, the conclusion is "this architecture's ceiling is single-asset α-classifier on SPY," and the project pivots accordingly.
- Production v7 audit may reveal it has been losing money under the broken metrics it was graduated on. Accepted: if true, v7 is rolled back to v6 or paused, and ADR-0024's graduation framework gets a real correction pass.

## Implementation status

- Patcher `V7_BASELINE_LIE_CORRECTED_V1` applied + manual fixup for 5 hardcoded references in lgbm-monolithic-predictor.py and lgbm-per-asset-predictor.py (per-patch sentinel bug — Corrections 1+2)
- `lgbm-predictor.py:301-310` hardcoded portfolio_sim dict deleted (Correction 1)
- Dynamic baseline loader live in lgbm-monolithic-predictor.py, lgbm-per-asset-predictor.py, lgbm-per-asset-aggregator.py, lgbm-v8-portfolio-sim.py (Correction 2)
- Honest non-overlap measurement protocol documented in this ADR (Correction 3)
- v8 ensemble production decision deferred (Correction 4)

Open issues A, B, C captured as sentinels for future investigation.

## References

- ADR-0027: Per-Asset Specialists with Bespoke Features (architectural decision that v8 ensemble was meant to support)
- ADR-0026: Director Graduation Gates (delta_PSR ≥ 0.80, applies to any future v8 graduation)
- ADR-0024: Promoted-Signal Correction (sibling-row pattern for lookahead bugs found post-promotion)
- 2026-05-18 session transcript: `/mnt/transcripts/2026-05-19-02-28-25-sofar-v7-v8-baseline-correction.txt`
