# ADR-0017: Research scraper v2 architecture — rebuild against substrate-canonical pattern

**Date:** 2026-05-02
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0004 (quant-research pause), ADR-0014 (External Research System), ADR-0015 (substrate ingestion conventions), ADR-0016 (mac2 Ollama SSH tunnel)
**Sentinel:** RESEARCH_SCOUT_V2_REBUILD_NOT_MIGRATION_V1

---

## Context

ADR-0014 introduced the substrate-canonical research library —
`documents`, `observations`, `research_themes`, `document_decisions`,
and `scout_runs` tables in the research database. The new
`research-summarizer.py` (per ADR-0014 §3 and `SUMMARIZER_REFRAME_V1`)
reads from `documents` and writes to `observations` and `scout_runs`.
Smoke-tested 2026-05-02; producing well-shaped observations on real
content (`SUMMARIZER_REFRAME_VALIDATED_2026-05-02_V1`).

The next dependency: scrapers must write into `documents` for the
summarizer to have anything to read. Today, three scrapers write JSON
files instead of database rows:

- `research-lab-scraper.py` — arxiv, quant substacks, GitHub, SpotGamma (~30 docs/day)
- `research-scout-scraper.py` — Reddit, SeekingAlpha (~83 docs/day)
- `quant-research-scout.py` — LLM-driven scout that picks its own URLs (~5-15 docs/day)

