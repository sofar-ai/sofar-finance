# SOFAR Continuity Protocol

**Sentinel:** CONTINUITY_PROTOCOL_V1
**Owner:** bot1
**Purpose:** Define how project context, decisions, state, and session-handoffs are recorded, retrieved, and maintained across Claude sessions.

---

## The problem this solves

Single-developer projects with AI assistants face a specific scaling failure: the assistant has no memory between sessions, so context must be re-established each time. Initially this is solved by manually re-explaining things at the start of each session. As the project grows, manual re-explanation gets too expensive (in time and in errors-from-omission), and informal handoff documents accumulate to the point where they're too long to read efficiently.

This protocol establishes a layered record-keeping system designed so that:
1. Each piece of information lives in exactly one place
2. The location is predictable based on the information's *type* and *durability*
3. New sessions can establish full context by reading a small set of canonical files
4. The maintenance burden is bounded — adding new information is cheap, reading old information is fast

---

## The four layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: PROJECT CONTEXT (CLAUDE.md)               │
│  Durable, loaded at session start, ~150 lines max   │
│  "What is this project? What conventions matter?"   │
└─────────────────────────────────────────────────────┘
              ↓ references
┌─────────────────────────────────────────────────────┐
│  Layer 2: ARCHITECTURAL DECISIONS (docs/adr/)       │
│  Per-decision markdown, immutable once accepted     │
│  "Why did we choose X?"                             │
└─────────────────────────────────────────────────────┘
              ↓ informs
┌─────────────────────────────────────────────────────┐
│  Layer 3: SYSTEM STATE (docs/SYSTEM-STATE.md)       │
│  Live operational state, mutable, single file       │
│  "What is running RIGHT NOW? What's paused/broken?" │
└─────────────────────────────────────────────────────┘
              ↓ feeds into
