# Experiment Failure Taxonomy — 2026-05-21 Daemon Run

Source: 24 experiments run by overnight-research-daemon.py, 2026-05-21 21:11–~22:20 EDT,
consuming the scout-generated `pending_experiment` queue. Classified from the actual
experiment records (experiments table, decision + decision_reason/error).

## Outcome summary

| Outcome | Count |
|---|---|
| failed (compute crash) | 15 |
| failed (0 values / <500) | 2 |
| code validation failed (missing compute_signal) | 3 |
| failed (empty LLM JSON during codegen) | 1 |
| rejected (ran clean, no Sharpe improvement) | 3 |
| promoted | 1 |

~73% failed before producing a testable result. Only 4 of 24 ran cleanly enough to
reach a gate decision (3 rejected, 1 promoted). The 1 promotion passed on an inflated
backtest Sharpe (5.02 — see Finding 5).

## The key pattern

Signals that crash all touch **NULL-prone fields** (IV/greeks, macro spreads,
cross-asset rate series): vol_skew, macro_vol_dispersion, equity_vol_gamma,
rate_equity_corr, yield_curve_decoupling, pc_vol_iv_divergence, etc.

Signals that RAN cleanly (whether rejected or promoted) are on **complete
price/structure data**: spy_tech_vol_decoupling, spread_autocorr_breakdown,
spy_gap_discontinuity_zscore, spy_macro_vol_relative_zscore.

So failure correlates with the data the signal touches, not with the hypothesis being
unreasonable. The hypotheses are sound; the generated code crashes on missing data it
didn't guard, in the data domains that have gaps.

## Errors classified by fix lever

### Lever A — DATA FILTERING (the dominant fix)
**Errors:** `float(None)` / `len(None)` compute crashes (15 of 24), and the
`0 values / need 500+` cases (2) where over-broad chain selection yields no usable rows.

**Root cause:** Generated signals query the *entire* option chain or a raw field that
contains NULLs (illiquid/deep-OTM IV, sparse greeks), then call `float(r['iv'])` /
`float(r['delta'])` without guarding None. The NULLs are legitimately illiquid contracts
(ThetaData rejects IV with iv_error>50) — data we should *exclude*, not fill.

**Fix:** Signal codegen must filter the chain by **delta band** (e.g.
`WHERE delta IS NOT NULL AND abs(delta) BETWEEN 0.10 AND 0.50`) plus a volume/OI floor.
Delta jointly encodes moneyness × time-to-expiry × underlying vol, so it correctly
selects the liquid chain across both index and high-vol single names (a 5%-OTM contract
is ~2-delta at 1DTE [illiquid] but ~35-delta at 6mo [liquid]). Because delta is NULL in
exactly the rows IV is NULL (same greeks fetch), `delta IS NOT NULL` self-excludes the
illiquid tail. No backfill needed — the liquid chain already has IV (SPY: 9–13K
liquid-ATM-IV rows/month, 12+ months deep, well past the 500-gate).

**Not backfill / not scouting:** the data exists and is sufficient for the liquid chain;
the deep-OTM NULLs are noise we don't want. This is purely a query-the-right-slice fix.

### Lever B — DATA SCOUTING / BACKFILL (needs investigation)
**Errors:** `float(None)` crashes specifically in NON-IV signals — `spy_rate_equity_corr_zscore`,
`spy_yield_curve_return_decoupling`, `spy_macro_spread_vol_divergence`.

**Root cause (to confirm):** these touch macro/rate series (yield curve, rate-equity
correlation). Possible the macro series themselves are sparse or contain placeholder/NULL
values (cf. existing sentinel MACRO_SIGNALS_VIX_LEVEL_YIELD_CURVE_CONSTANT_PLACEHOLDER_V1).
If the rate/macro data has genuine gaps, that's a **data-scouting** target (the data scout
covers FRED — it could detect/route macro gaps) or a **backfill** (FRED history is freely
available and backfillable).

**Open question:** is the None in these signals a missing-data problem (scout/backfill) or
just an unguarded conversion on present-but-occasionally-null data (filtering/codegen)?
Needs: check NULL rates in the macro/rate signal_values these signals read.

### Lever C — CODEGEN (NOT a data problem)
**Errors:** `Missing compute_signal(db) function` (3 of 24), `JSON parse failed / No JSON
object found` (1).

**Root cause:** The LLM signal-codegen produced structurally invalid code (no required
entry-point function) or returned empty/malformed JSON. No data fix addresses these.

**Fix:** (1) Harden the codegen prompt to always emit a valid `compute_signal(db)` and
guard all numeric conversions against None. (2) Add empty-response retry to the codegen
LLM call (same class as the morning-director empty-response bug fixed 2026-05-21,
sentinel DIRECTOR_MORNING_EMPTY_RESPONSE_RETRY_GUARD_V1 — the daemon already retries JSON
once and it sometimes recovers; extend/strengthen). A hand-written reference signal
(prototype) should define the canonical structure + None-handling + delta-filtering for
the codegen prompt to emulate.

### Lever D — NONE (working as intended)
**Outcomes:** 3 rejected ("No Sharpe improvement") + 1 promoted. These ran cleanly and
reached an honest gate decision. No fix needed — this is the pipeline working.

## Finding 5 — graduation gate uses inflated Sharpe (separate issue)
The 1 promotion (`spy_macro_vol_relative_zscore`, an IV-dispersion signal) graduated with
`backtest_sharpe = 5.0244`. That is in the same inflated units established earlier this
session (over-annualized / overlap-violating; honest non-overlap SPY baseline ~1.537).
The *relative* gate ("Sharpe improved +0.0584, ranks #2") may survive a consistent bias,
but the absolute gate is measured in untrustworthy units. The experiment daemon's backtest
gate should use the corrected non-overlap Sharpe.
Sentinel: EXPERIMENT_GRADUATION_GATE_USES_INFLATED_SHARPE_V1.

## Priority of fixes

1. **Codegen hardening (Lever A + C)** — highest leverage. None-guards + delta-band chain
   filtering + valid-structure enforcement in the signal-codegen prompt would address
   ~18 of 24 failures (the 15 compute crashes + 2 zero-value + structural). Build a
   hand-written reference signal first (prototype) as the template.
2. **Graduation-gate Sharpe correction (Finding 5)** — so graduations mean something.
3. **Macro/rate data gap check (Lever B)** — confirm whether the non-IV None crashes are
   missing data (scout/backfill) or just unguarded codegen; fix accordingly.

## Sentinels referenced / proposed
- VOL_SKEW_SIGNAL_CODEGEN_NEEDS_DELTA_BAND_FILTER_V1 (Lever A)
- EXPERIMENT_SIGNAL_CODEGEN_NONE_UNGUARDED_AND_INVALID_STRUCTURE_V1 (Lever A+C)
- EXPERIMENT_GRADUATION_GATE_USES_INFLATED_SHARPE_V1 (Finding 5)
- OPTIONS_IV_NULL_FOR_ILLIQUID_CONTRACTS_BY_DESIGN_V1 (data context: NULLs are illiquid tail, not a bug)
- MACRO_SIGNALS_VIX_LEVEL_YIELD_CURVE_CONSTANT_PLACEHOLDER_V1 (existing; relevant to Lever B)
