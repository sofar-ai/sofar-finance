# ADR-0023: Promotion executor — running approved signal_code into signal_values

**Date:** 2026-05-08
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0011 (verify schema before write), ADR-0020 (signal-graduation source-agnostic — sibling pipeline piece, not parent), ADR-0022 (SOFAR ML pipeline architecture — downstream consumer)
**Sentinel:** `ARCHITECTURAL_PIECE_CONFLATION_GRADUATOR_VS_EXECUTOR_V1`

---

## Context

The 2026-05-07 evening handoff empirically verified the gap captured by sentinel `EXPERIMENT_PROMOTION_NO_ACTION_LAYER_V1`: as of 2026-05-08, `research.experiments` contains 2 rows with `decision='promoted'` (`spy_vol_price_coherence` promoted 2026-04-15 and `spy_momentum_vol_decoupling` promoted 2026-04-16, both from `overnight_daemon`, both with `signal_code` populated as ~1600-1900 character Python `compute_signal(db)` function definitions), and `market.signal_values` contains zero rows for either signal at any `signal_version`. The director's promotion decision has had no downstream effect for ~3 weeks. There is no script in the repo that closes this loop.

ADR-0020 specifies a different piece of the open-quant pipeline: a *graduator* that aggregates per-(method, horizon) statistics from per-source measurement tables (e.g. `unusual_flow_returns`) and INSERTs qualifying methods INTO `experiments`. ADR-0020's graduator runs *upstream* of the director's promotion decision; this ADR's executor runs *downstream* of it. Both pieces are source-agnostic in spirit and read-from-one-table-write-to-another in shape, which led the 2026-05-07 handoff to refer to the executor as "the action layer / graduator" while citing ADR-0020 as its design spec. That conflation is named in sentinel `ARCHITECTURAL_PIECE_CONFLATION_GRADUATOR_VS_EXECUTOR_V1` and motivates this ADR being its own document rather than an extension of ADR-0020.

A separate finding during pre-design verification: the `EXPERIMENTS_TABLE_DIVERGENCE_RESEARCH_VS_PRODUCTION_V1` sentinel (filed 2026-05-07) appears to have been filed on a wrong premise. Production database queries showing "7 promoted signals" almost certainly hit `production.research_fdw.experiments` (a postgres_fdw foreign table that mirrors `research.experiments`) under a different decision filter, not a divergent local table. As of 2026-05-08, `production.public.experiments` and `research.public.experiments` show byte-identical decision histograms (failed=183, rejected=51, blank=45, needs_review=29, promoted=2). Sentinel hygiene deferred to tonight's session-wrap handoff.

## Decision

Build a **promotion executor** as `~/scripts/promotion-executor.py`. Source-agnostic from the first commit. Reads `experiments WHERE decision='promoted'`, executes each row's `signal_code` in an isolated subprocess with read-only database access, and writes the resulting (date, value) tuples into `signal_values` under a sandbox `signal_version` (never `v1.0` in this version). Refuses to execute any row whose review gate does not pass: `human_reviewed_at` and `human_reviewed_signal_code_hash` must both be non-NULL, and the stored hash must match the current `sha256(signal_code)`.

### Schema change

Add two columns to `research.experiments`:

```sql
ALTER TABLE experiments
  ADD COLUMN human_reviewed_at TIMESTAMPTZ,
  ADD COLUMN human_reviewed_signal_code_hash VARCHAR(64);
```

Migration sentinel: `EXECUTOR_HUMAN_REVIEW_GATE_V1`.

The two columns together form the trust marker for executor admission. `human_reviewed_at` records WHEN review happened; `human_reviewed_signal_code_hash` records WHAT was reviewed (sha256 of `signal_code` at approval time). Co-locating both with the artifact means any post-approval mutation of `signal_code` is detectable: at execution time the executor recomputes `sha256(signal_code)` and refuses to run if it does not match `human_reviewed_signal_code_hash`. Timestamp-only would have failed this property — an edit between approval and execution would slip through unnoticed.

Executor admission predicate:

```
human_reviewed_at IS NOT NULL
  AND human_reviewed_signal_code_hash IS NOT NULL
  AND sha256(experiments.signal_code) == experiments.human_reviewed_signal_code_hash
```

On hash mismatch, the executor refuses with:

```
[signal_name] signal_code mutated after approval; re-review required
  approved sha256: <stored hash>
  current sha256:  <recomputed hash>
```

No check constraint is placed on the columns. Direct `psql` UPDATE remains a valid (if discouraged) approval path — the gate is the column values, not the mechanism that set them. The recommended path is the executor's own `--approve` subcommand (see Operational model below), which computes the hash atomically with the timestamp.

### Execution model

Per-signal subprocess isolation. Each promoted row's `signal_code` is written to a temp file and executed via `python3 -c "..."` in a fresh subprocess that:

