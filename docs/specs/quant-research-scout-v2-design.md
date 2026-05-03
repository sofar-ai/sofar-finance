# Design Doc — quant-research-scout.py v2 rebuild

**Date:** 2026-05-03
**Status:** in-design
**Author:** session 2026-05-03 (continuing from 2026-05-02-saturday-evening)
**Related ADRs:** ADR-0004 (quant-research pause), ADR-0014 (external research system),
                  ADR-0017 (research scout v2 rebuild not migration), ADR-0018 (director context),
                  ADR-0019 (data gap auto-populator)
**Sentinel:** `HYPOTHESIS_GROUNDING_REQUIRED_V1`
**Source script:** `/home/bot1/scripts/quant-research-scout.py` on spark-cfbd
**Target script:** same path, v2 rebuild in place (with `.bak.YYYYMMDD-HHMM` backup)

---

## 1. Why this rebuild

Per ADR-0014 §6, every LLM-proposed hypothesis must cite at least one row in
`research.documents`. The v1 script does not enforce this — it omits
`cited_doc_ids` from its INSERT entirely, which means every insert either
fails on the NOT NULL constraint (if active) or silently violates the
grounding contract (if column added after v1 ran).

This rebuild closes `HYPOTHESIS_GROUNDING_REQUIRED_V1` and aligns the
script with the substrate-canonical research subsystem shipped Saturday
2026-05-02. ADR-0004's quant-research pause was, in part, waiting on
this enforcement; v2 is a prerequisite for fully un-pausing the
hypothesis side of the research loop.

## 2. What v1 actually was

Four-phase autonomous loop:
- **plan**: LLM reads schema + recent experiments, decides theme + queries
- **search**: SearXNG / Semantic Scholar / arxiv API / Chromium dump-DOM
  fetch raw web content into local memory
- **synthesize**: LLM reads ~15 content chunks, emits 5-10 hypotheses with
  signal definitions
- **reflect**: LLM extracts 2-3 meta-insights for next-cycle context

Outputs:
- `data/quant-research-queue.json` (legacy file consumer)
- `data/scout-scored-quant-YYYYMMDD.json` (legacy file consumer)
- `research.hypotheses` INSERT (without `cited_doc_ids` — the bug)

Persistence: `data/quant-scout-memory.json` for cross-cycle state.

LLM: `gemma4:26b` for everything, hardcoded as `SCOUT_MODEL`.
Network: bare `urllib.urlopen`, no retry/backoff, no timeout discipline.
Audit: log file only; no `scout_runs` row.

## 3. v2 architectural decisions (locked 2026-05-03)

### Decision 1 — Grounding architecture: **Y-pure**

Scout consumes the existing substrate corpus only.
- Phase 2 (search) is rewritten as a query against
  `research.documents` JOIN `research.observations` filtered by recency,
  ticker overlap, and theme tags
- No autonomous web fetch in v1 of v2
- Coverage gap is accepted; revisit with hybrid fallback if the corpus
  proves too narrow in practice

Rejected: X (cite-by-ingest), because it would make this script a parallel
scraper to research-scout-scraper.py and research-lab-scraper.py.
Architectural unification was the point of Saturday's work.

### Decision 2 — Models: **tiered, env-driven**

| Phase | Default model | Reasoning posture | Wall budget |
|---|---|---|---|
| plan | `qwen3.6:35b-a3b` | configurable via env, default `none` | ~15s |
| synthesize | `qwen3:235b` (mac1) | configurable via env, default `none` (TBD by A/B) | ~90s |
| reflect | `qwen3.6:35b-a3b` | `none` | ~5s |

Env vars (read from `/etc/sofar-llm.env` per ADR-0010):
- `QRS_PLAN_MODEL`, `QRS_PLAN_ENDPOINT`, `QRS_PLAN_REASONING_EFFORT`
- `QRS_SYNTHESIZE_MODEL`, `QRS_SYNTHESIZE_ENDPOINT`, `QRS_SYNTHESIZE_REASONING_EFFORT`
- `QRS_REFLECT_MODEL`, `QRS_REFLECT_ENDPOINT`, `QRS_REFLECT_REASONING_EFFORT`

