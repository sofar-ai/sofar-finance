# ADR-0025: Sandbox-version signal validator built on daemon's canonical validate_signal

**Date:** 2026-05-10
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0001 (three-database split), ADR-0004 (quant-research pause), ADR-0011 (verify schema before write), ADR-0020 (signal-graduation source-agnostic), ADR-0022 (SOFAR ML pipeline architecture), ADR-0023 (promotion executor), ADR-0024 (promoted-signal correction via sibling experiment row)
**Sentinel:** `EXPERIMENT_SANDBOX_VALIDATIONS_TABLE_V1`

---

## Context

ADR-0023's promotion executor backfills sandbox `signal_values` into `market.signal_values` under non-production `signal_version` strings (e.g. `v_research_002`). ADR-0024's sibling-experiment pattern can produce `experiments` rows whose `backtest_sharpe` is intentionally `NULL` pending re-validation.

Both leave a gap: **what is the Sharpe of a sandbox-backfilled signal when evaluated by the daemon's canonical walk-forward methodology?**

The daemon's `validate_signal(signal_values, signal_name, ticker="SPY")` in `overnight-research-daemon.py` is the canonical methodology. It implements a 133-feature LightGBM walk-forward (`CHAMPION_FEATURES` baseline vs `+ new signal` enhanced, train on years < test_year, evaluate on test_year, concatenate pnls, compute Sharpe/accuracy/profit-factor/feature-importance). It is what produced every `experiments.backtest_sharpe` number in the database. It is what the daemon would use to validate a future promoted signal.

What the daemon's `validate_signal` could *not* do, as written: validate against signal_values from a sandbox version. The hardcoded `signal_version='v1.0'` at line 584 governs which **champion baseline** the function reads. But — and this is the critical insight from the 2026-05-10 audit — `validate_signal`'s **first argument** is `signal_values`, a list of `(date, value)` tuples for the *experimental* signal. The function does not query the experimental signal from any database; it accepts whatever the caller passes in. The hardcoded `'v1.0'` only governs the baseline champion features.

This means: a validator that calls `validate_signal` with experimental signal_values read from a sandbox version, against the daemon's same v1.0 champion baseline, gets a directly-comparable Sharpe number — without any modification to the daemon.

## Decision

**Build a standalone operator-invoked validator script that imports the daemon's `validate_signal` unchanged and uses it to compute walk-forward metrics for sandbox-backfilled signals. Store results in a dedicated table in the research DB.**

Three concrete pieces:

1. **No daemon refactor.** `overnight-research-daemon.py` is unchanged. The function `validate_signal` is the canonical methodology and stays the canonical methodology; we delegate to it.

2. **Symlink for clean importing.** `overnight_research_daemon.py → overnight-research-daemon.py` so Python can import (no dashes in module names). The daemon has no module-level side effects (audited 2026-05-10), so import is safe.

3. **Validator script.** `~/scripts/validate-sandbox-signal.py`:
   - Takes `--experiment-id` and `--target-version` (e.g. `v_research_002`)
   - Reads `(date, value)` rows from `market.signal_values` for that name+version+ticker
   - Calls `daemon.validate_signal(rows, signal_name, ticker)` — uses production v1.0 baseline features unchanged
   - Writes the returned metrics to `research.experiment_sandbox_validations`

4. **Results table.** `research.experiment_sandbox_validations` with columns mirroring the structure of `validate_signal`'s return dict (baseline_*, enhanced_*, *_delta, new_signal_*, validation_days, provisional, computed_at, validator_version, full_results_json). `UNIQUE (experiment_id, target_version, validator_version)` permits intentional re-validation by bumping `validator_version`, while preventing accidental overwrites.

5. **Methodology is fully delegated.** No methodology drift is possible by construction: the validator does not reimplement walk-forward logic, does not duplicate LightGBM hyperparameters, does not maintain its own copy of CHAMPION_FEATURES. If the daemon's methodology changes, the validator follows automatically on the next call.

## Implementation timing

Built and first-run completed during the 2026-05-10 session. Seven validations of sandbox-backfilled signals in `v_research_002` against production v1.0 baseline:

- 6 daemon-promoted signals: sandbox-validated Sharpe consistent with original at ~+1.4% systematic drift (likely baseline feature evolution between original promotion in mid-April and re-validation today)
- 1 manual-correction sibling (`spy_qqq_corr_zscore_v2`): first-ever measured Sharpe; sharpe_delta of +0.0176, below the daemon's MIN_SHARPE_IMPROVEMENT threshold of 0.05

## Empirical findings from the first batch

The first-batch results validate the architecture and surfaced one substantive finding worth recording in the ADR rather than just the handoff:

**Sandbox vs original Sharpe drift is systematic, not signal-specific.** All 6 daemon-promoted signals show sandbox-Sharpe ~1.4-1.5% above their original-promotion Sharpe. This tightness rules out signal-specific reproduction issues and points to systematic factors:
- Champion baseline features have accumulated ~3 weeks of new market data since original promotions in mid-April
- Some champion signals may have been backfilled or corrected in that window
- Walk-forward test sets have ~15 additional trading days each, with recent regime apparently favorable

The drift is **not** evidence that the executor failed to faithfully reproduce promotion-time output. The signal values themselves are bit-for-bit reproductions of what `compute_signal(db)` returns for each date (audited 2026-05-09). The drift comes from the baseline (the other 133 features) evolving underneath the test.

This is an important framing for future graduation decisions: sandbox-Sharpe is the Sharpe *today*, not a frozen Sharpe-at-promotion-time. Graduation criteria should compare against the same-day baseline.

