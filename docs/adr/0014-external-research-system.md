# ADR-0014: External Research System — substrate-canonical research library, multi-scout fleet, and hypothesis grounding

**Date:** 2026-05-02
**Status:** proposed
**Deciders:** bot1
**Related:** ADR-0001 (three-DB split), ADR-0004 (quant-research pause), ADR-0005 (sentinel conventions), ADR-0006 (continuity protocol), ADR-0010 (substrate canonical for rate-cards), ADR-0011 (verify schema before write), ADR-0013 (multi-host substrate canonical)
**Sentinel:** EXTERNAL_RESEARCH_SYSTEM_V1

---

## Context

SOFAR built three independent external-research systems between 2026-04-12
and 2026-04-22, all paused on 2026-04-22 alongside the broader
quant-research subsystem under ADR-0004:

1. `research-scout-scraper.py` — RSS/web scraper for trade-idea content
   (X/FinTwit cached headlines, Seeking Alpha RSS, six subreddits,
   Quantpedia). ~83 items/day. Output: `data/research-raw/scout-raw-{date}.json`.
2. `research-lab-scraper.py` — RSS/web scraper for methodology content
   (arXiv q-fin Atom API, six quant Substacks, GitHub trending across three
   topics, SpotGamma blog). ~30 items/day. Output:
   `data/research-raw/lab-raw-{date}.json`.
3. `research-summarizer.py` — LLM-driven scoring/summarization layer over
   both scrapers. Output: `data/research-scored/{scout,lab}-scored-{date}.json`.
4. `quant-research-scout.py` — LLM-driven autonomous research agent
   (SearXNG + arXiv API + Semantic Scholar + headless Chromium for full-page
   reads). Four-phase loop: PLAN, SEARCH, SYNTHESIZE, REFLECT. Writes
   to `research.hypotheses` with `proposer='quant-scout'`. ~10 hypotheses
   generated to date.

These four systems work individually but do not compose into a research
loop. The structural problems:

**JSON-only persistence.** Scrapers and summarizer write only to JSON files
on disk. Output is not queryable, not cross-referenceable, not semantically
searchable, and not linked to the hypotheses or experiments that should
cite it. Two-plus weeks of scraped output (Mar 16 through Apr 22) sits as
~30 JSON files in `data/research-raw/`. The day's lab-raw-2026-04-22.json
contains arXiv papers directly relevant to SOFAR signal generation
(SPX put-call parity residuals, options-implied discount factors); none
informed any subsequent hypothesis or experiment.

**No integration with the experiment orchestrator.** `experiment-orchestrator.py`
generated 670 LLM-driven experiments before pause. Its `gather_context()`
function reads only internal state (recent backtest_runs, signal_stats,
data_coverage, past_experiments, experiment_knowledge, active_weights).
It never reads scraper output, summarizer output, or scout-proposed
hypotheses. Of the 10 hypotheses scout wrote to `research.hypotheses`,
zero appear in the `experiments` table — the orchestrator ran 670
experiments in parallel to a research feed it could not see.

**Wrong framing in the summarizer.** The "lab" system prompt asks the model
"what gap in SOFAR's pipeline does this expose?" — an internal-refactor
framing — rather than extracting external observations. Output rows are
shaped as `proposed_change.target_component` ("exact filename") and
`change_description` ("concrete implementable description"). The frame
is upside-down: scraped research should produce extracted claims, findings,
methods, and data sources mentioned, which the orchestrator and director
can later cite. Internal gap analysis is a separate concern.

**Mid-migration code state.** The summarizer points at a local Ollama
endpoint (`MODEL = 'gemma4:e4b'`, `API_URL =
'http://localhost:11434/v1/chat/completions'`) but retains Anthropic Haiku
pricing constants (`HAIKU_IN_COST`, `HAIKU_OUT_COST`) and ANTHROPIC_KEY
loading logic. The model was redirected to local Ollama; cost accounting
was not updated.

**Empty data_gaps loop.** When the scout proposes a hypothesis requiring
data SOFAR does not have, that should auto-populate `research.data_gaps`
so vendor evaluation can begin. The data_gaps table has 1 row total
(a manual test entry). All 10 scout hypotheses have empty `data_gap_ids`
arrays.

