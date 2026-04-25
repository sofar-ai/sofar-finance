# ADR-0005: Sentinel format + migrations_applied table convention

**Date:** 2026-04-25
**Status:** accepted
**Deciders:** bot1

---

## Context

SOFAR has many small structural changes — schema migrations, refactors, behavior toggles — and a growing history of them. Without a convention, it becomes impossible to:

- Tell from a code reference what version/era a piece of code belongs to
- Verify whether a migration has been applied to a database
- Cross-reference a comment in code with a commit, doc, or DB state
- Roll back partial deployments

The need is for a lightweight tag that:
- Appears in code, in commit messages, in docs, and in the DB
- Is unique per change
- Is human-readable but machine-parseable

## Decision

**Sentinel format:** `UPPER_SNAKE_NAME_VN`, e.g.:
- `CFTC_COT_V1`
- `SESSION_DATE_FALLBACK_V1`
- `GIT_PUSH_QUEUE_V2`
- `DB_TABLE_ROUTING_V1`

Versioning convention:
- `V1` for the original implementation
- `V2`, `V3`, ... for incompatible reworks
- Same name across versions when superseding (`GIT_PUSH_QUEUE_V1` → `GIT_PUSH_QUEUE_V2`)
- New name for fundamentally different scope

**Where sentinels appear:**
- In code as a comment near the change (`# Sentinel: CFTC_COT_V1`)
- In SQL migration files as a header comment
- In commit messages as a tag (`CFTC_COT_V1: ...`)
- In ADRs as the "Implementation notes" link
- In the `migrations_applied` table as the `name` column for SQL migrations

**`migrations_applied` table** lives in the `market` Neon DB:

```sql
CREATE TABLE migrations_applied (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

Every SQL migration ends with:

```sql
INSERT INTO migrations_applied (name)
VALUES ('SENTINEL_NAME_VN')
ON CONFLICT (name) DO NOTHING;
```

This makes "has this migration been applied?" a one-query answer.

## Alternatives Considered

### Alternative 1: Use git commit hashes as the version reference
- **Pros:** Already exist; unique; immutable
- **Cons:** Not human-readable; not present in DB without separate tracking; don't distinguish "code change" from "schema change"
- **Why not:** Doesn't serve the cross-domain need (code + DB + docs + commits)

### Alternative 2: Date-based versioning (`20260423_CFTC`)
- **Pros:** Implicit ordering
- **Cons:** Multiple changes on same day collide; not semantically descriptive; rebases mess with ordering
- **Why not:** Less useful than meaningful names. Date is in the commit anyway.

### Alternative 3: Use a proper migration framework (Alembic, Flyway, etc.)
- **Pros:** Battle-tested; handles dependencies, rollbacks, parallel branches
- **Cons:** Adds tooling; designed for code-only schema migrations, not the broader "tag a change" use case
- **Why not:** Sentinels serve more than just SQL. May revisit with Alembic specifically for SQL migrations later, layering it on top of the sentinel convention.

## Consequences

### Positive
- Cross-referencing code, commits, docs, and DB state is trivial via the sentinel string
- "Has migration X been applied to this DB?" is one query: `SELECT * FROM migrations_applied WHERE name='X'`
- Clear when a change is a versioned rework (V2) vs a brand-new thing (new name)
- ADRs anchor sentinels to their rationale

### Negative / trade-offs
- Manual discipline required — no tooling enforces sentinel use
- Risk of typos producing orphaned sentinels
- `migrations_applied` only covers SQL migrations; code-only changes get sentinels but not DB rows

### Risks
- **Sentinel reuse / drift.** Mitigation: grep before naming; existing sentinels are listed in ADRs and in the migrations_applied table.

## Implementation notes

- Migration table: `market.migrations_applied`
- Existing sentinels (non-exhaustive): `MULTIDB_REFACTOR_V1`, `DB_TABLE_ROUTING_V1`, `CFTC_COT_V1`, `SESSION_DATE_FALLBACK_V1`, `DATE_SELECT_GTH_AWARE_V1`, `GIT_PUSH_QUEUE_V1`, `GIT_PUSH_QUEUE_V2`, `UNUSUAL_FLOW_DEDUP_V1`, `SYNTHESIS_UNUSUAL_FLOW_V1`, `STEP0_VALIDATOR_ONLY_V1`, `API_BIFURCATE_V1`, `DUAL_FILE_READ_V1`, `CONTINUITY_PROTOCOL_V1`

## References

- Migration files: `~/sofar-finance/migrations/*.sql`
- System changelog: `~/sofar-finance/SYSTEM-CHANGELOG.md`
