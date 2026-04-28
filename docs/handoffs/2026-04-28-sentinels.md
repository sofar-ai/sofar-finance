# Sentinels Captured — 2026-04-28 evening

Small dedicated capture document for sentinels surfaced during the 2026-04-28
evening session. Intended for the 3:25 AM extract_handoffs.py cron to promote
these to first-class substrate entities via the auto-create-sentinel patch
shipped earlier today.

---

## New sentinels

### `FLOW_INTEL_VS_FLOW_ANALYZER_DISAMBIGUATION_V1`

Two SOFAR scripts have similar names but distinct roles, hosts, and operational
states. Worth capturing the disambiguation explicitly to prevent future
confusion (including by Claude in subsequent sessions):

| Field | flow-intelligence.py | flow-structure-analyzer.py |
|---|---|---|
| Host | spark-cfbd (s1) | spark-73ff (s2) |
| systemd unit | sofar-flow-intel.service@spark-cfbd | sofar-flow-analyzer.service@spark-73ff |
| Model | gemma4:26b (local Ollama) | qwen3:235b (mac1 Ollama via LAN) |
| Purpose | Discord alerts on options flow patterns | Structural analysis writing flow_analysis rows |
| State as of 2026-04-28 | inactive (intentionally paused by user) | active (FIXED 2026-04-27 morning) |
| Pause reason | Alerts noisy without spread context — flags individual large trades that may be legs of multi-leg structures | n/a |
| Disaster history | n/a | Hardcoded `192.168.50.15` for mac1 Ollama, broke when mac1 reset to localhost-only on weekend reconfig |

Real captured: substrate entity 32 is flow-intelligence.py (spark-cfbd, gemma4:26b);
substrate entity for flow-structure-analyzer.py@spark-73ff has hardcoded_ips
flagged. Cross-reference: 2026-04-27-flow-analyzer-disaster-postmortem handoff
(entity 2548).

### `SUBSTRATE_METADATA_NOT_PURPOSE_DOCUMENTATION_V1`

Substrate captures structural facts (functions defined, calls made, tables
referenced, env files sourced) but NOT the script's primary purpose or
descriptions of WHAT it does in human terms. Asking "what does X do" via
substrate alone leads to misleading inferences from partial evidence (e.g.
seeing send_discord defined and incorrectly concluding a script's primary
purpose is Discord alerts when it might be one of many functions).

Real workflow implication: for "what does X do" questions, treat substrate
as a navigation graph that points to source via `source_ref` field, then
read the source. Substrate is an index, not documentation. Script docstrings
or ADRs are where purpose-level descriptions belong.

### `SYSTEM_PROMPT_DIDNT_TEACH_BUNDLE8_QUERY_PATTERNS_V1`

The v2.1 system prompt baked into qwen3-substrate and gemma4-31b-substrate
Modelfiles was written before bundle 8 ws2/ws3 landed (multihost scripts,
systemd units, launchd agents). Result: when asked questions about systemd
daemons or launchd plists, the model honestly responds "no such data
available in my tools" — even though substrate now has `systemd_unit` and
`launchd_agent` entity types fully populated.

Real captured: model is correctly NOT fabricating, but is incorrectly
declining queries it COULD answer. Closes when v2.2 prompt updates the
entity-type list and adds canonical query patterns for the new types.

Affects: any natural-language query about daemons, services, persistence,
running processes, hardcoded IPs in unit files, etc. — all answerable from
substrate but not from the model's prompt-described tool surface.

### `HARDCODED_IPS_FLAG_INCLUDES_BIND_ALL_AND_LOOPBACK_V1`

extract_launchd_agents.py and extract_systemd_units.py both flag any IPv4
address found in ExecStart/Environment/ProgramArguments as `hardcoded_ips`.
This includes special non-routable addresses like `0.0.0.0` (bind-all) and
`127.0.0.1` (loopback) which are NOT operational fragility — they're
intentional configuration choices.

Example: com.user.ollama-host@mac1 has `hardcoded_ips: ['0.0.0.0']` because
its ProgramArguments include `setenv OLLAMA_HOST 0.0.0.0:11434` — that's
the LAN-binding fix from 2026-04-27, intentionally targeting all interfaces.

Real refinement: extractor could exclude `0.0.0.0`, `127.0.0.1`, `::`, `::1`
from the hardcoded_ips list, since these never represent the brittleness
the field is meant to flag (production IPs that break when the target host
moves). Low priority — a human reading the entity attrs can interpret
correctly. Worth fixing if/when the field gets used by automated alerting.

---

## Sentinel state changes

- `OLLMCP_CLIENT_ENVIRONMENT_AFFECTS_BEHAVIOR_V1` (originally captured
  2026-04-27 evening amendment) — **retracted**. Hypothesis was that
  Windows ollmcp differed from mac2-direct ollmcp in some structural way.
  Real diagnosis tonight: Windows wrapper just SSHes to mac2 and runs the
  same ollmcp binary. Both invocations produce equivalent surgical analyst
  output when substrate has authoritative source. Last night's empty
  response on mac2-direct was substrate-emptiness (handoffs not yet
  extracted), correctly captured by `LOCAL_EXPERT_USEFUL_WHEN_SUBSTRATE_HAS_SOURCE_V1`.

- `AUTO_PUSHER_SCOPED_TO_DATA_ONLY_V1` (originally captured 2026-04-27
  evening amendment) — already retracted there. Auto-pusher does sweep
  `docs/handoffs/` broadly; the "data only" pattern was a misread of
  the visible commit log dominated by frequent flow-tape.json updates.

---

**Filed**: 2026-04-28 evening
**Companion to**: today's pending end-of-day handoff (not yet written)
**Will be substrate-canonical**: after extract_handoffs.py runs (manually
or via 3:25 AM cron tomorrow morning)