**Empirical evidence the bubble matters.** Of 670 experiments: 514 failed
(76.7%), 85 rejected, 59 needs_review, 7 promoted. Of the 7 promoted, zero
appear in `published_signals` (Build 4 from ADR-0004 — the orphan
disconnect). Of the failures, the recurring patterns are: schema
hallucination (LLM references columns that don't exist),
`Missing compute_signal(db) function` (LLM doesn't follow the contract),
`Only 0 values computed` (LLM SQL returns empty). These match ADR-0004's
`H1 schema injection` and `H2 smoke-test gate` failure modes exactly.

ADR-0004's Builds 1-6 fix the *plumbing* of the LLM-driven loop (schema
injection, smoke-test gate, cleanup, promote-to-production, bless-weights,
re-enable cron). Shipping Builds 1-6 alone would produce a faster, cleaner
version of the same bubble: an LLM proposing signals against internal
state only, with no external grounding. Renaissance-frame: the external
information advantage matters more than the recombination cleverness.
What's missing structurally is integration of scraped research into the
hypothesis-generation context, with a substrate-canonical research
library that compounds across sessions.

The Bipsync hedge fund maturity curve framework names this directly:
firms that preserve research outputs (JSON files) without preserving
the thinking behind them lose visibility into how decisions were formed.
Substrate already provides the canonical-knowledge-graph layer for
SOFAR's operational state. This ADR extends that canonical layer to
research content.

The Man Group ArcticDB precedent informs the future-scale path: text
research data at SOFAR's scale (~700MB/year worst case at current
scout fleet, ~3.5GB at 5 years) stays comfortably in Postgres for the
foreseeable future. The dataset that will eventually force a different
storage architecture is `flow_trades` and tick data, not research
content. That is a separate future ADR.

## Decision

Build a substrate-canonical External Research System on top of the existing
scraper, summarizer, and LLM scout components. Seven sub-decisions follow.

### 1. New schema in research DB: documents, observations, themes, decisions, scout_runs

Five new tables in `research` DB capture research content as canonical,
queryable, append-only data:

- `research.documents` — every scraped or fetched item, exactly once
  (idempotent on `content_hash`). Stores full `raw_text` (no cap) and
  optional `summary` extracted by the summarizer.
- `research.observations` — LLM-extracted claims, findings, methods,
  data sources mentioned, and reproducibility cues. Each observation
  rows has `source_doc_id` FK to `documents`. Multiple observations per
  document. The summarizer produces these.
- `research.research_themes` — recurring topics across documents,
  detected by clustering observations. Each theme has
  `observation_count`, `first_observed_at`, `last_observed_at`,
  `status` (emerging/tracked/hot/saturated/deprecated).
- `research.document_decisions` — append-only log of decisions made
  about a document (director-reviewed, cited-in-hypothesis, archived,
  etc.). Replaces UPDATE-in-place patterns; preserves audit trail.
- `research.scout_runs` — audit log of every scraper or scout
  invocation: which scout, when, source-by-source item counts,
  errors, model used (FK to substrate `model` registry). Enables
  drift detection.

DDL ships in `migrations/20260502-research-library-v1.sql`.

Schema design constraints (locked decisions):
- **Postgres-portable.** No Neon-specific features. JSONB, TEXT, TEXT[],
  TIMESTAMP WITH TIME ZONE, GIN indexes only. Future migration to local
  Postgres is mechanical.
- **Bi-temporal columns from the start.** Every row has `valid_from`,
  `valid_to`, `recorded_at`. Matches Man Group's ArcticDB
  bi-temporality pattern. Cheap to add now, expensive to retrofit.
- **Append-only.** Status changes (proposed → reviewed → cited → archived)
  go to `document_decisions` as new rows, not UPDATEs to documents.
- **Full text, no cap.** `documents.raw_text` is unbounded TEXT (Postgres
  TOAST handles large values out-of-line transparently). A 10MB
  per-document warning logs for inspection but does not truncate.