┌─────────────────────────────────────────────────────┐
│  Layer 4: SESSION HANDOFFS (docs/handoffs/)         │
│  Per-session markdown, ephemeral session-to-session │
│  "What did we just do? What's next?"                │
└─────────────────────────────────────────────────────┘
```

Each layer has a clear scope. Items move between layers as their nature changes — a session-handoff insight that becomes durable gets promoted into a CLAUDE.md edit or new ADR; a system-state issue that gets resolved gets removed from SYSTEM-STATE and recorded as a closed item in the next handoff.

---

## Layer 1: CLAUDE.md (project context)

**One file at the root of each repo.** Auto-loaded by Claude Code at session start. Contains durable context: what the project is, how it's structured, what conventions matter.

**What goes here:**
- Project overview (1-2 paragraphs)
- Architecture summary (where the major pieces live)
- Conventions (sentinel naming, commit message format, sentinel format)
- Key file paths and what they do
- Common commands the user runs
- "Don't do X" rules — known pitfalls Claude should avoid
- Pointers to the ADR index and SYSTEM-STATE.md

**What does NOT go here:**
- Anything that changes session-to-session (use SYSTEM-STATE.md)
- Specific past decisions and their rationale (use ADRs)
- "What we just did" (use handoff docs)

**Size discipline:** Target under 200 lines. CLAUDE.md is loaded into every Claude context, so size is a budget. If it grows, prefer to split into per-area docs that are linked rather than inlined.

---

## Layer 2: docs/adr/ (architectural decisions)

**One markdown file per significant decision.** Format: `NNNN-slug.md` where NNNN is a four-digit incrementing number.

**What counts as "significant":**
- A choice between meaningfully different options
- Something we'll regret if we re-litigate it from scratch later
- A decision whose rationale is non-obvious from the code alone
- Anything that shapes other decisions downstream

**What does NOT count:**
- Implementation details (those live in code)
- Routine changes (those live in commit messages and changelog)
- Decisions that were obvious in context (no value in recording)

**Format:** see `docs/adr/template.md`. Lightweight Michael Nygard format adapted for AI-assisted development:
- Context, Decision, Alternatives Considered, Consequences

**Lifecycle:**
- ADRs are *immutable once accepted*. To change a decision, write a new ADR that *supersedes* the prior one.
- An ADR can be in status: `proposed`, `accepted`, `deprecated`, `superseded by ADR-NNNN`.
- The ADR index (`docs/adr/README.md`) lists all ADRs by number with a one-line summary.

---

## Layer 3: SYSTEM-STATE.md (live state)

**One file at `docs/SYSTEM-STATE.md`.** Captures the current operational state of the system at any given moment.

**What goes here:**
- Which services/daemons are running
- Which crons are active vs paused (with WHY they're paused)
- Known-broken things (with status + workaround)
- Active feature flags
- Pilot vs production posture for each data source
- Hardware inventory (what node runs what)

**Key property:** This file is *mutable* and *current*. When state changes (something gets paused, a pilot goes production, a node comes online), this file gets updated *in the same commit as the change*. It is the answer to "what is the system doing right now?"

**Don't use this for history.** Closed issues get removed; the audit trail lives in commit history + handoffs. SYSTEM-STATE answers "now," nothing else.

---

## Layer 4: docs/handoffs/ (session handoffs)

**One markdown per session.** Filename: `YYYY-MM-DD-{morning|afternoon|evening}.md` or similar. Format defined in `docs/HANDOFF-TEMPLATE.md`.

**What goes here:**
- What this session shipped (commit hashes, sentinels)
- What got surfaced but not finished (open issues with priority)
- What was discussed but not yet decided (queued for ADR)
- Explicit "next session start here" pointer

**What does NOT go here (anymore — this is a change from before):**
- Long-form architecture descriptions (those go in CLAUDE.md)
- Decisions and their rationale (those become ADRs)
- Current operational state (lives in SYSTEM-STATE.md)

**Result:** Handoffs become much shorter — a few hundred lines instead of thousands — because they only carry the session-specific delta. A new session reads CLAUDE.md (durable context) + SYSTEM-STATE.md (current state) + the most recent handoff (recent delta) and is fully briefed in a few minutes.

---

## How a session works under this protocol

### Starting a session

1. Claude reads CLAUDE.md (auto-loaded)
2. User points Claude at the most recent handoff: *"Read docs/handoffs/2026-04-25-morning.md to catch up"*
3. If user mentions a topic that touches a known decision, Claude reads the relevant ADR
4. If a question depends on current state, Claude reads SYSTEM-STATE.md
5. Work begins

### During a session

- New durable insights → propose adding to CLAUDE.md
- New significant decisions → propose writing an ADR
- State changes (pause/unpause, pilot/production, broken/fixed) → update SYSTEM-STATE.md in the same commit as the change
- Everything else → captured in the working session, will end up in the handoff

### Ending a session

1. Write/update the handoff doc per `docs/HANDOFF-TEMPLATE.md`
2. If anything durable was learned, propose CLAUDE.md edit
3. If a decision was made, propose an ADR
4. If state changed, verify SYSTEM-STATE.md reflects it
5. Commit + push

---

## Maintenance discipline

The protocol works only if items end up in the *right* layer. Some heuristics:

- **"Will this matter next month?"** → Yes → durable (CLAUDE.md or ADR). No → handoff.
- **"Does this change frequently?"** → Yes → SYSTEM-STATE. No → CLAUDE.md or ADR.
- **"Is this a *decision* or a *fact*?"** → Decision → ADR. Fact → CLAUDE.md.
- **"Could a new person/Claude resume work without this?"** → No → it must be in CLAUDE.md or SYSTEM-STATE. Yes → handoff is fine.

When in doubt, err toward the more durable layer. It's easier to demote later than to recover lost knowledge.

---

## What this is NOT

- **Not a substitute for code comments.** Code-level "why" still belongs in code.
- **Not a substitute for commit messages.** What changed and why-this-change still belongs in commits.
- **Not vendor-locked.** All files are markdown in git. Portable across any tool.
- **Not exhaustive.** This system tracks decisions and operational state, not every interaction. It is intentionally selective.
- **Not for the user's personal notes.** The user maintains their own working memory; this protocol is for what *Claude needs to know* to be useful across sessions.

---

## Future extensions (not yet built)

- Vector-database memory for semantic retrieval across all four layers — defer until the file-based system shows scaling problems (likely 6-12 months out)
- Cross-repo continuity (right now sofar-finance and sofar-scripts have separate CLAUDE.md files; eventually a shared "ecosystem" file may be useful)
- Automated state-change → SYSTEM-STATE.md updates (e.g., a pre-commit hook that detects systemd changes)

These are deferred. Build the simple file-based layer first; complicate only if it shows real strain.
