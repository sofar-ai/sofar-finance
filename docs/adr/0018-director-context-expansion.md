# ADR-0018: Research Director context expansion to consume documents + observations

**Date:** 2026-05-02
**Status:** accepted
**Deciders:** bot1
**Related ADRs:** ADR-0004 (quant subsystem pause), ADR-0014 (external research system), ADR-0017 (research scraper v2 architecture)

---

## Context

ADR-0004 paused the `research-director-evening.py` and `research-director-morning.py` scripts in cron via `# QR-PAUSED-DIRECTORS:` prefix on 2026-04-22. The pause covered both directors plus the broader quant subsystem (experiment-orchestrator, overnight-research-daemon, quant-research-scout, signal generators).

The directors were not the primary cause of the pause — that was the quant subsystem's hallucination problem. But the directors DEPEND on hypothesis state to produce useful briefings, and with hypothesis generation paused, director output had no fresh signal to draw from.

ADR-0014 §3 specified that directors should consume the new research substrate (`research.documents` and `research.observations`) once it was populated. That substrate was built up across this session: 4 ADRs ingested, schema migrated, scrapers v2 promoted, summarizer reframe deployed, ~190 documents ingested, ~580 observations extracted, ~63 data_gaps curated.

By 2026-05-02 evening, the research substrate was producing real signal but directors couldn't see it. The director scripts read 6 tables (market.flow_analysis, research.daily_summaries, research.data_gaps, research.data_scout_log, research.experiments, research.hypotheses) but NOT documents or observations — the gap captured as `ORCHESTRATOR_CONTEXT_EXPANSION_PENDING_V1`.

## Decision

Expand both director scripts to read from documents + observations + auto-populated data_gaps. Specifically:

1. **`gather_pipeline_context()` in evening director** — add 3 new ctx keys:
   - `ctx["recent_observations"]` — last 7 days of observations (LIMIT 80) joined to documents for source attribution
   - `ctx["recent_documents_summary"]` — count of new docs by source over past 24h
   - `ctx["top_vendors_mentioned"]` — vendors mentioned across observations (last 14 days, ≥2 mentions) joined against `data_gaps` for tier/status

2. **`build_user_prompt()` in evening director** — add 3 new prompt sections inserted after the hypothesis pipeline summary, before the data sources catalog block. Sections grouped by observation_type (claim/method/data_source/open_question/result) with source attribution for each excerpt.

3. **Morning director (different shape)** — adds new fetcher `get_research_observations_context(today)` returning the same 3 dicts. `build_morning_prompt` signature extended with `research_ctx=None` kwarg for backward compat. Sections inserted before function return.

4. **Un-pause both director cron entries** — remove the `# QR-PAUSED-DIRECTORS: ` prefix:
   - Evening: `30 16 * * 1-5 . /etc/sofar-llm.env && export OLLAMA_URL DIRECTOR_MODEL && python3 /home/bot1/scripts/research-director-evening.py >> /home/bot1/logs/director-evening.log 2>&1`
   - Morning: `30 7 * * 1-5 . /etc/sofar-llm.env && export OLLAMA_URL DIRECTOR_MODEL && python3 /home/bot1/scripts/research-director-morning.py >> /home/bot1/logs/director-morning.log 2>&1`

5. **Quant subsystem stays paused.** The remaining ADR-0004 builds 1-6 (schema injection, smoke-test gate, cleanup, promote-to-production.py, bless-weights-proposal.py, re-enable signal compute cron) are NOT part of this ADR. ADR-0018 is narrowly the briefing layer; the inference layers (quant-research-scout v2 with hypothesis grounding per ADR-0014 §5, experiment orchestrator, signal generators) remain dormant.

## Consequences

### Positive

- Directors produce briefings grounded in 80 recent observations + 20+ data-gap signals + research-library ingest counts
- Closes `ORCHESTRATOR_CONTEXT_EXPANSION_PENDING_V1`
- Provides immediate consumer for the work shipped in ADR-0014 + ADR-0017 (no more "latent value pending consumers")
- Monday morning's first run is the moment-of-truth for whether the research half is producing useful signal
- Patches were idempotent and applied via Python patcher scripts (`patch-director-evening.py`, `patch-director-morning.py`) with auto-backup and auto-rollback on syntax break — preserves exact pre-existing logic for everything else

### Negative

- Prompt size grew: evening 29,635 chars (~7,408 tokens), morning 21,595 chars (~5,398 tokens). Both still well within qwen3:235b's 262K context but no longer trivial.
- Hypothesis pipeline is still empty (quant-research-scout v2 not yet shipped). Directors will see lots of observations but few hypotheses to act on. Brief quality limited until ADR-0014 §5 ships.
- Pre-existing bug surfaced: `DIRECTOR_FETCH_DATA_SCOUT_ESCALATIONS_BROKEN_COLUMN_NAME_V1` — `fetch_data_scout_escalations()` references column names that don't exist (`ingestion_attempts` vs actual `scout_attempts`). Non-fatal but escalations always come back empty until fixed.

### Risks

- If observation extraction has quality issues (we saw `SUMMARIZER_DATA_SOURCES_SOMETIMES_DESCRIPTIONS_NOT_NAMES_V1`), the director will see noisy data and may reflect that noise back in briefings.
- Data-source vendor mentions list is curated against the data_gaps tier classifications (built same session via data-gap-populator). If those classifications have errors, the director sees them.
- Director output not validated yet against fresh data — Monday morning is the first real evaluation.

## Sentinels

`DIRECTORS_UNPAUSED_2026-05-02_AFTER_CONTEXT_EXPANSION_V1`
`ORCHESTRATOR_CONTEXT_EXPANSION_PENDING_V1` (resolved by this ADR)
`DIRECTOR_FETCH_DATA_SCOUT_ESCALATIONS_BROKEN_COLUMN_NAME_V1` (pre-existing, captured for follow-up)

## Files

- Patched: `/home/bot1/scripts/research-director-evening.py` (+84 lines)
- Patched: `/home/bot1/scripts/research-director-morning.py` (+86 lines)
- Backups: `.bak.20260503-0122` (evening), `.bak.20260503-0127` (morning)
- Cron backup: `~/crontab.bak.20260503-0130`
- Patcher scripts archived in handoff outputs
