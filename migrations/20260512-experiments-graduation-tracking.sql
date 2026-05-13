-- Adds graduation-tracking columns to research.experiments per ADR-0026.
--
-- Tracks the lifecycle of a sandbox-validated signal as it moves from
-- v_research_NNN through to production v1.0:
--   - graduated_at: when sandbox-graduator.py execute moved the signal
--   - graduated_to_version: target version (typically 'v1.0')
--   - review_dismissed_at: when operator chose NOT to graduate (with reason)
--   - review_dismissed_reason: explanation for the dismissal (audit trail)
--
-- The graduation-surfacer.py cron uses (graduated_at IS NULL AND
-- review_dismissed_at IS NULL) to identify candidates still needing
-- operator review. Partial index keeps that lookup fast as the
-- experiments table grows.

ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS graduated_to_version VARCHAR(64),
  ADD COLUMN IF NOT EXISTS review_dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_dismissed_reason TEXT;

CREATE INDEX IF NOT EXISTS experiments_graduation_pending_idx
  ON experiments (experiment_id)
  WHERE graduated_at IS NULL AND review_dismissed_at IS NULL;

COMMENT ON COLUMN experiments.graduated_at IS
  'Timestamp when sandbox-graduator.py promoted this experiment''s signal '
  'to a production signal_version. NULL = not yet graduated. Set together '
  'with graduated_to_version under a single transaction.';

COMMENT ON COLUMN experiments.graduated_to_version IS
  'The signal_version this experiment graduated to (typically v1.0). '
  'NULL if not graduated. Allows future multi-version graduation targets.';

COMMENT ON COLUMN experiments.review_dismissed_at IS
  'Timestamp when operator explicitly marked this experiment as NOT to '
  'be graduated (e.g. via sandbox-graduator.py dismiss). Surfacer will '
  'stop re-notifying. Different from rejected: rejected means the daemon '
  'or director said no; dismissed means the graduator operator said no '
  'after sandbox validation.';

COMMENT ON COLUMN experiments.review_dismissed_reason IS
  'Operator''s rationale for dismissing this experiment from graduation '
  'consideration. Free-text audit trail.';