**The spy_qqq_corr_zscore_v2 finding is the strongest single result.** The corrected sibling produced by ADR-0024 (lookahead bias removed) was measured at sharpe_delta = +0.0176 — far below the daemon's MIN_SHARPE_IMPROVEMENT threshold of 0.05. The original buggy version, with its 20-day forward leak, had backtest_sharpe = 5.1966 (highest of all 7). **Removing the lookahead removed almost all of the signal's apparent predictive edge.**

This is empirical validation of the audit finding from ADR-0024. Had the original spy_qqq_corr_zscore been backfilled to v_research_002 and used to train a future sandbox lgbm, that lgbm would have learned a feature whose Sharpe was largely an artifact of forward data leakage. The audit caught it; ADR-0024 created the correction path; ADR-0025 measured the corrected reality.

Note that the corrected signal still ranks #3 of 134 in feature importance — there's some residual information value in SPY-QQQ correlation regime. Just much less than the leaked version implied. Whether the signal is worth keeping in the sandbox vs. removing entirely is a judgment for future graduation criteria, not for this ADR.

## Consequences

### Positive

- **Canonical methodology preserved.** validate_signal is the source of truth; the validator delegates to it. Zero risk of methodology drift between daemon evaluation and sandbox evaluation.
- **No daemon modifications required.** The daemon stays exactly as written. When/if it unpauses (per ADR-0004 it is currently paused; cron entries are QR-PAUSED'd in bot1's crontab; no systemd service active), its behavior is unchanged.
- **Operator-invoked, not cron'd.** Sandbox validation is a deliberate human-driven check, not an autonomous loop. This matches the post-pause project disposition where automated decisions are deferred until review gates are robust.
- **Audit trail in research.experiment_sandbox_validations.** Every validation is timestamped, versioned, and has its full result captured as JSONB for post-hoc analysis. UNIQUE constraint prevents silent re-validation; bumping `validator_version` is explicit.
- **The seven-row table is now the project's source of truth for "what is each v_research_002 signal worth?"** Replaces the implicit assumption that `experiments.backtest_sharpe` answers that question (it doesn't — it reflects an evaluation at promotion time against a then-current baseline).

### Negative

- **Validator imports the daemon module.** This couples the validator's correctness to the daemon's module-load-time behavior staying side-effect-free. If a future daemon edit adds module-level statements that fail at import time, the validator breaks too. Mitigation: the daemon's top has been audited and is clean; any future module-level addition should be flagged in code review.
- **Symlink fragility.** The `overnight_research_daemon.py → overnight-research-daemon.py` symlink can be accidentally broken by aggressive file ops. Mitigation: ls'd and tested at session end; future failures would surface immediately on next validator invocation. Worth noting in future deploy automation.
- **No re-validation policy yet.** The UNIQUE constraint requires explicit `validator_version` bumps for re-runs. We have no convention for when to bump or what the version means semantically. First convention proposed: bump to `v1.1` if validate_signal behavior changes; keep at `v1.0` if only the baseline data has evolved. Refine when we have a second batch to compare.

### Risks accepted

- The validator could be invoked against the wrong target_version, silently producing meaningless results (e.g. comparing v_research_002 sandbox features against a v_research_003 expected baseline that doesn't exist). Mitigation: the validator validates input row existence and exits cleanly if no rows match; the operator confirms target_version at command line.

## Out of scope (deferred)

- **Re-decision logic for the director against sandbox-validated Sharpe.** The director currently decides promote/reject based on `experiments.backtest_sharpe`. Whether the director should consult `experiment_sandbox_validations.enhanced_sharpe` when present is a separate ADR. The director-evening / director-morning scripts (`research-director-{evening,morning}.py`) are the relevant entry points; modifying them is non-trivial.
- **Auto-graduation from sandbox to v1.0.** If a sandbox-validated signal exceeds graduation criteria (TBD: probably both `sharpe_delta > 0.05` AND consistent over multiple validation runs), promoting it to `signal_version = 'v1.0'` in production market.signal_values is the next stage. Not implemented; not even spec'd. Probably requires the daemon's unpause and a real graduation ADR.
- **Real-time daemon-sandbox mode.** Having the daemon itself, during overnight runs, evaluate against sandbox versions rather than v1.0 is conceptually distinct from this validator. It would require the parameter refactor I initially proposed (`target_version` arg on `validate_signal`). It's not necessary for the validator and not necessary for the next obvious project steps. Defer indefinitely.
- **Multi-ticker validation.** The validator currently defaults to SPY and supports `--ticker` override, but the daemon's `validate_signal` itself hardcodes some SPY-specific assumptions (e.g. CHAMPION_FEATURES is the SPY 133-signal champion set, not a per-ticker champion). Multi-ticker is a daemon-level question, not a validator-level question.
- **Sklearn UserWarning cleanup.** The daemon's `validate_signal` produces ~44 sklearn "X does not have valid feature names" warnings per validation (1 per fit/predict pair, ~22 walk-forward years × baseline+enhanced models). Cosmetic only — the warning is wrong about there being a problem. Worth fixing on the daemon side with a 2-line change at some future point, but not in scope here.

## References

- `/home/bot1/scripts/overnight-research-daemon.py` lines 571-748 — `validate_signal` definition (canonical methodology)
- `/home/bot1/scripts/validate-sandbox-signal.py` — new validator script (this ADR's implementation)
- `/home/bot1/sofar-finance/migrations/20260510-experiment-sandbox-validations.sql` — table creation
- ADR-0023 (executor that backfilled v_research_002) and ADR-0024 (sibling-experiment correction pattern; produced spy_qqq_corr_zscore_v2)
- 2026-05-10 session: first 7 validations recorded, results recorded in this ADR's "Empirical findings" section
