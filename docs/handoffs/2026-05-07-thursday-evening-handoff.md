# 2026-05-07 Thursday Evening Handoff — lightgbm prototype shipped, CFTC features evaluated, action-layer gap empirically verified

**Session window:** Thursday 2026-05-07 mid-day through evening (continuation of multi-day arc beginning 2026-05-03)
**Operator:** bot1
**Pause status (ADR-0004):** unchanged — quant-research subsystem paused, signal-pipeline + ML prototype work sanctioned.

---

## TL;DR

Three substantial tracks shipped:

1. **LightGBM prototype trainer infrastructure** — `lgbm-predictor-prototype.py` (~500 lines). Sandboxed via `--signal-version` arg (default `v_research_001`), parameterized horizon, separate model + metadata file paths, no frontend write, no record_prediction call, no hardcoded portfolio_sim. Defaults match production v7 exactly (faithful to within statistical noise: 44.6%/3.619 vs production 44.6%/3.611).

2. **CFTC z-score features derived into v_research_001 sandbox** — 8 features (`cot_spy_{dealer,asset_mgr,lev_money,other_rept}_z_{consol,emini}`), 20,180 rows committed, sandbox convention established. Cross-horizon experiment shows monotonic accuracy improvement with horizon (7d: -0.9pp, 14d: +0.2pp, 21d: +0.4pp) — directionally consistent with literature but Sharpe deltas within noise. Pipeline-level finding: macro features in 21d production model already absorb most of the orthogonal information CFTC z-scores would convey.

3. **Action-layer gap empirically verified.** Two promoted experiments from April 15-16 (`spy_vol_price_coherence`, `spy_momentum_vol_decoupling`) sit stranded in research.experiments — director marked `decision='promoted'` 3 weeks ago, but `signal_values` contains zero rows for either signal. The wiring layer between "experiment promoted" and "signal live in production" does not exist. This empirically confirms the gap pattern the operator described from memory of the v1 pipeline: ~100+ experiments → handful promoted → none actually wired into production. The action layer is the keystone missing piece for closed-loop research → production.

Plus a substantial fourth piece (negative): early-stopping diagnostic finding. The "obvious safe trainer improvement" from ADR-0022 backlog item #1 is actually HARMFUL for this domain (-2.9pp accuracy, -0.5 Sharpe on production v7's data). New sentinel filed.

## Sections