Endpoints default to `http://localhost:11435/v1/chat/completions` (mac2-tunnel
per ADR-0016). mac1's qwen3:235b will need its own endpoint or a second
tunnel — see Open Questions §10.

Reasoning posture A/B test plan:
1. Ship with `none` everywhere. Run for ≥3 cycles. Capture per-phase metrics.
2. Flip `QRS_SYNTHESIZE_REASONING_EFFORT=medium`. Run for ≥3 cycles.
3. Compare via SQL: `SELECT sources_status->'phase_metrics'->'synthesize'->>'reasoning_effort', AVG(...) FROM scout_runs WHERE scout_name='quant-research-scout.py' GROUP BY 1`
4. Lock the winner in `/etc/sofar-llm.env`.

The summarizer's reasoning-mode patches (content/reasoning fallback,
escape repair, max_tokens headroom) port verbatim into v2's `call_llm`.
This makes the A/B flip safe regardless of which model emits to which field.

### Decision 3 — Single tier of LLM call function: **shared `call_llm(model, endpoint, reasoning_effort, ...)`**

One LLM-call function with parameterized model/endpoint/reasoning. No
per-phase forking of the call site. Phases pass their own config in.

Patches built in from day one (ported from research-summarizer.py v2):
- `reasoning_effort` + `think` keys in payload (configurable)
- Content/reasoning field fallback in response parsing
- Invalid JSON escape repair (`repair_invalid_json_escapes`)
- max_tokens headroom (default 8192, override per phase)
- Markdown fence stripping
- Trailing/missing-comma cheap repair

### Decision 4 — Drop daemon mode

`run_daemon`, `--daemon`, `--interval`, `--cycles` flags removed entirely.
Cron is canonical. Single cycle is the default invocation.

`MEMORY_FILE` JSON persistence preserved for now (cross-cycle insight
continuity). Future cleanup: migrate to a `scout_state` row in
`research`. Captured as future work, not in this rebuild.

### Decision 5 — `cited_doc_ids` enforcement: **three layers**

**Layer 1 — Soft (prompt):**
The synthesize prompt enumerates the available `doc_id` UUIDs and
requires the LLM to populate `cited_doc_ids` for each hypothesis from
that enumerated set. The system prompt explicitly states "every
hypothesis must cite at least one doc_id from the list above; cite by
exact UUID."

**Layer 2 — Hard (pre-insert validation):**
Before each `INSERT INTO hypotheses`, validate:
- `cited_doc_ids` is a non-empty list
- Every UUID in `cited_doc_ids` exists in the corpus passed to synthesize
  (cheap set membership check, no DB round-trip)

On failure: skip the INSERT, log a structured single-line JSON record:
```
[ts] [hypothesis_validation_failure] hypothesis_id=qr-... cited_doc_ids=[...] available_count=N reason=...
```
Increment `hypotheses_rejected_grounding` in scout_runs metrics.

**Layer 3 — Safety net (DB):**
`research.hypotheses.cited_doc_ids` is `ARRAY NOT NULL`. If layers 1+2
both miss, the INSERT fails loud at the DB.

Sentinel for repeat-failure pattern: `HYPOTHESIS_VALIDATION_FAILURES_TABLE_PROPOSED_V1`.

### Decision 6 — Corpus filter

**Primary signal: ticker overlap.**
**Secondary signal: theme/tag overlap.**
**Recency floor: 30 days** (`QRS_RECENCY_WINDOW_30D_TBD_AS_CORPUS_GROWS_V1`).

Corpus query (parameterized; SQL skeleton):