- Imports nothing from the executor's process state
- Receives a `db` callable bound to a Postgres connection opened with `options='-c default_transaction_read_only=on'` against the `market` database
- Has `resource.setrlimit` enforced for `RLIMIT_AS` (4 GB virtual memory) and `RLIMIT_CPU` (300 seconds CPU time)
- Has its wall-clock bounded by a 5-minute parent-side `subprocess.run(..., timeout=300)`
- Returns its result as JSON on stdout, errors as JSON on stderr
- Returns its `(date, value)` tuples serialized as `[[date_iso, float], ...]`

The subprocess does not have its network firewalled (deferred — spark-cfbd lacks easy egress controls without containerization, acceptable risk given the human-review gate and the small N of signals).

### Backfill date range

Default backfill window comes from the experiment row itself: `(experiments.date_range_start, experiments.date_range_end)`. This matches the window the original backtest was run over, making post-execution math validation against the backtested Sharpe/accuracy a like-for-like comparison.

When `date_range_start` or `date_range_end` is NULL on the experiment row, the executor falls back to "all available history" — the subprocess returns whatever its `compute_signal(db)` returns when given full historical data. This is the case for both currently-promoted signals (their `date_range_*` columns are unverified at draft time; the executor will surface this in dry-run output regardless).

CLI overrides:

```
--backfill-from YYYY-MM-DD     # override date_range_start
--backfill-to YYYY-MM-DD       # override date_range_end
```

Dry-run output explicitly states whether the effective backfill window matches the original backtest window:

```
[spy_vol_price_coherence] Backfilling 1247 rows from 2024-01-02 to 2026-04-14
                          Matching original backtest window: yes
                          (date_range_start=2024-01-02, date_range_end=2026-04-14)
```

When the window does not match (operator override, or NULL fallback to full history), the line reads `Matching original backtest window: no` with the divergence reason. Math validation against the original Sharpe/accuracy must restrict to the matching window before comparing.

### Write semantics

Writes to `market.signal_values` with:

- `signal_name` ← `experiments.signal_name`
- `signal_version` ← required CLI arg `--target-version` (no default)
- `ticker` ← `experiments.ticker` (defaults to `'SPY'` per existing schema; both current promoted rows use this default and their `signal_code` queries `WHERE symbol = 'SPY'`, so this is consistent)
- `value` ← the float from each `(date, value)` tuple returned by `compute_signal`
- `raw_value` ← NULL in v1 (jsonb left for future use; see open questions)
- `computed_at` ← `now()` (schema default)

Idempotency via `ON CONFLICT (date, signal_name, signal_version, ticker) DO NOTHING` (the existing UNIQUE constraint). Re-running the executor against the same target version is safe — already-written rows are not modified, new rows are added. This also means a promotion that gets re-decided later (e.g. `needs_review` → `promoted` for a row currently in that state) is handled cleanly when the executor next runs against a fresh target version.

### CLI surface

```
promotion-executor.py
  --target-version v_research_NNN     [required for execute mode]   sandbox signal_version to write under
  --signal-name NAME                  [optional]                    restrict to a single signal_name
  --dry-run                           [default in execute mode]     execute, print plan, write nothing
  --commit                            [opt-in in execute mode]      execute and write
  --backfill-from YYYY-MM-DD          [optional]                    override experiments.date_range_start
  --backfill-to YYYY-MM-DD            [optional]                    override experiments.date_range_end
  --approve EXPERIMENT_ID             [subcommand mode]             compute sha256(signal_code), set human_reviewed_at=now() and human_reviewed_signal_code_hash atomically
  --skip-review-gate                  [forbidden in v1]             reserved; raises NotImplementedError
```

`--dry-run` and `--commit` are mutually exclusive. Dry-run is the default; `--commit` must be passed explicitly. `--approve` is its own mode and is not combined with execute flags.

### Operational model (v1)

Operator-invoked, not cron'd. The expected workflow per stranded promoted signal:

1. Operator runs `--dry-run` against the target sandbox version
2. Executor lists each promoted row with its review-gate status; refuses to execute any row where the gate predicate fails (NULL columns, or hash mismatch)
3. Operator inspects the printed `signal_code` snippet (executor prints first 500 chars and full sha256), greps for the suspicious-call list (see Negative consequences below), reviews
4. Operator runs `promotion-executor.py --approve <experiment_id>` — this computes sha256, atomically sets both columns, and writes a line to `~/logs/promotion-executor.log` with experiment_id, sha256, and timestamp
5. Operator re-runs `--dry-run` — gate now passes, executor prints planned writes
6. Operator inspects dry-run output (row counts, date ranges, sample values)
7. Operator runs with `--commit` to write
8. Operator runs math-validation queries against `signal_values` to confirm reproduced statistics match the original backtest

`--approve` is the recommended path because it captures the hash atomically with the timestamp and emits an audit log line. Direct `psql` UPDATE remains valid for emergency or scripted use — the gate logic is identical regardless of how the columns got set — but loses the audit log entry and requires the operator to compute the sha256 by hand. No check constraint enforces `--approve`; this is convention, not mechanism.

