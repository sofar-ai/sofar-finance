-- ============================================================================
-- Migration: 20260508-executor-human-review-gate.sql
-- Sentinel: EXECUTOR_HUMAN_REVIEW_GATE_V1
-- ADR: ADR-0023 (promotion executor)
-- Target DB: research
-- Target table: experiments
--
-- Adds two columns that together form the executor's review gate:
--   human_reviewed_at                TIMESTAMPTZ  — WHEN review happened
--   human_reviewed_signal_code_hash  VARCHAR(64)  — sha256 of signal_code at review
--
-- The promotion-executor.py script refuses to execute any row where either
-- column is NULL or where sha256(current signal_code) != stored hash.
--
-- Tracking: this migration does NOT write to migrations_applied. Per repo
-- practice as of 2026-05-08, that table is absent from the research DB and
-- the most recent research migrations have a mixed track record on writing
-- to it. The doc-vs-reality drift (CLAUDE.md describes the convention;
-- 20260502-research-library-v1.sql attempted bootstrap; table is currently
-- absent) is flagged for tonight's handoff under sentinel
-- MIGRATIONS_APPLIED_RESEARCH_DB_BOOTSTRAP_NOT_TAKEN_V1. Bootstrapping the
-- table as a side effect of this feature migration would mix concerns;
-- bootstrap-or-don't is its own decision deserving its own discrete migration.
-- Audit trail for this migration is the filename + git commit + ADR-0023.
-- ============================================================================

BEGIN;

-- ── Schema change ───────────────────────────────────────────────────────────
-- IF NOT EXISTS on each ADD COLUMN so the migration is safe to re-run after
-- a partial failure (e.g. dry-run COMMITted by accident, then real run).
ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS human_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_reviewed_signal_code_hash VARCHAR(64);

-- ── Verification: both columns present, both NULL across all rows ───────────
-- Expect: total = (rows in experiments), reviewed = 0, hashed = 0.
SELECT
  count(*)                                  AS total_rows,
  count(human_reviewed_at)                  AS reviewed,
  count(human_reviewed_signal_code_hash)    AS hashed
FROM experiments;

-- ── Verification: column metadata matches spec ──────────────────────────────
-- Expect two rows: human_reviewed_at (timestamp with time zone, nullable yes)
-- and human_reviewed_signal_code_hash (character varying, max length 64, nullable yes).
SELECT column_name, data_type, character_maximum_length, is_nullable
FROM information_schema.columns
WHERE table_name = 'experiments'
  AND column_name IN ('human_reviewed_at', 'human_reviewed_signal_code_hash')
ORDER BY column_name;

-- DRY RUN: leave commented for inspection, then uncomment ONE of the two below.

-- ROLLBACK;   -- for the test-in-transaction dry run
COMMIT;     -- for the real run after dry run looks clean
