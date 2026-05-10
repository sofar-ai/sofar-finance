# 2026-05-09 Saturday evening handoff

**Session length:** ~9 hours (continued from 2026-05-07 Thursday work; this session ran Saturday evening into early Sunday morning UTC, plus a brief Sunday-morning wrap to commit the executor and write this doc).

**Primary outcome:** **Action-layer gap closed for 2 of 7 promoted signals.** Promotion executor designed, built, shipped, and run end-to-end. 16,440 rows landed in `market.signal_values` under sandbox version `v_research_002`. Five additional promoted experiments queued for next-session review.

---

## What shipped

### ADR-0023 (commit `0b7f3533f`)
`docs/adr/0023-promotion-executor.md`. Source-agnostic promotion executor design. Status: `proposed` at file-write time; should be flipped to `accepted` now that the executor is live and proven on 2 signals. Two-column review gate with sha256 hash-pinning. Subprocess isolation. Sandbox-only writes in v1. Cross-DB atomicity flagged as out-of-scope (correction noted below).

Files sentinel `ARCHITECTURAL_PIECE_CONFLATION_GRADUATOR_VS_EXECUTOR_V1` in its header.

### Migration `20260508-executor-human-review-gate.sql` (commit `0908bac53`)
`migrations/20260508-executor-human-review-gate.sql`. Adds two columns to `research.experiments`:
- `human_reviewed_at TIMESTAMPTZ`
- `human_reviewed_signal_code_hash VARCHAR(64)`

