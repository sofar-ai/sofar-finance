# Quant Research Subsystem — PAUSED

**Paused:** 2026-04-22 (Wednesday evening session)
**Toggle script:** `~/scripts/quant-research-toggle.sh`
**Status check:** `~/scripts/quant-research-toggle.sh status`
**Unpause:** `~/scripts/quant-research-toggle.sh unpause`

## Why paused

The research subsystem has two structural problems that make it net-negative to keep running:

### Problem 1 — Hallucinated table names in generated signal code

The LLM (Claude in experiment-orchestrator, Ollama in overnight-research-daemon) generates Python compute functions. The prompts list table names but NOT column schemas. Without column info, the LLM guesses — and occasionally forgets the real table name entirely, producing code like:

- `FROM treasury_data` (real table: `treasury_rates`)
- `FROM prices_daliy` (typo)
- `FROM options_e0d` (zero instead of letter o)
- `FROM macro_data`, `FROM prices_arg_daily`, `FROM prices_distributed` (invented names)

Evidence: 496 files in `~/scripts/signals/experimental/` — most reference tables that don't exist in any DB. They error on first query.

### Problem 2 — No integration path for signals that DO work

Even when a signal computes correctly and gets marked `decision='promoted'`, there's no machinery to publish it. Verified state at pause:

- `experiments` table: 7 rows with `decision='promoted'` (SPY-focused signals)
- `published_signals` table: **0 rows** — nothing populates it
- `active-weights.json`: 24 baseline features, **none of the 7 promoted signals**
- `signal_attribution`: 0 rows
- LightGBM has **never seen** the promoted signals

The promote cycle ends at promotion. Signals are orphaned.

## Net effect

Running the subsystem spends compute (LLM API calls, S2 GPU cycles) to:
1. Generate hypotheses (most reference fake tables → errored out silently)
2. Run CPCV on the ~20% that do compute (legit work but...)
3. Mark some as promoted (stored in experiments table)
4. Done. Nothing consumes those promotions.

Accumulates garbage in `experiments` and `experiment_knowledge` without producing production value. Pausing stops the bleeding.

## What's paused

Cron entries tagged with `# QR-PAUSED:` prefix:
- `30 10 * * 1-5` research-scout-scraper.py
- `0 11 * * 1-5` research-summarizer.py (scout path)
- `30 2 * * 1-5` research-lab-scraper.py
- `0 3 * * 1-5` research-summarizer.py (lab path)
- `0 23 * * *` quant-research-scout.py

Services stopped:
- sofar-research.service (overnight-research-daemon.py)

Crontab backup at pause time: `~/crontab-backups/crontab.pre-pause-<timestamp>.txt`

## What's NOT paused (intentionally left running)

- AI synthesis (morning, intraday hourly, evening) — different subsystem, unaffected
- Unusual flow detector (every 15 min during RTH) — different subsystem
- Flow tape daemon — data ingestion, not research
- All market-data ingestion crons (prices, futures, dark pool, etc.)
- Pipeline-runner at 18:00 — needs to produce predictions regardless of research state
- Research directors (evening at 16:30, morning at 07:30) — these write strategic narratives from existing data, do NOT generate signal code

## Before unpausing, build these

### Fix for Problem 1 (hallucination)

**Fix A — Schema injection.** In `experiment-orchestrator.py` (and `overnight-research-daemon.py`), replace the row-count-only data summary with full schema dumps:

```python
data_summary = "Available tables and columns:\n\n"
for table in AVAILABLE_TABLES:
    cols = execute_query("""
        SELECT column_name, data_type FROM information_schema.columns 
        WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position
    """, (table,))
    count = execute_query(f"SELECT COUNT(*) AS n FROM {table}")[0]['n']
    col_spec = ', '.join(f"{r['column_name']} {r['data_type'].upper()}" for r in cols)
    data_summary += f"  {table} ({count:,} rows):\n    {col_spec}\n\n"
```

~10 lines per script. Eliminates the hallucination root cause.

**Fix B — Smoke-test gate.** Before inserting a generated experiment into the `experiments` table, execute the compute function against a small date range. If it errors on `relation does not exist` or `column does not exist`, either retry the LLM with corrective context, or reject the experiment. Never store code that doesn't execute.

### Fix for Problem 2 (no integration)

These are the Builds 1-6 from the queued list (see `SOFAR-SESSION-HANDOFF-TUESDAY-APRIL-21-2026.md`):

**Build 1 — `promote-signal-to-production.py`**
- Finds `experiments.decision='promoted' AND signal_name NOT IN active-weights.features`
- For each: reads signal_code from DB, writes canonical file `~/scripts/signals/sig_<name>.py`
- Inserts row into `published_signals`
- Backfills `signal_values` historically (2y window)
- Appends to `active-weights-proposed.json` (NOT active-weights.json — requires human bless)

**Build 2 — `bless-weights-proposal.py`**
- Human gate. You review the proposal.
- Run this to archive current active-weights, activate proposal, log to `weight_change_log`

**Build 3 — Re-enable signal compute cron**
- Uncomment the `# PIPELINE:` lines for compute_fast.py, compute_batch_signals.py, sig_multi_timeframe.py
- Verify graduated signals get picked up (registry pattern or explicit imports)

**Build 4 — `batch-validate-candidates.py`**
- Periodic (weekly?) retrain with full candidate pool + baseline
- Measures gain importance + permutation importance + SHAP values
- Reports which features earn their place
- Gates Build 1 promotions based on batch results

**Build 5 — Smoke-test gate integration**
- Pairs with Fix B above
- Before insert into experiments, compute() against small date range
- Fail fast on hallucinated tables/columns

**Build 6 — LightGBM retrain cron**
- After Builds 1-5 flow data through the loop
- Periodic retrain reads active-weights.features + signal_values
- New weight_set compared to current via held-out period
- Auto or human-gated activation

## Larger architectural trajectory (from Tuesday handover)

Three-tier ensemble search:

- **Tier 1** (after Builds 1-6): Continuous batch re-validation. ~100-200 signals.
- **Tier 2**: Evolutionary feature subset search with LLM-assisted subset proposal. ~500+ signals.
- **Tier 3**: Online bandit allocation across regime-specific models. Ambitious.

See full trajectory in `SOFAR-SESSION-HANDOFF-TUESDAY-APRIL-21-2026.md` section "Future architecture — ensemble search at scale".

## Unpause checklist

Before running `quant-research-toggle.sh unpause`, verify:

- [ ] Fix A shipped (schema injection in experiment-orchestrator.py and overnight-research-daemon.py)
- [ ] Fix B / Build 5 shipped (smoke-test gate)
- [ ] Builds 1-3 shipped (promote → published → compute)
- [ ] Build 4 shipped (batch validation)
- [ ] Build 6 shipped (retrain loop)
- [ ] End-to-end flow tested: new LLM hypothesis → smoke-test passes → CPCV → promoted → published → signal_values backfilled → active-weights-proposed → human bless → retrain → LightGBM consumes → prediction
- [ ] Regression test: confirm a known-good signal still compute cleanly

When all checked, `~/scripts/quant-research-toggle.sh unpause` restores everything.

## Related files

- Toggle script: `~/scripts/quant-research-toggle.sh`
- Crontab backup: `~/crontab-backups/crontab.pre-pause-*.txt`
- Tuesday handover: `~/sofar-finance/SOFAR-SESSION-HANDOFF-TUESDAY-APRIL-21-2026.md`
- Methodology doctrine: `~/sofar-finance/docs/DEFERRED_METHODS.md`
- Database routing architecture: `~/sofar-finance/docs/database-routing.md` (if present)
