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
-- Tracking: bootstraps migrations_applied if missing, then inserts the
-- sentinel row. Pattern follows 20260502-research-library-v1.sql which
-- did the same per ADR-0005. As of 2026-05-08 a separate finding shows
-- migrations_applied is absent from the research DB even though the
-- May 2 migration claimed to bootstrap it; this migration's bootstrap
-- block is therefore both belt-and-suspenders and remediation.
-- See tonight's handoff for the broader doc-vs-reality reconciliation.
-- ============================================================================

BEGIN;

-- ── Bootstrap migrations_applied if missing (per ADR-0005) ──────────────────
CREATE TABLE IF NOT EXISTS migrations_applied (
    name        VARCHAR(100) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Schema change ───────────────────────────────────────────────────────────
ALTER TABLE experiments
  ADD COLUMN human_reviewed_at TIMESTAMPTZ,
  ADD COLUMN human_reviewed_signal_code_hash VARCHAR(64);

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

-- ── Track the migration ─────────────────────────────────────────────────────
INSERT INTO migrations_applied (name, applied_at)
VALUES ('EXECUTOR_HUMAN_REVIEW_GATE_V1', now())
ON CONFLICT (name) DO NOTHING;

-- ── Verification: tracking row landed ───────────────────────────────────────
-- Expect one row.
SELECT name, applied_at
FROM migrations_applied
WHERE name = 'EXECUTOR_HUMAN_REVIEW_GATE_V1';

-- DRY RUN: leave commented for inspection, then uncomment ONE of the two below.

ROLLBACK;   -- for the test-in-transaction dry run
-- COMMIT;     -- for the real run after dry run looks clean
