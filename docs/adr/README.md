# Architectural Decision Records (ADRs)

This directory contains Architectural Decision Records for SOFAR. Format defined in `template.md`. Protocol defined in `../CONTINUITY-PROTOCOL.md`.

## Index

| Number | Status | Title | Last Updated |
|--------|--------|-------|--------------|
| [0001](0001-three-database-split.md) | accepted | Three-database split: market / production / research | 2026-04-25 |
| [0002](0002-cftc-id-as-primary-key.md) | accepted | Use CFTC's `id` field as primary key for COT tables | 2026-04-25 |
| [0003](0003-centralized-git-push-queue.md) | accepted | Centralized git-push-queue cron for daemon writes | 2026-04-25 |
| [0004](0004-quant-research-pause.md) | accepted | Pause quant-research subsystem until Builds 1-6 ship | 2026-04-25 |
| [0005](0005-sentinel-and-migration-conventions.md) | accepted | Sentinel format + migrations_applied table convention | 2026-04-25 |
| [0006](0006-continuity-protocol.md) | accepted | Four-layer continuity protocol (CLAUDE.md / ADRs / state / handoffs) | 2026-04-25 |

## Adding a new ADR

1. Pick the next number (highest existing + 1)
2. Copy `template.md` to `NNNN-slug.md`
3. Fill it in
4. Add an entry to the index table above
5. Commit

If the ADR supersedes an older one, update the older ADR's status field to `superseded by ADR-NNNN` and link the new one in its References section.

## Status meanings

- **proposed** — drafted but not yet accepted; up for discussion
- **accepted** — current policy; new code should follow this
- **deprecated** — no longer recommended but not actively replaced
- **superseded by ADR-NNNN** — replaced by a later ADR; see linked successor

## What belongs here

See `../CONTINUITY-PROTOCOL.md` § Layer 2 for the full criteria. Short version: ADRs capture *significant decisions whose rationale is non-obvious from the code alone*. Implementation details belong in code, routine changes belong in commits, current operational state belongs in SYSTEM-STATE.md.
