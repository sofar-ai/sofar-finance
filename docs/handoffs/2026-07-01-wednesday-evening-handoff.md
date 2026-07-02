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
- **Linear bookkeeping:** SOF-5 Done, SOF-6 Done (earlier: survivors don't inherit the FRED leak),
  SOF-10 Done, SOF-13 filed (director proposal path), SOF-14 filed (Discord 403).

## Decisions

- **D2 graduated on honest numbers under the pre-registered rule** — no gate adjustments; actuals
  reproduced the promotion-era deltas within noise.
- **Graduations were manual** (`sandbox-graduator.py execute exp-…`), bypassing the buggy director
  proposal path deliberately (SOF-13 tracks the fix).
- **Mixed-regime `backtest_sharpe` left untouched** — exp-ce3ced9c reads 5.0244 (fiction-era) vs
  exp-02f03f64's 1.0735 (honest-era). Options proposed in the findings note (annotate era column
  [recommended] / overwrite / convention-only); operator decision pending. Do NOT rank experiments on
  `backtest_sharpe` across the 2026-05-28 boundary.
- `exp-02f03f64.honest_reaudit_status` stays NULL by design; validation id 16 is the evidential
  record.

## Production impact (what the next session must know)

- **v1.0 gained two signals:** `spy_macro_spread_vol_ratio` (8,264 rows) and
  `spy_macro_vol_relative_zscore` (8,269 rows), SPY, 1993→present, sourced from
  `treasury_rates.spread_10y_3m` + `prices_daily` (no FRED-leak inheritance —
  `D2_SURVIVORS_DO_NOT_INHERIT_FRED_LEAK_V1`).
- **Sunday 07-05 retrain** (17:00/17:15/17:30 ET) picks them up in the candidate pool. Running **D1**
  (SOF-9, four noise signals out of v1.0 — SQL ready, Awaiting Operator) before then would give the
  retrain a fully de-noised v1.0 in one pass.
- Graduation queue is clean: 0 pending / 20 superseded / 5 auto_executed.

## Sentinels (tonight)

- `D2_EXECUTED_HONEST_ERA_V1` — the execution record (`6f794c1`).
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
- Linear: SOF-5/6/10 Done · SOF-8/9 Awaiting Operator · SOF-13/14 Todo · SOF-7 Todo (cohort eval,
  unblocked) · SOF-11 Todo (UPS).
