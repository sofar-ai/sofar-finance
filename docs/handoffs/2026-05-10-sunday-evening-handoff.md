# 2026-05-10 Sunday evening — session handoff

**Author:** bot1 (with Claude)
**Session focus:** From paused-quant-pipeline executor v1 ship to seven-signal sandbox-validation result with ADR-0024 + ADR-0025 architecture.

---

## TL;DR for next session

Three milestones reached today:
1. **Executor v4 shipped** — daemon-matching execution environment (ambient imports + safe_db semantics + NaN-drop filter + diagnostics surfacing). Committed to sofar-scripts as `7b1d417`.
2. **7 of 7 promoted-or-corrected signals backfilled** into `market.signal_values WHERE signal_version='v_research_002'`. 55,028 rows total. All verified faithful per audit + validator.
3. **Sandbox-validation pipeline live.** `experiment_sandbox_validations` table in research holds 7 validated rows. spy_qqq_corr_zscore_v2 measured at sharpe_delta=+0.0176 (below daemon's 0.05 threshold) — **empirical confirmation that ADR-0024's lookahead correction was justified.** The 6 daemon-promoted signals show systematic ~+1.4-1.5% sandbox-Sharpe drift vs original-promotion Sharpe (baseline-feature evolution since mid-April, NOT signal-specific reproduction issues).

Two new ADRs: 0024 (promoted-signal correction via sibling experiment) and 0025 (sandbox-version signal validator). One new table in research: `experiment_sandbox_validations`. One operator-invoked script: `~/scripts/validate-sandbox-signal.py`. One symlink: `overnight_research_daemon.py → overnight-research-daemon.py` (no daemon code modified).

---

## Path C completion: 7 of 7 signals backfilled

Yesterday's handoff left 5 signals queued for processing under v2 executor + 2 already shipped under v2. Today we discovered v2 was incomplete (missing daemon execution-environment match) and built v3 → v4 to fix it. End state:

| signal_name | experiment_id | rows | notes |
|---|---|---|---|
| spy_vol_price_coherence | exp-2d9fe66c | 8105 | original v2 ship, verified bit-for-bit identical under v4 |
| spy_momentum_vol_decoupling | exp-637ea968 | 8335 | original v2 ship, verified bit-for-bit identical under v4 |
| spy_atr_vol_of_vol | exp-74f70fc3 | 8336 | shipped today under v4 |
| spy_bond_vol_lead_ratio | exp-bc010c0e | 8237 | shipped under v2 (8287 rows), found divergent from daemon, DELETE'd, re-shipped under v4 (8237 rows). 4 NULL spread_10y_3m + 50 affected window rows correctly dropped per `if not (val_f != val_f)` daemon convention. |
| sp_vol_atr_divergence_zscore | exp-7873c54d | 8296 | needed v4's ambient `math` import (original signal_code used `math.sqrt` without `import math`; original promotion only worked because daemon's wrapper provided ambient `math`) |
| spy_atr_spread_vol_divergence | exp-45018ace | 6966 | treasury_rates LEFT JOIN with 64 missing dates × 20-day window-shadow = ~1300 row reduction. Faithful — daemon would have produced same count. |
| spy_qqq_corr_zscore_v2 | exp-72d528e3-fixed-v1 | 6753 | ADR-0024 manual_correction sibling. Original (exp-72d528e3) downgraded to `decision='rejected'` with supersession reason. Backfill faithful under v4. |

55,028 rows total. **Audit of all 6 shipped signals' date attribution: 5/5 daemon-promoted have correct end-of-window date labeling; spy_qqq_corr_zscore is the only original with the lookahead bug; the corrected sibling has correct attribution by construction.**

Original spy_qqq_corr_zscore (exp-72d528e3) is in experiments as a preserved historical artifact: `decision='rejected'`, `source='overnight_daemon'`, decision_reason describes the supersession. Sibling (exp-72d528e3-fixed-v1): `decision='promoted'`, `source='manual_correction'`, `parent_experiment_id='exp-72d528e3'`, `backtest_sharpe=NULL`.

---

## Executor v4 — what changed and why

v1 (yesterday) ran promoted signal_code in a minimal subprocess: `exec(signal_code, ns={})` with a raw psycopg2 cursor as `db`. That worked for signals whose code is fully self-contained and queries only non-nullable columns.

