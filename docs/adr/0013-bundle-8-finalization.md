# ADR-0013: Bundle 8 finalization — multi-host canonical, sentinel auto-promotion, qwen3.6-substrate as canonical local expert

**Date**: 2026-04-28
**Status**: accepted
**Sentinel**: BUNDLE_8_FINALIZED_V1

## Context

Bundle 8 (multi-host substrate extraction) shipped its first two workstreams
on 2026-04-27: `extract_scripts_multihost.py` (ws1) and
`extract_systemd_units.py` (ws2). The 2026-04-27-evening-handoff captured
substantial production failures during deployment (flow-analyzer disaster,
synthesis-trigger field name bug, ThetaData WARN drift) and an open queue
of ws3 + coverage gaps + browser-path crisis going into the 2026-04-28
session.

This ADR captures the architectural decisions made during the 2026-04-28
evening session that finalize Bundle 8 and establish the canonical
operational properties of the substrate-as-knowledge-graph.

The session shipped 10 deliverables across three concern domains:

1. **Substrate coverage** — closing gaps that produced misleading "no data"
   answers from the local expert
2. **Local expert canonicalization** — establishing qwen3.6-substrate as
   the daily-driver substrate analyst, with v2.3 prompt
3. **State freshness** — adding 15-min state-only refresh so substrate's
   `state` field reflects near-current reality

## Decision

### 1. Bundle 8 ws3: launchd extraction is canonical

`extract_launchd_agents.py` (shipped 2026-04-28 morning, finalized evening)
walks `~/Library/LaunchAgents/`, `/Library/LaunchAgents/`, and
`/Library/LaunchDaemons/` on macOS hosts (mac1, mac2). Captures
`program_arguments`, `environment_vars`, `run_at_load`, `keep_alive`,
`hardcoded_ips`, `last_exit_status`, `pid`, `loaded` from `launchctl list`,
plus `raw_plist`. Produces 5 `launchd_agent` entities: 1 on mac1
(`com.user.ollama-host`) and 4 on mac2 (substrate-sse, homebrew.mxcl.ollama,
docker.socket, docker.vmnetd).

Cron entry at 3:40 AM. Closes sentinel
`MACOS_LAUNCHD_NOT_EXTRACTED_V1` from 2026-04-27.

### 2. Sentinel auto-promotion from handoff text

Sentinels were previously promoted to first-class `type=sentinel` entities
ONLY by `extract_adrs.py` parsing explicit `Sentinel:` headers in ADR
files. Sentinels mentioned in handoff text (e.g.,
`OPEN_WEBUI_TOOL_PIPELINE_DIVERGENCE_V1`) remained substrate-invisible
unless promoted to an ADR. Substrate's sentinel count was 15 (ADR-born
only) on session start.

`extract_handoffs.py` was patched (v3) to:
1. Change the sentinel `LOOKUPS` entry's `lookup_method` from `'exact'` to
   `'regex_only'`, removing the substrate-membership filter that previously
   silently dropped unknown sentinel mentions.
2. Add `auto_create_handoff_sentinel(writer, sentinel_name, handoff_name,
   source_ref)` helper that creates a tier-1 sentinel entity with
   `attrs.first_seen_in = <handoff_name>` and
   `attrs.discovery_path = 'handoff_text'`.
3. Splice the auto-create call into the pass-2 mention loop: when
   `lookup_entity_id` returns None for `etype='sentinel'`, auto-create
   instead of incrementing `mentions_unmatched`.

After the patch shipped, 40 sentinels were auto-promoted from existing
handoff text. Substrate sentinel count: 15 → 55.

The `attrs.discovery_path` field cleanly distinguishes ADR-born sentinels
(`first_seen_in: 'ADR-NNNN'`, no discovery_path) from handoff-born
(`discovery_path: 'handoff_text'`). Future tooling can filter on this
distinction.

### 3. qwen3.6-substrate is the canonical local expert (NOT qwen3:235b)