`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so the migration is safe to re-run. Does NOT write to `migrations_applied` — that table doesn't exist in research despite documentation claiming it should. See `MIGRATIONS_APPLIED_RESEARCH_DB_BOOTSTRAP_NOT_TAKEN_V1` below.

**Important footnote on this migration's effective state:** it was committed via `psql "$DATABASE_URL_DIRECT"` with apparently-successful BEGIN/ALTER/SELECT/COMMIT output, but the column changes were not visible to db.py-routed reads several hours later. Re-running the same ALTER via `execute_query(..., direct=True)` from the executor's own code path made the columns reliably visible. Root cause unresolved. See `RESEARCH_DB_BACKEND_CATALOG_DIVERGENCE_NEON_V1` below.

### `~/scripts/promotion-executor.py`
Committed to `sofar-scripts` repo this morning (commit landed on `main`). 594 lines. Two CLI modes:

- `approve <experiment_id>` — fetches signal_code, computes sha256, atomically updates both review-gate columns, writes audit line to `~/logs/promotion-executor.log`
- `execute --target-version v_research_NNN [--signal-name X] [--dry-run|--commit] [--backfill-from D] [--backfill-to D]` — fetches promoted experiments, applies review gate (timestamp non-NULL AND hash matches current `sha256(signal_code)`), runs each in isolated subprocess with `RLIMIT_AS=4GB`, `RLIMIT_CPU=300s`, wall-clock 300s, read-only `db()` adapter against market via `default_transaction_read_only=on`. Idempotent writes via `ON CONFLICT (date, signal_name, signal_version, ticker) DO NOTHING`.

Subprocess imports nothing from parent process state. signal_code passed via stdin. Results returned as JSON `[[date_iso, float], ...]` on stdout.

Parent uses db.py's `execute_query` and `execute_many` directly. TABLE_DB_MAP auto-routes: `experiments → research`, `signal_values → market`.

### Signal_values rows written

| signal_name | signal_version | rows | date range | value range |
|---|---|---|---|---|
| spy_vol_price_coherence | v_research_002 | 8105 | 1994-02-24 → 2026-05-08 | -3.7006 → +4.2803 |
| spy_momentum_vol_decoupling | v_research_002 | 8335 | 1993-03-30 → 2026-05-08 | -4.5833 → +3.4695 |

Both signals are z-scores by construction; distributions are healthy (predominantly in ±2, tails reaching ±4 over 32-year sample, no NaN, no overflow). First-value oddity in spy_momentum_vol_decoupling (-1.0 exactly at index 41) traced to structural artifact: z-score with sample size 2 is exactly ±1.0; not a numerical bug, faithfully reproduces the original signal definition.

**Math not yet validated against original backtest Sharpe.** Per ADR-0023's Out-of-Scope, the experiments rows have `date_range_start/end = NULL`, so the executor backfilled full available history rather than the original backtest window. The originals reported Sharpe ~4.96; we have not yet computed a windowed Sharpe from `v_research_002` to compare like-for-like. Suggested follow-up for next session.

---

## What is still queued

Five promoted experiments untouched this session. All `decision='promoted'`, all `human_reviewed_at IS NULL`, all from `overnight_daemon` between 2026-04-20 and 2026-04-22:

| signal_name | promoted | backtest_sharpe | backtest_accuracy |
|---|---|---|---|
| spy_atr_vol_of_vol | 2026-04-20 | 4.9172 | 53.35 |
| spy_bond_vol_lead_ratio | 2026-04-20 | 4.9629 | 53.91 |
| sp_vol_atr_divergence_zscore | 2026-04-21 | 4.9860 | 53.40 |
| spy_qqq_corr_zscore | 2026-04-22 | 5.1966 | 53.66 |
| spy_atr_spread_vol_divergence | 2026-04-22 | 5.3502 | 53.80 |

The `--dry-run` smoke test in this session showed all 5 BLOCKed correctly with full signal_code previews printed. Three of them (spy_atr_vol_of_vol, sp_vol_atr_divergence_zscore, spy_atr_spread_vol_divergence) appear to involve ATR; spy_bond_vol_lead_ratio and spy_atr_spread_vol_divergence query both `prices_daily` and `treasury_rates`; spy_qqq_corr_zscore queries SPY+QQQ. None of them passed visual review yet.

**Workflow per signal for next session (proven this session):**
1. `python3 -c "from db import execute_query; rows = execute_query(\"SELECT signal_code FROM experiments WHERE experiment_id = %s\", ('exp-XXX',)); print(rows[0]['signal_code'])"` — read full code
2. Programmatic grep for the suspicious-token list (urllib, requests, socket, http, subprocess, os.system, eval, exec, compile, __import__, pickle)
3. Visual eyeball
4. `./promotion-executor.py approve exp-XXX`
5. `./promotion-executor.py execute --target-version v_research_002 --signal-name <name> --dry-run`
6. Math sanity (z-score-shape, sane date range, no NaN/overflow)
7. `./promotion-executor.py execute --target-version v_research_002 --signal-name <name> --commit`
8. Verify in signal_values

Time per signal: ~5 minutes if clean, longer if anything weird in the code.

---

## Sentinels

### Closing or status-changing

- **`EXPERIMENT_PROMOTION_NO_ACTION_LAYER_V1`** — **resolved for 2 signals, still active for the 5 queued.** Keep status active until all 7 promoted experiments have been processed. Suggest closing once the 5 queued signals are backfilled.

- **`EXPERIMENTS_TABLE_DIVERGENCE_RESEARCH_VS_PRODUCTION_V1`** — **close as filed-on-wrong-premise.** Last session's report of "research has 2 promoted, production has 7 promoted" appears to have been a query against `production.research_fdw.experiments` (a postgres_fdw foreign table mirroring research's experiments) misread as production's local data, OR a query under a different `decision` filter. As of 2026-05-08 verification, `production.public.experiments` and `research.public.experiments` showed byte-identical decision histograms (failed=183, rejected=51, blank=45, needs_review=29, promoted=2 at the time, now 7 promoted across both). Not divergence; FDW mirroring working correctly.

- **`ARCHITECTURAL_PIECE_CONFLATION_GRADUATOR_VS_EXECUTOR_V1`** — **filed and active.** Already in ADR-0023 header; should materialize on next ADR-extractor cron run if it hasn't already. Captures: ADR-0020's graduator (raw measurement tables → INSERT INTO experiments) is a different pipeline piece from the executor (experiments WHERE decision='promoted' → backfill signal_values). The 2026-05-07 handoff conflated them. Discipline: when an ADR is cited as a spec for new code, verify scope match (inputs/outputs/gating) before treating ADR open questions as the code's design questions.

### New sentinels to file (mentioned in backticks for ingestion)

- `RESEARCH_DB_BACKEND_CATALOG_DIVERGENCE_NEON_V1` — Real Neon-side behavior observed this session and not fully understood. Migration was applied via `psql "$DATABASE_URL_DIRECT"` and reported `ALTER TABLE` + `COMMIT` cleanly, with in-session verification SELECTs showing the new columns. Hours later, db.py-routed reads (also `direct=True`, identical URL components per `_get_url`) returned `UndefinedColumn` and pg_attribute showed only 42 columns on `public.experiments` across 30 fresh connections. Same Neon project (spring-sun-27699207), no branches, `pg_is_in_recovery=False`. Single ALTER re-run via `execute_query(..., direct=True)` (the executor's own connection path) made the columns stably visible to all subsequent reads (30/30 connections confirmed 44 columns). **Discipline:** when migration effects are unclear, re-run via the same connection path the consuming code uses, not via psql, even if env file is the same. Verify with `pg_attribute` on a fresh process from the consumer's connection path. Suggested investigation: open Neon support ticket if reproducible; check for separate read-replicas, transient page-server inconsistencies, or compute-pool quirks not surfaced through standard introspection.

- `MIGRATIONS_APPLIED_RESEARCH_DB_BOOTSTRAP_NOT_TAKEN_V1` — `migrations_applied` was created in market DB long ago (per ADR-0005) and bootstrap of the same table in research DB was attempted by `20260502-research-library-v1.sql` via `CREATE TABLE IF NOT EXISTS`. As of 2026-05-08 the table is absent from research. Either the May 2 migration's bootstrap block didn't run, or the table was dropped afterward. CLAUDE.md still implies the convention is universal. **Action deferred:** decide whether to (i) re-bootstrap fleet-wide in a discrete migration with sentinel `MIGRATIONS_APPLIED_BOOTSTRAP_FLEETWIDE_V1`, or (ii) update CLAUDE.md to drop the convention and adopt "git history is the audit trail." This session's executor migration explicitly skipped the tracking insert to avoid mixing concerns.

- `SUBSTRATE_DATA_TABLE_COUNTS_STALE_V1` — Substrate reported `research = 21 tables` when queried for orientation this session. Reality (via `information_schema.tables` against research with `direct=True`) is 33 local public tables plus 7 foreign tables in `research_fdw` schema and 17 foreign tables in `market_fdw` schema. Substrate's `data_table` entity count is stale by at least 12 tables. **Action deferred:** check `~/scripts/extract_data_relationships.py` cadence and last-run timestamp; consider whether substrate counts should be regenerated nightly or on-demand.

- `INFORMATION_SCHEMA_NOT_TIGHT_ENOUGH_AS_MIGRATION_VERIFICATION_V1` — During the migration verification SELECTs inside `20260508-executor-human-review-gate.sql`, the in-session verification queried `information_schema.columns` and reported the new columns present. Later read from a different connection path showed the columns absent. **Information_schema can summarize state from a backend other than the one your consuming queries reach.** Tighter check: `SELECT count(*) FROM pg_attribute WHERE attrelid = 'schema.table'::regclass AND attname = ...` from a fresh process on the consumer's exact connection path. Strongest check: run the actual SELECT that the consuming code will run, against the consumer's connection. Update CLAUDE.md migration-verification guidance accordingly.

### Optional, me-shaped, file at operator's discretion

- `ASSISTANT_LOST_FDW_MENTAL_MODEL_MID_SESSION_V1` — Assistant correctly identified the `research_fdw.experiments` foreign-table mirror pattern early in the session when investigating apparent research-vs-production divergence. By session hour ~4, when investigating an apparent same-host-three-DBs situation, the mental model had decayed and the assistant generated false alarms before the operator surfaced the FDW pattern again. **Discipline:** when interpreting unexpected DB query results involving table catalogs or cross-DB consistency, explicitly check whether `*_fdw` foreign-table schemas would explain the result before reasoning from "two DBs have the same data" or "three DBs see the same tables." Promoting FDW topology from "implicit knowledge gained per session" to "explicit fact in CLAUDE.md or substrate" would close the recurrence.

- `ASSISTANT_SED_PIPELINE_BROKE_AND_WAS_TRUSTED_V1` — Assistant produced a sed pipeline to extract hostnames from three env files; the pipeline returned what looked like three identical hostnames; assistant reasoned from that output as if it were real data, generating false alarms about all three DBs being one project. Operator manually verified the hosts were actually distinct. **Discipline:** when assistant's own tooling produces a surprising-uniformity result, the first hypothesis is the tooling, not the underlying reality.

---

## Pitfalls to add to CLAUDE.md

These all came up live this session and would have saved time if they were already documented:

1. **FDW topology section.** Each project (research/market/production) has `<otherproject>_fdw` schemas containing foreign-table mirrors of the other projects' tables. A query like `SELECT ... FROM research_fdw.experiments` viewed from production returns research's data via FDW, not a divergent local table. Information_schema and `\dt` from any connection list these foreign tables alongside the local ones; the distinction is `table_type='FOREIGN'` vs `'BASE TABLE'`. Cross-DB joins use these schemas explicitly.

2. **Neon connection-path divergence warning.** Same env file's `DATABASE_URL` vs `DATABASE_URL_DIRECT` typically point at pgbouncer-pooler vs direct-compute on the same project. But: a migration applied via `psql "$DATABASE_URL_DIRECT"` may not be reliably visible to subsequent `psycopg2.connect(DATABASE_URL_DIRECT)` reads, even though the URL components match. Verify migration effects via the consumer code's connection path before declaring a migration done.

3. **Verify with pg_attribute, not information_schema, when checking whether a recent migration landed.** Information_schema is a SQL-standard view layer; it can show columns from a backend other than the one your reads reach. `SELECT count(*) FROM pg_attribute WHERE attrelid = '<schema>.<table>'::regclass AND attname = '<column>'` from a fresh process on the consumer's exact connection path is the tighter test. Strongest is to run the actual consuming SELECT.

4. **db.py routing reminder.** TABLE_DB_MAP routing only applies to `execute_query`, `execute_many`, and `execute_script`. `get_connection()` does NOT auto-route; it falls back to `_DEFAULT_DB` (production) unless `db=` is passed explicitly. Easy bug if a script does `with get_connection() as conn` for a query touching a non-production table.

5. **`migrations_applied` is currently market-only.** Research and production do not have this table as of 2026-05-09 (despite CLAUDE.md implying universal). Until `MIGRATIONS_APPLIED_RESEARCH_DB_BOOTSTRAP_NOT_TAKEN_V1` is resolved, research migrations should not write to `migrations_applied`. Git history is the audit trail.

---

## Out-of-scope items deferred from ADR-0023 (track these)

These should each become their own ADR when picked up.

### Cross-DB atomicity (urgency: low; revisit when proposals table is built)
The executor reads from research (experiments) and writes to market (signal_values). It does not write back to experiments in execute mode (approve mode is the sole writer to the review-gate columns), so the two-DB sequence is currently safe. ADR-0023 v1 omits this from the design but it needs to be documented in a future amendment. **Concrete future scenario:** if we later add an `executed_at` column on experiments to track successful execution, the pattern "write signal_values rows AND mark experiments.executed_at = now()" cannot be made atomic across the research/market DB boundary in psycopg2 because they're physically separate Postgres instances. Options for that future ADR: (a) saga-pattern with idempotent writes + retry, (b) move executed-tracking to a single DB, (c) accept a partial-failure window and have a reconciler script.

### Proposals table (urgency: medium; next planned ADR)
A `lgbm_metadata_proposals` table that the Sunday retrain reads to discover candidate features. Schema sketched in last session's discussion: PK id, signal_name, signal_version, target_model, proposed_at/by, source_experiment_id, status (`pending|accepted|rejected|superseded`), status_at/reason, backfill_n_rows, backfill_date_range. The Sunday retrain would `WHERE status='pending' AND target_model='lgbm_v8_7day'` to pick up candidates; it would NOT auto-include — separate decision per ADR-0020 spirit. Should become ADR-0024 after the 5 queued signals are backfilled.

### Production v1.0 promotion (urgency: low; far future)
The executor in v1 can only write to sandbox versions (`v_research_NNN`); `v1.0` writes are explicitly forbidden by CLI guard. Promoting a sandbox-validated signal to production v1.0 needs its own ADR covering: criteria for graduation (match-windowed-Sharpe close enough to backtest), how the sandbox lgbm retrain influences the decision, and the actual mechanism (re-run the executor with target-version=v1.0? a separate migration script? a backfill from v_research_002 to v1.0?). This will probably be ADR-0026 or later.

### Auto-promotion / cron-ification (urgency: low)
ADR-0023 deferred cron-ification until at least 3 successful manual cycles across at least 2 distinct signals. With the 2 signals run this session, we're 1 of 3. The 5 queued signals are good candidates to reach the threshold. Not before mid-May.

### Multi-ticker signals (urgency: low)
Both current promoted signals are SPY-only; experiments.ticker='SPY' as default. The executor uses experiments.ticker as source-of-truth for the write-side ticker column. This is fine until a multi-ticker signal is first promoted — at that point the executor would need to handle a signal_code that returns rows for multiple tickers (which would require a contract change to compute_signal's return shape: from `[(date, value), ...]` to `[(date, ticker, value), ...]`).

### FDW mirror update for production.research_fdw.experiments (urgency: very low)
The two new columns are not visible through `production.research_fdw.experiments` because postgres_fdw foreign tables are static declarations, not live introspection. Updating the foreign table:
```sql
ALTER FOREIGN TABLE research_fdw.experiments
  ADD COLUMN human_reviewed_at TIMESTAMPTZ OPTIONS (column_name 'human_reviewed_at'),
  ADD COLUMN human_reviewed_signal_code_hash VARCHAR(64) OPTIONS (column_name 'human_reviewed_signal_code_hash');
