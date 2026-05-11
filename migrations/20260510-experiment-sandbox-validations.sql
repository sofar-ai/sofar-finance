-- 20260510-experiment-sandbox-validations.sql
--
-- ADR-0025 (forthcoming): Create the table that holds results of running
-- validate_signal against signal_values from a sandbox version (e.g.
-- v_research_002) rather than production v1.0. Operator-invoked validator
-- writes rows here; downstream consumers (director, future graduator) read.
--
-- Sentinel: EXPERIMENT_SANDBOX_VALIDATIONS_TABLE_V1
-- Target DB: research
-- Apply via: psql "$DATABASE_URL_DIRECT" -f this-file.sql (using research env)
-- Or via db.py execute_query(direct=True) — verify columns post-apply with
-- pg_attribute on the consumer's connection path, NOT information_schema
-- (per RESEARCH_DB_BACKEND_CATALOG_DIVERGENCE_NEON_V1 sentinel).
--
-- Idempotent: IF NOT EXISTS on table + indexes. Safe to re-run.

CREATE TABLE IF NOT EXISTS experiment_sandbox_validations (
    id                       SERIAL PRIMARY KEY,
    experiment_id            VARCHAR(255) NOT NULL,
    target_version           VARCHAR(64)  NOT NULL,
    signal_name              VARCHAR(255) NOT NULL,
    ticker                   VARCHAR(16)  NOT NULL DEFAULT 'SPY',

    -- Baseline = champion features only (no new signal)
    baseline_sharpe          DECIMAL(10,4),
    baseline_accuracy        DECIMAL(6,2),
    baseline_profit_factor   DECIMAL(10,4),
    baseline_scored          INTEGER,

    -- Enhanced = champion features + new signal as feature 134
    enhanced_sharpe          DECIMAL(10,4),
    enhanced_accuracy        DECIMAL(6,2),
    enhanced_profit_factor   DECIMAL(10,4),
    enhanced_scored          INTEGER,

    -- Deltas
    sharpe_delta             DECIMAL(10,4),
    accuracy_delta           DECIMAL(6,2),
    profit_factor_delta      DECIMAL(10,4),

    -- Feature-importance from the final enhanced model fit
    new_signal_importance    INTEGER,
    new_signal_rank          INTEGER,
    total_features           INTEGER,

    -- Validation metadata
    validation_days          INTEGER,
    provisional              BOOLEAN,

    -- Provenance
    computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validator_version        VARCHAR(32)  NOT NULL,

    -- Full validate_signal return as jsonb for any post-hoc analysis
    full_results_json        JSONB,

    -- Allow re-running validations with bumped validator_version without losing history.
    UNIQUE (experiment_id, target_version, validator_version)
);

CREATE INDEX IF NOT EXISTS idx_esv_experiment
    ON experiment_sandbox_validations(experiment_id);

CREATE INDEX IF NOT EXISTS idx_esv_target_version
    ON experiment_sandbox_validations(target_version);

CREATE INDEX IF NOT EXISTS idx_esv_computed_at
    ON experiment_sandbox_validations(computed_at DESC);

-- Verification query — operator can run after apply to confirm column presence
-- on the same connection path that consumers will use:
--
--   SELECT column_name, data_type FROM pg_attribute
--   WHERE attrelid = 'experiment_sandbox_validations'::regclass AND attnum > 0
--   ORDER BY attnum;
--
-- Expected: 23 columns including id, experiment_id, ..., full_results_json.
