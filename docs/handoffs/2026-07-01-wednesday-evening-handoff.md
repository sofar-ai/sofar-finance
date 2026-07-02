# 2026-07-01 Wednesday Evening Handoff

## Context

D2 night. The graduator hardening (SOF-5, drafted in June, refined through two review-blocker rounds)
was applied by the operator early evening, the post-apply smoke test surfaced two queue surprises, the
agent resolved both read-only, prepped a pre-registered validation runbook, and the operator then ran
the whole D2 pipeline end-to-end: queue cleanup → approvals → materialization → v1.2 validations →
manual graduations → idempotency proof. **Production changed tonight: two new v1.0 signals.** Work
pipeline is Linear (team SOF, `LINEAR_PIPELINE_CONVENTIONS_V1`); durable records in
`sofar-scripts/diagnostics/`.

## Shipped

- **Graduator hardening APPLIED** (sofar-scripts `bb8c442`; live `sandbox-graduator.py` md5
  `560a3643`). Five-state zero-insert classifier with early-guard routing + exit-0 benign states
  (`GRADUATOR_ZERO_INSERT_FALSE_SUCCESS_V1`) and the cross-DB interim (attempt-key + `[split-brain]`
  logging, `GRADUATOR_CROSS_DB_ORDERING_V1`). Patchers archived to `diagnostics/applied/`. SOF-5 Done.
  **Still open:** the `graduation_attempts` outbox DDL (HARD RULE 1) — interim reduces, does not
  close, the split-brain window.
- **Graduation-queue investigation** (`31918ae`, `GRADUATION_QUEUE_STATE_V1`): the D2 survivors had
  zero proposals AND zero sandbox validations (rc-5 blocked); all 25 historical proposals were stale
  echoes of the already-graduated 05-18 cohort (4 of 5 = the D1 noise signals). Director proposal
  path is unguarded (`DIRECTOR_PROPOSAL_PATH_UNGUARDED_V1`) → filed SOF-13.
- **D2 runbook, pre-registered** (`aa06050`, `D2_VALIDATION_RUNBOOK_PREREGISTERED_V1`): 3-stage
  approve → materialize (promotion-executor) → validate (v1.2), with expected deltas +0.1231/+0.1349
  and the ≥ +0.08 / < +0.08 STOP decision rule stated before any run.
- **D2 EXECUTED by operator** (record: `6f794c1`, `D2_EXECUTED_HONEST_ERA_V1`):
  - Queue cleanup: 20 stale pendings → `superseded` (queue now 0 pending).
  - Materialization: 8,264 + 8,269 rows @ `v_research_002`.
  - v1.2 validations (ids 16/17): **Δ +0.1203 vs pre-reg +0.1231; Δ +0.1306 vs pre-reg +0.1349** —
    both within ~0.004, both clear the rule; delta_PSR 0.8975 / 0.7460 (honest band).
  - **exp-ce3ced9c's fiction-era 5.0244 took an -81.26% haircut to 0.9414 and STILL passed.**
  - Manual graduations 22:35/22:36 EDT (`manually_executed`, attempt_keys logged); v1.0 counts ==
    source counts (FULL, exact).
  - **Idempotency proof = first live firing of the five-state classifier:** both reruns →
    `[grad-classify] ALREADY-COMPLETE`, exit 0.
- **D1 EXECUTED by operator, immediately after D2** (record: `d9328ad`, `D1_EXECUTED_V1`): the four
  reaudit-failed noise signals version-moved out of v1.0 → `v_retired_20260609` (== the 2026-06-09
  reaudit retirement cohort). Pre-count 31,643 exactly (zero drift since 06-16); post-verify v1.0
  remainder 0, retired counts 6,966 / 8,237 / 8,335 / 8,105 = 31,643 exact; `v_research_002` sandbox
  copies untouched; reversible by design. **First attempt failed SAFELY:** the tracker's pre-written
  `'v_retired_reaudit_20260609'` (26 chars) exceeded `signal_version` varchar(20) →
  `StringDataRightTruncation`, zero rows touched — micro-finding
  `PREWRITTEN_SQL_EXCEEDED_COLUMN_WIDTH_V1` (runbook SQL gets logic-reviewed but not
  length-validated; check `information_schema` at draft time).
