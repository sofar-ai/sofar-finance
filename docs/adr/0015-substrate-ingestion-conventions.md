# ADR-0015: Substrate ingestion conventions for ADRs and handoffs

**Date:** 2026-05-02
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0005 (sentinel and migration conventions), ADR-0006 (continuity protocol), ADR-0013 (sentinel auto-promotion patch)

---

## Context

The four-layer continuity protocol (ADR-0006) relies on ADRs and handoff
documents being machine-ingestible into substrate via `extract_adrs.py` and
`extract_handoffs.py`. The conventions for filename format, header fields,
sentinel naming, and entity-mention syntax are currently tribal knowledge —
not captured in a canonical document. New Claude sessions (or future LLMs
swapped in via the model registry) cannot infer these conventions from
substrate alone; they must be told primer-style or risk producing documents
the extractors silently misparse.

This ADR captures the conventions as canonical so any LLM session reading
substrate can write substrate-ingestible documents on the first attempt.

The conventions were established incrementally:
- ADR-0005 introduced sentinel format (SHOUTING_SNAKE_CASE_V<N>) and
  migration filename pattern
- ADR-0006 established the four-layer protocol (CLAUDE.md + ADRs +
  SYSTEM-STATE + handoffs)
- ADR-0013 patched `extract_handoffs.py` to auto-promote sentinels
  mentioned in handoff prose (rather than requiring explicit ADR
  declaration)

The `MISSING_INGESTION_CONVENTIONS_DOC_V1` sentinel surfaced from this
session: future LLM sessions need this captured.

## Decision

### File location and naming

ADRs live at `~/sofar-finance/docs/adr/NNNN-slug.md` where:
- `NNNN` is a four-digit ADR number, monotonically increasing
- `slug` is short kebab-case description
- File extension must be `.md`

Handoffs live at `~/sofar-finance/docs/handoffs/YYYY-MM-DD-slug.md` where:
- `YYYY-MM-DD` is the session date
- `slug` is short descriptor (e.g., `evening-handoff`, `saturday-amendment`,
  `flow-analyzer-disaster-postmortem`)

### ADR document structure

```markdown
# ADR-NNNN: Title

**Date:** YYYY-MM-DD
**Status:** accepted | proposed | deprecated | superseded
**Deciders:** bot1
**Related:** ADR-XXXX, ADR-YYYY    (optional)
**Supersedes:** ADR-ZZZZ           (optional, only when replacing prior decision)
**Sentinel:** <NAME>_V<N>            (optional, ADR-born sentinel header; replace with actual capitalized form ending in V-and-a-digit)

---

## Context
[the problem/situation that motivated the decision]

## Decision
[what was decided; sub-sections allowed for multi-part decisions]

## Alternatives Considered
[options with pros/cons/rejection reasons; optional but preferred for
non-trivial decisions]

## Consequences

### Positive
[what gets better]

### Negative
[what gets worse or harder]

### Risks
[what could go wrong; include mitigations]

## Implementation notes
[file paths, sentinels introduced, scripts touched; optional]

## References
[other docs, prior handoffs, source material]
```

### Handoff document structure

```markdown
# Session Handover — YYYY-MM-DD descriptor

**Filed**: timestamp
**Amends**: prior-handover-name        (if amending)
**Captures**: one-line session summary

## What shipped today
[bullet list of concrete deliverables with file paths]

## New sentinels captured
**`<NAME>_V<N>`**            (replace with actual capitalized form ending in V-and-a-digit, one per new sentinel)
[paragraph explaining what it captures, why it matters, what to do]

## Files added/modified
[grouped by host, full paths]

## Pending TODO carryover
[deferred work]

## Substrate state at end of session
[counts: entities, relationships, sentinels]

## Notes for next session start
[orientation cues for the next session]
```

### Sentinel format

Sentinels follow `SHOUTING_SNAKE_CASE_V<N>` ending in version (V1, V2, V3).
Substrate auto-creates them when names appear in prose enclosed in backticks:
- In ADR `Sentinel:` header field: creates with attrs.first_seen_in =
  ADR-NNNN, no discovery_path
- In handoff prose backticks: creates with attrs.first_seen_in =
  handoff-name, attrs.discovery_path = "handoff_text"

Do NOT manually insert sentinel entities. Let the extractors auto-create
them from the markdown. Manual insertion creates two storage shapes for
the same conceptual sentinel.

**Documentation hazard.** This very ADR (and any other doc that shows
sentinel-format examples) must obfuscate placeholder sentinels using
angle-bracket syntax like `<NAME>_V<N>`. A literal capitalized name
ending in `_V` followed by a digit (the auto-promote regex pattern)
will create a phantom sentinel entity on ingest, even when used in a
"do not do this" example. The angle-bracket form does not match the
auto-promotion regex.

