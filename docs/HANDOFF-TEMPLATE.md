# Session Handoff Template

This is the canonical structure for session handoff docs. Copy this when starting a new handoff. Save as `docs/handoffs/YYYY-MM-DD-{period}.md` where period is `morning`, `afternoon`, `evening`, or `late-night`.

Sentinel of the protocol that defines this format: `CONTINUITY_PROTOCOL_V1`

---

## TEMPLATE BELOW THIS LINE — copy from here ↓

```markdown
# Session Handoff — {YYYY-MM-DD} ({period})

**Sentinel:** SESSION_HANDOFF_{YYYY-MM-DD}_{PERIOD}
**Author:** Claude (SOFAR session assistant)
**Duration:** {start time → end time, ET}
**Continuity protocol:** CONTINUITY_PROTOCOL_V1

---

## TL;DR

Two-to-four sentence summary. What happened, what shipped, what's the most important thing for next session to know.

---

## Shipped

Listed by sentinel where applicable, with commit hash where applicable.

| Sentinel | Repo | Commit | Description |
|----------|------|--------|-------------|
| SENTINEL_NAME_VN | sofar-finance | abc1234 | One-line description |
| OTHER_NAME_V1 | sofar-scripts | def5678 | One-line description |

For each, link the specific files modified. Don't restate file content — that's in the commit.

---

## Open issues surfaced this session (not yet resolved)

Each issue gets a priority and a clear next-action. If an issue is significant enough to need its own design doc, queue it as a future ADR by noting `→ ADR candidate`.

### {Issue title} — {priority: critical | high | medium | low}

What it is. Why it matters. Concrete next step (a command to run, a question to answer, a decision to make).

If applicable: `→ ADR candidate when resolved` or `→ update CLAUDE.md when resolved`.

### {Next issue title}
...

---

## State changes this session

If any of these were modified during the session, list them here AND verify SYSTEM-STATE.md reflects them:

- Services started/stopped/restarted
- Crons enabled/disabled/paused
- Pilot → production promotions
- New components added to the system
- Components decommissioned

This section should be near-empty most sessions. It's a checkpoint, not a content area.

---

## Decisions made this session (need ADR)

If you decided something significant during this session, list it here with enough detail to write an ADR. Don't write the ADR inline — note it for promotion.

### {Decision summary}

- Context: ...
- Chosen: ...
- Alternatives considered: ...
- → Promote to ADR-{NNNN}

---

## Discussed but not decided

Things that came up where the user posed a question or floated an option but no decision was reached. List them here so they're not forgotten.

### {Topic}

Brief summary. What the open question is. What information would help resolve it.

---

## Next session priority

Explicit, ordered list. The first item is what next-session-Claude should pick up first.

1. **{Highest priority item}** — one sentence on why it's first
2. {Next item}
3. {Next item}

---

## Resume context

Pointers, not content. Where to read more if needed:

- `CLAUDE.md` — durable project context (auto-loaded)
- `docs/SYSTEM-STATE.md` — current operational state
- `docs/adr/NNNN-{topic}.md` — relevant decision records for this session's work
- `docs/handoffs/{prior session}.md` — what came before this

---

## Notes / observations / aside

Anything that doesn't fit elsewhere but is worth capturing. User's mood. A pattern Claude noticed. A tangent that wasn't pursued. Things that would be lost otherwise.

This section is optional and free-form.
```

## END OF TEMPLATE — guidance below ↑

---

## Why this format

Compared to free-prose handoffs:

- **Sections enforce coverage.** It's harder to forget the "next session priority" if the template demands it.
- **Decisions are flagged for promotion.** Anything decided in a session gets explicitly tagged for ADR conversion, so decisions don't decay into handoff history and become unfindable.
- **Length is bounded by structure.** A typical handoff under this template is 100-300 lines, vs the 250-500 of free prose.
- **Resumption is fast.** "Next session priority" with ordered items means the next session knows exactly where to start, instead of scanning narrative for clues.

## What changed from prior handoffs

Earlier handoffs (pre CONTINUITY_PROTOCOL_V1) carried a lot of durable content — architectural descriptions, file path references, system invariants — that should now live in CLAUDE.md or ADRs. When converting old handoffs to the new style:

1. Anything that won't change next month → CLAUDE.md
2. Anything that's a "decision with rationale" → ADR
3. Anything that's "current state" → SYSTEM-STATE.md
4. What's left after those promotions → fits the template above

The first time the new template is used, you may have a backlog to migrate. Don't try to migrate all of it at once. The next handoff using the template will be much shorter; the old ones can stay as historical artifacts and be referenced from ADRs/CLAUDE.md when relevant.
