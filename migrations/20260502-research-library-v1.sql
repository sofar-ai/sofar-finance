-- ============================================================================
-- Migration: 20260502-research-library-v1.sql
-- Sentinel:  RESEARCH_LIBRARY_SCHEMA_V1
-- Target:    research DB (Neon)
-- ADR:       0014 (External Research System)
-- ============================================================================
-- Creates the substrate-canonical research library:
--   research.documents          — every scraped/fetched item, exactly once
--   research.observations       — LLM-extracted claims/findings/methods
--   research.research_themes    — recurring topics across documents
--   research.document_decisions — append-only log of decisions per document
--   research.scout_runs         — audit log of scraper/scout invocations
--
-- Schema design constraints (from ADR-0014 §Decision):
--   - Postgres-portable. JSONB, TEXT, TEXT[], TIMESTAMP WITH TIME ZONE only.
--   - Bi-temporal. Every row has valid_from / valid_to / recorded_at.
--   - Append-only. No UPDATE in place; status changes go to document_decisions.
--   - Full text, no cap. raw_text TEXT (Postgres TOAST handles large values).
--   - Substrate-canonical. extract_data_tables.py + extract_data_relationships.py
--     pick these up automatically on next cron run.
--
-- MIGRATION_TARGET_DB_ASSERTION_PATTERN_V1 — assert we're on research DB
-- before any DDL runs. Refusing rather than silently misrouting.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── DB target assertion ─────────────────────────────────────────────────────
DO $$
BEGIN
    IF current_database() != 'sofar-research' THEN
        RAISE EXCEPTION 'WRONG DB: this migration targets research, got %', current_database();
    END IF;
END $$;

-- ── Idempotency: bail if already applied ────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM migrations_applied
        WHERE name = 'RESEARCH_LIBRARY_SCHEMA_V1'
    ) THEN
        RAISE NOTICE 'RESEARCH_LIBRARY_SCHEMA_V1 already applied; exiting clean';
        -- Postgres has no early-return-from-anonymous-block; we use a
        -- harmless no-op below and the rest of the migration uses
        -- IF NOT EXISTS guards anyway.
    END IF;
END $$;

-- ============================================================================
-- TABLE: research.documents
-- ============================================================================
-- Every scraped or fetched item, exactly once. Idempotent on content_hash.
-- Stores full raw_text (no cap; Postgres TOAST handles large values).

