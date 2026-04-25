# ADR-0004: Pause quant-research subsystem until Builds 1-6 ship

**Date:** 2026-04-25 (recording a decision originally made 2026-04-22)
**Status:** accepted
**Deciders:** bot1

---

## Context

The quant-research subsystem (experiment-orchestrator, overnight-research-daemon, quant-research-scout, signal generators, the LLM-driven hypothesis pipeline) was generating a large volume of "experimental signals" that exhibited two structural problems:

1. **Hallucination at the schema layer.** The LLM proposing hypotheses had no programmatic visibility into the actual database schema. It would invent table names, column names, or assumptions about data availability. ~496 generated signal scripts referenced tables that don't exist in any of the three databases.

2. **Promotion → orphan disconnect.** When an experiment "passed CPCV" (the validator gate) and was marked `decision='promoted'`, nothing actually moved that signal into production. The `experiments.signal_code` was set, but no canonical `signals/sig_*.py` was generated, no `published_signals` row, no entry in `active-weights-proposed.json`. As a result, 7 promoted signals existed in the DB with zero downstream effect.

These two problems together meant the subsystem was generating activity without producing value, and worse, was creating a maintenance burden (hundreds of broken scripts, orphaned DB rows) that obscured real signal work.

## Decision

Pause the subsystem entirely until structural fixes (numbered Builds 1-6) ship:

- Five quant-research crons in crontab tagged with `# QR-PAUSED:` prefix and disabled
- `sofar-research.service` (systemd) stopped
- A new toggle script `~/scripts/quant-research-toggle.sh` allows reversible pause/unpause for future testing

Builds required before unpause:
- **Build 1 (H1):** Schema-injection in LLM prompts so the model sees actual table/column reality
- **Build 2 (H2):** Smoke-test gate before insert into `experiments` table
- **Build 3 (H3):** Cleanup of hallucinated experimental scripts
- **Build 4 (S1):** `promote-signal-to-production.py` — closes the promotion gap
- **Build 5 (S2):** `bless-weights-proposal.py` — human gate
- **Build 6 (S3):** Re-enable signal compute cron

## Alternatives Considered

### Alternative 1: Don't pause; fix in place
- **Pros:** No interruption to research throughput
- **Cons:** Throughput was producing garbage; "in place" fixes have to coexist with broken code generation
- **Why not:** Too much risk of producing more debt while debt is being paid down.

### Alternative 2: Pause permanently; abandon LLM-driven research
- **Pros:** Eliminates the entire risk class
- **Cons:** Loses the optionality of LLM-driven discovery; commits to manual-only signal authoring
- **Why not:** The structural problems are fixable. Permanent abandonment over-corrects.

### Alternative 3: Run on a separate node so blast radius is bounded
- **Pros:** Fixes the "hallucination contaminates production" risk without pausing
- **Cons:** Requires hardware that wasn't available at decision time; doesn't fix the orphan-promotion problem
- **Why not:** Hardware-dependent. Re-evaluate when GB10 arrives — see SYSTEM-STATE.md "GB10 role" for current thinking.

## Consequences

### Positive
- No new hallucinated scripts being generated
- Existing 502 hallucinated scripts archived to `~/scripts-experimental-archive-20260423.tar.gz` and removed from disk
- Clear set of structural prerequisites before unpause; no ambiguity about "are we ready"
- Research-director-morning + research-director-evening crons continue to run; this exposed a separate issue (see open issues in latest handoff) that they narrate from stale data even when no experiments run

### Negative / trade-offs
- No new signal hypotheses being explored during the pause
- LLM director still sends morning briefs that may sound like they reflect overnight work — they don't
- Builds 1-6 are not yet scoped/prioritized; the pause is open-ended

### Risks
- **Pause becomes permanent through inertia.** Mitigation: keep Builds 1-6 in the active queue.
- **Director continues sending misleading briefs.** Mitigation: pending — either pause directors as well or add freshness gate. See current handoff for status.

## Implementation notes

- Toggle script: `~/scripts/quant-research-toggle.sh`
- Pause sentinel in crontab: lines beginning `# QR-PAUSED:`
- Stopped service: `sofar-research.service`
- Pause doc: `~/sofar-finance/docs/QUANT-RESEARCH-PAUSE.md` (predates this ADR; will be retired in favor of this ADR + SYSTEM-STATE.md once stable)

## References

- Original pause was Wed 2026-04-22 evening
- Hallucinated-signals archive: `~/scripts-experimental-archive-20260423.tar.gz` (326K, 502 files)
