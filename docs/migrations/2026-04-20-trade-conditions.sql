-- =============================================================================
-- Migration: trade_conditions reference + flow metrics enrichment
-- Target DB: sofar-market-data
-- Author: session 2026-04-20 evening
-- =============================================================================
--
-- Adds OPRA condition code reference (149 codes, authoritative per ThetaData docs)
-- and enriches flow_session_metrics + flow_sweep_rollups to leverage condition-code
-- signal rather than timing heuristics.
--
-- Design reference:
-- - Chakravarty/Jain/Upson/Wood (JFQA 2012): "Clean Sweep: Informed Trading
--   through Intermarket Sweep Orders" — ISO trades have significantly larger
--   information share; informed institutions are primary users.
-- - OPRA Binary Participant Interface Specification
-- - ThetaData condition mapping: https://http-docs.thetadata.us/Articles/Data-And-Requests/Values/Trade-Conditions.html
--
-- Idempotent: safe to run multiple times. CREATE IF NOT EXISTS, INSERT ON CONFLICT.
-- =============================================================================

BEGIN;

-- =============================================================================
-- Part 0: Target-DB assertion — ABORT if not running against sofar-market-data
-- =============================================================================
-- Prevents the migration from landing in the wrong DB if env state is ambiguous.
-- macro_signals is market-only; positions is production-only (per routing map).
-- Raises an exception if assertion fails, rolling back the entire transaction.
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
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: macro_signals not found. This DB is not sofar-market-data. Aborting migration.';
    END IF;
    IF has_positions THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: positions table found. This is sofar-production, not market. Aborting migration.';
    END IF;

    RAISE NOTICE 'Target assertion passed: this is sofar-market-data. Proceeding with migration.';
END
$assert$;


-- =============================================================================
-- Part 1: Reference table — option_trade_conditions
-- =============================================================================
-- Maps numeric condition codes (as stored in flow_trades.condition) to names
-- and a normalized category used by rollups and the analyzer prompt builder.
-- =============================================================================

CREATE TABLE IF NOT EXISTS option_trade_conditions (
    code          INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,   -- ISO | MULTILEG | CROSS | FLOOR | AUCTION | STOCK_OPT | REGULAR | CANCEL | OTHER
    is_iso        BOOLEAN NOT NULL DEFAULT FALSE,
    is_multileg   BOOLEAN NOT NULL DEFAULT FALSE,
    is_floor      BOOLEAN NOT NULL DEFAULT FALSE,
    is_auction    BOOLEAN NOT NULL DEFAULT FALSE,
    is_cross      BOOLEAN NOT NULL DEFAULT FALSE,
    is_stock_tied BOOLEAN NOT NULL DEFAULT FALSE,
    is_cancel     BOOLEAN NOT NULL DEFAULT FALSE,
    description   TEXT
);

CREATE INDEX IF NOT EXISTS ix_option_trade_conditions_category
    ON option_trade_conditions (category);
CREATE INDEX IF NOT EXISTS ix_option_trade_conditions_is_iso
    ON option_trade_conditions (is_iso) WHERE is_iso = TRUE;

-- Seed data. Codes 0-148 per ThetaData/OPRA spec.
-- ISO flag: true for pure ISO (95) and all ISO-variant auction/cross types (126, 128, 136, 141, 142)
-- MULTILEG flag: true for any multi-leg condition (125+ with "MULTI_LEG", plus complex-tied types)
-- Only codes actually used in options (OPRA) are meaningfully populated; equities-only codes
-- are still listed for completeness but with category=OTHER.

