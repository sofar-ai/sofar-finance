-- Migration: synthesis_archive + unusual_flow_signals + unusual_flow_returns
-- Target: sofar-market-data (NOT production, NOT research)
-- Sentinel: SYNTHESIS_UNUSUAL_FLOW_V1
-- Date: 2026-04-21

BEGIN;

-- ============================================================
-- Target-DB assertion (per database-routing-addendum-2026-04-20.md)
-- ============================================================
DO $assert$
DECLARE
    has_market_marker BOOLEAN;
    has_production_marker BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='macro_signals' AND table_schema='public') INTO has_market_marker;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='positions' AND table_schema='public') INTO has_production_marker;

    IF NOT has_market_marker THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: macro_signals not found. Expected market DB.';
    END IF;
    IF has_production_marker THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: positions table found. This is production DB, not market.';
    END IF;
END
$assert$;

-- ============================================================
-- 1. synthesis_archive — row per synthesis write
-- ============================================================
CREATE TABLE IF NOT EXISTS synthesis_archive (
    archive_id              SERIAL PRIMARY KEY,
    archived_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generated_at            TIMESTAMPTZ,
    source                  TEXT NOT NULL,      -- evening / morning / intraday / overnight / conditional
    model_used              TEXT,
    regime                  TEXT,
    intraday_signal         TEXT,
    intraday_confidence     INTEGER,
    next_day_signal         TEXT,
    next_day_confidence     INTEGER,
    long_term_signal        TEXT,
    long_term_confidence    INTEGER,
    spy_price_at_gen        NUMERIC,
    qqq_price_at_gen        NUMERIC,
    full_json               JSONB NOT NULL,
    prompt_chars            INTEGER,
    response_chars          INTEGER,
    runtime_seconds         NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_synthesis_archive_source_time
    ON synthesis_archive (source, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_synthesis_archive_generated
    ON synthesis_archive (generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_synthesis_archive_full_json
    ON synthesis_archive USING GIN (full_json);

-- ============================================================
-- 2. unusual_flow_signals — one row per detection event
-- ============================================================
CREATE TABLE IF NOT EXISTS unusual_flow_signals (
    signal_id           SERIAL PRIMARY KEY,
    session_date        DATE NOT NULL,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    symbol              TEXT NOT NULL,
    method              TEXT NOT NULL,          -- iso_concentration / intraday_burst / direction_concentration / sweep_cluster_density / premium_vs_baseline / rank_anomaly (when baselines mature)
    score               NUMERIC,                -- normalized strength 0-100
    threshold_hit       NUMERIC,                -- what the detector required
    actual_value        NUMERIC,                -- what the detector found
    trigger_details     JSONB,                  -- raw stats that fired it
    premium_snapshot    NUMERIC,                -- total_premium at detection
    direction           TEXT,                   -- BUY_SKEW / SELL_SKEW / MIXED / NA
    notified_at         TIMESTAMPTZ             -- non-null when Discord posted (Phase 2)
);
CREATE INDEX IF NOT EXISTS idx_unusual_flow_session_symbol
    ON unusual_flow_signals (session_date, symbol);
CREATE INDEX IF NOT EXISTS idx_unusual_flow_method_date
    ON unusual_flow_signals (method, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_unusual_flow_detected
    ON unusual_flow_signals (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_unusual_flow_score
    ON unusual_flow_signals (score DESC);

-- ============================================================
-- 3. unusual_flow_returns — forward return measurements
--    Separate table so horizons are flexible per method
-- ============================================================
CREATE TABLE IF NOT EXISTS unusual_flow_returns (
    return_id           SERIAL PRIMARY KEY,
    signal_id           INTEGER NOT NULL REFERENCES unusual_flow_signals(signal_id) ON DELETE CASCADE,
    horizon_days        INTEGER NOT NULL,       -- 1, 5, 20, 40, intraday_close (as 0)
    measured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    price_at_signal     NUMERIC,                -- symbol's spot at signal detection (from prices_intraday if available else prices_daily)
    price_at_horizon    NUMERIC,                -- spot at horizon measurement
    return_pct          NUMERIC,                -- (price_at_horizon - price_at_signal) / price_at_signal
    direction_correct   BOOLEAN,                -- did the signal's implied direction match realized?
    UNIQUE (signal_id, horizon_days)
);
CREATE INDEX IF NOT EXISTS idx_unusual_flow_returns_signal
    ON unusual_flow_returns (signal_id);
CREATE INDEX IF NOT EXISTS idx_unusual_flow_returns_horizon
    ON unusual_flow_returns (horizon_days, measured_at DESC);

-- ============================================================
-- 4. Register this migration (marker)
-- ============================================================
CREATE TABLE IF NOT EXISTS migrations_applied (
    name        TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO migrations_applied (name) VALUES ('SYNTHESIS_UNUSUAL_FLOW_V1')
ON CONFLICT (name) DO NOTHING;

COMMIT;
