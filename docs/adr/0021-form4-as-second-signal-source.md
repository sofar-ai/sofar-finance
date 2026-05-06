# ADR-0021: SEC EDGAR Form 4 as second signal source

**Date:** 2026-05-05
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0001 (three-database split), ADR-0004 (quant-research pause), ADR-0011 (verify schema before write), ADR-0020 (signal-graduation source-agnostic)
**Sentinel:** N/A — this ADR is informational, no open-question anchor required

---

## Context

The open quant pipeline (replacing the paused closed-loop hypothesis-generation system per ADR-0004) requires multiple signal sources flowing into a uniform graduation layer per ADR-0020. The first source — unusual-flow detector + reconciler — is in production with 3,708 forward-return measurements as of 2026-05-04 evening. ADR-0020 deliberately defers graduator implementation until at least one additional signal source has shipped a working reconciler, so that the source-agnostic abstraction is informed by two real cases rather than speculated from one.

WARN Firehose was the initial second-source candidate (selected 2026-05-04 evening) but became blocked on vendor-side email-verification glitches that the operator could not resolve (resend endpoint returns "Method Not Allowed", dashboard verification doesn't propagate to the API gateway). Beyond the immediate block, broader vendor risk surfaced: WARN Firehose is a young product (Feb 2026 launch, single-developer or small-team operation) with no third-party reviews and rough operational UX. The WARN artifacts (`warn_filings` table, `warn-firehose-ingester.py`, `/etc/warnfirehose.env`) remain deployed-but-idle pending vendor resolution — see sentinel `WARN_FIREHOSE_VERIFICATION_BLOCKED_2026_05_04_V1`.

SEC EDGAR Form 4 was selected as the pivot source on 2026-05-05 evening for the following reasons:

1. **Source-of-truth.** Government-run, no auth gate, no rate-limit issues worth worrying about (10 req/sec strict but generous), no vendor risk. Same database that powers every commercial insider-trading aggregator.
2. **Real-time.** Form 4 filings appear within 2 business days of the underlying transaction (Sarbanes-Oxley legal requirement). Comparable freshness to options-tape data.
3. **Decades of historical data** vs WARN Firehose's 90-day free-tier window. No paid tier needed for any reasonable backtesting horizon.
4. **Native ticker + CIK in filing.** Direct join shape to `prices_daily` via the `company_tickers.json` CIK-to-ticker map.
5. **Strong literature backing.** Lakonishok & Lee (2001), Jeng et al. (2003), Cohen et al. (2012), and recent ML-augmented work (Hangyi Zhao Stanford 2025: AUC 0.70 on out-of-sample microcap purchase predictions). Multiple specific filter refinements known to amplify signal: P-coded purchases (not S-coded sales), officer/director rank, opportunistic-vs-routine, transaction size relative to baseline.
6. **Architectural shape identical to unusual-flow / WARN ingester pattern.** Same conventions: psycopg2 direct, env-loading via line-parse, dry-run-then-`--commit`, ON CONFLICT DO NOTHING for idempotency, market DB via `DATABASE_URL_DIRECT`. Zero re-architecture cost.

## Decision

The Form 4 ingester is built as the second signal source in the open quant pipeline, with the following shape:

### Schema

Two tables in the market DB (`prices_daily`-cohabiting):

- **`form4_filings`** — one row per Form 4 filing. Primary key: `accession_number` (EDGAR's natural unique ID, e.g. `0001214659-26-005533`). Includes issuer (CIK + ticker + name), filing dates, primary reporting owner (CIK + name + role flags + officer title), source URLs, and an `in_universe BOOLEAN` flag indicating whether the issuer's ticker was present in `prices_daily` at ingest time.
- **`form4_transactions`** — one row per transaction within a filing (1:N to filings). Primary key: synthetic `BIGSERIAL`. Includes transaction code (P/S/A/D/etc.), date, shares, price, premium (computed at ingest), acquired/disposed flag, post-transaction holdings, and `is_derivative` flag for Table I (non-derivative) vs Table II (derivative) transactions.

Multi-owner filings (where a single Form 4 has multiple reporting owners listed in the daily index) are deduplicated at ingest by accession_number — the first owner inserted "wins" and others are silently dropped. This is acceptable given that signal-derivation primarily cares about issuer-level events ("did anyone file a P-purchase for this issuer this week") rather than per-owner data. If multi-owner research becomes important, schema migration to a `form4_reporting_owners` join table is straightforward.

### Universe gate

`prices_daily` currently covers 325 unique symbols (verified 2026-05-05): mostly large-cap S&P 500-style names, with deep history (1993-01-04 through present) but **no delisted tickers** (verified absence of ENRN, LEH, BSC, WAMU). Form 4 filings span thousands of issuers — public companies of all sizes including microcaps where the literature's strongest insider-purchase signal is documented (Hangyi Zhao 2025: $30M-$500M market cap range).

The deliberate choice is to **capture all Form 4 filings (universe-broad) but tag `in_universe=TRUE` only when the issuer's ticker is in `prices_daily` at ingest time**. The reconciler will filter to `in_universe=TRUE` rows. Future price-coverage expansion can retroactively flip the flag without re-fetching XMLs.

This gate has explicit limitations:

- ~5-6% symbol coverage (325 of ~5,000-6,000 currently public US equities)
- ~30-40% filing-volume coverage (large-caps file Form 4s frequently)
- ~1-2% coverage of the strongest signal class (microcap purchases per literature)
- Survivorship bias: cannot backtest against delisted tickers

These limitations are acknowledged and accepted as the cost of starting with current infrastructure rather than gating on a separate `prices_daily` expansion project. A future ADR (or a sentinel) will be filed when broader-universe price coverage is built — at that time, Form 4 retroactive measurement becomes possible without re-ingestion since the underlying filing data is already captured.

### Ingester structure

`/home/bot1/scripts/form4-ingester.py` (~470 lines). Mirrors WARN/unusual-flow conventions:

- Daily index fetch from `https://www.sec.gov/Archives/edgar/daily-index/{YYYY}/QTR{1-4}/form.{YYYYMMDD}.idx` — one request per day. Handles 403/404 (returned for not-yet-posted indexes) by logging and continuing.
- Per-filing fetch of the submission `.txt` file (concatenated documents). XML extracted inline via `extract_form4_xml_from_submission_txt()` which handles three patterns: `<DOCUMENT>...<XML>...</XML>...</DOCUMENT>`, `<DOCUMENT>...<TEXT>raw-xml...</TEXT>...</DOCUMENT>`, and bare top-level XML.
- Bulk CIK-to-ticker resolution via single `https://www.sec.gov/files/company_tickers.json` fetch at startup (~8,000 mappings, refreshed each run).
- Rate limited to 8 req/sec (80% of EDGAR's 10 req/sec ceiling for safety margin).
- User-Agent header `sofar-finance/form4-ingester (bot1@sofar.finance)` per EDGAR's mandatory descriptive-string-with-email policy. Generic User-Agents (Python-urllib, Mozilla/5.0) get 403'd.
- Three modes: default (since `MAX(filing_date)` or 90-day fallback for empty table), `--since YYYY-MM-DD`, `--full-backfill N` (capped at 90 days).
- Dry-run-then-`--commit` pattern. Pre-checks `accession_number` existence before fetching XML to skip already-ingested filings.

### Daily ingestion cadence

Cron: `0 2 * * 2-6` (02:00 UTC, Tuesday through Saturday). 2 AM UTC = ~9 PM ET previous day, well past EDGAR's nightly index posting window which starts ~10 PM ET and completes within a few hours. Tuesday-Saturday matches the trading calendar — Tuesday picks up Monday's filings, Saturday picks up Friday's. Sunday/Monday runs are skipped (no trading data to fetch).

The script is idempotent (`ON CONFLICT (accession_number) DO NOTHING`), so timing tolerance is high — if a run fails for any reason, the next day's run will catch up via default mode.

### Initial backfill scope

14-day backfill `--full-backfill 14 --commit` was run 2026-05-05 evening as the initial historical seed. Selected over 90-day full backfill to:
- Validate the architectural pipeline at smaller scope first (~30 min runtime vs ~6 hours)
- Get reconciler-ready data flowing for the shorter horizons (1d, 3d, 5d, 10d) immediately
- Leave room for a deliberate weekend 90-day extension once the 14-day window has been observed for correctness

90-day backfill is deferred but not abandoned. The hard cap of 90 days in the ingester is for runtime bounding, not data quality.

## Consequences

### Positive

- ADR-0020's two-real-source precondition is met once the Form 4 reconciler is built (next step). The graduator can be designed against unusual-flow + Form 4 simultaneously, producing a source-agnostic abstraction informed by two real cases instead of one.
- Government-source data eliminates vendor risk that would otherwise hang over the pipeline.
- Architectural pattern reuse (psycopg2, env-loading, dry-run-then-commit, ON CONFLICT idempotency, --since/--full-backfill modes) means future ingesters bootstrap quickly from this template.
- Universe gate via `in_universe` flag preserves all data for future expansion without forcing re-ingestion later.

### Negative

- Universe coverage limits backtesting to 325 large-cap names. Microcap research (where the literature's strongest signal sits) cannot be done without expanding `prices_daily`.
- Survivorship bias in `prices_daily` means historical backtest results overstate forward-realizability.
- Daily ingest pulls ~2,000 filings/day at ~4 minutes wallclock — significant but acceptable. Cron runs in off-hours so doesn't compete with intraday workloads.
- Multi-owner filings drop secondary owners. Acceptable for issuer-level signals but a known limitation for owner-attribution research.

### Open questions

- **`is_10b5_1` detection** is currently best-effort. Form 4 doesn't have a clean structured field for "this trade was executed under a pre-arranged 10b5-1 plan." Footnote text parsing would improve this, deferred to a future patch when the reconciler reveals whether 10b5-1 filtering meaningfully changes signal quality.
- **Form 4/A amendments** are captured (`is_amendment` flag) but not specially handled. Amendments correct prior filings; the right behavior is probably to update the original row rather than insert a new one. Deferred until amendment volume in the data justifies the schema change.
- **`prices_daily` expansion** is the upstream blocker for proper microcap backtesting. Scope and timing TBD in a separate future ADR.

## References

- 2026-05-04 evening handoff (the WARN-block + Form 4 pivot decision)
- 2026-05-05 evening session log (Form 4 ingester implementation)
- ADR-0020 — the source-agnostic graduator commitment this ADR's source helps satisfy
- Hangyi Zhao (Stanford 2025) — recent ML-augmented insider-purchase predictability work informing the signal hypothesis
- Lakonishok & Lee (2001), Jeng et al. (2003), Cohen et al. (2012) — classical insider-trading literature
- `/home/bot1/scripts/form4-ingester.py` — implementation
- `/home/bot1/scripts/warn-firehose-ingester.py` — sibling ingester (idle, vendor-blocked)
- `/home/bot1/scripts/unusual-flow-reconciler.py` — first reconciler this pattern generalizes from
