# ADR-0024: Promoted-signal correction via sibling experiment row

**Date:** 2026-05-10
**Status:** proposed
**Deciders:** bot1
**Related:** ADR-0023 (promotion executor — establishes hash-pinning anti-mutation discipline), ADR-0001 (three-database split — sibling rows go in research), ADR-0005 (sentinel conventions)
**Sentinel:** `PROMOTED_SIGNAL_CORRECTION_VIA_SIBLING_EXPERIMENT_V1`

---

## Context

ADR-0023 shipped the promotion executor in early May 2026. The executor's review-gate enforces strong anti-mutation discipline via sha256 hash-pinning on `experiments.signal_code` — any change to a promoted row's `signal_code` between approval and execution forces re-review by design. This is correct behavior for defending against silent drift, supply-chain attack, or accidental mutation of artifacts that have already passed the director's promotion decision.

What ADR-0023 did not specify: **what does the project do when a promoted signal is found defective post-promotion?**

This question moved from hypothetical to concrete during the executor's first batch run (2026-05-09 to 2026-05-10). Of the 7 signals in `experiments WHERE decision='promoted'` at session start, 6 had correct date attribution in their `signal_code` and were faithfully backfilled into `signal_values v_research_002`. One — `spy_qqq_corr_zscore` (`exp-72d528e3`) — was found during pre-approval code review to have a 20-day lookahead bias: rolling-window correlations were labeled with the start date of their window rather than the end date, attributing 20 trading days of forward information to each signal value.

The original `backtest_sharpe` for `exp-72d528e3` was 5.1966 — the highest of the 7 promoted signals. That number reflects the lookahead bug; if the signal were corrected and re-validated by the daemon, the resulting Sharpe might be substantially lower (the lookahead would have inflated the apparent predictive power). At minimum it is no longer the daemon-validated Sharpe of the corrected signal.

ADR-0023's discipline rules out the obvious quick path: do not modify `experiments.signal_code` in place to "fix the bug," because that breaks the hash-pinning gate, breaks the audit trail of what the director promoted, and silently substitutes a different artifact than what was reviewed and approved.

This ADR establishes the pattern for the not-quick path.

## Decision

**When a promoted signal is found defective post-promotion, the project inserts a sibling experiment row with corrected `signal_code` rather than modifying the original.**

Concretely, when defect is found in `experiments.signal_code` for a row with `decision='promoted'`:

1. **Do not modify the original row's `signal_code`.** The original artifact stays exactly as the director saw and decided on it. Hash-pinning gate stays intact for any audit query that revisits the original.

2. **Insert a new `experiments` row** with the following shape:
   - `experiment_id` — new identifier following the convention `<original_experiment_id>-fixed-vN` (e.g. `exp-72d528e3-fixed-v1`). Subsequent corrections of the same lineage increment N.
   - `signal_name` — new name following the convention `<original_signal_name>_v<N+1>` (e.g. `spy_qqq_corr_zscore_v2`). Distinguishes from the original in `signal_values` (UNIQUE constraint is on `(date, signal_name, signal_version, ticker)`, so same-name same-version would collide).
   - `parent_experiment_id` — set to the original's `experiment_id`. Foreign-key trail.
   - `signal_code` — the corrected source.
   - `hypothesis` — copy from original plus a fix note appended.
   - `rationale` — describes the defect and the fix.
   - `source` — `'manual_correction'`. Distinguishes from `'overnight_daemon'` and any other automated source. Allows the executor and downstream consumers to filter, route, or warn on manual-correction siblings if needed.
   - `decision` — `'promoted'`. Manual promotion of the sibling is acceptable because the correction is operator-authored and the deviation from the original is the exact, well-understood bug fix.
   - `decision_reason` — describes the manual promotion: "Manual correction of <defect> in parent exp-XXX. Awaiting daemon re-validation."
   - `decision_at` — `now()` at insert time.
   - `created_at` — `now()` at insert time.
   - `backtest_sharpe`, `backtest_accuracy`, `cpcv_*`, `vs_baseline_*` — **left NULL**. The original's metrics reflected the buggy code and are not transferable to the corrected sibling. The corrected sibling's true Sharpe is unknown until daemon re-validation (see "Out of scope" below).
   - Other columns inherited from the original where they remain meaningful (`ticker`, `timeframe`, `date_range_start`, `date_range_end`, `signal_version`).

3. **Mark the original row `decision='rejected'`** with `decision_reason` describing the supersession. Use existing decision taxonomy rather than inventing new states (no `'superseded'` value). The original is preserved in the table with full history; it just no longer appears in the executor's `WHERE decision='promoted'` queue.

4. **Run the corrected sibling through the standard executor flow.** Hash-pinning gate applies normally. `approve` subcommand sets `human_reviewed_at` + `human_reviewed_signal_code_hash` at sibling-row approval time. `execute --commit` backfills `signal_values` under `signal_name=<corrected_name>` and the configured target sandbox version.