- **Substrate-canonical.** Each new table registers as a `data_table`
  entity via the existing `extract_data_tables.py` extractor on next
  cron run. Lineage edges (script → reads_from → table, script →
  writes_to → table) populate via `extract_data_relationships.py`.

`PGVECTOR_DEFERRED_V1`: pgvector extension for semantic search is
deferred. Phase 1 uses Postgres `tsvector` full-text search, which
ships native. Add pgvector later as a follow-up ADR if/when semantic
proximity becomes the bottleneck for orchestrator context retrieval.

### 2. Migrate scrapers to write to `research.documents` directly

`research-scout-scraper.py` and `research-lab-scraper.py` keep their
existing fetch logic (RSS, arXiv API, Reddit JSON, GitHub API, headless
Chromium for SearXNG paths) but replace JSON output with INSERT into
`research.documents`. Idempotent on `content_hash`. Adds `source_type`,
`source_subtype` (e.g. `reddit:options`), and existing fields
(tickers_detected, fetch_verified, partial_reason).

Hard cutoff (per session decision): scrapers stop writing JSON on the
first run after migration. No dual-write window. Saturday-into-Sunday
timing is intentional — research sources publish 24/7, so first
post-migration runs validate end-to-end within hours.

The 30 days of existing JSON files (`scout-raw-2026-03-16.json` through
`scout-raw-2026-04-22.json` plus `lab-raw-*.json`) get backfilled in a
one-time migration script that reads each JSON file and inserts into
`research.documents` with original timestamps preserved. Backfill
script: `scripts/backfill_research_documents.py`, ships alongside
the migration.

### 3. Reframe and fix `research-summarizer.py`

Two changes:

**Endpoint and model fix.** The mid-migration state is resolved by
deciding on local Ollama (decision: keep local for cost and latency;
revisit when frontier-cloud meaningfully beats local on extraction
quality). Update `MODEL`, `API_URL`, payload format. Remove dead
HAIKU_*_COST constants. Replace ANTHROPIC_KEY loading with substrate
model-registry lookup so model swaps are config changes (per ADR-0010).

