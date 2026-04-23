-- ============================================================================
-- Migration: CFTC COT ingestion — TFF (financial) + DCOT (commodity)
-- Sentinel:  CFTC_COT_V1
-- Date:      2026-04-23
-- Target DB: market (per TABLE_DB_MAP auto-routing)
-- ----------------------------------------------------------------------------
-- Creates two tables for CFTC Commitments of Traders reports:
--   cftc_cot_financial  — TFF (financial futures: equities, rates, FX)
--   cftc_cot_commodity  — DCOT (physical: energy, metals, ag, softs)
--
-- Both tables keyed on CFTC's own `id` field (format: YYMMDD + contract_code
-- + {F,C}, e.g. '26041443874QF' = 2026-04-14, contract 43874Q, futonly).
-- This is idempotent for re-ingestion / backfills via ON CONFLICT.
--
-- Column selection rationale:
--   - Keep: _all positional variants, pct_of_oi_*, change_in_*
--   - Drop: _old / _other / _1 / _2 (crop-year splits — _all is the unified figure)
--   - Drop: conc_* (concentration by top-N traders — rarely used for our signals)
--   - Drop: traders_* (count of reporting firms — metadata, not positioning)
--
-- Data provenance note:
--   TFF launched June 2010; DCOT launched September 2009. CFTC retrospectively
--   reclassified 2006-present historical data into current taxonomy.
--   Pre-launch rows are AUTHORITATIVE but were NOT publicly available in this
--   form at the time. See docs/CFTC-UNIVERSE-CATALOG.md §Data Provenance.
--
-- Registration: data_source_registry gets one row per table at end of migration.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 1: cftc_cot_financial (TFF)
-- Reporter categories: dealer / asset_mgr / lev_money / other_rept / nonrept
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cftc_cot_financial (
    -- Identity
    id                              TEXT        PRIMARY KEY,
    report_date                     DATE        NOT NULL,
    market_and_exchange_names       TEXT        NOT NULL,
    contract_market_name            TEXT,
    cftc_contract_market_code       TEXT,
    cftc_market_code                TEXT,
    cftc_commodity_code             INTEGER,
    commodity_group_name            TEXT,
    commodity_subgroup_name         TEXT,
    commodity_name                  TEXT,
    contract_units                  TEXT,
    futonly_or_combined             TEXT,
    yyyy_report_week_ww             INTEGER,

    -- Open interest
    open_interest_all               BIGINT,
    change_in_open_interest_all     BIGINT,

    -- Reporter: Dealer (banks / swap dealer intermediary)
    dealer_positions_long_all       BIGINT,
    dealer_positions_short_all      BIGINT,
    dealer_positions_spread_all     BIGINT,
    change_in_dealer_long_all       BIGINT,
    change_in_dealer_short_all      BIGINT,
    change_in_dealer_spread_all     BIGINT,
    pct_of_oi_dealer_long_all       NUMERIC(6,2),
    pct_of_oi_dealer_short_all      NUMERIC(6,2),
    pct_of_oi_dealer_spread_all     NUMERIC(6,2),

    -- Reporter: Asset Manager (real-money: pension, mutual, endowment)
    asset_mgr_positions_long        BIGINT,
    asset_mgr_positions_short       BIGINT,
    asset_mgr_positions_spread      BIGINT,
    change_in_asset_mgr_long        BIGINT,
    change_in_asset_mgr_short       BIGINT,
    change_in_asset_mgr_spread      BIGINT,
    pct_of_oi_asset_mgr_long        NUMERIC(6,2),
    pct_of_oi_asset_mgr_short       NUMERIC(6,2),
    pct_of_oi_asset_mgr_spread      NUMERIC(6,2),

    -- Reporter: Leveraged Money (hedge funds, CTAs — PRIMARY SIGNAL)
    lev_money_positions_long        BIGINT,
    lev_money_positions_short       BIGINT,
    lev_money_positions_spread      BIGINT,
    change_in_lev_money_long        BIGINT,
    change_in_lev_money_short       BIGINT,
    change_in_lev_money_spread      BIGINT,
    pct_of_oi_lev_money_long        NUMERIC(6,2),
    pct_of_oi_lev_money_short       NUMERIC(6,2),
    pct_of_oi_lev_money_spread      NUMERIC(6,2),

    -- Reporter: Other Reportables (prop firms, other discretionary)
    other_rept_positions_long       BIGINT,
    other_rept_positions_short      BIGINT,
    other_rept_positions_spread     BIGINT,
    change_in_other_rept_long       BIGINT,
    change_in_other_rept_short      BIGINT,
    change_in_other_rept_spread     BIGINT,
    pct_of_oi_other_rept_long       NUMERIC(6,2),
    pct_of_oi_other_rept_short      NUMERIC(6,2),
    pct_of_oi_other_rept_spread     NUMERIC(6,2),

    -- Reporter: Non-Reportable (small traders, below reporting threshold)
    nonrept_positions_long_all      BIGINT,
    nonrept_positions_short_all     BIGINT,
    change_in_nonrept_long_all      BIGINT,
    change_in_nonrept_short_all     BIGINT,
    pct_of_oi_nonrept_long_all      NUMERIC(6,2),
    pct_of_oi_nonrept_short_all     NUMERIC(6,2),

    -- Audit
    ingested_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    script_version                  TEXT        NOT NULL DEFAULT 'CFTC_COT_V1'
);