INSERT INTO option_trade_conditions (code, name, category, is_iso, is_multileg, is_floor, is_auction, is_cross, is_stock_tied, is_cancel, description) VALUES
 (0,  'REGULAR',                       'REGULAR',  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Regular trade'),
 (1,  'FORM_T',                        'OTHER',    FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Before/after regular hours'),
 (13, 'SOLD_LAST',                     'REGULAR',  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Late reporting'),
 (18, 'AUTO_EXECUTION',                'REGULAR',  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Electronic execution — most common single-leg'),
 (40, 'CANC',                          'CANCEL',   FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  'Cancel previously reported trade'),
 (41, 'CANC_LAST',                     'CANCEL',   FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  'Cancel most recent last-setting trade'),
 (42, 'CANC_OPEN',                     'CANCEL',   FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  'Cancel opening trade'),
 (43, 'CANC_ONLY',                     'CANCEL',   FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  'Cancel the only trade report'),
 (44, 'CANC_STPD',                     'CANCEL',   FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,  'Cancel STPD trade'),
 (95, 'INTERMARKET_SWEEP',             'ISO',      TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Pure ISO — primary sweep signal'),
 (106,'STOPPED_IM',                    'REGULAR',  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Stopped at price, no trade-through'),
 (115,'ODD_LOT',                       'OTHER',    FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Trade size 1-99'),
 (124,'QUALIFIED_CONTINGENT_TRADE',    'OTHER',    FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'QCT — two+ component contingent trade'),
 (125,'SINGLE_LEG_AUCTION_NON_ISO',    'AUCTION',  FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, FALSE, 'Electronic auction (AIM/SAM) non-ISO'),
 (126,'SINGLE_LEG_AUCTION_ISO',        'ISO',      TRUE,  FALSE, FALSE, TRUE,  FALSE, FALSE, FALSE, 'AIM/SAM ISO — sweep via auction'),
 (127,'SINGLE_LEG_CROSS_NON_ISO',      'CROSS',    FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, 'Cust-to-Cust cross, QCC single leg'),
 (128,'SINGLE_LEG_CROSS_ISO',          'ISO',      TRUE,  FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, 'Cust-to-Cust cross ISO — sweep via cross'),
 (129,'SINGLE_LEG_FLOOR_TRADE',        'FLOOR',    FALSE, FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, 'Non-electronic floor trade'),
 (130,'MULTI_LEG_AUTOELEC_TRADE',      'MULTILEG', FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, 'Electronic multi-leg in complex order book'),
 (131,'MULTI_LEG_AUCTION',             'MULTILEG', FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, FALSE, 'Electronic multi-leg auction (AIM/SAM complex)'),
 (132,'MULTI_LEG_CROSS',               'MULTILEG', FALSE, TRUE,  FALSE, FALSE, TRUE,  FALSE, FALSE, 'Electronic multi-leg cross (QCC with ≥2 legs)'),
 (133,'MULTI_LEG_FLOOR_TRADE',         'MULTILEG', FALSE, TRUE,  TRUE,  FALSE, FALSE, FALSE, FALSE, 'Non-electronic multi-leg floor'),
 (134,'ML_AUTO_ELEC_TRADE_AGSL',       'MULTILEG', FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, 'Electronic multi-leg vs single legs'),
 (135,'STOCK_OPTIONS_AUCTION',         'STOCK_OPT',FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  FALSE, 'Stock/options auction (C-AIM w/ Stock)'),
 (136,'ML_AUCTION_AGSL',               'MULTILEG', TRUE,  TRUE,  FALSE, TRUE,  FALSE, FALSE, FALSE, 'Multi-leg auction vs single legs — often ISO context'),
 (137,'ML_FLOOR_TRADE_AGSL',           'MULTILEG', FALSE, TRUE,  TRUE,  FALSE, FALSE, FALSE, FALSE, 'Non-electronic multi-leg floor vs single legs'),
 (138,'STK_OPT_AUTO_ELEC_TRADE',       'STOCK_OPT',FALSE, TRUE,  FALSE, FALSE, FALSE, TRUE,  FALSE, 'Electronic stock/options multi-leg'),
 (139,'STOCK_OPTIONS_CROSS',           'STOCK_OPT',FALSE, TRUE,  FALSE, FALSE, TRUE,  TRUE,  FALSE, 'Stock/options cross (QCC w/ Stock)'),
 (140,'STOCK_OPTIONS_FLOOR_TRADE',     'STOCK_OPT',FALSE, TRUE,  TRUE,  FALSE, FALSE, TRUE,  FALSE, 'Non-electronic stock/options floor'),
 (141,'STK_OPT_AE_TRD_AGSL',           'STOCK_OPT',TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE,  FALSE, 'Electronic stock/options multi-leg vs SL — ISO variant'),
 (142,'STK_OPT_AUCTION_AGSL',          'STOCK_OPT',TRUE,  TRUE,  FALSE, TRUE,  FALSE, TRUE,  FALSE, 'Stock/options auction vs SL — ISO variant'),
 (143,'STK_OPT_FLOOR_TRADE_AGSL',      'STOCK_OPT',FALSE, TRUE,  TRUE,  FALSE, FALSE, TRUE,  FALSE, 'Non-electronic stock/options floor vs SL'),
 (144,'ML_FLOOR_TRADE_OF_PP',          'MULTILEG', FALSE, TRUE,  TRUE,  FALSE, FALSE, FALSE, FALSE, 'Proprietary product multi-leg ≥3 legs, non-electronic'),
 (145,'BID_AGGRESSOR',                 'REGULAR',  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Buy-side aggressor'),
 (146,'ASK_AGGRESSOR',                 'REGULAR',  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Sell-side aggressor'),
 (147,'MULTILAT_COMP_TR_PDP',          'OTHER',    FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Multilateral compression outside RTH'),
 (148,'EXTENDED_HOURS_TRADE',          'OTHER',    FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Extended hours trade')
ON CONFLICT (code) DO UPDATE SET
    name          = EXCLUDED.name,
    category      = EXCLUDED.category,
    is_iso        = EXCLUDED.is_iso,
    is_multileg   = EXCLUDED.is_multileg,
    is_floor      = EXCLUDED.is_floor,
    is_auction    = EXCLUDED.is_auction,
    is_cross      = EXCLUDED.is_cross,
    is_stock_tied = EXCLUDED.is_stock_tied,
    is_cancel     = EXCLUDED.is_cancel,
    description   = EXCLUDED.description;

-- Filler rows for codes 2-94 and 96-123 (equities-heavy or reserved; may appear in data occasionally)
-- Mark as OTHER. We only enumerate fully the codes relevant to options trading above.
INSERT INTO option_trade_conditions (code, name, category, description)
SELECT gs.n,
       'UNKNOWN_' || gs.n::text,
       'OTHER',
       'Code not explicitly mapped — see OPRA spec if this appears in flow_trades'
FROM generate_series(2, 148) gs(n)
WHERE NOT EXISTS (SELECT 1 FROM option_trade_conditions otc WHERE otc.code = gs.n)
ON CONFLICT (code) DO NOTHING;


-- =============================================================================
-- Part 2: Enrich flow_session_metrics with per-category breakdowns
-- =============================================================================
-- Adds columns tracking premium and trade count by condition category, so the
-- UI, flow analyzer, and AI synthesis can all reason about institutional
-- structure rather than just aggregate flow.
-- =============================================================================

ALTER TABLE flow_session_metrics
    ADD COLUMN IF NOT EXISTS iso_trade_count       INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS iso_premium           NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS multileg_trade_count  INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS multileg_premium      NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cross_trade_count     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cross_premium         NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS floor_trade_count     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS floor_premium         NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS auction_trade_count   INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS auction_premium       NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stock_opt_trade_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stock_opt_premium     NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cancel_trade_count    INTEGER DEFAULT 0;

-- =============================================================================
-- Part 3: Enrich flow_sweep_rollups — remove dependence on old flow-tape-daemon
-- populating sweep_id. Sweeps are now computed from ISO condition codes.
-- =============================================================================
-- The existing table keyed on sweep_id (text from daemon). We keep the column
-- but compute our own IDs using (symbol, contract, time bucket) since the
-- daemon was never populating sweep_id anyway.
--
-- Add a condition_code column so rollups know which ISO variant they came from.
-- =============================================================================

ALTER TABLE flow_sweep_rollups
    ADD COLUMN IF NOT EXISTS primary_condition INTEGER,
    ADD COLUMN IF NOT EXISTS iso_type          TEXT;  -- 'PURE' | 'AUCTION' | 'CROSS' | 'COMPLEX'

-- =============================================================================
-- Commit
-- =============================================================================
COMMIT;

-- =============================================================================
-- Verification queries (run after migration to confirm)
-- =============================================================================
-- SELECT category, COUNT(*) FROM option_trade_conditions GROUP BY category ORDER BY category;
-- SELECT * FROM option_trade_conditions WHERE is_iso ORDER BY code;
-- SELECT column_name FROM information_schema.columns WHERE table_name='flow_session_metrics' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns WHERE table_name='flow_sweep_rollups' ORDER BY ordinal_position;