**Reframe the prompt.** The "what SOFAR pipeline gap does this expose"
framing is replaced with structured observation extraction:
- Claims (the document's testable statements, with strength: high/medium/low)
- Findings (empirical results reported)
- Methods (techniques, models, data structures used)
- Data sources mentioned (tables, vendors, APIs referenced)
- Reproducibility cues (code links, datasets, parameter values)

Output rows go to `research.observations` with `source_doc_id` FK,
`extracted_by_model_id` FK to the substrate model entity, and
`extraction_run_id` linking to `scout_runs`. Internal-gap analysis is
deleted from this layer; if SOFAR-specific gap analysis is ever
needed, it becomes a separate downstream consumer of
`research.observations`.

`SUMMARIZER_REFRAME_V1` captures this reframing.

### 4. Wire `quant-research-scout.py` into the new schema

The LLM scout already does the right thing structurally: planned web
search via SearXNG, arXiv API, Semantic Scholar, headless Chromium reads,
synthesis into hypotheses, reflection. Three integration changes:

- Papers and pages it reads INSERT into `research.documents` with
  `source_type='scout-fetched'` and `source_subtype` matching the source
  (arxiv, semantic_scholar, web_searxng). Idempotent on content_hash.
- Hypotheses written to `research.hypotheses` get a new
  `cited_doc_ids` TEXT[] column referencing `documents.doc_id`. Enforced
  non-empty: every scout hypothesis must cite at least one document
  it actually read.
- When a hypothesis requires data SOFAR does not have, the scout
  auto-populates `research.data_gaps` with the relevant documents as
  evidence. Closes the gap loop that has been disconnected.

### 5. Specialized scout fleet (additive, not replacement)

The current four scrapers + one LLM scout cover trade-idea content
(scout-scraper), methodology content (lab-scraper), and
researcher-driven exploration (LLM scout). Additional beats are
identified for future ADRs but not built in this one:

- `scout-fed.py` — FOMC minutes, Beige Book, FRED releases, regional
  Fed research (NY, Chicago, Atlanta)
- `scout-sec.py` — SEC EDGAR (8-K, 13F, S-1 filings), CFTC enforcement
  actions, FINRA notices
- `scout-altdata.py` — alternative data vendor announcements,
  AlternativeData.org, conference papers
- `scout-foreign.py` — Bank of Japan, ECB, PBOC, BIS publications
- `scout-practitioner.py` — Hudson River Trading research, Jane Street
  tech blog, Two Sigma engineering

These ship as separate scripts following the same template once the
core schema and existing-scraper migration are validated. Each writes
to `research.documents` with its own `source_type`. Each may run on
different schedule (Fed monthly, SEC daily, altdata weekly).

`SCOUT_FLEET_EXPANSION_PENDING_V1` captures the future-build list.

### 6. Hypothesis grounding requirement (cite-or-die)

Every LLM-proposed hypothesis must cite at least one row in
`research.documents`. Enforcement happens at two points:

- **Scout writes:** `quant-research-scout.py:write_to_hypotheses_table`
  rejects hypotheses with empty `cited_doc_ids`. The scout's
  synthesize-phase prompt already references documents it read; the
  enforcement makes the citation structural rather than narrative.
- **Orchestrator proposals:** `experiment-orchestrator.py:propose_hypothesis`
  loads recent observations into context, and the system prompt
  requires `cited_doc_ids` in the JSON response. Validation rejects
  proposals with empty arrays. This closes the bubble described in
  ADR-0004 §Context: the LLM cannot propose recombinations of internal
  signals without grounding in external observations.

`HYPOTHESIS_GROUNDING_REQUIRED_V1` captures this rule.

ADR-0004's Builds 1-6 still ship and remain valid — they fix the
implementation layer (schema injection, smoke-test, cleanup, promote,
bless, re-enable). This ADR sits one layer up: it changes what the LLM
is reasoning *about*, not how it generates and validates code.
Build 1 (schema injection) and the new grounding requirement are
complementary: schema injection prevents the LLM from inventing
columns; grounding prevents the LLM from inventing motivation.

### 7. Orchestrator's `gather_context()` reads from the library

The orchestrator's PROPOSE-stage context expands to include:

- `recent_observations`: top N observations from last K days, weighted
  by cross-document confirmation count (an observation that 3 papers
  independently support is stronger than one paper's claim)
- `hot_themes`: themes with observation_count growth in last 30 days
- `unexploited_data_sources`: data sources mentioned in observations
  but absent from `data_source_registry` — auto-creates `data_gaps`
  rows pointing at the supporting documents
- `scout_hypotheses_pending_review`: hypotheses with `proposer='quant-scout'
  AND status='proposed'` — the orchestrator can prioritize testing these
  rather than generating its own from scratch

Implementation deferred to a follow-up patch on
`experiment-orchestrator.py` after the schema and scrapers ship.
Tracked as `ORCHESTRATOR_CONTEXT_EXPANSION_PENDING_V1`.

## Alternatives Considered

### Alternative 1: Keep JSON files, add a queryable index alongside
- **Pros:** Less migration work; existing scraper code untouched
- **Cons:** Two storage shapes for the same data; index goes stale;
  preserves the "JSON as database" anti-pattern the user has explicitly
  rejected
- **Why not:** Defeats the substrate-canonical principle. JSON files
  are operational ephemera, not canonical state.

### Alternative 2: Use a dedicated document store (MongoDB, Elasticsearch)
- **Pros:** Built-in full-text search, schemaless flexibility for
  varied source types
- **Cons:** New operational dependency; no existing SOFAR infrastructure
  for it; lineage tracking via substrate breaks at the boundary; future
  local-DB migration becomes harder, not easier
- **Why not:** Postgres handles SOFAR's research-text scale (~700MB/year)
  with native full-text search. The marginal benefit of a dedicated
  document store does not justify the operational complexity at
  this scale.

### Alternative 3: Build the multi-scout fleet first, library second
- **Pros:** More information sources sooner; broader collection
- **Cons:** More volume into a still-broken persistence layer; would
  generate even more JSON files that need backfilling; doesn't fix
  the integration disconnect
- **Why not:** The bottleneck is integration, not collection. Existing
  scrapers already produce more content than the orchestrator can use.
  Fix the substrate layer first; expand fleet against a working
  foundation.

### Alternative 4: Replace existing scrapers with a single unified scout
- **Pros:** Simpler operational surface; one cron entry
- **Cons:** Loses specialization (lab-scraper's arXiv handling differs
  meaningfully from scout-scraper's Reddit handling); concentrates
  failure (one scout broken = all scouts broken); loses the
  beat-specific tuning that already works
- **Why not:** Renaissance-frame: don't reinvent working components.
  Migrate the existing scrapers to the new schema; expand the fleet
  additively.

### Alternative 5: Defer pgvector but add embeddings via `tsvector` simulation
- **Pros:** Get semantic-ish search now without extension dependency
- **Cons:** Conflates two storage shapes (real embeddings vs keyword
  tokens); adds complexity that disappears the moment pgvector lands
- **Why not:** Postgres `tsvector` is sufficient for Phase 1 keyword and
  phrase search. Add real embeddings via pgvector when needed; don't
  half-build it.

## Consequences

### Positive

- Research output compounds across sessions. Every paper read, every
  blog post scraped, every observation extracted is queryable forever.
- Hypotheses cite evidence. The bubble described in ADR-0004 §Context
  closes structurally, not behaviorally — LLM cannot bypass the
  grounding requirement.
- Cross-confirmation across sources becomes computable. Observations
  with high cross-document support are weighted more heavily in
  orchestrator context.
- Substrate lineage walker can answer "what document fed what
  observation fed what hypothesis fed what experiment fed what
  signal" — the kind of audit trail Renaissance-frame demands.
- Model swap discipline: every observation and hypothesis records
  the model that produced it, via FK to substrate's model registry
  (per ADR-0010). Future LLM swaps are config changes; historical
  attribution preserved.
- ADR-0004's Builds 1-6 still ship, but against a richer context.
  Schema injection plus grounding requirement together address both
  failure modes (invented columns AND invented motivation).

### Negative

- One-time migration work: schema DDL, scraper INSERT logic, summarizer
  reframe, scout integration, JSON backfill. Estimated ~2-3 sessions
  of focused work before the system is fully operational.
- Two-storage-shape transition for ADRs 0001-0006 status field
  (per ADR-0015) does NOT extend to research data. New schema is
  clean from the start; no historical artifact to preserve.
- Schema design choices made now are difficult to undo later if scale
  or access patterns shift. Mitigation: bi-temporal + append-only +
  Postgres-portable = portable to ArcticDB or similar later if
  research data unexpectedly explodes (which the storage math says
  it won't, but the discipline costs nothing).
- Increased `experiment-orchestrator.py` complexity: gather_context
  now reads from 5 new tables. Debugging the propose stage gets
  harder before it gets easier.

### Risks

- **Migration window failure.** If the hard-cutoff Saturday migration
  breaks scrapers and isn't caught quickly, scrapers run silently
  broken and lose data. Mitigation: hard cutoff is Saturday afternoon
  precisely so the next 24 hours are weekend hours where scrapers
  publish (Reddit, X-FinTwit, Substacks all 24/7) and breakage is
  observable within hours.
- **Backfill conflicts with idempotency.** The existing JSON files
  span Mar 16 - Apr 22 with overlapping content_hashes. Mitigation:
  backfill script must be idempotent on content_hash and ON CONFLICT
  DO NOTHING; run is safe to retry.
- **Summarizer reframe loses signal.** The "what SOFAR gap" framing
  occasionally produced useful internal-refactor suggestions.
  Mitigation: those suggestions were not actually being read by the
  orchestrator anyway; if useful, they can be re-introduced as a
  separate downstream consumer of `research.observations` later.
- **Scope creep into Builds 1-6.** This ADR explicitly does not ship
  schema injection (Build 1), smoke-test gate (Build 2), or
  promote-to-production (Build 4). Those remain ADR-0004's scope
  and ship as separate work. Do not bundle.
- **pgvector deferral becomes permanent through inertia.** Mitigation:
  `PGVECTOR_DEFERRED_V1` captured; revisit when context-retrieval
  quality from `tsvector` becomes the bottleneck.

## Implementation notes

### File paths

- `migrations/20260502-research-library-v1.sql` — schema DDL
- `~/scripts/research-scout-scraper.py` — modified to write
  `research.documents` instead of JSON
- `~/scripts/research-lab-scraper.py` — modified same
- `~/scripts/research-summarizer.py` — reframed prompt + endpoint fix +
  writes to `research.observations`
- `~/scripts/quant-research-scout.py` — modified to write documents +
  cite documents in hypotheses + populate data_gaps
- `~/scripts/backfill_research_documents.py` — new, one-time backfill
  of existing `data/research-raw/*.json` files

### Sentinels introduced

- `EXTERNAL_RESEARCH_SYSTEM_V1` — captures the system as a whole
- `RESEARCH_LIBRARY_SCHEMA_V1` — captures the schema decision
- `SUMMARIZER_REFRAME_V1` — captures the prompt + endpoint cleanup
- `HYPOTHESIS_GROUNDING_REQUIRED_V1` — captures cite-or-die
- `PGVECTOR_DEFERRED_V1` — captures the deferral
- `SCOUT_FLEET_EXPANSION_PENDING_V1` — captures the future-build list
- `ORCHESTRATOR_CONTEXT_EXPANSION_PENDING_V1` — captures
  gather_context() expansion as deferred

### Cron changes

QR-PAUSED prefix removed from existing scraper crons after migration
validates. New cron entries for backfill (one-time, manual) and any
new scouts (per-scout schedule).

### Substrate lineage

After migration, `extract_data_tables.py` and
`extract_data_relationships.py` produce:
- 5 new `data_table` entities (documents, observations, themes,
  document_decisions, scout_runs)
- New `writes_to` relationships from
  `research-scout-scraper.py @ spark-cfbd`,
  `research-lab-scraper.py @ spark-cfbd`,
  `research-summarizer.py @ spark-cfbd`,
  `quant-research-scout.py @ spark-cfbd` to the new tables
- New `reads_from` relationship from
  `experiment-orchestrator.py @ spark-cfbd` to documents and
  observations (after gather_context expansion)

### Relationship to ADR-0004

ADR-0004's Builds 1-6 remain valid and required. This ADR adds a
seventh build (call it Build 7: external research integration) at a
higher architectural layer:

- Build 1 (H1): schema injection — still needed
- Build 2 (H2): smoke-test gate — still needed
- Build 3 (H3): cleanup — done
- Build 4 (S1): promote-to-production — still needed
- Build 5 (S2): bless-weights — still needed
- Build 6 (S3): re-enable signal compute cron — still needed
- Build 7 (NEW): external research integration — this ADR

Quant-research subsystem unpause requires all seven builds.

## References

- ADR-0001 (three-DB split — research DB scope)
- ADR-0004 (quant-research pause — Builds 1-6 this ADR adds Build 7 to)
- ADR-0005 (sentinel + migration conventions — schema migration follows
  the convention)
- ADR-0006 (continuity protocol)
- ADR-0010 (substrate canonical for rate cards — model registry FK
  pattern this ADR adopts for observation/hypothesis attribution)
- ADR-0011 (verify schema before write — informed schema design pass)
- ADR-0013 (Bundle 8 finalization — sentinel auto-promotion mechanism
  this ADR's sentinels rely on)
- ADR-0015 (substrate ingestion conventions — format this document
  follows)
- `~/scripts/research-scout-scraper.py` (current state, pre-migration)
- `~/scripts/research-lab-scraper.py` (current state, pre-migration)
- `~/scripts/research-summarizer.py` (current state, pre-migration,
  mid-migration to local Ollama)
- `~/scripts/quant-research-scout.py` (current state, writes to
  `research.hypotheses` already)
- `~/scripts/experiment-orchestrator.py` (current state,
  gather_context() reads internal state only)
- `data/research-raw/` (existing JSON output, ~30 files Mar-Apr,
  to be backfilled)
- Bipsync hedge fund maturity curve (resonance: preserve thinking
  behind research, not just outputs)
- Man Group ArcticDB (precedent for future-scale storage of time-series
  data; informs why research library stays Postgres while flow_trades
  may migrate)
