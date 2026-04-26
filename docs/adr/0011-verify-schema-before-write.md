# ADR-0011: Verify schema before writing code that depends on it

**Date**: 2026-04-26
**Status**: accepted

## Context

Three substrate development sessions hit the same class of bug:

| Date | Bug | Cost |
|---|---|---|
| 2026-04-25 | `migrations_applied.filename` did not exist (column is `name`) | One ROLLBACK + patch + redeploy |
| 2026-04-26 morning | `relationships.kind` did not exist (column is `type`) | One run failure + patch + redeploy |
| 2026-04-26 morning | `uq_llm_call_events_source_ref` was a partial index, not constraint; `ON CONFLICT (cols)` requires constraint | One run failure + ALTER TABLE + truncate-and-retry |

In each case I (Claude) wrote code referencing assumed schema details
without verifying. The substrate's actual `\d` output would have
surfaced each in 10 seconds.

## Decision

**Before writing or updating any code that references DB schema (table
names, column names, index/constraint names, types), run `\d <table>`
against the live schema first. Use the verified output as ground truth.**

This applies equally to:
- New extractors
- New migrations (verify the table you're altering already exists with
  expected shape)
- New queries (verify column names exist in current schema, not legacy
  schema)
- Patches to existing code

## Rationale

1. **Memory and assumption are unreliable.** Schemas evolve, conventions
   shift across migrations, copy-paste from other tables propagates
   wrong column names. Verification is cheap; failure recovery is not.

2. **Real cost of skipped verification:**
   - ~5-15 minutes per incident: bug surfaces, patch written, redeployed,
     tested
   - User trust cost: "again with this kind of mistake?"
   - Compounding: when the substrate is the canonical record, schema
     mistakes corrupt the canonical record.

3. **The substrate already has the data we need.** `extract_db_schema.py`
   captured every column, index, and constraint as substrate entities.
   For any table the substrate knows about, a query like:

   ```sql
   SELECT name, attrs FROM entities
   WHERE type = 'column' AND attrs->>'table' = 'relationships'
   ORDER BY (attrs->>'ordinal_position')::int;
   ```

   gives full schema without psql access. Use the substrate to verify
   the substrate.

## Consequences

- **Pre-flight check** for any DB-touching code: query schema first,
  paste verified output, then write code against it.
- **Sentinel `SUBSTRATE_SCHEMA_VERIFY_BEFORE_WRITE_V1`** flags this as
  a required practice. New contributors and Claude in future sessions
  see this and know to follow it.
- **For migrations specifically**: after applying, run `\d` on the
  affected table and compare the actual structure to what the migration
  intended. Catches partial-vs-full constraint issues like the
  `uq_llm_call_events_source_ref` case.

## Tooling implication

Future small tool: a `verify_schema_assumptions(table, expected_columns)`
helper that runs `\d` on a table and asserts expected columns exist
with expected types. Would catch the same bug class systematically.
Not built today.

## Related

- substrate-day2 bundle 1 (schema migration introduced llm_call_events
  with the partial-index bug)
- substrate-day2 bundle 2 (extract_llm_calls.py used wrong column name)
- yesterday's substrate-v2-nomic.sql (used wrong migrations_applied
  column name)