1. [Substrate catch-up at session start](#substrate-catchup)
2. [Sandbox signal_version convention adopted](#sandbox-convention)
3. [Prototype trainer build + early-stopping diagnostic](#prototype-trainer)
4. [CFTC feature derivation + N+1 perf bug fix](#cot-features)
5. [Cross-horizon CFTC experiment results](#cot-experiment)
6. [Architectural reading: full pipeline mapped](#pipeline-architecture)
7. [Action-layer gap empirically verified](#action-layer-gap)
8. [Pending sentinels to file](#pending-sentinels)
9. [Next session opening scope](#next-session-scope)
10. [Assistant-pattern observations](#assistant-patterns)

---

## Substrate catch-up at session start {#substrate-catchup}

Wednesday handoff (`2026-05-06-wednesday-evening-handoff.md`) ingested cleanly at 03:25 UTC this morning as substrate id 3107. Four new sentinels materialized:
- `LGBM_TRAINER_HARDCODES_PORTFOLIO_METRICS_V1` (id 3106, via ADR-0022 extract)
- `SCHEMA_DESIGN_FROM_SPEC_NOT_DATA_RECURRING_PATTERN_V1` (id 3108, via handoff extract)
- `LGBM_SANDBOX_SIGNAL_VERSION_CONVENTION_UNDEFINED_V1` (id 3109, via handoff extract)
- `LGBM_STALE_MODELS_PURPOSE_AND_STATUS_UNKNOWN_V1` (id 3110, via handoff extract)

Operator established trajectory: prototype new lightgbm version that evaluates new signals (form4, CFTC, unusual_flow). Approach decided: sandbox via signal_version, prototype trainer copy with optional improvements, attribution via three-way comparison (production / baseline-prototype / full-prototype).

## Sandbox signal_version convention adopted {#sandbox-convention}

Adopted convention: `v_research_NNN` (3-digit sequence number). First batch is `v_research_001`. Closes sentinel `LGBM_SANDBOX_SIGNAL_VERSION_CONVENTION_UNDEFINED_V1` (id 3109).

Rationale captured: matches existing v1.0 string shape, sequence number rather than date avoids ambiguity when iterating multiple times in a day, "research" prefix grep-able and clearly distinguishes from production, three digits room for ~1000 iterations.

Verified isolation before populating: production lgbm scripts (lgbm-predictor.py, lgbm-predictor-14d.py, lgbm-predictor-21d.py) all filter explicitly by `WHERE signal_version='v1.0'`. optimize.py filters by `signal_version='v1.0'`. The only active script reading signal_values without version filter is `backcompute-vol-regime.py` line 179 (diagnostic GROUP BY signal_name count — no production behavior path). Other unfiltered grep hits were `.pre-*` backup files (inert).

## Prototype trainer build + early-stopping diagnostic {#prototype-trainer}

[CODE] `/home/bot1/scripts/lgbm-predictor-prototype.py` (~500 lines). Sandboxed copy of production lgbm-predictor.py with these isolating differences:

- `--signal-version` arg (default `v_research_001`) determines which version's data to read
- `--features` (comma-separated) or `--features-from <metadata.json>` to specify feature list explicitly (no auto-discover-from-version since same version contains many features that production wouldn't use)
- `--output-suffix <name>` constructs output paths `lgbm_proto_<suffix>.pkl` + `lgbm_proto_<suffix>_metadata.json`
- `--horizon <days>` parameterized; threshold computed as `0.003 * sqrt(horizon)` matching production formula
- `--early-stopping` opt-in flag (default OFF — see diagnostic finding below)
- `--reg-lambda <float>` for L2 regularization tuning (default 0.0 to match production)

Explicitly NOT replicated from production:
- ❌ Hardcoded portfolio_sim block in metadata (per project no-hardcoding rule)
- ❌ Frontend file copy (`~/sofar-finance/data/lgbm-prediction.json`)
- ❌ `record_prediction()` call (would pollute production tracking)
- ❌ `predict_today()` (focus is metric comparison, not prediction generation)

[BUG_RESOLVED_THIS_SESSION] Initial prototype draft included early stopping (15% chronological val slice + early_stopping_rounds=20) and L2 regularization (reg_lambda=1.0) as "safe trainer improvements" per ADR-0022 backlog item #1. Smoke test against v1.0 with production's 75 features showed walk-forward accuracy 41.8% vs production's 44.6% — a 2.8pp regression. Operator agreed to diagnostic A/B/C runs to isolate cause.

3-way diagnostic comparison on v1.0 / 75 features / SPY / 7d horizon:

| Config | scored | accuracy | Sharpe |
|---|---:|---:|---:|
| Production v7 (reference) | 3,268 | 44.6% | 3.611 |
| A: production-equivalent (no ES, reg_lambda=0) | 3,272 | 44.6% | 3.619 |
| B: L2 only (reg_lambda=1.0) | 3,252 | 44.4% | 3.531 |
| C: Early stopping only | 3,050 | 41.7% | 3.084 |
| Original full-prototype (both improvements) | 3,068 | 41.8% | 3.142 |

**Findings:**
- Diagnostic A reproduces production within statistical noise → prototype is faithful, no bugs in the script
- L2 regularization at 1.0 is approximately neutral (-0.2pp accuracy, -0.09 Sharpe)
- **Early stopping is HARMFUL** (-2.9pp accuracy, -0.5 Sharpe) — dominated the original full-prototype regression

**Interpretation:** chronological-slice validation (last 15% of training data) is unrepresentative for financial time series with regime changes. The model gets early-stopped based on a slice that doesn't match the full distribution. Standard early-stopping methodology assumes IID data; financial time series violates this.

[CHANGE] Module-level defaults flipped: `DEFAULT_USE_EARLY_STOPPING = False`, `DEFAULT_REG_LAMBDA = 0.0`. CLI flag inverted from `--no-early-stopping` (opt-out) to `--early-stopping` (opt-in). Docstring captures the diagnostic findings explicitly so future sessions don't re-attempt.

[CORRECTION TO ADR-0022] Backlog item #1 ("Early stopping") was claimed as a safe LightGBM standard practice. Empirically false for this domain. To re-enable safely would require alternative validation strategy: random-sample within-window, purged cross-validation per López de Prado, or block-wise CV. None of these were implemented.

Smoke test with corrected defaults reproduced production exactly: accuracy 44.6%, Sharpe 3.619, scored 3,272. Confirms prototype as sandboxed, faithful baseline for evaluating new signals.

## CFTC feature derivation + N+1 perf bug fix {#cot-features}

[CODE] `/home/bot1/scripts/derive-cot-features.py` (~280 lines after refactor). Reads `cftc_cot_financial` directly (not `cot_signals` — that table only contains |z|>=2 extremes, while ML features need continuous z-scores for every week). Computes per-(report_date, contract, category) net positioning z-scores via 52-week rolling window. Forward-fills to all trading dates in prices_daily for SPY. Writes 8 features to signal_values under `signal_version='v_research_001'`.

Eight features:
- `cot_spy_{dealer,asset_mgr,lev_money,other_rept}_z_consol` (S&P 500 Consolidated)
- `cot_spy_{dealer,asset_mgr,lev_money,other_rept}_z_emini` (E-MINI S&P 500)

[BUG_RESOLVED_THIS_SESSION] Initial implementation used per-(category, contract) LATERAL subquery for as-of join — looked set-oriented syntactically but Postgres re-executed the rolling-window CTE for each trading day. ~7 minute runtime for what should have been seconds. Same shape-of-bug as form4-reconciler N+1 from yesterday despite my having flagged that pattern.

[CODE FIX] Refactored to two-phase materialization: Phase 1 computes ALL 8 z-score series in single UNION ALL into temp table `cot_zscores_temp`, indexed on (signal_name, report_date). Phase 2 does as-of join via DISTINCT ON in single indexed pass. Result: ~8 second runtime, 50× speedup. Same 20,180 rows output, same sample values preserved.

[DATA] Committed 20,180 rows under v_research_001/SPY (4,184 z-score rows × forward-filled to trading days from 2010-06-29 onward — 1995-2010 drops out due to 52-week rolling-window startup requirement).

Pre-experiment setup: copied 892,897 production v1.0 SPY rows into v_research_001 via SQL `INSERT ... ON CONFLICT DO NOTHING`. v_research_001 final state: 913,077 rows, 173 distinct signal_names (165 production + 8 new CFTC).

## Cross-horizon CFTC experiment results {#cot-experiment}

Three horizons tested with full attribution. Faithful baseline established for each horizon by running prototype against v1.0 with production's exact feature list (verified via diagnostic that prototype matches production within noise). Then full-prototype run against v_research_001 with production features + 8 new CFTC features.

| Horizon | Baseline (v1.0) | Full-prototype (v_research_001 + CFTC) | Δ accuracy | Δ Sharpe |
|---:|---|---|---:|---:|
| 7d | 44.6% / 3.619 (75 features) | 43.7% / 3.287 (83 features) | **−0.9pp** | **−0.33** |
| 14d | 50.1% / 4.354 (75 features) | 50.3% / 4.406 (83 features) | **+0.2pp** | **+0.05** |
| 21d | 52.8% / 4.868 (133 features) | 53.2% / 4.873 (141 features) | **+0.4pp** | **+0.005** |

**Findings:**

- **Monotonic accuracy improvement with horizon** — directionally consistent with CFTC literature suggesting positioning information has 4-12 week predictive horizons.
- **Sharpe delta near-flat at 21d** despite accuracy improvement — suggests model finds more directionally-correct situations but those situations don't have meaningfully different return characteristics than what the existing 133 macro features were already picking up.
- **All deltas are within statistical noise.** With 3,634 scored predictions at 14d, standard error on accuracy is roughly ±0.83pp. The +0.2pp result cannot reject "no effect."

**Honest interpretation:** the 21d production model already includes 58 macro features (yield curves, OAS spreads, USD index, breakeven inflation, real yields). These largely subsume the macro positioning information that CFTC z-scores would convey. The marginal value of adding 8 weekly-cadence forward-filled z-scores on top of an already-rich macro feature set is small or zero.

**Asymmetry to acknowledge:** the 8 features we built are from `cftc_cot_financial` (S&P 500 contracts, financial trader categories: dealer, asset_mgr, lev_money, other_rept). The literature's strongest historical signal — `prod_merc` (commercials) on commodity contracts — was NOT included because SPY maps to financial-table contracts, not commodity-table. A separate research direction (Option B from session discussion) would derive prod_merc-based features as macro risk-regime indicators rather than as direct SPY signals. Not pursued tonight.

**Infrastructure value:** the prototype trainer + sandbox version + cross-horizon comparison methodology is reusable for any future signal source. CFTC was the first integration test; the pattern is now repeatable for form4 (when applicable, requires multi-ticker work since SPY has no insider filings), unusual_flow, dark_pool aggregations, alternative CFTC encodings, etc. The infrastructure itself is the durable output of this session even if the CFTC experiment was directionally-positive-but-noisy.

## Architectural reading: full pipeline mapped {#pipeline-architecture}

After ~90 minutes of architectural conversation, operator pushed back on my repeated mis-recollections of project state and pointed me to documentation. Reading ADRs 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022 + the v2-wip design doc (`docs/specs/quant-research-scout-v2-design.md`) yielded the canonical pipeline:

```
EXTERNAL INTAKE:
  research-lab-scraper.py + research-scout-scraper.py
       → research.documents
       → research-summarizer.py (LLM extracts observations)
       → research.observations
       → data-gap-populator.py (LLM classifies vendor mentions)
       → research.data_gaps

HYPOTHESIS GENERATION (currently broken — v2-wip is skeleton):
  quant-research-scout-v2 (PHASES 1, 3, 4 STUBBED — NotImplementedError)
       → research.hypotheses (with cited_doc_ids grounding requirement)

DIRECTOR REVIEW (operational):
  research-director-morning.py (07:30 ET weekdays)
  research-director-evening.py (16:30 ET weekdays)
  Reads: hypotheses + observations + documents + data_gaps + flow_analysis + experiments
  LLM (qwen3:235b on mac1):
    - Synthesizes daily briefing
    - Updates hypothesis status (proposed→approved/rejected)
    - Reviews completed experiments → decision: promoted/rejected/needs_review
    - Decisions based on metric thresholds AND structural heuristics
      (e.g. "Sharpe improved but signal ranks #44 (low importance)" → needs_review)

EXPERIMENT EXECUTION:
  Source 1: overnight-research-daemon (active — produced the 2 stranded promotions)
  Source 2: quant-research-scout (paused, v2-wip not done)
  Source 3: manual / other (45 source='' rows in experiments)
       → research.experiments (or production.experiments — both exist, diverged counts)

ACTION LAYER (DOES NOT EXIST):
  Hypothetical: graduator script per ADR-0020 design
  Should: read decision='promoted' → backfill signal_code values → INSERT signal_values
          → update lgbm_metadata.json features → trigger retrain
  ACTUAL: nothing reads decision='promoted'
  Empirically verified gap (see next section)

PRODUCTION ML (operational, mapped in ADR-0022):
  feature-engineering.py + ingest-macro-signals.py → signal_values v1.0
  lgbm-predictor.py / -14d.py / -21d.py → models, retrained Sundays
  pipeline-runner.py → daily orchestrator
  ai-synthesis.py + frontend
```

The director sits between hypothesis-generation and action. It is the **decision authority** — both which hypotheses become experiments AND which completed experiments get marked promoted. It is **not** the action executor. The graduator (per ADR-0020) is the action layer that should execute on director-approved promotions.

ADR-0020 was deliberately deferred until at least one additional signal source had shipped a reconciler beyond unusual-flow. As of 2026-05-07 we now have three reconcilers (unusual_flow, form4, cot) so the precondition is met. Implementation has not begun.

## Action-layer gap empirically verified {#action-layer-gap}

**Empirical query result that confirms the gap operator described from memory:**

Research DB experiments table state:
| decision | count |
|---|---:|
| failed | 183 |
| rejected | 51 |
| (blank) | 45 |
| needs_review | 29 |
| promoted | 2 |

The 2 promoted signals (`research.experiments WHERE decision='promoted'`):
- `spy_vol_price_coherence` — promoted 2026-04-15, source=overnight_daemon, Sharpe 4.96, accuracy 53.13%, decision_reason "Sharpe improved by +0.2055, signal ranks #5"
- `spy_momentum_vol_decoupling` — promoted 2026-04-16, source=overnight_daemon, Sharpe 4.96, accuracy 53.35%, decision_reason "Sharpe improved by +0.2165, signal ranks #2"

Verification query against signal_values for these names: **zero rows**. Neither signal exists in the production feature store. They were marked promoted 3 weeks ago and never wired.

**Confirmed:** "promoted" in the experiments table is a recommendation the director made; the act of materializing that into the production feature store was a separate manual step that never executed. No script reads `decision='promoted'` and acts on it.

Production DB experiments table (separate from research, count: 674 total) shows analogous 7 promoted + 59 needs_review distribution. Names not pulled this session due to time but pattern likely identical.

**Anomaly worth investigating later:** research.experiments has 310 rows; production.experiments has 674. They are NOT FDW mirrors of each other (separate tables, independent state). Sentinel `EXPERIMENTS_TABLE_DIVERGENCE_RESEARCH_VS_PRODUCTION_V1` filed below. Could be (a) production is older and accumulated more rows historically, (b) different experiment-execution paths write to different DBs, (c) data synchronization expected but broken. Not investigated tonight.

**Why this finding matters strategically:**

The operator's previous direction-options conversation (sub-models vs v2-wip vs graduator) had no empirical anchor. With the action-layer gap verified, the picture changes:

- **Sub-model architecture** (Direction 2 from earlier conversation): valuable architectural improvement but doesn't address the action gap. Stranded promotions stay stranded.
- **v2-wip completion** (Direction 1): unblocks new hypothesis flow but those hypotheses would hit the same wiring gap once director-promoted. Generates more inputs to a system that already has unprocessed outputs.
- **Action layer / graduator** (Direction 3): directly addresses the empirically-verified gap. Backfills the 2 stranded signals as the first proof, establishes the pattern for any future promoted experiments. Completes the closed loop.

Action layer is now the empirically-supported priority.

## Pending sentinels to file {#pending-sentinels}

[SENTINEL] `EARLY_STOPPING_HARMFUL_FOR_FINANCIAL_TIME_SERIES_V1`

Diagnostic comparison 2026-05-07 against production v7 baseline (75 features, v1.0 signal_version, SPY, 7-day horizon) showed lightgbm early stopping with chronological 15% validation slice produces walk-forward accuracy of 41.7% vs production's 44.6% (-2.9pp) and Sharpe 3.084 vs 3.611 (-0.5). L2 regularization at reg_lambda=1.0 is approximately neutral (-0.2pp accuracy, -0.08 Sharpe). Conclusion: chronological-slice early stopping is harmful for financial time series because the late-window validation slice may be unrepresentative of the full distribution due to regime changes. The "obvious safe trainer improvement" candidate from ADR-0022 backlog item #1 is therefore NOT a free win — it requires alternative validation methodology (random-sample within-window, purged cross-validation per López de Prado, or block-wise CV) before it would be safe to enable. Closes when an alternative validation strategy has been implemented in lgbm-predictor-prototype.py and shown to match-or-improve production v7 walk-forward metrics.

[SENTINEL] `EXPERIMENT_PROMOTION_NO_ACTION_LAYER_V1`

Empirically verified 2026-05-07: research.experiments table has 2 rows with `decision='promoted'` (set by director on 2026-04-15 and 2026-04-16) but signal_values contains zero rows for either signal. The director marks promotion decisions but no script reads `decision='promoted'` and executes the wiring (compute signal historically, insert to signal_values, add to lgbm_metadata, retrain). The 2 stranded promotions (`spy_vol_price_coherence` and `spy_momentum_vol_decoupling`) are direct evidence of the gap that ADR-0020 anticipated needing to fill. Closes when an action-layer script is implemented that reads director-approved experiments and materializes them into the production feature store, AND the 2 stranded signals are successfully wired as proof.

[SENTINEL] `EXPERIMENTS_TABLE_DIVERGENCE_RESEARCH_VS_PRODUCTION_V1`

Both research.public.experiments and production.public.experiments exist with the same 42-column schema but have diverged row counts (310 vs 674 as of 2026-05-07). Same `decision` column distribution shape (promoted/needs_review/rejected/failed) but different signals in each. Not FDW mirrors — independent tables with independent writes. Cause unknown: possibly different experiment-execution paths wrote to each historically, possibly intentional separation, possibly broken sync. The action-layer script being designed needs to know which table is canonical (or whether to read from both and merge). Closes when canonical experiments table is identified and either the divergence is reconciled or the action-layer script is explicit about which one(s) it reads.

[SENTINEL] `ASSISTANT_PATTERN_MATCH_BEFORE_DEEP_READ_AT_SESSION_START_V1`

Recurring assistant failure mode observed across multiple sessions including this one: assistant forms partial mental model of project early in session via pattern-matching against substrate name searches and small excerpts, then operates from that incomplete model for hours before being corrected. Each correction surfaces real infrastructure that was documented in ADRs/handoffs the assistant never read. Specific instances this session: treating signal_values as "old paused architecture" when it's the live production feature store; missing optimize.py + strategy.py existence; missing v2-wip + experiments table existence; conflating graduator with auto-promotion when ADR-0020 explicitly defers semantics; chasing fake Neon DB outage for 90+ minutes due to wrong-schema queries. Closes when assistant adopts deliberate session-start protocol: read full handoff body (not excerpt) + read mentioned ADR bodies (not excerpts) + verify project model before recommending direction. Likely needs codification in CLAUDE.md or equivalent session-orientation primer.

The sentinels resolved by this session (close in next handoff or via separate resolution-archival commit):
- `LGBM_SANDBOX_SIGNAL_VERSION_CONVENTION_UNDEFINED_V1` (id 3109) — convention `v_research_NNN` adopted, first version v_research_001 populated with 8 CFTC features

## Next session opening scope {#next-session-scope}

1. **Build the action layer (graduator implementation per ADR-0020).** Empirically the highest-priority work. Concrete first deliverable: script that reads `experiments WHERE decision='promoted'`, retrieves `signal_code`, executes it to backfill historical values into signal_values v_research_NNN sandbox, then proposes addition to lgbm_metadata. Tested first against the 2 stranded April promotions as proof-of-pattern. Estimated 4-6 hours of focused work plus design conversation about the design questions ADR-0020 left open (descriptor schema, threshold storage, directional vs magnitude-only sources).

2. **Resolve experiments-table divergence question** before/while building action layer. Need to know whether action layer reads from research.experiments, production.experiments, or both. ~30 min SQL drill to characterize the divergence.

3. **The hardcoded-portfolio-sim fix** (sentinel `LGBM_TRAINER_HARDCODES_PORTFOLIO_METRICS_V1`) — still well-scoped, ~2 hours, addresses operator's no-hardcoding rule. Independent of action-layer work.

4. **lev_money asymmetry investigation** — ~30 min SQL drill-down. Still pending from yesterday's session.

5. **Stale models investigation** — ~20 min, still pending.

6. **The sentinels resolved across this multi-day arc need formal closure:** FORM4_INGESTER_CRON_TIMING_SUBOPTIMAL_V1, ACTIVATE_WEIGHTS_NO_TRANSACTION_PARTIAL_STATE_RISK_V1, ACTIVATE_WEIGHTS_USES_DEPRECATED_DATETIME_UTCNOW_V1, LGBM_SANDBOX_SIGNAL_VERSION_CONVENTION_UNDEFINED_V1.

Out of scope for next session unless time available:
- Sub-model architecture (real architectural improvement but doesn't address verified gap; revisit after action layer)
- v2-wip completion (Phases 1, 3, 4 stubs — same reasoning, address after action layer closes the loop on existing promotions)
- Form 4 features for non-SPY tickers (multi-ticker prototype work; substantial scope)
- Auto-discover-with-validation pipeline (deferred enhancement)
- prices_daily expansion (separate substantial project)

## Assistant-pattern observations (narrative-only) {#assistant-patterns}

Following ADR-0015's pattern:

- **Pattern-matching before deep-reading at session start is a recurring failure mode.** Already captured as sentinel above. This session lost ~2 hours to it. The operator pushed three times for me to "stop pattern-matching and read carefully," and each time I corrected for that one specific instance but didn't generalize the discipline. Worth a session-start protocol change.

- **Asserting certainty without verification.** Multiple times this session I said "yes the SQL is correct" or "the prototype is faithful" without verifying. Each was wrong in some way. The "renaissance approach" framing operator established (be deliberate, document findings durably, treat as real engineering not quick prototyping) is the correct posture but I've been violating it through over-confident assertions.

- **Wrong instinct on "safe trainer improvements."** Claimed early stopping was LightGBM standard practice and would help. Empirically false for this domain. The diagnostic A/B/C runs were the right move once we noticed the regression, but I shouldn't have included early stopping in the initial prototype defaults at all without evidence. Should have shipped the prototype as production-equivalent first, then layered improvements as separate experiments.

- **N+1 query bug recurred.** Caught form4-reconciler N+1 yesterday and shipped the fix. Then introduced the same shape-of-bug in derive-cot-features.py (LATERAL re-execution disguised as set-oriented). Same fix pattern (two-phase materialization with temp table + index) applied. The pattern itself is repeatable but I'm not catching it during initial design — only when smoke tests stall.

- **Time-framing fatigue continues.** Operator told me to stop time-framing multiple times across sessions. Pattern recurred when uncertain about scope. Improving slowly but not gone.

- **Compounding errors at session-late hours.** The Neon DB false-outage chase was an extreme example — 90+ minutes of misdiagnosis where each fix introduced new errors. The right move would have been to acknowledge the error compounding and stop earlier. Did eventually acknowledge (operator noted "what have we been doing for like 15 min") but the right behavior is for me to notice the pattern myself before the operator has to call it out.

- **One genuine win on intellectual honesty:** when the early-stopping diagnostic showed the prototype was worse than production, I correctly suggested running A/B/C diagnostics rather than rationalizing or pushing forward with a known-inferior prototype. The "renaissance approach" worked there. Same posture should apply to the failure modes above.

---

## References

- ADR-0014 (External Research System): foundational architecture for documents/observations corpus.
- ADR-0017 (Research scraper v2 architecture): the v2 rebuild pattern that quant-research-scout-v2-wip follows.
- ADR-0018 (Director context expansion): un-paused directors with expanded research context.
- ADR-0019 (Data gap auto-populator): vendor mention classification.
- ADR-0020 (signal-graduation source-agnostic): the action-layer design that empirically still needs implementation. Two-source precondition now met (unusual-flow + form4 + cot reconcilers all live).
- ADR-0021 (Form 4 as second signal source): in-universe gate methodology.
- ADR-0022 (SOFAR ML Pipeline Architecture): canonical reference. Backlog item #1 (early stopping) is empirically incorrect; correction noted in ADR amendment OR via this handoff's sentinel.
- v2-wip design doc: `docs/specs/quant-research-scout-v2-design.md` — read in full this session.
- `/home/bot1/scripts/lgbm-predictor-prototype.py` — shipped this session.
- `/home/bot1/scripts/derive-cot-features.py` — shipped this session, two-phase materialization.
- `signal_values v_research_001`: 913,077 rows for SPY (892,897 copied from v1.0 + 20,180 new CFTC features).
- 2026-05-06 evening handoff: prior session.