CREATE TABLE IF NOT EXISTS documents (
    doc_id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    source_type         TEXT         NOT NULL,
        -- Allowed values: 'scout-scraper', 'lab-scraper', 'scout-fetched',
        -- 'manual', 'backfill'. Future scout fleet adds more.
    source_subtype      TEXT,
        -- Beat-specific subtype: 'reddit:options', 'arxiv:q-fin',
        -- 'substack:moontower', 'searxng:web', 'semantic_scholar', etc.
    source_url          TEXT         NOT NULL,
    title               TEXT,
    authors             TEXT[],
    publication_date    DATE,
    fetched_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Content
    raw_text            TEXT         NOT NULL,
        -- Full content. No cap. Postgres TOAST handles large values out-of-line.
        -- Warn (don't truncate) if length > 10MB during ingest.
    content_hash        TEXT         NOT NULL UNIQUE,
        -- sha256:HEX. Idempotency key. Format matches existing scrapers'
        -- content_hash field.
    content_length      INTEGER      NOT NULL,
        -- Convenience for queries; equals length(raw_text).

    -- Discovery metadata
    tickers_detected    TEXT[]       DEFAULT '{}',
    tags                TEXT[]       DEFAULT '{}',
    fetch_verified      BOOLEAN      NOT NULL DEFAULT TRUE,
    partial_reason      TEXT,

    -- Engagement (from source if available: Reddit score, GitHub stars, etc.)
    engagement          JSONB        DEFAULT '{}'::JSONB,

    -- Provenance
    fetched_by_script   TEXT,
        -- e.g. 'research-scout-scraper.py', 'quant-research-scout.py'
    fetched_by_run_id   UUID,
        -- FK to scout_runs.run_id

    -- Bi-temporal columns (per ADR-0014 §Decision)
    valid_from          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_source_type
    ON documents (source_type, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_publication_date
    ON documents (publication_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_documents_tickers
    ON documents USING GIN (tickers_detected);
CREATE INDEX IF NOT EXISTS idx_documents_tags
    ON documents USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_documents_fulltext
    ON documents USING GIN (to_tsvector('english',
        coalesce(title, '') || ' ' || coalesce(raw_text, '')));

COMMENT ON TABLE documents IS
    'Every scraped/fetched research item. Idempotent on content_hash. '
    'Append-only; status changes go to document_decisions. Full text in '
    'raw_text (no cap; TOAST handles large values).';

-- ============================================================================
-- TABLE: research.observations
-- ============================================================================
-- LLM-extracted structured observations from documents.
-- Multiple observations per document. Each observation is a single
-- claim/finding/method/data-source mention.

CREATE TABLE IF NOT EXISTS observations (
    obs_id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source linkage
    source_doc_id           UUID         NOT NULL
        REFERENCES documents (doc_id) ON DELETE RESTRICT,
        -- ON DELETE RESTRICT: documents are append-only; never deleted.
        -- If we ever do delete, observations must be archived first.

    -- Observation content
    observation_type        TEXT         NOT NULL,
        -- Allowed: 'claim', 'finding', 'method', 'data_source', 'reproducibility_cue'
    text                    TEXT         NOT NULL,
        -- The extracted observation itself, in the source's voice.
    evidence_strength       TEXT,
        -- 'high' | 'medium' | 'low'. LLM-assessed.
    evidence_basis          TEXT,
        -- Why the LLM rated it as it did.

    -- Cross-referencing (computed by background job, not extraction)
    cross_referenced_count  INTEGER      NOT NULL DEFAULT 0,
        -- How many other documents make a similar claim. Updated by
        -- a periodic theme-clustering job.
    theme_id                UUID,
        -- FK to research_themes.theme_id when the observation has been
        -- clustered into a theme. Nullable; populated lazily.

    -- Discovery metadata
    tags                    TEXT[]       DEFAULT '{}',
    tickers_mentioned       TEXT[]       DEFAULT '{}',
    data_sources_mentioned  TEXT[]       DEFAULT '{}',
        -- Vendor/table/API names referenced. Used to auto-populate data_gaps
        -- when an observation references a source SOFAR doesn't have.

    -- Extraction provenance (per ADR-0014 §Decision: model swap discipline)
    extracted_by_model_id   TEXT         NOT NULL,
        -- Substrate model entity name, e.g. 'gemma4:e4b', 'claude-haiku-4-5'.
        -- FK conceptually to substrate.entities (type='model'); enforced at
        -- application layer rather than via cross-DB FK.
    extraction_run_id       UUID         NOT NULL,
        -- FK to scout_runs.run_id
    extracted_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Bi-temporal
    valid_from              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    valid_to                TIMESTAMPTZ,
    recorded_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_observations_doc
    ON observations (source_doc_id);
CREATE INDEX IF NOT EXISTS idx_observations_type
    ON observations (observation_type, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_theme
    ON observations (theme_id) WHERE theme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_tags
    ON observations USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_observations_tickers
    ON observations USING GIN (tickers_mentioned);
CREATE INDEX IF NOT EXISTS idx_observations_data_sources
    ON observations USING GIN (data_sources_mentioned);
CREATE INDEX IF NOT EXISTS idx_observations_fulltext
    ON observations USING GIN (to_tsvector('english', text));

COMMENT ON TABLE observations IS
    'LLM-extracted observations (claims/findings/methods/data-sources/repro-cues) '
    'from documents. Multiple per document. extracted_by_model_id records the '
    'specific model used per ADR-0010.';

-- ============================================================================
-- TABLE: research.research_themes
-- ============================================================================
-- Recurring topics across documents, detected by clustering observations.
-- Status tracks lifecycle: emerging → tracked → hot → saturated → deprecated.

CREATE TABLE IF NOT EXISTS research_themes (
    theme_id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    name                TEXT         NOT NULL UNIQUE,
        -- Short human-readable name; LLM-generated, optionally edited.
    description         TEXT,
        -- 1-3 sentence description of what unifies the observations.

    -- Lifecycle
    status              TEXT         NOT NULL DEFAULT 'emerging',
        -- 'emerging' | 'tracked' | 'hot' | 'saturated' | 'deprecated'
    first_observed_at   TIMESTAMPTZ  NOT NULL,
    last_observed_at    TIMESTAMPTZ  NOT NULL,

    -- Counts (denormalized for fast access; refreshed by clustering job)
    observation_count   INTEGER      NOT NULL DEFAULT 0,
    document_count      INTEGER      NOT NULL DEFAULT 0,
    hypothesis_count    INTEGER      NOT NULL DEFAULT 0,
        -- # of hypotheses citing observations in this theme

    -- Tags for cross-cutting categorization
    tags                TEXT[]       DEFAULT '{}',

    -- Bi-temporal
    valid_from          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_themes_status
    ON research_themes (status, last_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_themes_tags
    ON research_themes USING GIN (tags);

COMMENT ON TABLE research_themes IS
    'Recurring topics across documents. Populated by clustering job over '
    'observations. Status tracks lifecycle from emerging to deprecated.';

-- ============================================================================
-- TABLE: research.document_decisions
-- ============================================================================
-- Append-only log of decisions made about a document.
-- Replaces UPDATE-in-place for status fields; preserves full audit trail.

CREATE TABLE IF NOT EXISTS document_decisions (
    decision_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    document_id         UUID         NOT NULL
        REFERENCES documents (doc_id) ON DELETE RESTRICT,

    decision_type       TEXT         NOT NULL,
        -- 'reviewed', 'cited', 'rejected', 'archived', 'flagged_for_review',
        -- 'theme_assigned', 'priority_set'
    decision_value      TEXT,
        -- Context-dependent: theme_id for 'theme_assigned',
        -- priority level for 'priority_set', etc.
    decision_reason     TEXT,

    decided_by          TEXT         NOT NULL,
        -- 'director-evening' | 'director-morning' | 'orchestrator' |
        -- 'scout' | 'human:bot1' | model_id for LLM-driven decisions
    decided_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Bi-temporal
    valid_from          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    valid_to            TIMESTAMPTZ,
    recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_decisions_document
    ON document_decisions (document_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_decisions_type
    ON document_decisions (decision_type, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_decisions_decider
    ON document_decisions (decided_by, decided_at DESC);

COMMENT ON TABLE document_decisions IS
    'Append-only log of decisions about documents (reviewed, cited, rejected, '
    'archived, theme_assigned, priority_set). Replaces UPDATE-in-place for '
    'status; preserves full audit trail.';

-- ============================================================================
-- TABLE: research.scout_runs
-- ============================================================================
-- Audit log of every scraper/scout invocation.
-- Enables drift detection: which scout ran, when, what it found, errors.

CREATE TABLE IF NOT EXISTS scout_runs (
    run_id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identification
    scout_name          TEXT         NOT NULL,
        -- 'research-scout-scraper.py' | 'research-lab-scraper.py' |
        -- 'research-summarizer.py' | 'quant-research-scout.py' |
        -- future: 'scout-fed.py' | 'scout-sec.py' | 'scout-altdata.py' | etc.
    scout_version       TEXT,
        -- Optional version tag if the scout records one.
    host                TEXT         NOT NULL DEFAULT 'spark-cfbd',

    -- Timing
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    duration_seconds    NUMERIC,

    -- Outcomes
    status              TEXT         NOT NULL DEFAULT 'running',
        -- 'running' | 'completed' | 'failed' | 'partial'
    documents_inserted  INTEGER      NOT NULL DEFAULT 0,
    documents_skipped   INTEGER      NOT NULL DEFAULT 0,
        -- Skipped due to dedup (content_hash already present).
    observations_created INTEGER     NOT NULL DEFAULT 0,
        -- Only populated for summarizer runs.
    errors_count        INTEGER      NOT NULL DEFAULT 0,

    -- Per-source breakdown (mirrors existing scrapers' sources_status JSON)
    sources_status      JSONB        DEFAULT '{}'::JSONB,
        -- {"reddit": {"fetched": true, "items": 50, "errors": 0}, ...}

    -- Errors
    error_message       TEXT,
    error_traceback     TEXT,

    -- Model attribution (for summarizer/scout runs)
    model_id            TEXT,
        -- Substrate model entity name, e.g. 'gemma4:e4b', 'claude-haiku-4-5'.
        -- NULL for non-LLM scrapers.
    tokens_used         INTEGER,
    cost_usd            NUMERIC,

    -- Cron context
    triggered_by        TEXT         NOT NULL DEFAULT 'cron',
        -- 'cron' | 'manual' | 'backfill' | 'test'

    -- Bi-temporal
    recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scout_runs_scout
    ON scout_runs (scout_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scout_runs_status
    ON scout_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scout_runs_model
    ON scout_runs (model_id, started_at DESC) WHERE model_id IS NOT NULL;

COMMENT ON TABLE scout_runs IS
    'Audit log of every scout/scraper/summarizer invocation. Enables drift '
    'detection and per-scout performance tracking. model_id FKs (conceptually) '
    'to substrate model registry per ADR-0010.';

-- ============================================================================
-- Hypothesis-grounding extension to existing research.hypotheses
-- ============================================================================
-- Per ADR-0014 §Decision §6: every LLM-proposed hypothesis must cite at
-- least one document. Add cited_doc_ids column. Application-layer enforcement
-- (scout writes + orchestrator proposals reject empty arrays).

ALTER TABLE hypotheses
    ADD COLUMN IF NOT EXISTS cited_doc_ids UUID[]
        NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_hypotheses_cited_docs
    ON hypotheses USING GIN (cited_doc_ids);

COMMENT ON COLUMN hypotheses.cited_doc_ids IS
    'Documents (research.documents.doc_id) cited as grounding for this '
    'hypothesis. Per ADR-0014 (HYPOTHESIS_GROUNDING_REQUIRED_V1), application '
    'layer rejects writes with empty arrays from LLM proposers. Default empty '
    'is for legacy/manual rows pre-dating this column.';

-- ============================================================================
-- Record migration as applied
-- ============================================================================

INSERT INTO migrations_applied (name, applied_at)
VALUES ('RESEARCH_LIBRARY_SCHEMA_V1', now())
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Post-migration: verify
-- ============================================================================
-- Run after COMMIT to confirm:
--
--   \dt
--   -- Should show: documents, observations, research_themes,
--   --              document_decisions, scout_runs (plus existing tables)
--
--   SELECT name, applied_at FROM migrations_applied
--   WHERE name = 'RESEARCH_LIBRARY_SCHEMA_V1';
--   -- Should return exactly one row with current timestamp.
--
--   \d hypotheses
--   -- Should show new cited_doc_ids column of type uuid[] DEFAULT '{}'.
--
-- After verification, run the substrate extractors to canonicalize:
--
--   . /etc/neon-meta.env
--   python3 ~/scripts/extract_data_tables.py --verbose 2>&1 | tail -10
--   python3 ~/scripts/extract_data_relationships.py --verbose 2>&1 | tail -10
--
-- The 5 new tables become substrate `data_table` entities;
-- relationships will populate as scripts start writing to them.
-- ============================================================================
