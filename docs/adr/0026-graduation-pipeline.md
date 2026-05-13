# ADR-0026: Sandbox-to-production graduation pipeline (PSR-gated, director-decided, 48h auto-execute)

**Date:** 2026-05-13
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0001 (three-database split), ADR-0004 (quant-research pause), ADR-0006 (continuity protocol), ADR-0011 (verify schema before write), ADR-0016 (mac2 Ollama SSH tunnel), ADR-0020 (signal-graduation source-agnostic), ADR-0022 (SOFAR ML pipeline architecture), ADR-0023 (promotion executor), ADR-0024 (promoted-signal correction via sibling experiment row), ADR-0025 (sandbox-version signal validator)
**Sentinel:** `GRADUATION_EXECUTOR_V1`

---

## Context

ADR-0025 closed the gap of "what is the Sharpe of a sandbox-backfilled signal when evaluated by the daemon's canonical walk-forward methodology?" — sandbox-validated signals now live in `research.experiment_sandbox_validations` with comparable Sharpe metrics, including (post-2026-05-12) the daemon's exposed per-period pnls and the derived Probabilistic Sharpe Ratio statistics.

What ADR-0025 deliberately did NOT decide: **how does a validated sandbox signal actually move into production `signal_version='v1.0'`?**

That question has three sub-questions:

1. **What's the criterion?** sharpe_delta threshold alone? sharpe_delta + feature-importance rank? Statistical significance corrected for non-normality? Corrected for multiple-testing selection bias?
2. **Who decides?** Operator pulls from a queue, director pushes to operator for review, director auto-decides with operator veto?
3. **What's the action layer?** SQL by hand, an executor script invoked manually, an automated daily pass?

Through the 2026-05-12 → 2026-05-13 sessions, all three questions were answered empirically by computing PSR on the seven existing sandbox validations and observing what discriminated. The architectural decisions below are downstream of that empirical work.

## Empirical work that drove the decisions

### PSR exposure: validator extended to compute enhanced_psr and delta_psr (2026-05-12)

Two structural code changes shipped together (commit `450301a`):