But the daemon's wrapper (audited today; lives in `compute_signal_sandboxed` around lines 470-560 of overnight-research-daemon.py) provides a richer environment:
- Ambient imports: `sys`, `math`, `numpy as np`, `from datetime import date, timedelta`, `from collections import defaultdict`
- `safe_db()` wrapper: converts `Decimal → float` and `None → float('nan')` before signal_code sees rows
- NaN drop filter at output: `if not (val_f != val_f)` — daemon's wrapper drops NaN entries before returning

For ADR-0023 "faithful reproduction" to mean anything, our executor's subprocess needed to match this environment exactly. v4 does:
1. Subprocess imports `math`, `date`, `timedelta`, `defaultdict`, `numpy as np`, `Decimal` ambiently
2. Namespace `ns` for `exec(signal_code, ns)` pre-populated with those names
3. `db()` adapter performs Decimal→float, None→nan
4. Output normalization drops NaN values and emits diagnostic JSON on stderr
5. Parent process parses stderr-on-success and surfaces diagnostics in dry-run output

The 4 originally-shipped signals (spy_vol_price_coherence, spy_momentum_vol_decoupling, spy_atr_vol_of_vol, spy_bond_vol_lead_ratio) were re-dry-run under v4 to verify. 3 produce bit-for-bit identical output (their signal_code doesn't reference ambient names). 1 (spy_bond_vol_lead_ratio) produced different output: 8237 rows under v4 vs 8287 under v2. The v2 output was incorrect; the daemon's wrapper would have produced 8237 (faithful to daemon). DELETE + re-COMMIT applied. **This is the strongest piece of evidence that v4 was needed.**

`SENTINEL: EXECUTOR_FAITHFULNESS_REQUIRES_DAEMON_WRAPPER_PARITY_V1` — name this if substrate doesn't already create it from the ADR-0023 reference.

---

## ADR-0024 — promoted-signal correction via sibling experiment row

Established the pattern for handling defects found in already-promoted signal_code. Triggered by today's audit catching the lookahead-bias in spy_qqq_corr_zscore.

Pattern: don't modify the original experiments row. Insert a sibling with `parent_experiment_id` pointing at original, new `signal_name=<orig>_v2`, corrected signal_code, `source='manual_correction'`, `decision='promoted'`. Mark original `decision='rejected'` with supersession reason. Backtest_sharpe NULL on sibling (corrected signal hasn't been daemon-validated).

**Status: accepted today** (was proposed at ADR draft time; flipped after first instance executed cleanly). Sibling for spy_qqq_corr_zscore created and backfilled — `apply-qqq-correction.py` (sha `593c5d65...`) handled the INSERT+UPDATE transaction with explicit operator confirmation.

The diff vs original: single-character change `valid_dates[i-20]` → `valid_dates[i-1]` in the correlation loop. Original labeled correlation values with the **start** date of the 20-day window (20-day lookahead bias). Corrected labels with the end. Comment in corrected signal_code documents the fix.

---

## ADR-0025 — sandbox-version signal validator

Built today, ADR filed today (option 3: implementation first, ADR last with empirical results included).

**Key insight from audit:** daemon's `validate_signal(signal_values, signal_name, ticker)` accepts experimental signal values as a parameter. The hardcoded `'v1.0'` at line 584 only governs the **champion baseline** features. So a validator that reads experimental rows from sandbox versions and passes them in directly to validate_signal gets a comparable Sharpe — no daemon refactor needed.

Architecture:
- `~/scripts/overnight_research_daemon.py` — symlink to the dashed-named daemon (for clean Python import)
- `~/scripts/validate-sandbox-signal.py` — operator-invoked validator. Reads market.signal_values for (signal_name, target_version, ticker), calls `daemon.validate_signal(rows, ...)`, writes to research.experiment_sandbox_validations.
- `research.experiment_sandbox_validations` — results table. 23 columns + id PRIMARY KEY (so 24 total per pg_attribute). UNIQUE on (experiment_id, target_version, validator_version) enables intentional re-validation with explicit version bumps.

Validator runtime: ~9-10 seconds per signal (load market data + 22 walk-forward LightGBM year-folds + write). Tolerable for operator-driven invocation.

`SENTINEL: EXPERIMENT_SANDBOX_VALIDATIONS_TABLE_V1` — captured in ADR.

---

## First-batch validation results (all 7 written to research.experiment_sandbox_validations)

