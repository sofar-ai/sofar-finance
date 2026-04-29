# Session Handover — 2026-04-28 (Tuesday) Evening

## Operating rules (reinforced this session)

- **The user calls session done. Claude does not.** Held throughout
  tonight's session — Claude did not preemptively suggest "wrap up"
  except when the user explicitly named "useless" frustration midway
  (Claude offered honest assessment + options, did not push pause).
- **Renaissance discipline**: read working pattern before drafting parallel
  code; validate before shipping; capture lessons as sentinels. Held —
  every extractor patch was preceded by reading the existing source, and
  each fix shipped as a targeted str_replace not a rewrite.
- **No echo-back of credential strings** — held throughout.
- **Don't ask about time** — Claude has no clock.
- **v2 filename rule**: same-content-update of existing file uses _v2/_v3
  suffix; different content uses distinct slug. Followed for both
  extract_handoffs.py (v2/v3) and local-llm-system-prompt (v2/v3).
- **256GB on each Mac Studio** — confirmed during V4-Flash discussion.

## Context

User runs SOFAR finance analytics across 4 production hosts:
- **spark-cfbd** (s1, production-main, ~200 scripts, runs cron + pipeline-runner)
- **spark-73ff** (s2, synthesis, runs flow-structure-analyzer)
- **mac1** (frontier-inference, qwen3:235b paused per ADR-0004)
- **mac2** (mcp-host, daily-driver, hosts substrate MCP + ollmcp + Ollama)

User works from mac2 + remote Windows PC. Standard transit pattern: `scp
~/Downloads/<file> bot1@spark-cfbd:~/scripts/`. Auto-pusher on spark-cfbd
commits `~/sofar-finance/` every ~2min.

## What ships today (the empirical facts)

### Bundle 8 finalization (ws3 + sentinel auto-promotion + coverage gaps)

**Item 1 — extract_launchd_agents.py**: 5 launchd_agent entities landed
(1 mac1 + 4 mac2). Cron entry at 3:40 AM. Closes
`MACOS_LAUNCHD_NOT_EXTRACTED_V1`.

**Item 2 — extract_handoffs.py sentinel auto-promotion patch**: shipped v3
after two-step debug (regex_only + counter-increment fix). 40 sentinels
auto-promoted from existing handoff text. Substrate sentinel count: 15 → 55.
Auto-promoted entities have `attrs.discovery_path = 'handoff_text'`
distinguishing them from ADR-born sentinels.

**Item 3 — spark-cfbd systemd extraction**: 4 daemon entities (sofar-flow-intel
inactive intentional, sofar-flow-tape active, sofar-monitor active,
sofar-research inactive intentional per ADR-0004). Total systemd_unit
count: 5 (4 spark-cfbd + 1 spark-73ff).

**Item 4 — extract_llm_calls.py CLI-arg parsing patch**:
`parse_systemd_units_for_cli_models` walks systemd_unit entities,
regex-extracts `--model X` from exec_start. Real impact: flow-structure-analyzer's
qwen3:235b call (via systemd ExecStart on spark-73ff, inferring on mac1)
is now substrate-canonical. Closes `EXTRACT_LLM_CALLS_MISSES_CLI_ARG_MODELS_V1`
and `FLOW_SYNTHESIS_QWEN3_235B_INVISIBLE_TO_LLM_CALL_EXTRACTOR_V1`.

**Item 5 — extract_scripts.py host attr patch**: one-line addition of
`'host': 'spark-cfbd'`. 111 entities updated. spark-cfbd scripts now
host-filterable. Closes `EXTRACT_SCRIPTS_LEGACY_NO_HOST_ATTR_V1`.

**Item 6 — qwen3.6:35b-a3b-s2 alias gap closed**: `qwen3.6:35b-a3b-s2`
added as alias of canonical `qwen3.6:35b-a3b`. Phantom auto-created model
entity archived on next extract_llm_calls run.

### Local expert canonicalization

**Item 7 — qwen3.6-substrate validated as canonical local expert**: empirical
finding that qwen3:235b base model has stickier alignment refusal patterns
on operational queries than qwen3.6:35b-a3b — same v2.2 prompt produces
opposite behaviors. qwen3.6-substrate is now the daily-driver substrate
analyst (6x smaller at 23GB, 3B active params, faster decode). Captured as
`QWEN3_FAMILY_ALIGNMENT_VARIES_BY_SIZE_V1`.

**Item 8 — v2.2 system prompt update**: replaced multi-host section with
explicit teach for all three Bundle 8 entity types (script, systemd_unit,
launchd_agent), full attribute documentation, expanded canonical query
patterns, anti-pattern warnings.

**Item 9 — v2.3 system prompt update**: added "Fallback queries when filtered
results are empty" gotcha. Empirical motivation: qwen3.6-substrate's first-pass
behavior on filtered-zero-result queries was to give up rather than retry
without filter to disambiguate. v2.3 teaches the renaissance pattern.
Validated end-to-end: model now proactively offers fallback queries and
states scope boundaries explicitly.

