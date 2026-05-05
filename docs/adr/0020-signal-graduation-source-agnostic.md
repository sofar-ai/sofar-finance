# ADR-0020: Signal-graduation must be source-agnostic, not per-pipeline

**Date:** 2026-05-04
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0001 (three-database split), ADR-0004 (quant-research pause), ADR-0005 (sentinel conventions), ADR-0011 (verify schema before write), ADR-0014 (external research system), ADR-0017 (research scraper v2 architecture)
**Sentinel:** SIGNAL_GRADUATION_SOURCE_AGNOSTIC_V1

---

## Context

The open quant pipeline (the architecture replacing the paused closed-loop hypothesis-generation system per ADR-0004) accumulates per-detection forward-return measurements via reconciler scripts. The first reconciler — `unusual-flow-reconciler.py` — shipped 2026-05-04 evening, populating `unusual_flow_returns` from `unusual_flow_signals` across 9 horizons with SPY-baseline excess-return measurements. As of this ADR's date the reconciler holds 3,708 rows of measurement evidence covering 13 days of detections.

The natural next architectural piece is a **graduation script** — one that aggregates per-(method, horizon) statistics from the reconciler's output, applies threshold criteria (e.g. `n >= 100 AND excess_hit_rate > 55%`), and INSERTs qualifying methods into the `experiments` table for formal CPCV evaluation. This is what extends the chain from raw-measurement-data to the existing experiment infrastructure.

During design discussion of this script (referred to as "C1" in the 2026-05-04 evening session), a real risk surfaced: if the graduation script is written specifically for the unusual-flow source (reading `unusual_flow_returns` joined with `unusual_flow_signals`, aggregating by the unusual-flow-specific `method` column), the project will reproduce the closed-loop architectural failure mode at a higher abstraction layer. Each future signal source (planned candidates per the open-pipeline design include WARN Act notices, ERCOT grid data, USPTO patents, SEC EDGAR amendments, GitHub repo dynamics, shipping/AIS, and others not yet enumerated) would then require its own bespoke graduator script. Session drift across many implementation sessions would compound the problem: the easy default each time is to copy-and-modify the existing unusual-flow graduator rather than recognize the duplication and refactor.

The closed-loop system that ADR-0004 paused exhibited exactly this anti-pattern at the hypothesis-generation layer: per-domain hypothesis generators rather than a generic substrate. The open pipeline must not reproduce this at the graduation layer.

## Decision

The signal-graduation script — when implemented — must be **source-agnostic from the first commit**.

"Source-agnostic" means:

1. The graduator does not reference any specific signal source by name in its core logic.
2. Adding support for a new signal source is a small, well-defined change — typically registering a new measurements-source descriptor (table reference + group-by columns + measurement column + direction column where applicable) without modifying the graduator's threshold-and-decision logic.
3. The threshold criteria (sample size, hit-rate, mean-excess, p-value or t-stat where applicable) are configured per source, not hardcoded to the unusual-flow defaults.
4. The output `experiments.source` field encodes the originating signal source explicitly (e.g. `unusual_flow_method:iso_size:3`, `warn_act_layoffs:cluster_density:21`) so downstream evaluation can route by source if needed.
5. The script reads from a uniform abstraction over per-source measurement tables — either via a registry pattern (per-source descriptors loaded from configuration), a SQL-view pattern that unions sources into a common shape, or an equivalent mechanism. The exact mechanism is left to implementation but must satisfy properties (1)-(4).

## Implementation timing

Deliberately deferred. Implementation will not occur until **at least one additional signal source has shipped a working reconciler** — i.e., until the graduator has at least two real sources to design against. Designing source-agnostic infrastructure from a single source's shape risks producing an abstraction that fits one case and breaks for the next.

This means the natural sequencing is:

1. ✓ unusual-flow-reconciler shipped (2026-05-04)
2. → Build a second signal source's reconciler (one of: WARN, ERCOT, USPTO, SEC EDGAR, etc. — selection deferred to next planning session)
3. → Then build the source-agnostic graduator informed by both real cases
4. → Subsequent signal sources extend by registering their descriptor

Until the graduator exists, manual SQL inspection of `unusual_flow_returns` (per the 2026-05-04 session-end queries) serves as the human-in-the-loop graduation mechanism. Methods that look qualitatively promising in manual inspection are tracked in handoff documents but not auto-promoted to `experiments`.

## Consequences

### Positive

- Future signal sources extend the system by writing a reconciler against their data, not by writing a parallel graduator. The promotion logic is shared.
- The `experiments.source` field becomes a uniform routing key across all signal sources, enabling per-source analysis, cost attribution, and lineage tracking.
- Threshold tuning per source (e.g. faster-moving signals may want shorter sample-size requirements; slower-moving signals may want larger ones) is a configuration change, not a code change.
- Compliance with ADR-0011 (verify schema before write) is straightforward because the descriptor pattern makes table dependencies explicit.

### Negative

- The first version of the graduator does more design work than a per-source version would. Some upfront cost in defining the descriptor abstraction.
- Implementation is gated on having at least two real signal sources, which means the graduation step of the open pipeline isn't operational immediately. Manual inspection covers the gap.
- The descriptor abstraction may require schema additions (e.g. a `signal_measurement_sources` registry table) — design surface deferred to implementation time.

### Open questions

- **What's the descriptor schema?** TBD at implementation. Likely a row-shape with: source name, measurement table, signal-source table, join keys, group-by columns, measurement columns, direction column (nullable for non-directional sources), threshold parameter overrides.
- **Where do thresholds live?** Either per-source rows in a config table, or per-source entries in `unusual_flow_config.py`-style modules. Lean toward DB-backed config for consistency with the open-pipeline data-driven philosophy.
- **How does the graduator handle sources without a clean directional-prediction column?** Some signal types may not have BUY/SELL distinctions; threshold logic on hit-rate doesn't apply directly. Either restrict graduation to directional sources, or have separate threshold logic per source-type (directional vs magnitude-only).

These are explicitly deferred to implementation, not pre-decided here.

## References

- 2026-05-04 evening handoff (session that produced this ADR)
- `unusual-flow-reconciler.py` — the first reconciler this ADR generalizes from
- ADR-0004 — the closed-loop pause this architectural shape replaces
- Sentinel `SIGNAL_GRADUATION_SOURCE_AGNOSTIC_V1` — open until implementation occurs and meets the criteria above
