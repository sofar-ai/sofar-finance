# ADR-0001: Three-database split (market / production / research)

**Date:** 2026-04-25
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0005 (sentinel + migration conventions)

---

## Context

SOFAR's data has three distinct lifecycles:

- **Market data** — high-volume, append-mostly, externally-sourced (CFTC, ThetaData, FMP, FINRA, Polymarket, FRED, etc.). Read by analytics, signal compute, dashboards. Loss-tolerant in the sense that re-ingestion is possible from the source of record.
- **Production state** — trading state, positions, predictions, accuracy logs. Mutable, lower volume, *not* re-derivable from external sources. Loss is irreversible.
- **Research** — experiments, hypotheses, signal registry, director decisions. Highly mutable, disposable in principle (anything important should be promoted to production), but useful to retain for analysis.

A single Postgres database holding all three was the obvious starting point but ran into real problems:

- Backups optimized for trading state were too expensive when applied to high-churn market data
- Schema changes for research tables (frequent, exploratory) needed different review velocity than production tables (slow, careful)
- Read-only access for analytics could not be cleanly scoped without database-level boundaries
- Disaster recovery for "the trading bot" needed to be possible without restoring 200GB of CFTC history

## Decision

Use three separate Neon Postgres databases — `market`, `production`, `research` — each with its own credentials and lifecycle policy. A routing layer (`db.py` / `TABLE_DB_MAP`) auto-routes queries to the correct database based on table name, with explicit `db=` override available for cross-database needs.

## Alternatives Considered

### Alternative 1: Single database with schema separation
- **Pros:** Simpler. One credential. Cross-schema joins free. Single backup.
- **Cons:** Can't scale backup/HA policy independently. Schema migration cadence is locked together. Hard to grant read-only research access without exposing production.
- **Why not:** The lifecycle-policy difference between research churn and production stability is too large. Research alone would generate enough schema migrations to make production change-review feel oppressive, or vice versa.

### Alternative 2: Single DB + row-level partitioning
- **Pros:** Same as #1, plus some isolation via row policies.
- **Cons:** All of #1's problems remain. Adds query complexity.
- **Why not:** Doesn't solve the core problem.

### Alternative 3: Different DB engines per use case (Postgres + DuckDB + ClickHouse)
- **Pros:** Each engine optimized for its workload.
- **Cons:** Three engines to operate, three connection patterns, three migration tools.
- **Why not:** Operational complexity exceeds the benefit at current scale. May revisit when market-data volume justifies a columnar engine; the routing layer is designed to support this future move (note `backend=` parameter in `db.py`).

## Consequences

### Positive
- Each database can have backup/replication/retention tuned independently
- Research churn doesn't pollute production change history
- Read-only roles per database are trivial to grant
- A future migration to a different engine for one of the three is achievable without touching the other two
- DR for production state alone is fast (smaller dataset)

### Negative / trade-offs
- Cross-database queries are not possible (FDW could solve but adds operational complexity)
- One more thing to keep straight when writing queries (`db.py` solves most of it but not all)
- Three credential files to manage (`/etc/neon-{market,production,research}.env`)

### Risks
- Routing bugs in `db.py` cause silent misroutes — partially realized, see ADR-0006 reference to `_detect_table` regex bug. Mitigation: the routing layer logs what DB it's using; explicit `db=` parameter is always available as escape hatch.

## Implementation notes

- `~/scripts/db.py` — routing layer with `TABLE_DB_MAP`, `execute_query(db=...)`, `execute_many(db=...)`, `get_connection(db=...)`
- `/etc/neon-{market,production,research}.env` — credential files per DB
- Sentinel: `DB_TABLE_ROUTING_V1`
- Migration sentinel `MULTIDB_REFACTOR_V1` covers the original split; subsequent `*_V1`/`*_V2` migrations add specific tables to the appropriate database

## References

- `~/sofar-finance/docs/SCHEMA.md` — auto-generated schema dump per DB
- `~/scripts/db-env.sh` — credential loader
