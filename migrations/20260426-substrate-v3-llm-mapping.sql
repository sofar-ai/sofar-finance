-- 20260426-substrate-v3-llm-mapping.sql
-- Sentinel: SUBSTRATE_V3_LLM_MAPPING
--
-- Adds infrastructure for LLM call mapping (static + runtime).
--
-- New capabilities:
--   1. llm_call entities — static call sites discovered by source extraction.
--      Each represents a specific call site (script:line) with its
--      model + endpoint + inference_locus. Conditional routing captured
--      via attrs.is_conditional + attrs.conditions.
--
--   2. llm_call_events table — runtime observations from token-usage.log
--      and any future runtime instrumentation. Time-series, append-only,
--      one row per actual call.
--
--   3. model entity attrs.aliases — array of alternate names for a model
--      ("opus", "opus-4-7", "claude-opus-4-7" all map to the canonical id).
--      Used by both static extractor and runtime ingestion to normalize.
--
-- Why separate llm_call_events table instead of using events table:
--   The general events table records lifecycle events (extracted, updated,
--   etc) on entities. LLM call events are domain-specific time-series with
--   their own queryable fields (tokens, model, latency). Separate table
--   keeps queries fast and schemas clean.
--
-- WHAT IT TOUCHES: only adds new objects. No existing entities changed.
-- REVERSIBLE: drop the new objects, no data loss to existing substrate.
--
-- DEPLOY:
--   psql "$NEON_META_URL" -f migrations/20260426-substrate-v3-llm-mapping.sql

BEGIN;

-- ─── llm_call_events: time-series of actual LLM calls ─────────────────
-- One row per call. Append-only. Indexed for common queries.
CREATE TABLE IF NOT EXISTS llm_call_events (
    id              BIGSERIAL PRIMARY KEY,
    occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    script          TEXT NOT NULL,                    -- normalized script name
    model_id        TEXT NOT NULL,                    -- canonical model id (post-alias)
    raw_model       TEXT,                             -- original string from log
    input_tokens    INTEGER,                          -- NULL if unknown
    output_tokens   INTEGER,
    total_tokens    INTEGER,
    inference_locus TEXT,                             -- s1/s2/mac1/cloud_anthropic/...
    provider        TEXT,                             -- anthropic/ollama/openai
    source          TEXT NOT NULL DEFAULT 'token_usage_log',  -- where we got this event
    source_ref      TEXT,                             -- e.g., 'token-usage.log:line=4231'
    extra           JSONB DEFAULT '{}'::jsonb,        -- room for latency, cost, etc.
    ingested_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_call_events_occurred
  ON llm_call_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_call_events_script
  ON llm_call_events (script, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_call_events_model
  ON llm_call_events (model_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_call_events_source
  ON llm_call_events (source, source_ref);

-- Prevent duplicate ingestion of same log line
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_call_events_source_ref
  ON llm_call_events (source, source_ref)
  WHERE source_ref IS NOT NULL;


-- ─── ingestion_state: tracks last-ingested cursor for runtime ingestors ──
CREATE TABLE IF NOT EXISTS substrate_ingestion_state (
    ingestor       TEXT PRIMARY KEY,                  -- e.g., 'token_usage_log'
    last_cursor    TEXT NOT NULL DEFAULT '',          -- file path / line / timestamp
    last_run_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    rows_ingested  BIGINT NOT NULL DEFAULT 0,
    notes          TEXT
);


-- ─── Track the migration ──────────────────────────────────────────────
INSERT INTO migrations_applied (name, applied_at)
VALUES ('20260426-substrate-v3-llm-mapping.sql', NOW())
ON CONFLICT (name) DO NOTHING;

COMMIT;

\echo ''
\echo '✓ Schema additions:'
\echo '  - llm_call_events table (runtime observations)'
\echo '  - substrate_ingestion_state table (cursor tracking)'
\echo ''
\echo 'Note: llm_call entities use existing entities table (type=llm_call)'
\echo 'Note: model aliases use existing model.attrs (no schema change needed)'
\echo ''
\echo 'Verify:'
\echo '  \\d llm_call_events'
\echo '  \\d substrate_ingestion_state'