```
…against the production DB. Skipped this session per agreed lean: executor queries research directly, no current consumer of the production-side FDW mirror needs review state, speculative coverage isn't worth the entanglement.

---

## Session statistics (for the operator's interest, not durable)

- **Length:** ~9h Saturday evening + ~1h Sunday morning wrap = ~10h total
- **Artifacts shipped:** ADR-0023 (164 lines), migration (56 lines), executor (594 lines). 814 lines of designed + reviewed + committed code total.
- **Sentinels surfaced:** 7 (3 active/closing, 4 new for next session, 2 optional me-shaped)
- **Detours:** ~90 min on the Neon catalog visibility issue. ~30 min on the broken-sed-pipeline false alarm. ~20 min on the (a)→(b) migration-tracking drift that the operator caught. Net detour cost ~140 min; productive time ~360 min.
- **Operator-caught assistant errors:** 4. (broken sed, silent migration option drift, lost FDW mental model, treating verification output from one question as if it were verification of another). All caught and corrected in-session.

---

## What "Path B" math validation would look like (next session pickup point)

If next session opens with "let's validate math before processing more signals," here is the sketch.

For each of the 2 already-committed signals, compute Sharpe on the signal_values rows over a reasonable window (e.g. 2022-01-01 → 2026-04-15 — recent, excludes warm-up, ends before the original promotion date). Compare to experiments.backtest_sharpe. Procedure: bucket signal values into long/short (sign of z-score), compute forward-day returns from prices_daily, multiply, take mean and std, scale to annual. If the resulting Sharpe is within ~10% of the original (4.96), executor reproduction is faithful. If wildly different, either the original backtest used a window the rerunning is missing, the signal definition was different at promotion time, or there's a bug in our reproduction. Worth ~30 minutes per signal.

This should happen before processing the 5 queued signals; if our executor doesn't faithfully reproduce the original math, we shouldn't trust it on additional signals.

---

## What's actively running

Nothing of this session is on cron. The executor is operator-invoked only. The 2-minute git-push cron handled the ADR/migration commits and is unrelated to executor operation.

---

## Continuity links

- ADR-0023: `docs/adr/0023-promotion-executor.md` (commit `0b7f3533f`)
- Migration: `migrations/20260508-executor-human-review-gate.sql` (commit `0908bac53`)
- Executor: `~/scripts/promotion-executor.py` (committed to sofar-scripts main this session)
- Audit log: `~/logs/promotion-executor.log` (6 lines as of this writing: 2 APPROVE + 2 EXECUTE_DRYRUN + 2 EXECUTE_COMMIT)
- Prior handoff: `docs/handoffs/2026-05-07-thursday-evening-handoff.md` (the session that empirically verified the action-layer gap and set up tonight's work)