### State freshness

**Item 10 — extract_state_refresh.py (lean) + 15-min cron**: ~150-line
state-only refresh extractor. SSH-fans to all 4 hosts, queries
`systemctl is-active` (Linux) or `launchctl list` (macOS), updates only
state/pid/exit_status/loaded fields on existing entities. Per-run cost
~5-10 sec. Cron at `*/15 * * * *`. Closes the staleness gap; substrate
state field is now never more than 15 min stale.

## What was learned (sentinels and findings)

### New sentinels captured this session

All captured in ADR-0013, will be substrate-canonical via tomorrow's
3:25 AM extract_handoffs.py run.

- **`BUNDLE_8_FINALIZED_V1`** — Bundle 8 multi-host coverage complete
  (ws1 + ws2 + ws3 all shipped, cron'd, validated end-to-end)
- **`QWEN3_FAMILY_ALIGNMENT_VARIES_BY_SIZE_V1`** — counter-intuitive
  smaller-better finding within qwen3 family
- **`FLOW_INTEL_VS_FLOW_ANALYZER_DISAMBIGUATION_V1`** — two SOFAR scripts
  with similar names and distinct roles, captured to prevent future
  confusion (flow-intelligence.py = Discord daemon on spark-cfbd, paused;
  flow-structure-analyzer.py = structural analysis on spark-73ff, active)
- **`SUBSTRATE_METADATA_NOT_PURPOSE_DOCUMENTATION_V1`** — substrate
  captures structural facts (functions, calls, tables) but NOT script
  purpose. For "what does X do" return metadata + source_ref.
- **`SYSTEM_PROMPT_DIDNT_TEACH_BUNDLE8_QUERY_PATTERNS_V1`** — closed by
  v2.2 prompt update.
- **`HARDCODED_IPS_FLAG_INCLUDES_BIND_ALL_AND_LOOPBACK_V1`** — extractor
  flags `0.0.0.0` and `127.0.0.1` as `hardcoded_ips`; these are
  intentional bind-all/loopback configs not operational fragility. Low
  priority refinement for future.
- **`MODEL_ENTITIES_QUERYABLE_VIA_GET_PRICING_NOT_SEARCH_ENTITIES_V1`** —
  model registry surfaces via `get_pricing()` (10 models) not
  `search_entities(type='model')` (3 entities). Documented for prompt
  guidance; reconciliation deferred.
- **`SUBSTRATE_STATE_REFRESH_V1`** — 15-min state extractor sentinel.

### Retracted

- **`OLLMCP_CLIENT_ENVIRONMENT_AFFECTS_BEHAVIOR_V1`** — Windows ollmcp
  wrapper SSHes to mac2 and runs same ollmcp binary; both invocation
  paths produce equivalent surgical output when substrate has source.
  True root cause: `LOCAL_EXPERT_USEFUL_WHEN_SUBSTRATE_HAS_SOURCE_V1`.
- **`AUTO_PUSHER_SCOPED_TO_DATA_ONLY_V1`** — already retracted in
  2026-04-27 amendment.

## What's pending (action items, ranked by leverage)

### Tomorrow's first move

1. **Bundle 9: daemon health observability on spark-cfbd**. Substrate
   captures snapshot state (refreshed every 15 min now), but no live
   "is anything broken right now" alerting. Plan: substrate_log.py +
   daemon_health_now view + Discord alerts. Half-day work. Real prereq
   for quant-research unpause readiness checklist.

### High-leverage real follow-ups (next session)

2. **ADR-0013 commit to spark-cfbd**: scp from mac2 Downloads, drop in
   `~/sofar-finance/docs/adr/`, commit. Auto-pusher picks up within minutes.
3. **2026-04-28-evening-handoff.md commit** (this file): drop in
   `~/sofar-finance/docs/handoffs/`. extract_handoffs.py 3:25 AM cron
   ingests it.
4. **extract_log_files.py**: parse systemd_unit StandardOutput /
   StandardError, create log_file entities and `script -[writes_to]-> log_file`
   relationships. ~30 min real work. Closes the "where do these logs go"
   query class.
5. **Quant-research unpause readiness checklist**: per ADR-0004's pause
   conditions, list what's now satisfied (multi-host substrate, sentinels
   first-class, daemon coverage) vs what's still required (Bundle 9 closes
   the live-state gap). ~1 hour real strategic work.

### Lower priority / deferred

6. **`PENDING_CONSIDER_S2_TO_MAC2_CONSOLIDATION_V1`** — mac2 (256GB) is
   underutilized; spark-73ff hosts only flow-structure-analyzer + intraday
   synthesis. Architectural question: consolidate s2 workload onto mac2.
   Defer until: (a) mac2 utilization metrics show capacity headroom over
   a week, (b) explicit decision-time review.