5. **No special metadata flags on `signal_values`.** Rows from a manual-correction sibling land under their new `signal_name` and look identical in shape to any other signal_values row. Downstream consumers can identify the sibling lineage by querying back through `experiments` if needed (`source='manual_correction'`).

## Implementation timing

Apply immediately to `spy_qqq_corr_zscore` as the first instance. ADR-0024 and the first concrete application ship in the same session.

Subsequent defects in promoted signals follow the same pattern. No code changes to the executor are required — the existing flow handles manual-correction siblings the same as daemon-promoted rows.

## Consequences

### Positive

- **Audit trail preserved.** The original buggy artifact stays in `experiments` exactly as the director saw it. The corrected version is a separate row pointing at it via `parent_experiment_id`. Anyone investigating the lineage can see exactly what was promoted, when, by whom, why it was found defective, what was changed, and when.
- **Hash-pinning discipline intact.** ADR-0023's review gate is not broken or worked around. Both the original and the sibling have their own hashes; both can be approved or re-approved independently.
- **Pattern reusable.** Any future defect found in promoted signal_code follows the same flow. The cost of building this once amortizes over future corrections.
- **No executor changes required.** The pattern works with the existing executor as shipped in v4. The sibling row appears in the executor's queue alongside daemon-promoted rows and is processed identically modulo the `source` value.
- **Downstream sandbox lgbm consumers see the corrected feature** under the v2 signal_name without needing to know about the correction. The original signal_name never landed in signal_values, so there is no shadowing.

### Negative

- **Two near-identical signal_codes per correction.** The experiments table grows by one row per defect. At current volumes (one correction in seven promoted signals) this is negligible. At scale it could become noise; revisit if corrections become common.
- **Backfilled rows carry an implicit "not daemon-validated" caveat.** The corrected sibling's `backtest_sharpe` is NULL. Any decision to graduate the corrected signal to production v1.0 will need to wait for daemon-sandbox-mode re-validation. This is a real constraint but it surfaces the right way: at graduation time, the absence of a validated Sharpe is conspicuous.
- **Manual promotion bypasses daemon validation.** The sibling is promoted by operator action rather than by the director's evaluation logic. This is acceptable for one-off corrections where the diff from the original is small and well-understood, but it is NOT a license for arbitrary manual signal authoring. The pattern is specifically for fixing defects in already-director-validated signals.

### Risks accepted

- An operator could in principle abuse the manual-correction path to inject signals that were never director-validated. Mitigated by: the `source='manual_correction'` audit marker, the parent_experiment_id trail, the executor's hash-pinning gate on the sibling itself, and the operator's own discipline. The pattern is not a substitute for the director's promotion process; it is an escape hatch for fixing defects found in promotion outputs.
- Subtle defects in the operator's correction itself would land in signal_values as authoritative data. Mitigated by: pre-approval code review (the discipline that caught the defect in the first place), the hash-pinning gate forcing explicit re-approval if signal_code mutates between operator-insert and operator-approve, and downstream sandbox-mode validation when it exists.

## Out of scope (deferred)

- **Daemon-side automatic detection of lookahead bias and similar defects.** A separate future ADR could specify rules the daemon applies during its evaluation stage to catch certain classes of attribution errors before they reach `decision='promoted'`. The sibling-correction pattern this ADR establishes is the human-in-the-loop remedy; daemon-side detection would be the preventive measure. Not in scope tonight.
- **Daemon re-validation of manual-correction siblings.** When daemon-sandbox-mode exists (a separate forthcoming ADR), the corrected sibling's `signal_code` can be run through the same walk-forward LightGBM pipeline the daemon used at original promotion time, producing a comparable `backtest_sharpe` number. Until then, sibling rows have `backtest_sharpe=NULL` and graduation to production v1.0 is blocked.
- **Whether the original's `decision` should be `'rejected'` or some new `'superseded'` value.** Using `'rejected'` is the pragmatic choice tonight: existing taxonomy, removes the row from the executor's queue, audit-trailed via `decision_reason`. A future taxonomy refactor could distinguish "rejected by director" from "superseded by manual correction." Not worth doing tonight for one row.

## References

- ADR-0023 (promotion executor — defines the hash-pinning anti-mutation discipline this ADR works within)
- Audit log entry from 2026-05-10 session identifying the lookahead bias in `exp-72d528e3` `spy_qqq_corr_zscore`
- 2026-05-09 Saturday evening handoff (documents the executor's first batch run; flagged the lookahead finding for next-session resolution)
- The actual defect in `spy_qqq_corr_zscore.signal_code`:
  ```python
  for i in range(20, len(spy_rets)):
      window_s = spy_rets[i-20:i]   # window covers indices i-20 through i-1
      ...
      corrs.append(corr)
      corr_dates.append(valid_dates[i-20])   # BUG: labels with start of window
                                             # Fix: should be valid_dates[i-1]
                                             # (end of window) or valid_dates[i]
                                             # (date the correlation is valid as-of)
  ```