1. **Daemon return dict extended.** `overnight-research-daemon.py:validate_signal` now exposes `enhanced_pnls` and `base_pnls` as two new keys in its return dict. Existing consumers (including the daemon's own `evaluate_results`) ignore them — additive only. Methodology is unchanged.

2. **Validator computes both PSR variants.** `validate-sandbox-signal.py` consumes the new pnls and computes:
   - `enhanced_psr`: PSR of the enhanced-model's standalone Sharpe vs benchmark=0
   - `delta_psr`: PSR of the per-period delta (`enhanced_pnls - base_pnls`) vs benchmark=0

Both PSR scalars stored in `research.experiment_sandbox_validations`; pnls themselves stored in `full_results_json` for audit.

3. **PSR module.** `~/scripts/psr.py` is a self-contained Bailey & Lopez de Prado 2012 closed-form implementation. No external dependencies beyond `math`. Self-tests included.

### The seven-signal v1.1 result

Re-running validate-sandbox-signal.py at `validator_version='v1.1'` against the same seven sandbox signals produced:

| signal | sharpe_delta | enhanced_psr | delta_psr |
|---|---|---|---|
| spy_bond_vol_lead_ratio | +0.3605 | 1.000000 | **0.999987** |
| spy_vol_price_coherence | +0.2037 | 1.000000 | **0.997283** |
| spy_momentum_vol_decoupling | +0.2149 | 1.000000 | **0.994072** |
| spy_atr_spread_vol_divergence | +0.2431 | 1.000000 | **0.985504** |
| sp_vol_atr_divergence_zscore | +0.2411 | 1.000000 | **0.983863** |
| spy_atr_vol_of_vol | +0.0796 | 1.000000 | **0.762080** |
| spy_qqq_corr_zscore_v2 | +0.0176 | 1.000000 | **0.520592** |

Two findings:

1. **enhanced_psr saturates.** Every signal returns 1.000000 to six decimal places. With baseline Sharpes already ~4.7-5.0 on ~8000-day samples, "is the enhanced Sharpe genuinely positive" is trivially yes. enhanced_psr is informational only — useful to confirm the pnls aren't degenerate, but cannot gate graduation.

2. **delta_psr discriminates.** The five strong candidates (delta_psr ≥ 0.95) separate cleanly from the borderline (0.762) and the null (0.520). The borderline signal warrants more data before deciding; the null signal — spy_qqq_corr_zscore_v2 — is the very experiment ADR-0024 flagged for lookahead-correction. **delta_psr empirically confirms ADR-0024's correction finding**: even the corrected sibling has effectively zero edge.

Also surfaced: **new_signal_rank is unstable across validator runs.** Between v1.0 and v1.1, ranks shifted (spy_vol_price_coherence went from #2 to #8; spy_bond_vol_lead_ratio went #3 to #5). LightGBM's feature importance is non-deterministic enough that a hard `rank ≤ 3` graduation gate would be fragile. Rank should not be a graduation criterion.

### Stability check on selection-bias scope

delta_psr at 0.95 accepts a ~5% per-signal false-positive rate. Across N tested signals, expected false-graduations = N × 0.05. With current pipeline producing ~50 daemon experiments per cron pause-to-resume cycle, that's ~2-3 expected false-positives per cycle. This is bounded but not negligible. Multiple-testing correction (Deflated Sharpe Ratio, requires defining the trial population) is deferred to a future ADR; current threshold accepts the bounded rate.

## Decision

**Graduate sandbox signals to `signal_version='v1.0'` via a director-decided, operator-vetoable, 48h-auto-execute pipeline gated on `delta_psr ≥ 0.95 AND validation_days ≥ 2000`.**

Six pieces:

### 1. Threshold

`delta_psr ≥ 0.95 AND validation_days ≥ 2000`.

- Rank dropped: empirically unstable.
- Raw `sharpe_delta` dropped: subsumed by delta_psr (delta_psr being high requires both magnitude AND consistency).
- Days threshold preserved: structural floor against tiny samples slipping through.

The threshold is **guidance to the director**, not a hard SQL filter. Director makes the qualitative judgment in context (e.g. director might DEFER a 0.96 signal that has known data-quality concerns; might propose DISMISS on a 0.98 if the underlying mechanism is unclear). The threshold guides; the frontier model decides.

### 2. Decision authority: director makes the call

`research-director-evening.py` extended with:

- Graduation context fetched in `gather_pipeline_context`: open candidates (sandbox-validated, not yet graduated, not dismissed) AND already-pending proposals.
- Section 7d in director's prompt: `GRADUATE` / `DEFER` / `DISMISS` directives per candidate, with delta_psr and validation_days as quantitative guidance.
- Parser (`parse_graduation_directives`) extracts directives from director's output.
- `apply_graduation_directives` writes:
  - `GRADUATE` → INSERT into `graduation_proposals` (auto_execute_at = now() + 48h)
  - `DEFER` → no-op, signal stays in sandbox, re-evaluated next director run
  - `DISMISS` → UPDATE `experiments.review_dismissed_at`, signal stops surfacing

This mirrors the existing PROMOTE/REJECT/NEEDS_DATA/PARK pattern for hypothesis directives (section 7c). The operator did not invent a new architecture — they extended the pattern.

### 3. Operator veto authority

Six CLI subcommands on `~/scripts/sandbox-graduator.py`:

| Subcommand | Action |
|---|---|
| `list-pending` | Show all proposals where status='pending' |
| `status <exp_id>` | Show full audit trail for one experiment |
| `execute <exp_id> [--reason X] [--dry-run] [--force]` | Graduate immediately, bypass 48h wait |
| `dismiss <exp_id> --reason X` | Veto + set `experiments.review_dismissed_at` |
| `defer <exp_id> --reason X` | Veto + signal stays in sandbox awaiting re-validation |
| `hold <exp_id> --reason X` | Veto + director re-evaluates next run (no fresh validation needed) |

All five mutating commands post to Discord on success (`#sofar-graduations` channel).

### 4. 48-hour auto-execute window

`graduation_proposals.auto_execute_at` set to `proposed_at + interval '48 hours'`. `research-director-evening.py` runs `auto_execute_pending_graduations()` as the first action of each cron run — BEFORE flow analysis, context gathering, or LLM call. Per-proposal try/except: one failed graduation doesn't block the rest of director's daily work.

Why 48h (not 24h): two morning director Discord posts before auto-execute fires. Operator who's away for one day still gets the next day's veto opportunity.

When the timer fires, `execute_graduation()` library function (in `sandbox-graduator.py`) is called with `actor='director_auto'`. Same code path as operator's manual `execute` — only the actor metadata differs. graduation_proposals.status moves from 'pending' to 'auto_executed' (vs 'manually_executed' for operator-invoked).

### 5. Discord surfacing

Dedicated `#sofar-graduations` Discord channel with its own webhook (`/etc/discord-webhook-graduations.env`), separate from `#hermes-research` (where flow + director-morning post). Single channel for all graduation events:

- `📋 NEW GRADUATION PROPOSAL` (when director-evening creates a proposal)
- `🚫 EXPERIMENT DISMISSED BY DIRECTOR` (when director-evening dismisses)
- `🚫 GRADUATION DISMISSED / ⏸ DEFERRED / 🤔 HELD` (when operator vetoes)
- `✅ GRADUATED` (manual execute OR auto-execute)

Additionally, `research-director-morning.py` extended to surface pending proposals in its daily Discord post (`#hermes-research`). Operator gets one consolidated daily readout of what's pending; the dedicated `#sofar-graduations` channel is the per-event audit trail.

### 6. Multi-target-version support deferred

`graduated_to_version` column exists on `experiments`, defaults to `'v1.0'`, but only `v1.0` is currently supported by `sandbox-graduator.py:execute_graduation`. Allows future multi-version graduation (e.g. for parallel A/B production rollouts) without schema change.

## Schema changes

Three migrations applied 2026-05-12 and 2026-05-13:

1. **`migrations/20260512-experiment-sandbox-validations-psr-columns.sql`**: adds `enhanced_psr NUMERIC(8,6)` and `enhanced_psr_benchmark NUMERIC(8,4) DEFAULT 0.0`.

2. **`migrations/20260512-add-delta-psr-column.sql`**: adds `delta_psr NUMERIC(8,6)`.

3. **`migrations/20260512-experiments-graduation-tracking.sql`**: adds `graduated_at TIMESTAMPTZ`, `graduated_to_version VARCHAR(64)`, `review_dismissed_at TIMESTAMPTZ`, `review_dismissed_reason TEXT`, plus partial index `experiments_graduation_pending_idx WHERE graduated_at IS NULL AND review_dismissed_at IS NULL`.

4. **`migrations/20260513-graduation-proposals-table.sql`**: creates the `graduation_proposals` table with 11 columns (status enum, status_actor enum, auto_execute_at, director_reasoning, discord_posted, etc.), partial index on pending status, full index on (experiment_id, proposed_at DESC), two CHECK constraints.

## Code shipped

| File | Type | Lines | Commit |
|---|---|---|---|
| `psr.py` | new module | 213 | `450301a` |
| `overnight-research-daemon.py` | edited (return dict) | +4 | `450301a` |
| `validate-sandbox-signal.py` | edited (PSR compute) | +49 | `450301a` |
| `sandbox-graduator.py` | new, 6 subcommands | 560 | `17e606f` |
| `research-director-evening.py` | edited (graduation flow) | +283 | `17e606f` |
| `research-director-morning.py` | edited (surfacing) | +35 | _pending commit_ |

## End-to-end smoke test (2026-05-13 evening)

Director-evening run produced section 7d with 7 directives. All 7 parsed and applied correctly:

- **5 GRADUATE** → 5 rows in `graduation_proposals` with `auto_execute_at = 2026-05-15 22:15 UTC`:
  - exp-bc010c0e (spy_bond_vol_lead_ratio, delta_psr 0.999987)
  - exp-2d9fe66c (spy_vol_price_coherence, delta_psr 0.997283)
  - exp-637ea968 (spy_momentum_vol_decoupling, delta_psr 0.994072)
  - exp-45018ace (spy_atr_spread_vol_divergence, delta_psr 0.985504)
  - exp-7873c54d (sp_vol_atr_divergence_zscore, delta_psr 0.983863)
- **1 DEFER** → exp-74f70fc3 (spy_atr_vol_of_vol, delta_psr 0.762080). No state change; will be re-evaluated next director run.
- **1 DISMISS** → exp-72d528e3-fixed-v1 (spy_qqq_corr_zscore_v2, delta_psr 0.520592). `experiments.review_dismissed_at` set; signal stops surfacing.

Director's reasoning text was concise and statistically honest — cited delta_psr values and validation_days for each, referenced ADR-0024 for the dismissal. No hallucination, no hedging.

## Why this matters

The action layer for the closed research → production loop is now complete:

```
daemon experiments
  → executor (ADR-0023) → market.signal_values @ v_research_NNN
  → validator (ADR-0025) → research.experiment_sandbox_validations + PSR
  → director-evening (ADR-0026) → GRADUATE / DEFER / DISMISS
  → graduator auto-execute (ADR-0026) → market.signal_values @ v1.0
  → lgbm weekly retrain → production champion
```

Before ADR-0023-0026, daemon-promoted experiments accumulated in `research.experiments` with no path to production. Director silently dropped its directives (parser bug fixed 2026-05-11). Sandbox values existed but had no validation gate. The pipeline was disconnected at three points.

Tonight: all three connections work. Director made the GRADUATE call. The 48h timer runs. The graduator's code path is identical between manual and auto-executed graduations. Operator can dismiss / defer / hold via CLI with Discord audit trail. Daily director-morning brief surfaces what's pending.

## Out of scope (future ADRs)

1. **Selection-bias correction (DSR).** Requires defining the trial population. Likely future ADR after 2-3 graduation cycles surface real false-positive rate data.

2. **Multi-target-version graduation** (e.g. graduate to v1.1 in parallel with v1.0). Schema supports it; executor does not.

3. **Auto-re-validation cron.** Currently operator must manually run `validate-sandbox-signal.py --validator-version vX.Y` to produce new sandbox rows for re-evaluating deferred signals. Future cron could refresh weekly.

4. **Graduated-signal demotion.** No pathway to roll back a graduated signal if it underperforms in production. Manual SQL would work today; a structured demotion ADR is future work.

5. **Director's section 7d quality monitoring.** Director's GRADUATE/DEFER/DISMISS calls themselves are not currently audited against any ground truth. The first 2-3 auto-graduations are the operator's chance to observe whether director's judgment matches what they'd have decided manually.

## Sentinel

`GRADUATION_EXECUTOR_V1` — opens with this ADR. Watch points:
- Auto-execute reliability (zero failures expected in baseline operation)
- Director directive parse rate (zero `Parsed 0 graduation directives` runs once candidates exist)
- Operator veto cadence (high veto rate signals director judgment needs tuning)
- delta_psr drift across re-validations (rank instability already observed — does delta_psr show similar volatility?)