Promotion to cron deferred until at least 3 successful manual cycles across at least 2 distinct signals.

### Sandbox version assignment

The two stranded signals are executed into a fresh `signal_version='v_research_002'`, kept separate from `v_research_001` (which is reserved for the in-flight CFTC features experiment). Each future executor run takes its own target version per the `v_research_NNN` convention.

## Out of scope (deferred to later ADRs)

- **Proposals table.** A `lgbm_metadata_proposals` table that the Sunday retrain reads to discover candidate features. Sketch in the 2026-05-08 design discussion; will become its own ADR after the executor proves out against `v_research_002`.
- **Production `v1.0` writes.** The executor in v1 cannot write to `signal_version='v1.0'`. Promoting a sandbox-validated signal to production is a separate decision and a separate ADR.
- **Auto-execution / cron.** Deferred until manual cycles have shown the executor is well-behaved.
- **Network firewall on subprocess.** Deferred. The combination of human-review gate + read-only `db` adapter + resource limits is the v1 trust boundary.
- **Multi-ticker signals.** Both current promoted signals are SPY-only with `experiments.ticker='SPY'`. The executor uses `experiments.ticker` as the source of truth for the ticker column on writes; this becomes a real assumption to revisit when a multi-ticker signal is first promoted.
- **`raw_value` jsonb usage.** Left NULL in v1. Future signals may want to store directional metadata or per-row provenance; design deferred until a real use-case appears.

## Consequences

### Positive

- Closes the action-layer gap captured by `EXPERIMENT_PROMOTION_NO_ACTION_LAYER_V1`. The 2 stranded April-15/16 promotions get backfilled into the sandbox.
- Source-agnostic by construction. Adding a future signal source means writing a reconciler and getting a director promotion; the executor needs no change.
- Human-review gate at the trust boundary, co-located with the artifact. Hash-pinning means any mutation of `signal_code` post-approval is detected at execution time and re-review is forced.
- Dry-run by default, sandbox-only target, idempotent writes. Three independent guards before any production exposure.
- Backfill window provenance is explicit in dry-run output. Math validation against original backtest is a like-for-like comparison.

### Negative

- Manual review gate adds operator friction per new promoted signal. Acceptable at current volumes; revisit if signal volume grows past ~1/week.
- Subprocess overhead is roughly 500ms per signal. Negligible at current N (2-30 signals); irrelevant compared to actual computation time of the signals themselves.
- Does not scale to thousands of signals as written. Acceptable for foreseeable horizon.
- Network is not firewalled at the subprocess boundary. Mitigated but not eliminated by the human-review gate; operator is the last line of defense if `signal_code` contains a network call. Reviewer should grep for `urllib`, `requests`, `socket`, `http`, `subprocess`, `os.system`, `eval`, `exec`, `compile`, `__import__`, `pickle` before clearing review. (`pickle` covers deserialization attacks; `compile` is the underlying primitive for `eval` and `exec`.)

### Risks accepted

- An operator who clears the review gate without actually reading the code defeats the gate. This is a discipline risk, not a code risk; mitigated by the sentinel, by the executor printing the sha256 of the reviewed code, and by the `--approve` audit log line. The hash-pinning property catches the mutation case but not the rubber-stamp case.
- The director LLM that wrote `signal_code` could in principle be prompt-injected via document corpus. Out of scope for executor; addressed by upstream director hardening if/when needed.

## Open questions explicitly deferred

- When and how does a sandbox-validated signal graduate to `signal_version='v1.0'`? (Future ADR.)
- Should the proposals table be its own table, or columns on `experiments`, or both? (Future ADR.)
- After N successful cycles, is auto-execution warranted, or does the human-review gate stay forever? (Revisit after operator experience.)
- Does the executor need to handle signals whose `compute_signal` returns something other than `(date, float)` tuples — e.g. multi-value tuples for compound signals? (Defer; not present in current promotions.)

## References

- 2026-05-07 evening handoff §"action-layer gap empirically verified" and §"next session"
- 2026-05-08 design conversation (this session)
- Sentinel `EXPERIMENT_PROMOTION_NO_ACTION_LAYER_V1` — the gap this ADR closes
- Sentinel `ARCHITECTURAL_PIECE_CONFLATION_GRADUATOR_VS_EXECUTOR_V1` — first filed in this ADR's header
- Sentinel `EXPERIMENTS_TABLE_DIVERGENCE_RESEARCH_VS_PRODUCTION_V1` — flagged for re-investigation in tonight's handoff (likely filed on FDW-confused premise)
- ADR-0011 — verify-schema-before-write discipline; executor follows it for both `experiments` reads and `signal_values` writes
- ADR-0020 — sibling pipeline piece (graduator); explicitly not the parent of this ADR
- ADR-0022 — downstream consumer (lgbm pipeline) of what this executor writes
