-- =============================================================================
-- Migration: ticker_names
-- =============================================================================
-- Adds a ticker_names table to market DB for mapping symbol → company name.
-- Seeded from recent flow_session_metrics + ~20 structurally-important ETFs
-- and index products. Names populated by weekly FMP ingestion (company_name
-- NULL on insert, filled by ingest-fmp-company-names.py).
--
-- Demand-insertion happens at API time: /api/flow-aggregates upserts any
-- symbol in top_tickers, so new wildcards (CAR, CRWV types) register
-- automatically and get named on the next Sunday run.
--
-- Target: market DB (sofar-market-data, ep-rough-star-an3dv074).
-- =============================================================================

BEGIN;

-- =============================================================================
-- Part 0: Target-DB assertion — ABORT if not market
-- =============================================================================
DO $assert$
DECLARE
    has_macro BOOLEAN;
    has_positions BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='macro_signals' AND table_schema='public') INTO has_macro;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='positions' AND table_schema='public') INTO has_positions;

    IF NOT has_macro THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: macro_signals not found. Not market. Aborting.';
    END IF;
    IF has_positions THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: positions found. This is production. Aborting.';
    END IF;

    RAISE NOTICE 'Target assertion passed: sofar-market-data. Proceeding.';
END
$assert$;


-- =============================================================================
-- Part 1: ticker_names table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ticker_names (
    symbol            TEXT PRIMARY KEY,
    company_name      TEXT,
    last_refreshed_at TIMESTAMPTZ,
    first_seen_at     TIMESTAMPTZ DEFAULT NOW(),
    source            TEXT DEFAULT 'fmp',      -- 'fmp' / 'seed' / 'manual'
    fmp_error_count   INT DEFAULT 0            -- tracks FMP failures for this symbol
);

COMMENT ON TABLE ticker_names IS
  'Maps option flow symbols to company names. Seeded from flow_session_metrics '
  'and core ETFs. Populated by ingest-fmp-company-names.py weekly. New symbols '
  'appear via demand-insertion from /api/flow-aggregates.';

-- removed bad partial-index predicate (NOW is not IMMUTABLE)
CREATE INDEX IF NOT EXISTS idx_ticker_names_stale
  ON ticker_names (last_refreshed_at NULLS FIRST);


-- =============================================================================
-- Part 2: Seed from recent flow_session_metrics (last 5 trading days)
-- =============================================================================

INSERT INTO ticker_names (symbol, source)
SELECT DISTINCT symbol, 'seed'
FROM flow_session_metrics
WHERE session_date >= CURRENT_DATE - INTERVAL '7 days'
  AND symbol IS NOT NULL
ON CONFLICT (symbol) DO NOTHING;


-- =============================================================================
-- Part 3: Safety-net seed — structural index/volatility/sector ETFs
-- =============================================================================
-- These may have sparse flow days but are core SOFAR instruments. Pre-seeded
-- with known company_names so they're functional immediately without waiting
-- for FMP. Source = 'manual' so FMP refresh won't overwrite them.

INSERT INTO ticker_names (symbol, company_name, source, last_refreshed_at) VALUES
  ('SPX',  'S&P 500 Index',                          'manual', NOW()),
  ('SPXW', 'S&P 500 Index Weekly Options',           'manual', NOW()),
  ('NDX',  'Nasdaq-100 Index',                       'manual', NOW()),
  ('NDXP', 'Nasdaq-100 Index PM-Settled',            'manual', NOW()),
  ('RUT',  'Russell 2000 Index',                     'manual', NOW()),
  ('RUTW', 'Russell 2000 Index Weekly Options',      'manual', NOW()),
  ('XSP',  'Mini-SPX Index',                         'manual', NOW()),
  ('VIX',  'CBOE Volatility Index',                  'manual', NOW()),
  ('VIXW', 'CBOE Volatility Index Weekly Options',   'manual', NOW()),
  ('SPY',  'SPDR S&P 500 ETF',                       'manual', NOW()),
  ('QQQ',  'Invesco QQQ Trust',                      'manual', NOW()),
  ('IWM',  'iShares Russell 2000 ETF',               'manual', NOW()),
  ('DIA',  'SPDR Dow Jones Industrial Average ETF',  'manual', NOW()),
  ('VXX',  'iPath Series B S&P 500 VIX Short-Term Futures ETN', 'manual', NOW()),
  ('UVXY', 'ProShares Ultra VIX Short-Term Futures ETF', 'manual', NOW()),
  ('TLT',  'iShares 20+ Year Treasury Bond ETF',     'manual', NOW()),
  ('HYG',  'iShares iBoxx High Yield Corporate Bond ETF', 'manual', NOW()),
  ('GLD',  'SPDR Gold Trust',                        'manual', NOW()),
  ('SLV',  'iShares Silver Trust',                   'manual', NOW()),
  ('USO',  'United States Oil Fund',                 'manual', NOW()),
  ('XLE',  'Energy Select Sector SPDR Fund',         'manual', NOW()),
  ('XLF',  'Financial Select Sector SPDR Fund',      'manual', NOW()),
  ('XLK',  'Technology Select Sector SPDR Fund',     'manual', NOW()),
  ('XLU',  'Utilities Select Sector SPDR Fund',      'manual', NOW()),
  ('XLV',  'Health Care Select Sector SPDR Fund',    'manual', NOW()),
  ('XLY',  'Consumer Discretionary Select Sector SPDR Fund', 'manual', NOW()),
  ('XLP',  'Consumer Staples Select Sector SPDR Fund', 'manual', NOW()),
  ('XLB',  'Materials Select Sector SPDR Fund',      'manual', NOW()),
  ('XLI',  'Industrial Select Sector SPDR Fund',     'manual', NOW()),
  ('XLC',  'Communication Services Select Sector SPDR Fund', 'manual', NOW()),
  ('XLRE', 'Real Estate Select Sector SPDR Fund',    'manual', NOW())
ON CONFLICT (symbol) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  source       = 'manual',
  last_refreshed_at = NOW();


-- =============================================================================
-- Part 4: Report what we seeded
-- =============================================================================

DO $report$
DECLARE
    total_rows INT;
    with_names INT;
    need_fmp INT;
BEGIN
    SELECT COUNT(*) INTO total_rows FROM ticker_names;
    SELECT COUNT(*) INTO with_names FROM ticker_names WHERE company_name IS NOT NULL;
    SELECT COUNT(*) INTO need_fmp
      FROM ticker_names
      WHERE company_name IS NULL OR last_refreshed_at IS NULL;

    RAISE NOTICE 'ticker_names seeded:';
    RAISE NOTICE '  Total symbols:  %', total_rows;
    RAISE NOTICE '  With names:     % (manual seed)', with_names;
    RAISE NOTICE '  Need FMP fetch: % (next Sunday 2am cron)', need_fmp;
END
$report$;

COMMIT;

-- =============================================================================
-- 2026-04-20 evening — known issue
-- =============================================================================
-- ingest-fmp-company-names.py uses /api/v3/profile/{multi} which returns 403
-- on FMP Stable plan. Needs rewrite to use stable/profile?symbol={one}
-- single-symbol endpoint. Until then, only the 31 manually-seeded names show
-- in the UI; demand-insertion still registers new tickers (they'll hydrate
-- once the script is fixed). DO NOT add cron entry until rewrite is complete.
-- =============================================================================