| id | signal | baseline | enhanced | Δ | new_rank | orig | drift |
|---|---|---|---|---|---|---|---|
| 1 | spy_vol_price_coherence | 4.8352 | 5.0390 | +0.2039 | #2 | 4.9632 | +1.53% |
| 2 | spy_momentum_vol_decoupling | 4.8177 | 5.0327 | +0.2150 | #2 | 4.9568 | +1.53% |
| 3 | spy_atr_vol_of_vol | 4.9073 | 4.9869 | +0.0796 | #2 | 4.9172 | +1.42% |
| 4 | spy_bond_vol_lead_ratio | 4.6728 | 5.0336 | +0.3608 | #3 | 4.9629 | +1.42% |
| 5 | sp_vol_atr_divergence_zscore | 4.8141 | 5.0553 | +0.2412 | #3 | 4.9860 | +1.39% |
| 6 | spy_atr_spread_vol_divergence | 5.1855 | 5.4288 | +0.2433 | #5 | 5.3502 | +1.47% |
| 7 | **spy_qqq_corr_zscore_v2** | **4.7495** | **4.7671** | **+0.0176** | #3 | NULL | — |

**Two real findings:**

1. **Systematic ~1.4-1.5% sandbox-Sharpe drift across all 6 daemon-promoted signals.** Tightness rules out signal-specific issues — points to baseline (champion feature) evolution between mid-April promotion and today's re-validation. Three additional weeks of market data + possible champion-signal backfills + recent regime favorable. This is good: it confirms executor faithfulness in the signal-specific contribution (sharpe_delta), while explaining the absolute-Sharpe shift via a non-signal-specific cause.

2. **spy_qqq_corr_zscore_v2 sharpe_delta = +0.0176 is below the daemon's MIN_SHARPE_IMPROVEMENT = 0.05.** The original (buggy) version had backtest_sharpe = 5.1966 — highest of all 7. **Removing the 20-day lookahead removed almost all of the apparent predictive edge.** Empirical validation that the audit + ADR-0024 correction was justified. Had we shipped the lookahead-biased version, a future sandbox lgbm trained on v_research_002 would have learned a feature whose Sharpe was mostly forward-data-leak.

The corrected signal still ranks #3 of 134 in feature importance — there's some residual information. Just not Sharpe-actionable on its own. Decision deferred: whether to remove from v_research_002 entirely, leave it in, or promote conditional on multi-signal combinations.

---

## Schema migrations applied today