Empirical finding from 2026-04-28 evening: same v2.2 prompt baked into
qwen3-substrate (qwen3:235b base) and qwen3.6-substrate (qwen3.6:35b-a3b
base) produced different behaviors:

| Query | qwen3-substrate (235b) | qwen3.6-substrate (35b-a3b) |
|---|---|---|
| "Are any sofar daemons inactive on spark-cfbd?" | Refused: "no such data available" | Surgical: identified 2 inactive units + descriptions + ExecStart paths + correct interpretation of restart-policy semantics |

Three rounds of prompt iteration (v2.0 → v2.1 → v2.2) failed to break the
qwen3:235b refusal pattern. The 235b model has stickier
"don't-claim-status-of-live-systems" alignment training than the smaller
qwen3.6 family member.

**Counter-intuitive captured finding**: smaller model in the qwen3 family
is more cooperative for substrate-analyst work, despite "smaller = less
capable" intuition. Captured as
`QWEN3_FAMILY_ALIGNMENT_VARIES_BY_SIZE_V1`.

**Operational consequences**:
- Daily-driver substrate analyst: qwen3.6-substrate (23GB, 3B active params,
  faster decode)
- qwen3-substrate retained for 1M-context queries that genuinely need the
  larger context window
- mac2's `substrate <model>` zsh wrapper and Windows PowerShell wrapper
  default to qwen3.6-substrate

### 4. Substrate coverage gap closure

Three real coverage gaps were identified during local-expert testing and
closed in this session:

**`EXTRACT_SCRIPTS_LEGACY_NO_HOST_ATTR_V1`** — legacy
`extract_scripts.py` did not set `attrs.host` on entities it created. Result:
`search_entities(type='script', attrs_filter={'host': 'spark-cfbd'})`
returned 0 even though spark-cfbd has 100+ scripts. One-line patch added
`'host': 'spark-cfbd'` to the attrs dict; 111 entities updated on next run.

**`EXTRACT_LLM_CALLS_MISSES_CLI_ARG_MODELS_V1`** —
`extract_llm_calls.py` parsed only Python literals (e.g.,
`model="qwen3:235b"` in source). Models passed via systemd ExecStart CLI
args (e.g., `--model qwen3:235b` in
`sofar-flow-analyzer.service@spark-73ff`) were invisible to llm_call
queries. Real production impact: cost estimates and drift detection
silently missed flow-synthesis usage of qwen3:235b on mac1.

Patch: added `parse_systemd_units_for_cli_models(cur)` that walks
`systemd_unit` entities, regex-extracts `--model X` patterns from
`attrs.exec_start`, and produces findings in the same shape as the file
scanner. Findings flow through identical persistence path. New entity
shape: `<script>:systemd:<model>@<host>` with
`attrs.call_kind = 'systemd_cli_arg'`. Also creates direct relationship
`systemd_unit -[invokes_model]-> model` with `attrs.via = 'cli_arg'` so the
relationship is queryable from the unit side.

**`MODEL_ENTITIES_QUERYABLE_VIA_GET_PRICING_NOT_SEARCH_ENTITIES_V1`** —
`search_entities(type='model')` returned 3 (Anthropic-only) while
`get_pricing()` returned 10 (full registry including local models). Real
fix: alias-based reconciliation. `qwen3.6:35b-a3b-s2` (a code-side naming
convention for the s2-loaded variant) added as alias of the canonical
`qwen3.6:35b-a3b` model. Phantom auto-created model entity archived on
next extract_llm_calls run.

### 5. v2.3 system prompt teaches fallback queries

Empirical motivation: qwen3.6-substrate's first-pass behavior on
filtered-zero-result queries was to give up and return "no data."
This produced misleading answers when the issue was filter shape (e.g.,
missing `attrs.host`) rather than missing data.

v2.3 adds the `### Fallback queries when filtered results are empty`
section to the substrate-specific gotchas. Teaches: when
`attrs_filter` returns 0, retry without the filter to disambiguate "no
data" from "wrong filter shape." Also documents the `systemd_cli_arg`
call_kind so the model knows to check both Python-literal AND CLI-arg
pathways when looking for model usage.

