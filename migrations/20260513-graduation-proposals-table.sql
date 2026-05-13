-- Adds research.graduation_proposals — director's GRADUATE directives become
-- rows here, then auto-execute after 48h unless operator vetoes via the
-- sandbox-graduator.py CLI. Per ADR-0026.
--
-- Lifecycle:
--   1. Director-evening emits GRADUATE directive in section 7d of its output
--   2. apply_graduation_directives() in research-director-evening.py inserts
--      a row here with status='pending' and auto_execute_at = now() + 48h
--   3. Operator sees the proposal in director-morning's Discord post next AM
--   4. Operator has 48h to act:
--        - graduator.py dismiss <id> → status='vetoed_as_dismissed' +
--                                       experiments.review_dismissed_at set
--        - graduator.py defer <id>   → status='vetoed_for_more_validation'
--                                       (experiment row untouched; expects new
--                                        validator_version run before next consideration)
--        - graduator.py hold <id>    → status='vetoed_hold' (re-evaluate next director run)
--        - graduator.py execute <id> → status='manually_executed' (bypass 48h wait)
--   5. If no operator action by auto_execute_at, director-evening's pre-LLM
--      auto-execute pass calls graduator.execute() → status='auto_executed'
--
-- Each state transition (proposal creation, all 4 veto types, auto-execute)
-- posts to the dedicated #sofar-graduations Discord channel via the
-- /etc/discord-webhook-graduations.env webhook.
--
-- experiments.graduated_at is set by graduator.execute() under transaction
-- alongside the actual signal_values INSERT to v1.0.

CREATE TABLE IF NOT EXISTS graduation_proposals (
    proposal_id          SERIAL PRIMARY KEY,
    experiment_id        VARCHAR(64) NOT NULL,
    proposed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    proposed_by_run_id   VARCHAR(64),
    director_reasoning   TEXT,
    auto_execute_at      TIMESTAMPTZ NOT NULL,
    status               VARCHAR(32) NOT NULL DEFAULT 'pending'
                         CHECK (status IN (
                             'pending',
                             'auto_executed',
                             'manually_executed',
                             'vetoed_as_dismissed',
                             'vetoed_for_more_validation',
                             'vetoed_hold',
                             'superseded'
                         )),
    status_at            TIMESTAMPTZ,
    status_reason        TEXT,
    status_actor         VARCHAR(32)
                         CHECK (status_actor IN (
                             'director_auto',
                             'operator',
                             NULL
                         )),
    discord_posted       BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (experiment_id, proposed_at)
);

-- The surfacer's "show me what's pending" query uses status; index it.
CREATE INDEX IF NOT EXISTS graduation_proposals_pending_idx
    ON graduation_proposals (auto_execute_at)
    WHERE status = 'pending';

-- For "show me history for this experiment" lookups in graduator.py status:
CREATE INDEX IF NOT EXISTS graduation_proposals_by_experiment_idx
    ON graduation_proposals (experiment_id, proposed_at DESC);

COMMENT ON TABLE graduation_proposals IS
  'Director-proposed graduations of sandbox-validated signals to production v1.0. '
  'Each row is one proposal; UNIQUE constraint prevents duplicate proposals from '
  'the same director run. Lifecycle: pending → (auto_executed | manually_executed | '
  'vetoed_as_dismissed | vetoed_for_more_validation | vetoed_hold | superseded).';

COMMENT ON COLUMN graduation_proposals.experiment_id IS
  'References research.experiments.experiment_id but not enforced via FK (matches '
  'pattern in experiment_sandbox_validations — experiments table changes carefully).';

COMMENT ON COLUMN graduation_proposals.proposed_by_run_id IS
  'Director run_id that produced this proposal (e.g. "evening-2026-05-13"). '
  'Joins to research.daily_summaries.run_id for audit trail.';

COMMENT ON COLUMN graduation_proposals.director_reasoning IS
  'The parenthetical text the director wrote after the GRADUATE: directive. '
  'E.g. "delta_psr 0.999987, strong contribution over baseline". Preserved for '
  'operator review during the 48h veto window.';

COMMENT ON COLUMN graduation_proposals.auto_execute_at IS
  'When director-evening''s auto-execute pass will graduate this if not vetoed. '
  'Set to proposed_at + 48h by apply_graduation_directives(). 48h gives operator '
  'two full director-morning Discord posts to intervene.';

COMMENT ON COLUMN graduation_proposals.status IS
  'pending: awaiting auto_execute or veto. '
  'auto_executed: 48h elapsed, director-evening graduated it. '
  'manually_executed: operator ran graduator.execute() before 48h. '
  'vetoed_as_dismissed: operator dismissed; experiments.review_dismissed_at set. '
  'vetoed_for_more_validation: operator deferred; expects re-validation. '
  'vetoed_hold: operator unsure; re-evaluate next director run. '
  'superseded: another proposal for same experiment_id exists (defensive).';

COMMENT ON COLUMN graduation_proposals.discord_posted IS
  'True once the proposal-creation event has been posted to #sofar-graduations. '
  'Allows the surfacer to retry posting if a Discord delivery fails during the '
  'initial INSERT path.';
