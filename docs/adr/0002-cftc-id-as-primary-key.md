# ADR-0002: Use CFTC's `id` field as primary key for COT tables

**Date:** 2026-04-25
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0005 (sentinel conventions)

---

## Context

CFTC publishes Commitments of Traders (COT) data via two Socrata endpoints (TFF and DCOT). Each row has a unique `id` field of the form `YYMMDD + contract_code + {F,C}` where the suffix indicates futures-only (F) or combined-with-options (C). For example: `26041443874QF` = April 14, 2026 + contract code `43874Q` + futures-only.

When designing the local schema for `cftc_cot_financial` and `cftc_cot_commodity`, we needed to choose a primary key strategy that:

- Allowed idempotent re-ingestion (the same row fetched twice should not produce duplicates)
- Supported `INSERT ... ON CONFLICT DO UPDATE` for backfill operations
- Was stable across CFTC's publishing schedule (not derived from columns CFTC might revise)

## Decision

Use CFTC's own `id` field as the primary key on both COT tables. The PK column is `id TEXT PRIMARY KEY`, and the upsert pattern is:

```sql
INSERT INTO cftc_cot_financial (...)
VALUES (...)
ON CONFLICT (id) DO UPDATE SET
  {all non-id columns} = EXCLUDED.{...},
  ingested_at = NOW()
```

## Alternatives Considered

### Alternative 1: Composite key `(report_date, market_and_exchange_names, futonly_or_combined)`
- **Pros:** All natural data; no dependency on CFTC's internal field
- **Cons:** Three columns instead of one; `market_and_exchange_names` is a long string; harder to reference in foreign keys later
- **Why not:** Longer keys without offsetting benefit. CFTC's `id` already encodes the same uniqueness more compactly.

### Alternative 2: Generated UUID + UNIQUE constraint on the natural composite
- **Pros:** Tiny PK for foreign keys
- **Cons:** Adds a column, doesn't help with idempotent upsert (still need to look up the natural key first)
- **Why not:** Solves a problem we don't have. We don't have FKs to these tables yet, and likely never will.

### Alternative 3: Synthetic auto-increment integer
- **Pros:** Tiny PK
- **Cons:** Breaks idempotent upsert entirely — you can't `ON CONFLICT (id)` on a value that's assigned at insert time
- **Why not:** Defeats the purpose.

## Consequences

### Positive
- Idempotent upsert is one-line: `ON CONFLICT (id) DO UPDATE`
- Re-running a backfill doesn't produce duplicates
- The PK is meaningful — you can read a row's `id` and recover (date, contract, F/C) without joining
- 19-year backfill (50,342 rows) ran cleanly with this design; subsequent runs would be no-ops on existing rows and inserts on new ones

### Negative / trade-offs
- Couples our schema to CFTC's `id` format. If CFTC changes the format, our PK becomes ambiguous.
- The PK is a 13-character TEXT instead of an INT — slightly larger index footprint. Negligible at this scale.

### Risks
- **CFTC could rev the `id` format.** Mitigation: the universe filter is on `market_and_exchange_names`, not `id`; if CFTC's format changes, we'd notice via ingestion errors and could reconstruct/migrate. Low probability.
- **Two contracts could share an id.** Mitigation: not observed in 19y of data; trust the CFTC's uniqueness guarantee.

## Implementation notes

- Migration: `~/sofar-finance/migrations/20260423-cftc-cot.sql`, sentinel `CFTC_COT_V1`
- Ingest: `~/scripts/ingest-cftc-cot.py`
- Tables: `market.cftc_cot_financial`, `market.cftc_cot_commodity`

## References

- TFF endpoint: `https://publicreporting.cftc.gov/resource/gpe5-46if.json`
- DCOT endpoint: `https://publicreporting.cftc.gov/resource/72hh-3qpy.json`
