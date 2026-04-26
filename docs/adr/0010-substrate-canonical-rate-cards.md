# ADR-0010: Substrate is canonical for rate-cards (LLM pricing, etc.)

**Date**: 2026-04-26
**Status**: accepted

## Context

Bundle 4 of substrate-day2 needed cost-estimation queries. Initial
implementation embedded Anthropic API prices directly in SQL CTE:

```sql
WITH model_pricing(model_id, input_per_mtok, output_per_mtok) AS (
  VALUES
    ('claude-opus-4-7', 15.0, 75.0),  -- WRONG: was Opus 4.1 pricing
    ...
)
```

Two problems surfaced immediately:
1. Hardcoded prices were stale (using legacy Opus 4.1 pricing $15/$75
   instead of current Opus 4.x pricing $5/$25 — a 3× error)
2. Update friction: changing a price required editing SQL files,
   redeploying, etc.

This is a general pattern. Rate-card data (LLM pricing, but also future
things like API quotas, model deprecation dates, hardware costs)
**changes externally** — outside our code's control. Storing it in code
guarantees drift.

## Decision

**Rate-card data lives in `<entity>.attrs.<rate_card_field>` in the
substrate.** Queries read from there. Updates are DB updates, not code
edits.

For LLM pricing specifically:

```
model.attrs.pricing = {
  "input_per_mtok":     5.0,
  "output_per_mtok":    25.0,
  "currency":           "USD",
  "verified_date":      "2026-04-26",
  "source":             "anthropic.com/pricing",
  "batch_discount_pct": 50,
  ...
}
```

Same pattern applies to any external rate / quota / configuration that
changes outside our control.

## Rationale

1. **Single source of truth.** Multiple queries needing pricing all
   read from the same place. No duplication, no drift.

2. **Auditable.** Each row has `verified_date` and `source`. Anyone
   can ask "when was Opus pricing last verified" and get a real answer.

3. **Updateable without redeployment.** A single UPDATE statement
   changes the price. Queries reflect immediately.

4. **Self-documenting.** A query `SELECT * FROM entities WHERE
   type='model'` is the canonical model+pricing reference. New
   developers can discover what we know.

5. **Verifiable by future LLM analyst.** When the local expert
   (post-MCP) reasons about cost optimization, it queries the substrate
   and gets canonical numbers, not guesses.

## Consequences

- **All rate-card data goes through this pattern** going forward, not
  just LLM pricing. Examples to consider:
  - API rate limits per provider
  - Model deprecation dates
  - Per-node hardware costs (electricity / depreciation)
  - Per-table data refresh costs (Neon compute hours, FMP API calls)
- **Verification is a real operational concern.** Prices need to be
  re-verified periodically. Future automation: a small periodic check
  that fetches Anthropic's pricing page and compares to substrate;
  flags drift via a `pricing_audit_event`.
- **Sentinel `RATE_CARD_DRIFT_AUDIT_V1`**: future task, build the
  periodic verifier.

## Anti-pattern this rule prevents

- Hardcoded prices in queries
- Hardcoded prices in scripts (e.g., synthesis cost estimates)
- Memory-based pricing assertions in handoffs / commentary

If you need to compute a number that depends on external rates,
**look up the rate from the substrate, don't quote it from memory.**

## Related

- substrate-day2 bundle 4 v2 (introduced this pattern for LLM pricing)
- ADR-0005 (sentinel format and migration conventions): same spirit —
  metadata canonical in DB, queryable, verifiable