```sql
WITH plan_filters AS (
  SELECT %s::text[] AS target_tickers,
         %s::text[] AS target_themes,
         %s::int    AS max_age_days
),
candidate_docs AS (
  SELECT d.doc_id,
         d.title,
         d.source_subtype,
         d.fetched_at,
         d.tickers_detected,
         d.tags
    FROM documents d, plan_filters f
   WHERE d.fetched_at >= now() - (f.max_age_days || ' days')::interval
     AND (
       cardinality(f.target_tickers) = 0
       OR d.tickers_detected && f.target_tickers
     )
   ORDER BY d.fetched_at DESC
   LIMIT 30                          -- QRS_CORPUS_LIMIT_30_DOCS_TUNABLE_V1
),
ranked_observations AS (
  SELECT cd.doc_id,
         o.observation_id,
         o.observation_type,
         o.evidence_strength,
         o.text,
         o.tickers_mentioned,
         o.data_sources_mentioned,
         ROW_NUMBER() OVER (
           PARTITION BY cd.doc_id
           ORDER BY (o.evidence_strength = 'high')::int DESC,
                    (o.observation_type = 'finding')::int DESC,
                    (o.observation_type = 'claim')::int DESC,
                    (o.observation_type = 'method')::int DESC
         ) AS rank
    FROM candidate_docs cd
    JOIN observations o ON o.source_doc_id = cd.doc_id
)
SELECT cd.doc_id, cd.title, cd.source_subtype, cd.fetched_at,
       cd.tickers_detected, cd.tags,
       array_agg(json_build_object(
         'observation_id', ro.observation_id,
         'type',           ro.observation_type,
         'strength',       ro.evidence_strength,
         'text',           ro.text,
         'tickers',        ro.tickers_mentioned,
         'data_sources',   ro.data_sources_mentioned
       ) ORDER BY ro.rank) AS top_observations
  FROM candidate_docs cd
  JOIN ranked_observations ro ON ro.doc_id = cd.doc_id
 WHERE ro.rank <= 5                  -- top 5 observations per doc
 GROUP BY cd.doc_id, cd.title, cd.source_subtype, cd.fetched_at,
          cd.tickers_detected, cd.tags
 ORDER BY cd.fetched_at DESC;
```

Observation priority within each doc: high-strength `finding`
> high-strength `claim` > high-strength `method` > medium-strength `finding`
> rest. Captured as `QRS_OBSERVATION_PRIORITY_FINDING_OVER_METHOD_V1`.

Corpus shape passed to synthesize: list of dicts with fields
`{doc_id, title, source_subtype, fetched_at, tickers, tags, top_observations[]}`.

### Decision 7 — `scout_runs` row shape

Reuse existing `scout_runs` columns:
- `scout_name = 'quant-research-scout.py'`
- `host = HOST` (spark-cfbd)
- `started_at`, `completed_at`, `duration_seconds` standard
- `status ∈ {'running','completed','partial','failed'}`
- `documents_inserted` **repurposed as hypotheses_inserted**
  (`SCOUT_RUNS_DOCUMENTS_INSERTED_REPURPOSED_FOR_HYPOTHESES_V1`)
- `documents_skipped` repurposed as hypotheses_rejected_grounding
- `errors_count` standard
- `tokens_used` total across all phases
- `cost_usd` always NULL (local models per ADR-0010)
- `model_id` set to synthesize-phase model (the one that matters)
- `triggered_by` standard cron|manual|test|backfill
- `error_message` populated on failure
- `sources_status` JSONB carries the per-phase metrics + corpus filter
  + validation breakdown (see schema in §3 Decision 7 metrics block above)

`final_status` rules:
- `completed`: cycle ran end-to-end, ≥1 hypothesis inserted, errors_count=0
- `partial`: cycle ran but some hypotheses failed validation OR a
  non-fatal phase error occurred
- `failed`: zero hypotheses inserted (corpus empty, LLM call failed,
  validation rejected all, etc.)

### Decision 8 — Plan output schema additions