COMMENT ON TABLE cftc_cot_financial IS
  'CFTC TFF (Traders in Financial Futures) positioning by reporter category. '
  'Weekly, released Fridays 3:30pm ET covering Tuesday of same week. '
  'Sentinel: CFTC_COT_V1. Source: https://publicreporting.cftc.gov/resource/gpe5-46if.json';

CREATE INDEX IF NOT EXISTS idx_cftc_fin_date
  ON cftc_cot_financial (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_cftc_fin_market_date
  ON cftc_cot_financial (market_and_exchange_names, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_cftc_fin_subgroup_date
  ON cftc_cot_financial (commodity_subgroup_name, report_date DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- Table 2: cftc_cot_commodity (DCOT)
-- Reporter categories: prod_merc / swap / m_money / other_rept / nonrept
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cftc_cot_commodity (
    -- Identity
    id                              TEXT        PRIMARY KEY,
    report_date                     DATE        NOT NULL,
    market_and_exchange_names       TEXT        NOT NULL,
    contract_market_name            TEXT,
    cftc_contract_market_code       TEXT,
    cftc_market_code                TEXT,
    cftc_commodity_code             INTEGER,
    commodity_group_name            TEXT,
    commodity_subgroup_name         TEXT,
    commodity_name                  TEXT,
    contract_units                  TEXT,
    futonly_or_combined             TEXT,
    yyyy_report_week_ww             INTEGER,

    -- Open interest (use _all, skip _old/_other crop-year splits)
    open_interest_all               BIGINT,
    change_in_open_interest_all     BIGINT,

    -- Reporter: Producer / Merchant / Processor / User (physical hedgers — CONTRARIAN)
    prod_merc_positions_long        BIGINT,
    prod_merc_positions_short       BIGINT,
    change_in_prod_merc_long        BIGINT,
    change_in_prod_merc_short       BIGINT,
    pct_of_oi_prod_merc_long        NUMERIC(6,2),
    pct_of_oi_prod_merc_short       NUMERIC(6,2),

    -- Reporter: Swap Dealers (index funds, commercial swaps)
    swap_positions_long_all         BIGINT,
    swap__positions_short_all       BIGINT,        -- Note: Socrata field has DOUBLE underscore
    swap__positions_spread_all      BIGINT,        -- (typo in their schema, we mirror it)
    change_in_swap_long_all         BIGINT,
    change_in_swap_short_all        BIGINT,
    change_in_swap_spread_all       BIGINT,
    pct_of_oi_swap_long_all         NUMERIC(6,2),
    pct_of_oi_swap_short_all        NUMERIC(6,2),
    pct_of_oi_swap_spread_all       NUMERIC(6,2),

    -- Reporter: Managed Money (hedge funds, CTAs — PRIMARY SIGNAL for commodities)
    m_money_positions_long_all      BIGINT,
    m_money_positions_short_all     BIGINT,
    m_money_positions_spread        BIGINT,
    change_in_m_money_long_all      BIGINT,
    change_in_m_money_short_all     BIGINT,
    change_in_m_money_spread        BIGINT,
    pct_of_oi_m_money_long_all      NUMERIC(6,2),
    pct_of_oi_m_money_short_all     NUMERIC(6,2),
    pct_of_oi_m_money_spread        NUMERIC(6,2),

    -- Reporter: Other Reportables (prop firms, other discretionary)
    other_rept_positions_long       BIGINT,
    other_rept_positions_short      BIGINT,
    other_rept_positions_spread     BIGINT,
    change_in_other_rept_long       BIGINT,
    change_in_other_rept_short      BIGINT,
    change_in_other_rept_spread     BIGINT,
    pct_of_oi_other_rept_long       NUMERIC(6,2),
    pct_of_oi_other_rept_short      NUMERIC(6,2),
    pct_of_oi_other_rept_spread     NUMERIC(6,2),

    -- Reporter: Non-Reportable
    nonrept_positions_long_all      BIGINT,
    nonrept_positions_short_all     BIGINT,
    change_in_nonrept_long_all      BIGINT,
    change_in_nonrept_short_all     BIGINT,
    pct_of_oi_nonrept_long_all      NUMERIC(6,2),
    pct_of_oi_nonrept_short_all     NUMERIC(6,2),

    -- Audit
    ingested_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    script_version                  TEXT        NOT NULL DEFAULT 'CFTC_COT_V1'
);

COMMENT ON TABLE cftc_cot_commodity IS
  'CFTC DCOT (Disaggregated Commitments of Traders) positioning by reporter '
  'category for physical commodities. Weekly, released Fridays 3:30pm ET '
  'covering Tuesday. Sentinel: CFTC_COT_V1. '
  'Source: https://publicreporting.cftc.gov/resource/72hh-3qpy.json';

CREATE INDEX IF NOT EXISTS idx_cftc_com_date
  ON cftc_cot_commodity (report_date DESC);

CREATE INDEX IF NOT EXISTS idx_cftc_com_market_date
  ON cftc_cot_commodity (market_and_exchange_names, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_cftc_com_subgroup_date
  ON cftc_cot_commodity (commodity_subgroup_name, report_date DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- data_source_registry rows (pilot status until first successful weekly run)
--
-- Schema reference (matches existing rows like 'thetadata_flow_trades'):
--   Column defaults auto-populated: status='pilot', cost_monthly=0,
--   data_quality_checks='[]'::jsonb, verification_period_days=14,
--   created_at/updated_at=now(). We only specify non-default values.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO data_source_registry (
    source_name,
    description,
    ingestion_script,
    vendor,
    tier,
    table_name,
    expected_frequency,
    expected_rows_per_day,
    expected_latency_hours,
    pilot_start_date,
    verification_notes
)
VALUES (
    'cftc_cot_tff',
    'CFTC Traders in Financial Futures (TFF). Weekly positioning by reporter '
      || 'category (dealer / asset_mgr / lev_money / other_rept / nonrept) for '
      || 'equity indices, UST curve, short rates, FX. Released Fridays 3:30pm ET '
      || 'covering Tuesday of same week. Source: '
      || 'https://publicreporting.cftc.gov/resource/gpe5-46if.json. '
      || 'Universe: 47 markets per docs/CFTC-UNIVERSE-CATALOG.md. Sentinel: CFTC_COT_V1.',
    '/home/bot1/scripts/ingest-cftc-cot.py',
    'CFTC',
    1,
    'cftc_cot_financial',
    'weekly',
    47,               -- one row per market per week
    72,               -- Friday 3:30pm covers Tuesday: ~72h latency
    CURRENT_DATE,
    'Pilot — initial backfill covers 2007-01-01 to present. Promote to production after first successful weekly cron fire (first Saturday post-deploy).'
),
(
    'cftc_cot_dcot',
    'CFTC Disaggregated Commitments of Traders (DCOT). Weekly positioning by '
      || 'reporter category (prod_merc / swap / m_money / other_rept / nonrept) '
      || 'for physical commodities: energy, metals, agriculture, softs. Released '
      || 'Fridays 3:30pm ET covering Tuesday of same week. Source: '
      || 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json. '
      || 'Universe: 58 markets per docs/CFTC-UNIVERSE-CATALOG.md. Sentinel: CFTC_COT_V1.',
    '/home/bot1/scripts/ingest-cftc-cot.py',
    'CFTC',
    1,
    'cftc_cot_commodity',
    'weekly',
    58,
    72,
    CURRENT_DATE,
    'Pilot — initial backfill covers 2007-01-01 to present. Promote to production after first successful weekly cron fire (first Saturday post-deploy).'
)
ON CONFLICT (source_name) DO UPDATE SET
    description            = EXCLUDED.description,
    ingestion_script       = EXCLUDED.ingestion_script,
    table_name             = EXCLUDED.table_name,
    expected_frequency     = EXCLUDED.expected_frequency,
    expected_rows_per_day  = EXCLUDED.expected_rows_per_day,
    expected_latency_hours = EXCLUDED.expected_latency_hours,
    verification_notes     = EXCLUDED.verification_notes,
    updated_at             = NOW();
-- Intentionally NOT overwriting on conflict: status, pilot_start_date, tier,
-- verified_at, verified_by, last_ingested_at, quality_issues_recent.
-- These represent state earned after initial registration and must survive reruns.


-- ─────────────────────────────────────────────────────────────────────────────
-- migrations_applied log
-- Schema: (name text NOT NULL, applied_at timestamptz DEFAULT now())
-- Convention: name = sentinel (matches existing rows UNUSUAL_FLOW_DEDUP_V1 etc.)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO migrations_applied (name)
VALUES ('CFTC_COT_V1')
ON CONFLICT (name) DO NOTHING;


-- Migration complete.
-- Verification queries (paste into psql after running this file):
--
--   SELECT source_name, table_name, status, tier, expected_rows_per_day,
--          pilot_start_date, verification_notes
--   FROM data_source_registry WHERE source_name LIKE 'cftc_%';
--
--   SELECT name, applied_at FROM migrations_applied WHERE name='CFTC_COT_V1';
--
--   \d cftc_cot_financial
--   \d cftc_cot_commodity