1. **`research.experiment_sandbox_validations`** — created via `/home/bot1/sofar-finance/migrations/20260510-experiment-sandbox-validations.sql`. 24 columns total. UNIQUE (experiment_id, target_version, validator_version). Verified via `pg_attribute` on consumer connection path (per yesterday's sentinel about information_schema not being tight enough).

---

## New scripts

1. **`~/scripts/promotion-executor.py`** (v4, sha `7b1d417`) — daemon-matching execution environment. Committed to sofar-scripts master.
2. **`~/scripts/apply-qqq-correction.py`** (sha `593c5d65a2c57342a547957aee3342a54f387147dca076909effae7680862542`) — one-off operator-invoked script that applied ADR-0024 pattern for spy_qqq_corr_zscore. Embedded corrected signal_code as a string for verification + INSERT. Not committed to git (one-off); preserved on filesystem at /home/bot1/scripts/apply-qqq-correction.py.
3. **`~/scripts/validate-sandbox-signal.py`** — operator-invoked sandbox validator per ADR-0025. NOT YET COMMITTED to sofar-scripts.
4. **`~/scripts/overnight_research_daemon.py`** — symlink to overnight-research-daemon.py. NOT YET COMMITTED.

**Pending commit to sofar-scripts:** validate-sandbox-signal.py and the symlink. Migration SQL file at /home/bot1/sofar-finance/migrations/20260510-experiment-sandbox-validations.sql also pending commit to sofar-finance.

---

## Sentinels filed or relevant this session

- `EXPERIMENT_SANDBOX_VALIDATIONS_TABLE_V1` — in ADR-0025 (new)
- `PROMOTED_SIGNAL_CORRECTION_VIA_SIBLING_EXPERIMENT_V1` — in ADR-0024 (filed yesterday, status flipped to accepted today after first execution)
- `SYSTEM_CATALOG_QUERIES_REQUIRE_EXPLICIT_DB_PARAM_V1` — proposed new sentinel. Pattern: db.py's auto-router has no rule for pg_attribute / information_schema / pg_tables, so they fall through to _DEFAULT_DB (production). Verifying DDL changes after migration requires `db=<target>` explicitly. Hit twice in two days (yesterday: executor migration verify; today: experiment_sandbox_validations migration verify).
- `EXECUTOR_FAITHFULNESS_REQUIRES_DAEMON_WRAPPER_PARITY_V1` — proposed new sentinel. v2 executor's minimal subprocess produced different signal_values output than daemon's wrapper for any signal that relies on ambient imports OR queries nullable columns. v4 matches daemon wrapper exactly. ADR-0023's "faithful reproduction" required this match; the original ship didn't articulate it explicitly.
- `SIGNAL_CODE_DATE_ATTRIBUTION_AUDIT_PATTERN_V1` — proposed new sentinel. The audit pattern that caught spy_qqq_corr_zscore's lookahead bug: for each rolling-window signal, verify the date appended to results is the END of the window (not the START). Pattern is checkable mechanically by inspecting `<list>_dates.append(<datelist>[i-X])` constructions in signal_code.
- `SUBSTRATE_ADRS_PENDING_INGEST_V1` — substrate only knows through ADR-0022 as of session start. ADRs 0023, 0024, 0025 are committed but not yet extracted. The extract_adrs.py cron handles this nightly; can be triggered manually if substrate visibility needed earlier.

---

## What's still PENDING after this session

Real action items:

1. **Commit `validate-sandbox-signal.py` + the daemon symlink to sofar-scripts.** Symlink can go in as a real symlink in git — they're supported, just need `git add` to record them as such. Validator script straightforward git add.
2. **Commit the migration SQL to sofar-finance.** `/home/bot1/sofar-finance/migrations/20260510-experiment-sandbox-validations.sql` exists on disk; needs git add + commit + push.
3. **Substrate ingest for new ADRs.** ADR-0023, 0024, 0025 + this handoff. Run extract_adrs.py + extract_handoffs.py manually if substrate visibility wanted before next cron. Otherwise nightly cron handles it.
4. **Decision on spy_qqq_corr_zscore_v2.** Its sharpe_delta is below daemon's promotion threshold (0.05). Three options for the sandbox state: (a) leave it in v_research_002 indefinitely; (b) DELETE its 6753 rows since they're below-threshold; (c) leave it in but flag for the future sandbox lgbm training to exclude it. Not urgent. Worth discussing fresh.
5. **Consider running the validator with non-v_research_002 target_version** when other sandbox versions exist. The validator is generic; v_research_002 is just the first sandbox.

Deferred / longer-horizon:

6. **Director re-decision logic against sandbox-validated Sharpe.** Currently director scripts (`research-director-evening.py`, `-morning.py`) consult `experiments.backtest_sharpe`. Whether they should consult `experiment_sandbox_validations.enhanced_sharpe` is its own ADR. Note director cron is ACTIVE per yesterday's crontab paste (16:30 and 07:30 weekdays).
7. **Auto-graduation from sandbox to production v1.0.** Not even spec'd. Wait until we have a second batch (or daemon unpause) to think about this.
8. **Real-time daemon-sandbox mode** (the `target_version` parameter refactor I initially proposed and walked back from). Not necessary for any current workflow. Defer indefinitely.
9. **Sklearn UserWarning cleanup in daemon's validate_signal.** Cosmetic. 2-line fix at the daemon level. Not in scope.
10. **macmini migration of 24/7 crons.** Operator noted at session start they want to migrate cron-driven scripts to macmini. Director scripts and the eventually-unpaused research daemon would be in scope. No timeline.

---

## Operator notes carried forward

- macmini is the new workstation; future home for cron scripts. Currently running ssh from there into spark-cfbd. (Filed.)
- Renaissance disposition = methodological, deliberate, alpha-generating. Not literal Renaissance-Technologies process speculation. (Filed; corrected mid-session.)
- Heredoc > `python3 -c` for multi-line Python from chat (paste indentation issues).
- `git-safe.sh` is the only commit-push path. 2-minute auto-push cron exists.
- Three DBs are real and separate. They are not the same DB; this loop should not recur. ("DUDE EVERY FUCKING NIGHT" — explicit operator correction from this session.)
- Audit before patch. When tooling produces uniform/surprising results, suspect tooling before reality.
- Renaissance push: when assistant is being over-conservative on an architectural call, operator can push back; the smaller / lazier path isn't always the right one. (vs. "do the right thing — sometimes that's smaller" — both apply.)
- The validator's faithful reproduction is **structural** (subprocess exec's literal signal_code) plus **environmental** (v4 matches daemon's wrapper). Not statistical. The +1.4-1.5% drift across all 6 daemon-promoted signals is a baseline-evolution finding, not a faithfulness finding.

---

## Files SCP'd this session

(all from mac2 → spark-cfbd, all SHA256-verified post-transfer per session log)

- `promotion-executor.py` v4 → `/home/bot1/scripts/promotion-executor.py` (sha `7719af952...`)
- `0024-promoted-signal-correction.md` → `/home/bot1/sofar-finance/docs/adr/` (sha `2da6b8900...`)
- `apply-qqq-correction.py` → `/home/bot1/scripts/` (sha `593c5d65a...`)
- `20260510-experiment-sandbox-validations.sql` → `/home/bot1/sofar-finance/migrations/` (sha `9da05111b...`)
- `validate-sandbox-signal.py` → `/home/bot1/scripts/` (final sha `8649f37c6...`)
- `0025-sandbox-version-signal-validator.md` → `/home/bot1/sofar-finance/docs/adr/` (sha `1ddf5c01e...`)

---

## Git commits this session

In sofar-scripts (master):
- `7b1d417` — EXPERIMENT_PROMOTION_NO_ACTION_LAYER_V1: executor v4 - daemon-matching execution environment

In sofar-finance (main):
- `269b3a8a5` — ADR-0023: flip status to accepted
- `a6201b92c` — PROMOTED_SIGNAL_CORRECTION_VIA_SIBLING_EXPERIMENT_V1: ADR-0024
- `a5b0c0533` — EXPERIMENT_SANDBOX_VALIDATIONS_TABLE_V1: ADR-0025

(Pending: validator + symlink commits to sofar-scripts; migration SQL commit to sofar-finance.)

---

## Next-session direction: B then A

Two real paths after today's work, sequenced as B → A.

**B — downstream graduation + director re-decision (1-2 sessions):**
- ADR-0026 candidate: graduation criteria. When does a sandbox-validated
  signal earn promotion from `v_research_NNN` to production `v1.0`?
  Concrete data exists — the 7 rows in
  `research.experiment_sandbox_validations`. Test candidate rules against
  the real data: likely 5 of 6 daemon-promoted signals would pass naive
  criteria (sharpe_delta > 0.05 AND new_signal_rank ≤ 5 AND validation_days
  ≥ 2000); spy_qqq_corr_zscore_v2 (+0.0176 delta) would not — which is
  the right answer.
- ADR-0027 candidate (or amendment to 0026): director re-decision. The
  director scripts (`~/scripts/research-director-{evening,morning}.py`)
  currently consult `experiments.backtest_sharpe`. Should consult
  `experiment_sandbox_validations.enhanced_sharpe` when present. Note
  director cron is ACTIVE at 16:30 and 07:30 weekdays — modifying these
  is a live change, not a paused-codebase edit.
- Implementation of graduation logic + director updates.

**A — upstream quant-research-scout v2 completion (2-3 sessions):**
- Per `docs/specs/quant-research-scout-v2-design.md` (May 3, locked design),
  the v2 scout is a partial skeleton at `~/scripts/quant-research-scout-v2-wip.py`.
  Phase 2 (corpus query) is implemented; phases 1, 3, 4 are stubs raising
  NotImplementedError.
- Phase 1 (plan, small model qwen3.6:35b-a3b, ~15s wall): ~1-2h to
  implement and smoke-test.
- Phase 4 (reflect, small model, ~5s wall): ~30-60min.
- Phase 3 (synthesize, frontier qwen3:235b on mac1, ~90s wall):
  ~2-4h with iteration on the prompt. This is the phase that produces
  hypotheses with cited_doc_ids — the grounding contract per ADR-0014
  §6 / `HYPOTHESIS_GROUNDING_REQUIRED_V1`. Hardest piece.
- Integration glue, scout_runs lifecycle, grounding validation, INSERT
  with cited_doc_ids: ~2h.
- Un-pause scrapers v2 in cron, smoke-test full upstream flow into
  observations + documents.
- Eventually un-pause overnight-research-daemon.py per ADR-0004 once
  hypothesis quality has improved. ADR-0004's pause condition was
  partly waiting on grounding-required-V1; A closes that.

**Rough total scope:** B is ~1-2 sessions, A is ~2-3 sessions, full
closed-loop pipeline ~3-5 sessions out. Today's work (executor v4 +
sandbox validator + ADRs 0024/0025) was the action-layer half. B closes
the consumer side. A closes the producer side. Both are required for
the closed loop ADR-0004 paused.

Sentinels worth filing if not auto-extracted from these blocks:
`GRADUATION_CRITERIA_NEEDED_V1` (B's anchor),
`SCOUT_V2_PHASES_1_3_4_NOTIMPLEMENTED_V1` (A's anchor).