Validated end-to-end: post-v2.3, qwen3.6-substrate now offers fallback
queries proactively when initial results are narrow, and explicitly
states scope boundaries (e.g., "substrate doesn't store source text")
rather than fabricating.

### 6. Lean state-refresh extractor (15-minute cadence)

The four nightly extractors (handoffs 3:25, multihost scripts 3:30,
systemd 3:35, launchd 3:40) leave substrate's `state` field stale
during the day. "Is X running RIGHT NOW" queries returned the 3:35 AM
answer.

`extract_state_refresh.py` (~150 lines) shipped: lean state-only refresh
running every 15 min. SSH-fans to all 4 hosts, queries `systemctl is-active`
+ `systemctl show` (Linux) or `launchctl list` (macOS), updates only
`attrs.state`, `attrs.pid`, `attrs.last_exit_status`, `attrs.loaded` on
existing entities. Does NOT re-parse unit/plist files. Per-run cost:
~5-10 sec.

The full extractors continue running nightly to catch config-file edits
and new units.

Cron: `*/15 * * * * . /etc/neon-meta.env && python3 /home/bot1/scripts/extract_state_refresh.py >> /home/bot1/logs/extract-state-refresh.log 2>&1`

## Consequences

### Positive

- Substrate is now genuinely complete enough for natural-language
  operational queries via the local expert (validated on 4 real production
  diagnostic queries during the session: "what daemons are inactive,"
  "why hasn't this log updated," "what models are called by what scripts,"
  cross-checked against pricing registry).
- `LOCAL_EXPERT_USEFUL_WHEN_SUBSTRATE_HAS_SOURCE_V1` empirically validated.
  Local expert quality scales with substrate completeness; coverage gap
  closure produces analyst-grade output without further model/prompt
  iteration.
- 55 sentinels substrate-canonical (vs 15 at session start) — full
  operational learning history queryable.
- State freshness gap closed — substrate state field never more than 15
  min stale.

### Negative

- Five extractor crons now fire daily (was four). Adds modest scheduling
  complexity. Lean state refresh runs every 15 min, ~5-10 sec each — light
  but non-zero load on the cluster.
- More entity types in substrate means richer query surface but also more
  surface area where the local expert can get confused. v2.3 prompt
  iteration was required to close the filter-zero gotcha; future entity
  types may require similar explicit teaching.
- qwen3:235b reserved for 1M-context queries that may rarely materialize.
  Underutilization risk — captured as
  `PENDING_CONSIDER_S2_TO_MAC2_CONSOLIDATION_V1` for later strategic review.

### Neutral

- `OLLMCP_CLIENT_ENVIRONMENT_AFFECTS_BEHAVIOR_V1` retracted as a real
  divergence sentinel. Diagnosis: Windows ollmcp wrapper SSHes to mac2 and
  runs the same ollmcp binary; mac2-direct and Windows produce equivalent
  output when substrate has authoritative source. Captured root cause is
  `LOCAL_EXPERT_USEFUL_WHEN_SUBSTRATE_HAS_SOURCE_V1`, not client divergence.

## References

- 2026-04-26-evening-handoff.md (Bundle 7 closeout)
- 2026-04-27-evening-handoff.md (Bundle 8 ws1+ws2 deployment + production failures)
- 2026-04-27-evening-handoff-amendment.md (cron fix for extract_handoffs.py)
- 2026-04-27-flow-analyzer-disaster-postmortem.md (mac1 LAN binding issue)
- 2026-04-28-evening-handoff.md (this session — pending)
- ADR-0006 (continuity protocol — four-layer pattern this ADR follows)
- ADR-0008 (Macs as independent hosts — informs s2-to-mac2 deferral)
- ADR-0010 (substrate canonical for rate cards — informs alias-based model
  registry reconciliation)
- ADR-0012 (Bundle 7 local LLM consumer architecture — qwen3.6-substrate
  decision supersedes the qwen3-substrate canonical claim there)