All three are QR-PAUSED in cron per ADR-0004 (quant-research subsystem
paused 2026-04-22 because the LLM-generated hypotheses weren't grounded
and the loop wasn't closing). The scrapers were paused alongside the
hypothesis pipeline because there was no point fetching documents that
fed into a paused subsystem.

Question: how do we get from "JSON-writing v1 scrapers, paused" to
"DB-writing scrapers, running continuously"?

Two framings considered:

**(A) Migrate v1 scrapers minimally** — preserve every line of v1
behavior, swap only the persistence layer (JSON write → DB INSERT),
backup-and-deprecate the v1 file, run the new one. Tight diff, easy
review, low risk per scraper.

**(B) Rebuild as v2 against new architecture** — treat the v1 scrapers
as reference implementations that taught us what data sources we want
and how to fetch them, but design v2 from first principles around the
substrate-canonical pattern. Larger effort per scraper, but establishes
the pattern that all future scouts follow.

After reading the v1 lab-scraper code carefully, framing (B) is correct.
The v1 code has structural issues that aren't merely stylistic — they
actively block scaling:

1. **No `main()` function.** Top-level code runs at module import time.
   Each source is an inline try/except block at module scope. Adding a
   new source means appending another 30-line block to a 281-line file.
   This doesn't scale to 10 or 20 sources, which we'll want for a
   proper scout fleet (FRED-scout, SEC-scout, FOMC-scout, etc. per
   `SCOUT_FLEET_EXPANSION_PENDING_V1`).

2. **Mutable global state.** `seen_hashes`, `items`, `sources_status`,
   `item_counter` are all module-level. Hard to test, hard to reason
   about, hard to call from another script. The LLM-driven
   `quant-research-scout.py` v2 may want to call `fetch_arxiv()`
   directly with a topical query — impossible with current structure.

3. **`add_item()` returns nothing and silently drops.** No way to
   know which docs got dropped or why. For a continuous pipeline,
   dropped docs need to be visible, not invisible.

4. **30-day SEEN_FILE JSON dedupe.** A poor-man's dedupe DB. We
   already have a real DB. Two dedupe paths (SEEN_FILE + DB UNIQUE)
   is worse than one.

5. **Print statements as logs.** Per-source `print(...)` lands in
   cron's stdout. Fine for human eyeballing, but blocks future
   structured-log substrate consumption.

6. **No retry logic.** arxiv returns 503 once, that day's items are
   lost. With ~120 docs/day target, lossy fetches matter.

7. **Hardcoded KNOWN_TICKERS list duplicated across scrapers.**
   Captured separately as `KNOWN_TICKERS_HARDCODED_IN_SCRAPERS_V1`
   and `KNOWN_TICKERS_TO_CANONICAL_TABLE_PROPOSED_V1`; deferred to
   its own future ADR. Preserved verbatim in v2 scrapers for now.

The pause from ADR-0004 created an opportunity. We aren't migrating
running production code — we're rebuilding paused subsystem code
against a better architecture. The cost of v2 framing is bounded
(no in-flight users to break); the upside is a pattern that future
scouts inherit cleanly.

Captured discovery sentinels:
- `RESEARCH_SCOUT_V2_REBUILD_NOT_MIGRATION_V1` — the framing decision
- `RESEARCH_SCOUT_V2_PATTERN_PER_SOURCE_AS_FUNCTION_V1` — design pattern
- `RESEARCH_SCOUT_V2_PATTERN_SOURCE_REGISTRATION_V1` — registration pattern
- `RESEARCH_SCOUT_V2_DROP_SEEN_FILE_V1` — DB UNIQUE replaces JSON dedupe

## Decision

Treat the three paused scrapers (`research-lab-scraper.py`,
`research-scout-scraper.py`, `quant-research-scout.py`) as v2 rebuilds
against a shared architectural pattern. Establish that pattern via
`research-lab-scraper.py` first (smallest, simplest, all RSS-or-API
based) and inherit it into the other two.

The v2 pattern has six elements:

### 1. Per-source-as-function

Each source becomes a named function with a uniform signature:

```python
def fetch_arxiv() -> SourceResult: ...
def fetch_substacks() -> SourceResult: ...
def fetch_github_trending() -> SourceResult: ...
def fetch_spotgamma() -> SourceResult: ...
```

Each function:
- Owns its URL list, request shape, parsing logic, retry behavior
- Returns a structured `SourceResult` (see element 3)
- Catches exceptions internally and reports them in the result
- Never crashes the whole run

### 2. Source registration

Sources are listed once at module scope:

```python
SOURCES = [
    Source(name='arxiv',           fetcher=fetch_arxiv),
    Source(name='quant_substacks', fetcher=fetch_substacks),
    Source(name='github_trending', fetcher=fetch_github_trending),
    Source(name='spotgamma_blog',  fetcher=fetch_spotgamma),
]
```

`main()` iterates `SOURCES`, accumulates results. Adding a 5th source
is one new function + one line in `SOURCES`.

### 3. Structured `SourceResult` shape

Each fetcher returns a dict (or dataclass) of consistent shape:

```python
{
    'name':           str,        # 'arxiv'
    'attempted':      bool,       # True if fetch was tried
    'fetched':        bool,       # True if at least one item came back
    'items':          list[dict], # raw items (unwritten — main inserts them)
    'errors_count':   int,        # transient or fatal errors during fetch
    'error_details':  list[str],  # human-readable error messages
    'duration_sec':   float,      # wall time of the fetch
    'rate_limited':   bool,       # tripped a 429 or similar
}
```

This shape goes straight into `scout_runs.sources_status` JSONB
without ad-hoc translation. Drives downstream drift detection
("source X went from 12 items/day to 0 over 3 days = alarm").

### 4. Persistence: documents.content_hash UNIQUE replaces SEEN_FILE

The v1 scrapers maintain a 30-day-rolling `seen-hashes-{lab,scout}.json`
file in `~/sofar-finance/data/research-raw/`. Drop entirely.

Replaced by:
- `INSERT INTO documents (...) ON CONFLICT (content_hash) DO NOTHING
   RETURNING doc_id`
- Returns the doc_id of newly-inserted docs; returns nothing for dupes.
- Single source of truth, idempotent across re-runs, no JSON drift.

If the schema's `content_hash` column doesn't yet have a UNIQUE constraint,
we add one in a small migration (`20260502-research-documents-content-hash-unique.sql`)
before deploying the first v2 scraper.

### 5. Per-source retry with backoff

Each fetcher implements 3-attempt retry on transient errors (HTTP 5xx,
timeout, connection reset). Backoff: 5s, 15s, 45s. Rate-limit responses
(429) recorded but not retried automatically — captured in
`SourceResult.rate_limited` for surfacing.

Per-source `time.sleep()` between API calls preserved (e.g.,
GitHub's 0.5s) — this is throttling, not retry.

### 6. scout_runs lifecycle from every scraper

Every v2 scraper opens a `scout_runs` row at start and closes it at
end with full metrics:

- `scout_name`: 'research-lab-scraper.py'
- `host`: socket.gethostname()
- `started_at` / `completed_at` / `duration_seconds`
- `status`: 'completed' | 'partial' | 'failed'
- `documents_inserted`: count of newly-INSERTED docs (excluding dedup hits)
- `documents_skipped`: count of items that hit dedup (NULL or 0 if first run)
- `errors_count`: aggregate across all sources
- `sources_status`: jsonb of `{source_name: SourceResult}` for the run
- `triggered_by`: 'cron' | 'manual' | 'backfill' | 'test'

Same lifecycle pattern as `research-summarizer.py`. Reusable.

## Alternatives Considered

### Alternative 1: Minimal-diff migration (option A above)
- **Pros:** Smallest patch per scraper; lowest risk per scraper; faster
  to ship the first one
- **Cons:** Carries v1's structural problems forward into all three
  scrapers; the second migration (scout-scraper) is JUST as hard
  because no shared pattern; future scouts inherit the rot
- **Why not:** The v1 code's problems aren't aesthetic — they block
  scaling. Migrating them carries the cost.

### Alternative 2: Defer scrapers entirely; build LLM-driven scout from scratch
- **Pros:** Skips the migration question; goes straight to the v2
  vision (LLM picks URLs, fetches, summarizes)
- **Cons:** Loses the proven URL inventory (arxiv q-fin, specific
  substacks, specific subreddits) that v1 represents. We'd have to
  re-discover what's worth fetching. The v1 scrapers know which
  sources produce signal; throwing that away is wasteful.
- **Why not:** v1 scrapers are bad code but encode good knowledge.
  Preserve the knowledge, replace the code.

### Alternative 3: Per-source services (each source its own systemd unit)
- **Pros:** Maximum isolation; one source's failure doesn't block
  others; per-source schedules
- **Cons:** Massive operational overhead for 4 sources; loses the
  efficiency of a single cron-driven script with its own scout_runs
  audit row; over-engineering for current scale
- **Why not:** Tool too big for the problem. Single script with
  internal modularity is right shape; we can split later if a
  source's lifecycle materially diverges.

## Consequences

### Positive

- **Pattern, not snowflake.** The first scraper establishes shape;
  the next two are easier to write and review.
- **Testability.** Each fetcher is a function — can be called from
  a unit test or REPL with no global setup.
- **Composability.** LLM-driven `quant-research-scout.py` v2 can
  call `fetch_arxiv(query="topic:options")` directly instead of
  duplicating fetch logic.
- **Substrate-canonical from the start.** Every run produces a
  scout_runs row visible in lineage queries. No "where did this
  doc come from?" mysteries.
- **Drop SEEN_FILE.** One less stateful file to manage, back up,
  worry about during disk failures. The DB is canonical.
- **Forward-compatibility for monitoring.** Structured sources_status
  JSON allows building drift detectors ("arxiv went silent for 5
  days") without parsing log files.

### Negative

- **More work per scraper.** 281-line v1 → ~270-line v2 (similar
  total LOC), but the v2 is genuinely structured rather than
  inline-block.
- **Deviation from v1 means v1-vs-v2 output comparison is harder.**
  Mitigated by: same source URLs, same field extractions, same
  ticker filtering — only persistence and structure change.
- **First scraper costs more time to land than minimal-diff would.**
  Subsequent scrapers cost less because pattern is established.

### Risks

- **Behavior drift.** If we accidentally change what URLs get hit or
  what fields get extracted, the v2 scraper produces subtly different
  documents than v1 would have. Mitigation: side-by-side test before
  promotion (run new scraper manually, compare item counts and
  content_hashes against the most recent v1 JSON file).
- **Dedupe regression on initial run.** First v2 run sees 0 existing
  documents and inserts all fetched items. If we somehow re-fetch
  items that the v1 SEEN_FILE had previously suppressed, we'd get a
  one-time spike of "old" documents. Mitigation: optional `--max-age-days`
  filter in v2 scrapers; default 30 days, matching v1's `is_stale()`
  cutoff.
- **content_hash UNIQUE constraint requires migration.** If the column
  doesn't already have UNIQUE, we add it before deploying. Fast
  migration but it's a real DDL.

## Implementation notes

### Migration order

1. **research-lab-scraper.py first.** Smallest (281 lines), simplest
   sources (4, all RSS or API), lowest daily volume (~30 docs).
   Establishes the v2 pattern.
2. **research-scout-scraper.py second.** Same pattern, more sources
   (Reddit + SeekingAlpha), higher volume (~83 docs/day). Mostly
   "drop in your sources, follow the established structure."
3. **quant-research-scout.py last.** Most complex (LLM-driven scout
   that ALSO writes hypotheses with cited_doc_ids). Inherits the
   scraping pattern; adds hypothesis-generation atop it. May warrant
   its own ADR amendment when we get there.

### Schema sub-step

Before the first v2 scraper deploys, ensure `documents.content_hash`
has a UNIQUE constraint. If RESEARCH_LIBRARY_SCHEMA_V1 didn't include
it, add via:

```sql
-- 20260502-research-documents-content-hash-unique-v1.sql
ALTER TABLE documents
  ADD CONSTRAINT documents_content_hash_unique UNIQUE (content_hash);
```

Sentinel: `DOCUMENTS_CONTENT_HASH_UNIQUE_V1`. Verify by inspecting the
migration file before applying — if RESEARCH_LIBRARY_SCHEMA_V1 already
included the constraint, this is a no-op and the sentinel is captured
without a new migration.

### Sentinels introduced

- `RESEARCH_SCOUT_V2_REBUILD_NOT_MIGRATION_V1` — framing decision
- `RESEARCH_SCOUT_V2_PATTERN_PER_SOURCE_AS_FUNCTION_V1` — pattern
- `RESEARCH_SCOUT_V2_PATTERN_SOURCE_REGISTRATION_V1` — pattern
- `RESEARCH_SCOUT_V2_DROP_SEEN_FILE_V1` — pattern (decommission)
- `RESEARCH_SCOUT_V2_RETRY_BACKOFF_V1` — per-source retry shape
- `DOCUMENTS_CONTENT_HASH_UNIQUE_V1` — schema constraint

### Sentinels referenced (already active from prior ADRs)

- `EXTERNAL_RESEARCH_SYSTEM_V1` (ADR-0014)
- `RESEARCH_LIBRARY_SCHEMA_V1` (ADR-0014)
- `SUMMARIZER_REFRAME_V1` (ADR-0014)
- `SCOUT_FLEET_EXPANSION_PENDING_V1` (ADR-0014)
- `KNOWN_TICKERS_HARDCODED_IN_SCRAPERS_V1` (this session, deferred ADR)
- `KNOWN_TICKERS_TO_CANONICAL_TABLE_PROPOSED_V1` (this session, deferred ADR)
- `TICKER_DETECTION_TWO_LAYER_V1` (this session, design note)

### Files affected

- `/home/bot1/scripts/research-lab-scraper.py` — rebuilt as v2;
  v1 backed up as `.legacy.bak.YYYYMMDD-HHMM`
- `/home/bot1/scripts/research-scout-scraper.py` — same shape, later session
- `/home/bot1/scripts/quant-research-scout.py` — same shape + hypothesis writes, later session
- `~/sofar-finance/data/research-raw/seen-hashes-lab.json` — abandoned
  (not deleted; drops out of use)
- `~/sofar-finance/data/research-raw/lab-raw-{date}.json` — no longer
  written. Existing files preserved for backfill via
  `RESEARCH_RAW_BACKFILL_PENDING_V1`.
- New migration file `migrations/20260502-research-documents-content-hash-unique-v1.sql`
  if needed.

### Cron entries

The QR-PAUSED cron lines for the v1 summarizer call still pass a
JSON file path to summarizer. After v2 scraper deploys and v2 summarizer
is canonical, the cron entries get rewritten to no-args call shapes.
Cron rewrite is captured as `SCRAPER_CRON_REWRITE_PENDING_V1` and
happens after first v2 scraper smoke-tests in production manual mode.

### Side-by-side validation before promotion

For each v2 scraper, before flipping the cron from QR-PAUSED:

1. Run the new v2 manually with `--triggered-by smoke-test`
2. Compare: count of items inserted vs. count of items in v1's
   most recent JSON archive
3. Spot-check: a handful of titles match what v1 would have produced
4. Verify: scout_runs row landed correctly with status=completed
5. If all green: keep v2 file in production position, leave cron
   QR-PAUSED until end-of-session. Un-pause is a separate decision
   when we're confident.

## References

- ADR-0004 (quant-research pause — scrapers paused 2026-04-22)
- ADR-0014 (External Research System — defines `documents` and
  `scout_runs` tables that v2 scrapers write to)
- ADR-0015 (substrate ingestion conventions — format this document follows)
- ADR-0016 (mac2 Ollama SSH tunnel — informs that scrapers run on
  spark-cfbd, not on mac2)
- v1 scraper as reference: `~/scripts/research-lab-scraper.py` (281 lines,
  preserved verbatim under `.legacy.bak.YYYYMMDD-HHMM` after promotion)