- **Linear bookkeeping:** SOF-5 Done, SOF-6 Done (earlier: survivors don't inherit the FRED leak),
  SOF-9 Done, SOF-10 Done, SOF-13 filed (director proposal path), SOF-14 filed (Discord 403).

## Decisions

- **D2 graduated on honest numbers under the pre-registered rule** — no gate adjustments; actuals
  reproduced the promotion-era deltas within noise.
- **Graduations were manual** (`sandbox-graduator.py execute exp-…`), bypassing the buggy director
  proposal path deliberately (SOF-13 tracks the fix).
- **Mixed-regime `backtest_sharpe` left untouched** — exp-ce3ced9c reads 5.0244 (fiction-era) vs
  exp-02f03f64's 1.0735 (honest-era). Options proposed in the findings note (annotate era column
  [recommended] / overwrite / convention-only); operator decision pending. Do NOT rank experiments on
  `backtest_sharpe` across the 2026-05-28 boundary.
- **`honest_reaudit_status` question CLOSED (late supplement):** operator verified the column
  vocabulary (failed=16 / survived=2; the 16 reconciles exactly with the "16 noise of 19" reaudit
  cohort), then ran a 1-row guarded UPDATE (`WHERE … IS NULL`, idempotent) setting
  `exp-02f03f64='survived'`, evidence = validation id 16 (v1.2, Δ +0.1203). Post-update: survived=3,
  and both graduated survivors read `survived` with tonight's `graduated_at` — fully symmetric. (The
  row's delta/timestamp fields stay NULL; its evidence lives in the validation row.) Note this does
  NOT touch the separate `backtest_sharpe` fiction/honest-era split, which remains open.

## Production impact (what the next session must know)

- **v1.0 gained two signals:** `spy_macro_spread_vol_ratio` (8,264 rows) and
  `spy_macro_vol_relative_zscore` (8,269 rows), SPY, 1993→present, sourced from
  `treasury_rates.spread_10y_3m` + `prices_daily` (no FRED-leak inheritance —
  `D2_SURVIVORS_DO_NOT_INHERIT_FRED_LEAK_V1`).
- **v1.0 lost the four noise signals** (D1 executed tonight too): −31,643 rows to
  `v_retired_20260609`. Net tonight: v1.0 = **minus 4 noise, plus 2 honest graduates** — the clean
  honest-era namespace.
- **Sunday 07-05 retrain** (17:00/17:15/17:30 ET) pre-registration: no degradation expected from the
  removals (champions never consumed the noise four); **the open question is champion uptake of the
  two newcomers** — do they earn non-trivial importance on first exposure? Panel-family consumers get
  a cleaner SPY cell at the next rebuild.
- Graduation queue is clean: 0 pending / 20 superseded / 5 auto_executed.

## Sentinels (tonight)

- `D2_EXECUTED_HONEST_ERA_V1` — the D2 execution record (`6f794c1`, amended `6a1124d`).
- `D1_EXECUTED_V1` — the D1 execution record (`d9328ad`); mapping `v_retired_20260609` == the
  2026-06-09 reaudit retirement cohort.
- `PREWRITTEN_SQL_EXCEEDED_COLUMN_WIDTH_V1` — length-validate runbook SQL against
  `information_schema` at draft time.
- `D2_VALIDATION_RUNBOOK_PREREGISTERED_V1` — the runbook it followed (`aa06050`).
- `GRADUATION_QUEUE_STATE_V1`, `D2_SURVIVORS_HAVE_NO_SANDBOX_VALIDATION_V1`,
  `DIRECTOR_PROPOSAL_PATH_UNGUARDED_V1` — queue investigation (`31918ae`).
- `GRADUATOR_ZERO_INSERT_FALSE_SUCCESS_V1` / `GRADUATOR_CROSS_DB_ORDERING_V1` — applied + first live
  firing.
- Open/observed: Discord graduations webhook **403** (SOF-14, audit 2.5 class); `graduation_attempts`
  outbox DDL pending; FRED remediation (SOF-8) unaffected by tonight, still Awaiting Operator.

## Where to look

- Findings notes (sofar-scripts `diagnostics/`): `findings-d2-executed-2026-07-01.md`,
  `findings-d2-validation-prep-2026-07-01.md`, `findings-graduation-queue-state-2026-07-01.md`,
  `findings-graduator-hardening-2026-06-17.md`.
- Linear: SOF-5/6/9/10 Done · SOF-8 Awaiting Operator (FRED) · SOF-13/14 Todo · SOF-7 Todo (cohort
  eval, unblocked) · SOF-11 Todo (UPS).
- D1 record: `diagnostics/findings-d1-executed-2026-07-01.md` (sofar-scripts `d9328ad`).
