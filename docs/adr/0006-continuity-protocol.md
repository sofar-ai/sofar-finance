# ADR-0006: Four-layer continuity protocol (CLAUDE.md / ADRs / SYSTEM-STATE / handoffs)

**Date:** 2026-04-25
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0005 (sentinel conventions, since this ADR uses them)

---

## Context

SOFAR is a long-running, multi-component, single-developer project being built with extensive Claude assistance. By April 2026 the project has been in active development for ~2 months and has accumulated:

- Multiple repos (`sofar-finance`, `sofar-scripts`)
- Multiple databases (3 Neon instances, see ADR-0001)
- Multiple compute nodes (2 DGX Sparks, Mac Studio, more on the way)
- Dozens of cron jobs, daemons, and services
- A growing history of architectural decisions, paused subsystems, and "known quirks"

Each Claude session starts with no memory of prior sessions. Initially, context was re-established by reading a session handoff document at the start of each new session. But the handoff documents themselves grew unwieldy:

- 250-500 lines per session
- Mixing durable architecture content (file paths, conventions, system invariants) with ephemeral content (what we just shipped)
- Re-stating the same durable content session after session
- Difficult to scan; easy to miss things

The user identified this scaling failure explicitly: *"the session handovers will stop being effective the longer we go / the more complex it gets."*

## Decision

Adopt a four-layer continuity model:

1. **`CLAUDE.md`** at each repo root — durable project context, auto-loaded by Claude Code at session start. Target ≤200 lines per file.
2. **`docs/adr/NNNN-slug.md`** — Architectural Decision Records, one per significant decision, immutable once accepted.
3. **`docs/SYSTEM-STATE.md`** — single file capturing current operational state (what's running, paused, broken). Mutable.
4. **`docs/handoffs/YYYY-MM-DD-{period}.md`** — per-session handoffs, structured per `docs/HANDOFF-TEMPLATE.md`, stripped of durable content.

Full protocol specified in `docs/CONTINUITY-PROTOCOL.md`. Sentinel: `CONTINUITY_PROTOCOL_V1`.

Each layer has a clear scope. The decision rule for placing new information:
- Will it matter next month? → durable (CLAUDE.md or ADR)
- Does it change frequently? → SYSTEM-STATE
- Is it a *decision* with rationale? → ADR
- Is it a *fact* about how the system is structured? → CLAUDE.md
- Is it specific to this session? → handoff

## Alternatives Considered

### Alternative 1: Stick with single-file handoffs, just write more discipline
- **Pros:** Simplest. No new structure.
- **Cons:** Doesn't address the scaling problem; just defers it. Was already showing strain at 200-300 line handoffs.
- **Why not:** Identified by the user as the failure mode that triggered this work.

### Alternative 2: Vector-database-backed memory (Memorix, Cloudflare Agent Memory, AWS AgentCore, etc.)
- **Pros:** Semantic retrieval, scales to thousands of decisions
- **Cons:** Adds infrastructure; vendor-locks the institutional knowledge; overkill for a single developer with one Claude session at a time
- **Why not:** Optimizing for a problem we don't have. May revisit in 6-12 months if the file-based system shows real strain.

### Alternative 3: Hybrid file + DB (file-canonical, DB for retrieval)
- **Pros:** Best of both
- **Cons:** Two systems to keep in sync
- **Why not:** Premature. The pure-file approach should be tried first.

### Alternative 4: Adopt one of the published frameworks wholesale (Claude Memory Bank, Continuous-Claude-v3)
- **Pros:** Pre-built, battle-tested
- **Cons:** Designed for different use cases (greenfield codebases, multi-agent setups); would impose conventions that don't fit SOFAR's ops-heavy, multi-repo, multi-machine reality
- **Why not:** The patterns are valuable; the wholesale frameworks aren't. We're adopting the patterns (CLAUDE.md, ADRs, structured handoffs) without the specific framework code.

## Consequences

### Positive
- Each piece of information has one home
- New sessions can establish full context by reading 3-4 files (CLAUDE.md + most recent handoff + relevant SYSTEM-STATE + linked ADRs)
- Handoffs become much shorter (template enforces ~100-300 line ceiling)
- Decisions are recorded once and referenced thereafter, instead of being re-litigated in each handoff
- Portable — pure markdown in git, no vendor dependency
- Compatible with Anthropic's Claude Code memory features (CLAUDE.md is the canonical surface) but doesn't depend on them

### Negative / trade-offs
- More files to manage. Discipline required to put new info in the right place.
- Initial migration cost: existing handoff content must be promoted into CLAUDE.md / ADRs / SYSTEM-STATE. Multi-hour initial investment.
- Doesn't solve cross-session retrieval-by-topic ("when did we decide X?") — for that, you grep the ADR directory or rely on file naming.
- No automated enforcement; new content can land in the wrong layer if the developer (or Claude) is sloppy.

### Risks
- **Drift.** Files can become stale. SYSTEM-STATE in particular is only useful if updated when state changes. Mitigation: convention is to update SYSTEM-STATE in the same commit as the state change.
- **Layer creep.** Over time, handoffs may re-accumulate durable content. Mitigation: each session, explicitly check whether anything in the handoff should be promoted.
- **CLAUDE.md size.** If kept under 200 lines, fine. If it bloats, Claude's adherence drops. Mitigation: split into per-area files when approaching the limit.

## Implementation notes

- Protocol doc: `~/sofar-finance/docs/CONTINUITY-PROTOCOL.md`
- Templates: `~/sofar-finance/docs/HANDOFF-TEMPLATE.md`, `~/sofar-finance/docs/adr/template.md`
- Initial seed ADRs: 0001-0006
- Initial CLAUDE.md files: `~/sofar-finance/CLAUDE.md`, `~/scripts/CLAUDE.md`
- Initial SYSTEM-STATE.md: `~/sofar-finance/docs/SYSTEM-STATE.md`
- Sentinel: `CONTINUITY_PROTOCOL_V1`

## References

- Originating session: 2026-04-24 afternoon (the session this ADR was drafted in)
- Patterns drawn from: Claude Code official memory docs, Michael Nygard ADR format, multiple open-source continuity-tooling projects (Continuous-Claude-v3, Claude Memory Bank, Hindsight, Memorix). None adopted wholesale; the file-based four-layer model is original to this project.