### Mentions resolution

Any canonical entity name appearing in prose auto-links to its substrate
entity. Canonical names include:
- Script paths (e.g., `quant-research-scout.py`, `db.py`)
- Hostnames (`mac1`, `mac2`, `spark-cfbd`, `spark-73ff`)
- Database names (`market`, `production`, `research`)
- Table names (`research.hypotheses`, `market.signal_values`)
- ADR identifiers (`ADR-0004`)
- Sentinel names (`BUNDLE_8_FINALIZED_V1`)

The extractor reports `mentions_unmatched` count; should be zero on a
clean ingest. Non-zero indicates either a typo or a not-yet-canonical
entity. Either fix the typo or push the new entity to substrate first,
then re-ingest.

### Ingestion commands

```bash
# Ingest one ADR or all ADRs (idempotent)
. /etc/neon-meta.env
python3 ~/scripts/extract_adrs.py --verbose 2>&1 | tail -15

# Ingest one handoff or all handoffs (idempotent)
. /etc/neon-meta.env
python3 ~/scripts/extract_handoffs.py --verbose 2>&1 | tail -15
```

Look for `entities_inserted`, `entities_updated`, `sentinels_auto_created`,
`mentions_unmatched`, `relationships_inserted` in the output stats. Zero
unmatched mentions = clean ingest.

### Two storage shapes for ADR status

Historical artifact: ADRs 0001-0006 store status inside `body_excerpt` text
that the parser scrapes. ADRs 0007+ store status in `attrs.status` directly
via the `**Status:**` header field. New ADRs use the header-field form.
Both forms remain readable; future tooling may unify.

## Alternatives Considered

### Alternative 1: Embed conventions in CLAUDE.md only
- **Pros:** Loaded automatically by Claude Code; no separate ADR
- **Cons:** CLAUDE.md is for orientation, not canonical decisions; future
  format changes would lose decision audit trail
- **Why not:** Conventions are decisions and should be ADRs per ADR-0006.

### Alternative 2: Embed conventions in extract_adrs.py / extract_handoffs.py docstrings
- **Pros:** Lives next to the parser code that enforces them
- **Cons:** Not substrate-canonical; LLMs reading substrate would not see it
- **Why not:** Defeats the purpose of substrate-as-knowledge-graph.

### Alternative 3: Skip; rely on session primers from the user
- **Pros:** No ADR overhead
- **Cons:** Every new Claude session requires a primer paste; primer can
  drift from actual extractor behavior; LLM swaps via the model registry
  multiply the problem
- **Why not:** Substrate exists precisely to eliminate this kind of tribal
  knowledge.

## Consequences

### Positive

- Future Claude sessions (and any LLM swapped in via the substrate model
  registry per ADR-0010) can read this ADR from substrate and write
  conformant ADRs and handoffs without a primer.
- The conventions become testable: a script can validate an ADR file
  against this spec before commit.
- Format changes get audit trail through ADR amendments rather than
  ad-hoc primer updates.

### Negative

- Adds one more ADR to maintain. If the format genuinely changes, this
  ADR needs amendment alongside the parser change.
- Slight risk of drift between this document and the actual parser
  behavior. Mitigation: when modifying `extract_adrs.py` or
  `extract_handoffs.py`, the same commit should amend this ADR.

### Risks

- **Convention drift between doc and parser.** If `extract_adrs.py`
  changes filename pattern (NNNN-slug.md → NNNNN-slug.md, say) and this
  ADR is not amended, new sessions get incorrect guidance. Mitigation:
  add a CI-style check that this ADR's "File location and naming"
  section matches the parser's regex.

## Implementation notes

- This ADR is the canonical doc; parser code at
  `~/scripts/extract_adrs.py` and `~/scripts/extract_handoffs.py` is the
  enforcement.
- `MISSING_INGESTION_CONVENTIONS_DOC_V1` is closed by this ADR being
  filed and ingested.
- `SENTINEL_AUTO_CREATE_FROM_BACKTICKS_V1` describes the runtime behavior
  patched in by ADR-0013 §2; this ADR documents the user-facing
  convention that depends on it.

## References

- ADR-0005 (sentinel and migration conventions — defines the sentinel
  naming format)
- ADR-0006 (four-layer continuity protocol — establishes why
  substrate-canonical conventions matter)
- ADR-0013 §2 (sentinel auto-promotion patch — runtime mechanism that
  enables backtick-mention auto-creation)
- `~/scripts/extract_adrs.py` (parser implementation)
- `~/scripts/extract_handoffs.py` (parser implementation, v3 with
  auto-promotion)