7. **`SSH_KEYS_PASSPHRASELESS_BELT_SUSPENDERS_PENDING_V1`** — tighten
   authorized_keys on all 4 hosts to LAN-only with no forwarding. Real
   line: `from="192.168.50.0/24",no-agent-forwarding,no-port-forwarding,no-X11-forwarding ssh-ed25519 AAAAC...`
   ~5 min per host, dedicated security pass.
8. **DeepSeek V4-Flash evaluation** when local-compatible Ollama weights
   land (days away). Different model family, different alignment training.
   Real candidate for substrate-analyst alternative or ai-synthesis
   local replacement (currently $118/year Anthropic Opus).
9. **Network topology extraction** — closes `SUBSTRATE_NO_NETWORK_TOPOLOGY_V1`.
   1-2 hours real work. Each host's IP, listening ports, LAN-vs-localhost
   binding.
10. **Pipeline-runner state extraction** — `~/sofar-finance/data/pipeline-run.json`
    as substrate entities so "did tonight's pipeline pass" is queryable
    via local expert. ~30 min.

## What's broken or fragile (for the next session to be aware of)

### sofar-flow-intel.service paused intentionally

User stopped sofar-flow-intel on Apr 27 07:48 EDT because Discord alerts
were noisy without spread context (daemon flags individual large trades
that may be legs of multi-leg structures). Substrate now captures
`state: inactive` + `enabled: true` correctly. Real future-self gotcha:
"inactive but enabled" is intentional pause, not broken. Real path to
resume: extend send_discord with spread detection (sofar-flow-tape's data
has trades-by-symbol-and-time so spread inference is feasible).

### sofar-flow-tape.service depends on thetadata.service

`After=network.target ollama.service thetadata.service` — but
`thetadata.service` is not a sofar-* unit so it's NOT extracted by
`extract_systemd_units.py`. Real coverage gap. Fix would be extending
extractor's filter beyond `sofar-*.service`. Low priority — thetadata is
stable, thiis is "substrate doesn't know everything" not "production
fragility."

### Modelfile rebuild force-clean required for prompt updates

Confirmed twice this session: `ollama create <name> -f Modelfile` reports
`success` and creates a new layer, BUT may not update the in-memory
model handle. Must `ollama rm <name>` first to force clean rebuild. Then
verify via `ollama show <name> --system | grep <new content>`. ollmcp
TUI sessions opened before the rebuild also cache the model handle —
must exit + relaunch.

### qwen3.6-substrate v2.3 canonical, but the bundle7-phase2-modelfiles.sh
### script doesn't include qwen3.6-substrate

The builder script regenerates qwen3-substrate and gemma4-31b-substrate.
qwen3.6-substrate's Modelfile must be regenerated manually after each
prompt update via:
```bash
cp ~/sofar/modelfiles/Modelfile.qwen3-substrate ~/sofar/modelfiles/Modelfile.qwen3.6-substrate
sed -i '' 's|^FROM qwen3:235b|FROM qwen3.6:35b-a3b|' ~/sofar/modelfiles/Modelfile.qwen3.6-substrate
ollama rm qwen3.6-substrate
ollama create qwen3.6-substrate -f ~/sofar/modelfiles/Modelfile.qwen3.6-substrate
```
Real ergonomic fix: extend bundle7-phase2-modelfiles.sh to include
qwen3.6-substrate as a canonical target. ~5 min addition. Pending.

## Continuity protocol checks

Per ADR-0006:

- **Layer 1 (facts shipped)**: 10 deliverables documented above.
- **Layer 2 (lessons learned)**: 8 new sentinels + 2 retractions captured;
  ADR-0013 captures architectural decisions.
- **Layer 3 (action items)**: 10 ranked with real effort estimates.
- **Layer 4 (fragile state)**: documented 4 known gotchas with workarounds.

Next session should be able to pick up by reading this handoff +
ADR-0013 + the bundle-9 spec (whenever drafted), and have full context
for tomorrow's first move.

---

**Filed**: 2026-04-28 evening (cloud Claude session)
**Substrate state at end of session**:
- 18 entity types
- handoffs: 6 (this handoff makes 7 once 3:25 AM cron ingests it)
- sentinels: 55 (ADR-born + handoff-born; will grow to ~63 after tonight's
  amendments ingest tomorrow)
- systemd_unit: 5 (4 spark-cfbd + 1 spark-73ff)
- launchd_agent: 5 (1 mac1 + 4 mac2)
- llm_call: 24 (was 23 + 1 new systemd-CLI-derived entity for
  flow-structure-analyzer's qwen3:235b call)
- script: ~155 (111 spark-cfbd entities updated with host attr + multi-host)
- 5 extractor crons (4 nightly + 1 every-15-min state refresh)
- ai-synthesis 7-day cost: $2.26 (annual run-rate ~$118)
- Pipeline tonight: 23m14s, 20/20 OK (vs 62m43s yesterday with retries)

**Next session**: bundle 9 daemon health module. Real prereq for
quant-research unpause readiness checklist. Half-day work, scoped to
spark-cfbd-only first.