Add two optional fields to plan JSON:

```json
{
  "reasoning":        "...",
  "research_theme":   "...",
  "search_queries":   [...],            // legacy; kept for reflect-phase context
  "arxiv_queries":    [...],            // legacy; ignored in Y-pure
  "specific_urls":    [],               // legacy; ignored in Y-pure
  "focus_areas":      [...],
  "avoid":            [...],
  "target_tickers":   ["SPY", "TLT"],   // NEW; optional; empty = open-ended
  "target_themes":    ["dispersion"]    // NEW; optional; empty = open-ended
}
```

Plan-phase prompt explicitly tells the LLM these are optional and to
leave empty for conceptual research cycles.

## 4. Module structure

```
quant-research-scout.py
├── Constants                       (env-driven model config, paths, limits)
├── Helpers                         (now_utc, log, env_file reader, content_hash)
├── Memory                          (load/save_memory; bound at edges)
├── Substrate schema lookup         (NEW; replaces discover_schema pg_catalog walk)
├── Corpus query                    (NEW; Decision 6 SQL)
├── LLM call                        (call_llm — single shared function with reasoning fallback)
├── JSON repair helpers             (port from summarizer v2: escape repair + bracket walker)
├── Phase 1: plan                   (rewritten output schema; substrate schema input)
├── Phase 2: corpus_fetch           (renamed from "search"; pure DB query, no web)
├── Phase 3: synthesize             (rewritten prompt: doc_id enumeration + grounding requirement)
├── Phase 4: reflect                (mostly unchanged)
├── Validation                      (NEW: cited_doc_ids set membership check)
├── DB writes                       (write_to_hypotheses_table v2 with cited_doc_ids)
├── scout_runs lifecycle            (open_scout_run / close_scout_run)
├── Output writers                  (legacy JSON files preserved for downstream consumers)
└── Main / CLI                      (no daemon; --query, --triggered-by, --dry-run, --max-age-days)
```

## 5. CLI surface

```
quant-research-scout.py                       # full cycle, all defaults
quant-research-scout.py --dry-run             # plan + corpus_fetch only; no synthesize, no insert
quant-research-scout.py --triggered-by manual # cron|manual|test|backfill
quant-research-scout.py --query "..."         # ad-hoc theme override
quant-research-scout.py --max-age-days 14     # corpus recency override
quant-research-scout.py --memory              # dump scout-scout-memory.json and exit
```

Removed: `--daemon`, `--interval`, `--cycles`, `--model`. Model
overrides go via env vars (operationally cleaner; cron-friendly).

## 6. Sentinels filed by this rebuild

Created here:
- `QRS_RECENCY_WINDOW_30D_TBD_AS_CORPUS_GROWS_V1`
- `QRS_USES_SUBSTRATE_FOR_SCHEMA_NIGHTLY_LAG_ACCEPTED_V1`
- `QRS_SYNTHESIZE_PROMPT_HARDCODED_SIGNAL_LIST_V1`
- `SCOUT_RUNS_DOCUMENTS_INSERTED_REPURPOSED_FOR_HYPOTHESES_V1`
- `QRS_CORPUS_LIMIT_30_DOCS_TUNABLE_V1`
- `QRS_OBSERVATION_PRIORITY_FINDING_OVER_METHOD_V1`
- `HYPOTHESIS_VALIDATION_FAILURES_TABLE_PROPOSED_V1`

Closed by this rebuild (when shipped + first successful cycle):
- `HYPOTHESIS_GROUNDING_REQUIRED_V1` — closed by Decision 5 implementation

## 7. Validation plan

**Pre-deploy:**
- `ast.parse` the rebuilt file (syntax check)
- `--dry-run` invocation: confirms plan + corpus_fetch work without
  touching `hypotheses` table
- Manual `--query "test theme"` invocation with `--triggered-by test`:
  full cycle, ≤5 hypotheses, watch logs for validation failures

