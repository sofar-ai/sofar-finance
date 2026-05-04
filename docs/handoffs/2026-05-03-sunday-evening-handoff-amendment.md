# Handoff Amendment — 2026-05-03 Sunday evening

**Date:** 2026-05-03
**Period:** sunday-evening-handoff-amendment
**Amends:** 2026-05-03-sunday-evening-handoff

### What this amendment captures

The main 2026-05-03-sunday-evening-handoff declared two sentinels as archived-on-creation per the resolution-archival convention adopted this session:

- `MAC1_SSH_TRUST_FROM_CFBD_NEEDED_INTERACTIVE_HOSTKEY_ACCEPT_V1`
- `EXTRACT_LLM_CALLS_MAC1_IP_HISTORICAL_ANNOTATION_ADDED_V1`

`extract_handoffs.py` ingested the handoff and created both as `status: active` with only the standard `first_seen_in` + `discovery_path` attrs. The extractor parses sentinel **names** from handoff prose and creates standard new-active entries; it does not parse the "Status: archived" + "Attrs:" subsections in handoff sentinel declarations.

Resolution: a manual `UPDATE entities ...` was applied via `/home/bot1/scripts/archive_sentinels_2026_05_03.py` (newly created this session — implements the dry-run-then-`--commit` pattern using the same SQL shape via two queries, JSONB shallow-merge with `attrs = attrs || %s::jsonb` to preserve original attrs, idempotent via `WHERE status = 'active'` guard, atomic across both targets via single transaction). Dry-run inspected first; commit ran clean. Both rows now have `status: archived` with full resolution metadata: `archive_reason: 'resolved'`, `archived_at: '2026-05-03'`, `archived_by: 'manual_cleanup_extractor_predates_archived_on_creation_convention'`, plus `resolution_path` and `resolution_artifact_ref` attrs.

The `archived_by` value follows the May 2 phantom-cleanup precedent, which used the field for the reason the operation was manual (`manual_cleanup_after_regex_obfuscation`) rather than actor identity. Consistent with precedent — but a structural issue worth surfacing because it conflates two semantic axes (who did it / why was it manual) into one field. See `SUBSTRATE_ARCHIVED_BY_FIELD_CONFLATES_ACTOR_AND_METHOD_V1` below.

This amendment files two new active sentinels capturing the structural gaps surfaced by tonight's first exercise of the convention. Both close together when an ADR-0005 amendment formalizes:

1. extract_handoffs.py parsing the archived-on-creation subsections
2. a two-field `archived_by` / `archive_method` shape

The script `archive_sentinels_2026_05_03.py` is preserved on cfbd for reuse on future archive-on-resolved operations until/unless the extractor is updated.

### Sentinels filed

#### Active (open issues — 2)

**`EXTRACT_HANDOFFS_DOES_NOT_HONOR_ARCHIVED_ON_CREATION_CONVENTION_V1`**
extract_handoffs.py creates all sentinel entities with `status: active` and standard `first_seen_in` + `discovery_path` attrs regardless of how the sentinel is declared in handoff text. The resolution-archival convention adopted in 2026-05-03-sunday-evening-handoff specifies that handoff text may declare sentinels as `archived` on creation with full resolution metadata in their narrative bodies (`Status: archived` + `Attrs:` subsection). The extractor does not parse these declarations. Workaround in use: manual UPDATE script (`archive_sentinels_2026_05_03.py` on cfbd, dry-run-then-`--commit` pattern). Closes when extract_handoffs.py is updated to parse the `Status: archived` + `Attrs:` subsection in handoff sentinel declarations and applies the corresponding fields directly during ingest, or when ADR-0005 amendment defines an alternative mechanism (e.g. dedicated archival extractor) and that mechanism is implemented.

**`SUBSTRATE_ARCHIVED_BY_FIELD_CONFLATES_ACTOR_AND_METHOD_V1`**
The `archived_by` attr on archived entities is currently used to capture the *reason* an archival operation was manual (e.g. `manual_cleanup_after_regex_obfuscation` from 2026-05-02 phantom cleanup, `manual_cleanup_extractor_predates_archived_on_creation_convention` from 2026-05-03 resolution-archival). This conflates two semantic axes — actor identity and method/reason — into one field. Future queries like "what did this session's archivals touch" cannot be answered from the `archived_by` field alone because actor identity is not preserved. Closes when ADR-0005 amendment formalizes a two-field shape (e.g. `archived_by` for actor identity and `archive_method` for the reason/operation), and the existing archived rows (3 phantoms from 2026-05-02 + 2 resolution-archivals from 2026-05-03) are migrated to the new shape.

### Pickup pointer

Both sentinels above pair with two from the main handoff under **ADR-0005 amendment scope**:

- `EXISTING_CLAUDE_SENTINELS_NEED_RETYPE_TO_ASSISTANT_PATTERN_V1` (main handoff)
- `ADR_0005_SENTINEL_LIFECYCLE_AMENDMENT_OWED_V1` (main handoff)
- `EXTRACT_HANDOFFS_DOES_NOT_HONOR_ARCHIVED_ON_CREATION_CONVENTION_V1` (this amendment)
- `SUBSTRATE_ARCHIVED_BY_FIELD_CONFLATES_ACTOR_AND_METHOD_V1` (this amendment)

The four are all "convention exists or is needed but not yet ratified / wired into substrate machinery." Natural to address together in a single ADR-amendment session — read ADR-0005 in full, draft the amendment covering: (a) sentinel resolution lifecycle (archive-on-resolved with the 5 attrs adopted this session, possibly extended), (b) actor/method field separation, (c) extractor support for archived-on-creation declarations, (d) a separate `assistant_pattern` entity type for assistant-session observations. Migrate existing rows accordingly. Update extractors and document the conventions canonically.

That session is independent of the next-session tunnel-build (Option C from the main handoff), and lower-priority. Tunnel-build first; ADR-0005 amendment when convenient.

### Cross-references

- Resolved by `archive_sentinels_2026_05_03.py` UPDATE: `MAC1_SSH_TRUST_FROM_CFBD_NEEDED_INTERACTIVE_HOSTKEY_ACCEPT_V1`, `EXTRACT_LLM_CALLS_MAC1_IP_HISTORICAL_ANNOTATION_ADDED_V1` (both transitioned `active` → `archived` with full resolution metadata).
- Existing precedent for manual archival: 3 phantom sentinels archived 2026-05-02 with `archived_by: 'manual_cleanup_after_regex_obfuscation'`.
- ADR-0005 (Sentinel format + migrations_applied table convention) — body not re-read this session; flagged via `ADR_0005_SENTINEL_LIFECYCLE_AMENDMENT_OWED_V1` in main handoff.