**First cron-fire (Monday 07:30 ET — coincides with director morning fire):**
- `scout_runs` row landed with `status='completed'`
- Hypotheses landed in `research.hypotheses` with non-empty `cited_doc_ids`
- Director's morning report references newly-grounded hypotheses
  (this is the closing-the-loop validation)

**A/B test gate (after ≥6 cycles):**
- Compare reasoning-on vs reasoning-off via scout_runs metrics
- Lock winner in `/etc/sofar-llm.env`

## 8. Out of scope (explicit)

- `extract_scripts.py` re-run to refresh stale substrate edges
  (separate end-of-session task)
- Synthesize-prompt auto-generation from substrate column entities
  (`QRS_SYNTHESIZE_PROMPT_HARDCODED_SIGNAL_LIST_V1` — defer)
- Migration of `MEMORY_FILE` to a substrate row (future cleanup)
- Hybrid corpus fallback to autonomous web fetch (only if Y-pure proves
  insufficient in practice)
- `entities_produced` schema migration on `scout_runs` (coordinated with
  gap-populator and other repurposing scripts)

## 9. Operational notes

**Host:** spark-cfbd (canonical script location, all DB writes).
**LLM endpoints:**
- plan/reflect: mac2 via SSH tunnel (existing `mac2-ollama-tunnel.service`)
- synthesize: mac1 — needs endpoint config (see §10)

**Cron schedule:** TBD. Lab-scraper and scout-scraper run via existing
research subsystem cron entries; quant-research-scout has not yet been
scheduled. Recommend hourly during market hours initially, drop to 4x/day
once the A/B test settles. Cron-line addition is post-deploy step.

## 10. Open questions

1. **mac1 LLM endpoint.** mac1's qwen3:235b is referenced as the
   research-director endpoint per `/etc/sofar-llm.env`, but a separate
   tunnel may be needed for cfbd → mac1 if not already present. Verify
   via `cat /etc/sofar-llm.env | grep -i mac1` and `ss -tlnp | grep
   1143` before first run.

2. **Cron schedule.** Hourly during market hours is a starting guess.
   The right cadence depends on how often the research corpus changes
   meaningfully (i.e., how often summarizer adds new observations) and
   how much hypothesis volume the directors can review. Calibrate
   empirically after first week.

3. **scout-scored-quant-YYYYMMDD.json file consumer.** Who reads this
   file currently? If it's stale and unused, drop the legacy output
   writer and remove the `data/` directory writes entirely. If it's
   still consumed by a downstream daemon, preserve the format.

4. **Plan-phase schema input via substrate.** The plan prompt currently
   gets the schema as inlined text. With substrate canonical, do we
   pass the substrate `table` entity attrs as JSON, or render a
   summarized schema string? Lean: render the same shape v1 produced
   so the prompt change is minimal; capture as
   `QRS_SUBSTRATE_SCHEMA_RENDERED_AS_STRING_V1` for future cleanup to
   structured JSON.

## 11. Implementation order (this session + next)

This session (if context permits):
1. Module skeleton: constants, env reader, helpers
2. `scout_runs` lifecycle functions
3. Corpus query function (Decision 6 SQL with parameterization)
4. Substrate schema lookup function
5. `call_llm` shared function (port from summarizer)
6. JSON repair helpers (port from summarizer)
7. Validation function (Decision 5 layer 2)

Follow-up session:
8. Phase 1 prompt rewrite (plan, with target_tickers/target_themes)
9. Phase 3 prompt rewrite (synthesize, with doc_id enumeration)
10. Phase 4 (reflect — mostly unchanged port)
11. Output writers (legacy JSON file preservation TBD per Q3)
12. Main/CLI
13. End-to-end smoke test
14. Cron schedule

The split is natural because the prompts are the largest single design
surface and deserve a fresh-context session. The skeleton + DB I/O can
be built and unit-tested in isolation.

---

**End of design doc.**
