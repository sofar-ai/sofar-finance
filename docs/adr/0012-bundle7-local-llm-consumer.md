# ADR-0012: Bundle 7 — Local LLM consumer of the substrate (model, client, prompt, parameters, transport)

**Date**: 2026-04-26
**Status**: accepted
**Deciders**: bot1
**Related**: ADR-0006 (continuity protocol), ADR-0008 (defer Exo, Macs as independent hosts), ADR-0009 (local expert IS the reranker), ADR-0010 (substrate canonical for rate-cards), ADR-0011 (verify schema before write)
**Supersedes**: none
**Spec reference**: `docs/specs/bundle-7-local-llm-consumer.md` (drafted 2026-04-26 evening)

---

## Context

After Bundle 6 (`mcp_substrate.py` running on mac2, consumed by cloud Claude Desktop), the substrate had its first programmatic consumer but the *reasoning layer* was still cloud Claude. Bundle 7's goal: replace that reasoning layer with a local LLM, achieving full sovereignty (queries no longer flow through Anthropic inference servers) and zero per-call cost.

The bundle 7 spec posed seven architectural questions (Q1–Q7) and proposed a 5-phase build sequence. This ADR records the decisions made executing that build on 2026-04-26, with the empirical evidence from each phase.

## Decision

The bundle 7 production stack is:

| Layer | Choice |
|---|---|
| **MCP transport (substrate side)** | Dual: stdio (default, original) + SSE on `127.0.0.1:9000` (added Phase 5b) |
| **Daily-driver client (TUI)** | `ollmcp` 0.28.0 via stdio transport, launched by `substrate` PowerShell function from Windows over SSH |
| **Daily-driver client (browser)** | Open WebUI v0.6+ with `mcpo` MCP-to-OpenAPI bridge connecting to substrate over SSE |
| **Primary daily-driver model** | `gemma4-31b-substrate` (derived from `gemma4:31b` via Modelfile, baked on mac2's local Ollama) |
| **Reserve model for interactive deep-dives** | `qwen3:235b` raw on mac1 (frontier-inference host per ADR-0008) |
| **System prompt** | v1 of `docs/specs/local-llm-system-prompt.md`, baked into derived models via Modelfile `SYSTEM` directive |
| **Modelfile parameters** | `temperature=0.3`, `top_p=0.9`, `num_ctx=32768` |
| **Audit log integration** | Bundle 6's existing audit log (events table). Tool calls captured per-MCP-query regardless of which client invoked them |
| **HIL approval (ollmcp)** | On by default. `s` (session-approve) is per-tool; `d` (disable) is the true session-wide off-switch |
| **Source of truth for prompt** | `~/sofar-finance/docs/specs/local-llm-system-prompt.md` on spark-cfbd, version-controlled, rebuilt into Modelfiles via `~/sofar/bundle7-phase2-rebuild-with-context.sh` on mac2 |
| **SSE persistence** | `launchd` LaunchAgent at `~/Library/LaunchAgents/com.sofar.substrate-sse.plist`, KeepAlive=true, RunAtLoad=true |

The architecture is **model-agnostic at three layers** (MCP server, MCP client, prompt artifact) and **model-specific at one** (the Modelfile per derived model). Adding a new model is a one-line edit to the `CANDIDATES` array in the Phase 2 builder script and a re-run.

## Rationale — empirical evidence

Five phases of empirical work on 2026-04-26 produced the data behind this decision.

### Phase 1: Smoke tests on raw models (no system prompt, default parameters)

Tested `qwen3:235b`, `gemma4:31b`, and (skipped) `qwen3.6:35b-a3b`. Four prompts each:
1. `/tools` (lists 7 substrate tools — ollmcp/MCP plumbing test)
2. "List all 7 substrate tools and what each does"
3. "Find out how many ADRs exist, use status='accepted'"
4. "Current price of claude-opus-4-7"

Results:
- **`qwen3:235b` raw**: passed all 4. Surfaced the tokenizer caveat from `pricing.notes` unprompted on prompt 4. Cross-checked count vs entity list on prompt 3.
- **`gemma4:31b` raw**: passed prompts 1, 3, 4 cleanly but **failed prompt 3 specifically** by constructing `attrs_filter: {"status": "accepted"}` instead of using the top-level `status` parameter — returned 5 ADRs instead of 11 because only ADRs 0007–0011 redundantly store status in attrs, while ADRs 0001–0006 don't. **Confidently wrong**, no self-correction.
- **`qwen3.6:35b-a3b`**: deferred. Open Ollama issue #14493 (Feb 2026, unresolved as of writing) reports the Ollama tool-call renderer for the Qwen 3.5+ family sends Hermes-style JSON to a model trained on Qwen-Coder XML format. Tool calling unreliable until upstream fix. Note: some sources suggest vLLM uses Hermes-style parsing natively and may unblock this; future evaluation candidate.

Phase 1 verdict: qwen3:235b strong out-of-box. gemma4:31b had a real schema-comprehension gap on Phase 1's harder question.

### Phase 2: System prompt v1 + `num_ctx=32768` baked into derived models

Wrote `docs/specs/local-llm-system-prompt.md` v1, encoding Phase 1 findings (status-vs-attrs_filter rule, read-all-fields rule, count-vs-list cross-checking, depth-walk warning, status vocabulary table). Built `qwen3-substrate` from `qwen3:235b` and `gemma4-31b-substrate` from `gemma4:31b` via Modelfile `SYSTEM` directive.

First Modelfile build used default `num_ctx` (4096). `qwen3-substrate` returned "No content response received" on prompt 2 with 24 tool calls visible in the MCP server log over 4 minutes — diagnosed as context-window saturation: system prompt (~2000 tokens) + 7 tool schemas (~2000 tokens) + accumulating conversation state exceeded 4096.

Rebuild with `num_ctx=32768` (per Ollama's streaming-tool-calling blog post: *"using a context window of 32k or higher improves the performance of tool calling"*) fixed this. Both derived models passed all 4 smoke prompts. **gemma4-31b-substrate's Phase 1 attrs_filter bug closed entirely** — used top-level `status` parameter as the prompt directed.

Phase 2 verdict: system prompt closes Phase 1 gaps. `num_ctx=32768` is non-optional for derived models with prompts of this size.

### Phase 3: 15-question corpus run with locked ground truth

Wrote `docs/specs/bundle-7-corpus-ground-truth.md` (375 lines) — canonical answers to all 15 corpus questions computed by direct substrate query before any model ran. Scoring rubric: 5 dimensions per question (tool called? right tool? args correct? interpretation correct? hallucination penalty), 0–8 per question.

**`gemma4-31b-substrate` results** (13 questions attempted):

| # | Question shape | Score / 8 |
|---|---|---|
| Q1 | Direct retrieval (Opus pricing) | 8 |
| Q2 | Filter + join (qwen calls) | 8 |
| Q3 | Cost aggregation | 8 |
| Q4 | Drift table (15 entries) | 8 |
| Q5 | Ambiguous noun (table vs script) | 8 |
| Q6 | 3-way comparison + bonus context-window | 8 |
| Q7 | Arithmetic trap ($7.16/40 not /50) | 8 |
| Q9 | Multi-step counterfactual (Sonnet swap) | 8 |
| Q11 | ADRs about hardware | 8 |
| Q12 | Node info (S2 role + scripts) | 8 |
| Q13 | Sentinels (15 active, 0 closed) | 8 |
| Q14 | Meta — substrate can't track mtime | 2 (loop limit hit, returned off-topic) |
| Q8 | Production scripts on mac1's qwen3:235b | 6 (literal "0" correct, missed env-file-mediation caveat) |

**Total: 96/104 = ~92%, zero hallucinations across all 13.** Q10 and Q15 not run (skipped after pattern was clear).

Single failure (Q14) was diagnosed as ollmcp's default loop limit of 3 being insufficient for exploratory questions where the substrate doesn't have the answer. The model couldn't complete its multi-call exploration before being terminated, returned a stale answer from a prior tool call.

**`qwen3-substrate` results** (5 questions attempted, then halted):

| # | Question shape | Score / 8 |
|---|---|---|
| Q1 | Direct retrieval | 8 (with bonus historical pricing context) |
| Q5 | Ambiguous noun | 8 (with literal evidence records) |
| Q7 | Arithmetic trap | 8 (with bonus upper-bound + cross-validation + follow-up suggestions) |
| Q9 | Multi-step counterfactual | 0 (deliberation spiral — emitted ~2400 tokens of planning text but no tool call) |
| Q14 | Meta — substrate can't track mtime | 0 (stalled, abort required) |

On the questions that completed, **qwen3-substrate produced richer answers than gemma4-31b-substrate** — quantified upper-bound scenarios, cross-validated arithmetic, surfaced historical context (Opus 4.1 supersession), suggested follow-up tools. But on multi-tool questions and meta questions, qwen3-substrate **deliberation-spiraled**: spent thousands of tokens reasoning about which tools to call, second-guessing model IDs, planning verification steps — and never emitted an actual tool call structure. The reasoning came out as content rather than as a `tool_calls` array.

Diagnosis: the system prompt's "always query, never assume from memory" rule combined with the gotchas section produces analysis paralysis specifically in qwen3. Same prompt that closed gemma4's gaps caused qwen3 to over-verify each step. **The prompt is not model-agnostic in practice, even though it's structurally model-agnostic.**

Thinking-mode toggle (`tm`) did not resolve the spiral. The pattern reproduced even with thinking off. Ollama daemon restart cleared it briefly, but it returned on the next multi-tool question (Q9). Operationally fragile.

### Phase 4: This ADR

Documenting the empirical record above. Done.

### Phase 5a: Windows SSH alias for one-command ollmcp launch

Added an `ssh mac2` host entry to `~\.ssh\config` and a `substrate` PowerShell function to `$PROFILE` on the Windows daily-driver PC. Result: typing `substrate` from any Windows PowerShell window opens an ollmcp TUI session on mac2 with `gemma4-31b-substrate` selected. Override with `substrate qwen3:235b` for the reserve.

Validated end-to-end with the Q1 prompt — substrate returned $5/$25 with tokenizer caveat, same answer Phase 3 ollmcp run produced.

Setup script: `~/sofar/phase5a-fixed.ps1` (idempotent).

### Phase 5b: Open WebUI + mcpo + SSE transport for substrate

The bundle 7 spec proposed Open WebUI as a "richer UX for daily use." Implementation surfaced an architectural mismatch: **Open WebUI consumes OpenAPI, not raw MCP**. The bridge is `mcpo` (github.com/open-webui/mcpo) — a small proxy that exposes any MCP server as OpenAPI endpoints.

First attempt: ran mcpo as a Docker container that spawned `run_mcp_substrate.sh` via stdio. Failed because:
1. The runner's env file (`/etc/sofar-meta.env` or `~/.sofar-meta.env`) wasn't accessible from inside the container at the expected path
2. The runner's hardcoded Python path (`/Users/bot1/sofar/venv/bin/python`) is a macOS Apple Silicon binary that cannot run inside a Linux container

Resolution: **added SSE transport to `mcp_substrate.py`** as a peer to the existing stdio transport. The patched server runs on the mac2 host (where its venv works) and listens on `127.0.0.1:9000`. mcpo connects over the network via `host.docker.internal:9000/sse`. This preserves data sovereignty (loopback only, no LAN exposure) while sidestepping container Python compatibility entirely.

**Architecture as deployed**:

```
ollmcp (mac2 or via SSH from Windows) ──→ stdio ──→ mcp_substrate.py ──→ Neon
                                                           │
Browser (mac/Windows/iPad on LAN) ──→ Open WebUI ──→ mcpo container ──┘
                                       (port 3000)    (host.docker.internal:9000/sse)
```

Both clients share the same underlying audit log (events table) — cross-client query history is preserved.

**Mcpo subpath gotcha** (worth flagging because it cost real time): mcpo's `--config` mode serves each MCP server at a per-server subpath (e.g., `/substrate`), not at the root. The root `/openapi.json` returns `{"paths":{}}` with a description listing the available tool subpaths. Open WebUI's tool-server URL must be set to `http://mcpo:8000/substrate` (or `http://host.docker.internal:8000/substrate`), **not** `http://mcpo:8000`. The wrong URL causes silent invocation failures: model fabricates "I called the tool, no results" without anything reaching mcpo or substrate, because Open WebUI presents the tool name without any callable endpoint.

Validation: Phase 5b's Q1 ("Opus pricing") fired correctly through Open WebUI → mcpo → substrate, with `CallToolRequest` visible in the SSE log and a real answer rendered in the browser. **However**, the next question attempted (S2 role + scripts — equivalent to Phase 3's Q12) hung indefinitely. ollmcp answered Q12 cleanly in Phase 3 in ~10 seconds. Open WebUI's tool pipeline appears to handle direct retrieval (Q1) but stall on multi-tool graph-walk questions (Q12). **Full Open WebUI corpus validation is incomplete** and is captured as future work.

Setup scripts:
- `~/sofar/bundle7-phase5b-openwebui-setup.sh` (Docker Compose stack: Open WebUI + mcpo)
- `~/sofar/bundle7-phase5b-add-sse-transport-v2.sh` (patch `mcp_substrate.py` to add SSE transport)
- `~/sofar/openwebui-stack/docker-compose.yml`, `mcpo-config.json`

### Phase 5c: launchd persistence for the SSE server

The Phase 5b SSE server initially launched as a backgrounded shell job, which would not survive mac2 reboots — Open WebUI would silently lose substrate access on next boot.

Wrote `~/Library/LaunchAgents/com.sofar.substrate-sse.plist` with `KeepAlive=true` and `RunAtLoad=true`. The plist invokes `~/sofar/run_mcp_substrate_sse.sh` (a wrapper that sources the env file the way launchd needs since launchd doesn't run shell rc files) which exec's `mcp_substrate.py --transport sse --host 127.0.0.1 --port 9000`.

After this, the SSE server starts at login automatically and gets restarted by launchd if it crashes (10-second throttle prevents crash loops). Open WebUI's mcpo connection survives reboots without manual intervention.

Setup script: `~/sofar/bundle7-phase5c-launchd-persist.sh` (idempotent).

### Why gemma4-31b-substrate as primary

1. **Reliability across question categories**: 11 of 13 attempted at full score, no fabrication, single explainable failure on a meta question due to ollmcp infrastructure limit (loop budget), not model capability.
2. **Speed**: noticeably faster than qwen3-substrate (~10–15s vs ~30s for typical answers; not formally timed).
3. **Operational robustness**: works with HIL on or off, works with thinking mode on or off, works after Ollama restart, doesn't fail on multi-tool chained questions in ollmcp.
4. **Schema-strictness compliance**: with v1 system prompt baked in, uses correct top-level `status` parameter, reads notes fields, cross-checks counts.

### Why qwen3:235b raw as reserve (and not `qwen3-substrate`)

1. **Higher analytic quality when it works** — quantified scenarios, cross-validation, historical synthesis.
2. **Operationally fragile when run with v1 system prompt baked in** — deliberation spirals on multi-tool work, sensitive to context state.
3. **Raw qwen3:235b in interactive mode** (HIL on, ollmcp TUI) was the working configuration in Phase 1. The model is fine; the prompt amplifies its failure modes.
4. Reserved for human-driven interactive exploration of single hard questions, not corpus-style multi-question runs.

A **future v2 system prompt with per-model overlay** could close this gap (looser epistemic guardrails for qwen3, tighter for gemma4). Deferred — see "Future work" below.

## Bundle 7 spec corrections

Building bundle 7 surfaced multiple errors in the spec written 2026-04-26 evening. Captured here so future readers know what changed:

1. **`pip install` package name**: spec said `pip install mcp-client-for-ollama`. Canonical install is `pip install ollmcp` (which depends on the longer name).
2. **Config file path**: spec said `~/.config/ollmcp/servers.json`. Reality: `~/.config/ollmcp/config.json` is the auto-loaded default; named configs live at `~/.config/ollmcp/{name}.json`. Loaded with `--servers-json` (short `-j`).
3. **System prompt installation**: spec said "ollmcp supports custom system prompts via config or flag." Reality: ollmcp's CLI surface is intentionally narrow; system prompts are set in-TUI via `/system-prompt` slash command (per-session), or — preferred — baked into Ollama via Modelfile `SYSTEM` directive (persistent across all clients).
4. **gemma4 benchmark misattribution**: spec attributed "86.4% τ2-bench tool-call accuracy" to `gemma4:e4b`. The 86.4% is actually Gemma 4 31B; E4B scores 42.5% on a different benchmark. Spec confused model variants.
5. **Modelfile verification grep**: phase 2 builder used `grep -qx` (exact match), but `ollama list` shows `<n>:latest`. False-fail unless using `grep -qE "^${name}(:latest)?$"`. Patched in `bundle7-phase2-rebuild-with-context.sh`.
6. **Loop limit default**: spec proposed `max_iterations=5`. ollmcp 0.28.0 defaults to 3, which is insufficient for meta/exploratory questions. Use `/loop-limit` to raise during corpus runs.
7. **HIL session semantics**: spec implied HIL options were straightforward. Reality: `s` (session-approve) appears to be per-tool, not per-session — different tools re-trigger the prompt. `d` (disable) is the true session-wide off-switch despite menu wording suggesting it's "permanent."
8. **Open WebUI required architectural change to substrate**: spec assumed Open WebUI could consume the existing stdio MCP server directly. Reality: Open WebUI's `mcpo` bridge cannot run our runner inside a container (env file path, macOS Python venv); SSE transport had to be added to `mcp_substrate.py` and the server now runs as a host-side launchd service.
9. **Open WebUI tool-server URL**: not specified in spec. The correct URL is `http://mcpo:8000/<server-name>`, NOT `http://mcpo:8000` — the latter returns an empty OpenAPI spec because mcpo serves per-server subpaths.

These corrections are real lessons; the spec was a useful starting point but contact with reality changed multiple specifics.

## Sentinels (new in this ADR)

- **`MCP_TOOL_STATUS_VOCAB_FIX_V1`** — Pre-patch, MCP `substrate_search_entities` defaulted to literal `status='active'`, hiding ADRs (`accepted`), models (`loaded`/`needs_review`), etc. Post-patch defaults to `status != 'archived'`. Lesson: default filter values must encode lifecycle vocabulary, not assume it.
- **`BUNDLE7_PROMPT_V1_UNCERTAINTY_RULE_INSUFFICIENT_V1`** — System prompt v1's "be honest about uncertainty" rule did not transfer through to corpus meta-questions in either model. Both models either looped (gemma4 hit loop limit on Q14) or spiraled (qwen3 emitted reasoning as content on Q9, Q14). v2 candidate guidance: "If you cannot find a specific field that the question requires, do NOT enumerate large result sets searching for it — state that the substrate does not track this and stop."
- **`OLLMCP_DEFAULT_LOOP_LIMIT_3_INSUFFICIENT_FOR_META_V1`** — Default ollmcp agent loop limit of 3 is fine for direct lookups but insufficient for any question requiring multi-step exploration (substrate-meta questions, multi-source comparisons, dependency tracing). Set to 10 via `/loop-limit` for corpus runs.
- **`OLLMCP_HIL_SESSION_SEMANTICS_V1`** — ollmcp's `s/session` HIL choice may be per-tool, not session-wide. `d/disable` is the true session-off-switch. Capture for ollmcp documentation feedback.
- **`OLLMCP_CONVERSATION_HISTORY_ACCUMULATION_V1`** — ollmcp keeps full conversation history by default. Without `/clear` between independent corpus questions, accumulated state degrades model performance, especially with models like qwen3 that have thinking mode. Use `/clear` between corpus questions.
- **`SHELL_PATH_HYGIENE_V1`** — Recurring papercut across nodes (spark-cfbd `/etc/neon-meta.env` autoload missing, mac2 `/opt/homebrew/bin` not in PATH for SSH zsh). Each new shell rediscovers the gap. Process: every node's `~/.zprofile` (login shells) and `~/.bashrc` (interactive bash) must source brew/env files.
- **`BUNDLE7_SPEC_GEMMA4_BENCHMARK_MISATTRIBUTION_V1`** — Spec attributed 86.4% tool-call accuracy to `gemma4:e4b` when that benchmark is for Gemma 4 31B. Lesson: when citing benchmark numbers in specs, cite the model variant explicitly and verify against primary sources before propagating.
- **`BUNDLE7_SUBSTRATE_DUAL_TRANSPORT_V1`** — `mcp_substrate.py` now supports both stdio (default, used by ollmcp/Claude Desktop) and SSE (used by mcpo/Open WebUI). SSE bound to `127.0.0.1:9000` for loopback-only access. Both transports share the same audit log, tier filtering, and rate limiting. Adding new transports follows the same pattern: peer function alongside `serve()`/`serve_sse()`, branch in `__main__`.
- **`MCPO_SUBPATH_TOOL_REGISTRATION_V1`** — Open WebUI tool-server URLs must point at mcpo's per-server subpath (`http://mcpo:8000/<server-name>`) not the root. Wrong URL causes silent invocation failures (model fabricates tool calls, nothing reaches the wire). The mcpo root `/openapi.json` only lists subpath links via the description field, not aggregated tool paths.
- **`OPEN_WEBUI_TOOL_PIPELINE_DIVERGENCE_V1`** — Open WebUI's mcpo OpenAPI bridge handles direct-retrieval substrate queries (Q1 verified) but stalls on multi-tool graph-walk questions (Q12 hung indefinitely). ollmcp via stdio handled the same Q12 cleanly in Phase 3. Pipeline difference is meaningful enough that Open WebUI cannot be declared a Phase-3-equivalent daily driver until full corpus validation is run.
- **`EXTRACTOR_MAC2_OLLAMA_NOT_PROBED_V1`** — `extract_systems_state.py` probes spark-cfbd, spark-73ff, and mac1's Ollama APIs but does not probe mac2's. Result: 3 models loaded on mac2 (qwen3-substrate, gemma4-31b-substrate, gemma4:26b) are invisible to substrate. The daily-driver model per this ADR is not substrate-canonical until the extractor is updated. Fix: add mac2 to `~/scripts/config/nodes.yml` with `ollama_port: 11434` and re-run extractor.

Closed by this ADR: **None.** All Phase 1–5 sentinels were new to today's work.

## Configuration as deployed

### On spark-cfbd (source of truth, version-controlled)

- `~/sofar-finance/docs/specs/local-llm-system-prompt.md` — versioned system prompt v1
- `~/sofar-finance/docs/specs/bundle-7-corpus-ground-truth.md` — corpus + scoring rubric
- `~/sofar-finance/docs/specs/bundle-7-local-llm-consumer.md` — original spec (with corrections noted above)
- `~/sofar-finance/docs/adr/0012-bundle7-local-llm-consumer.md` — this ADR

### On mac2 (deployment)

- `~/sofar/local-llm-system-prompt.md` — working copy (sync from spark-cfbd on prompt updates)
- `~/sofar/bundle7-phase1-setup.sh` — installs ollmcp, writes substrate.json config, dry-runs MCP runner
- `~/sofar/bundle7-phase2-rebuild-with-context.sh` — extracts prompt body, generates Modelfiles, runs `ollama create` for each candidate
- `~/sofar/bundle7-phase5b-openwebui-setup.sh` — Open WebUI + mcpo Docker Compose stack
- `~/sofar/bundle7-phase5b-add-sse-transport-v2.sh` — patches `mcp_substrate.py` to add SSE transport
- `~/sofar/bundle7-phase5c-launchd-persist.sh` — installs launchd plist for SSE persistence
- `~/sofar/run_mcp_substrate.sh` — stdio runner (used by ollmcp, Claude Desktop)
- `~/sofar/run_mcp_substrate_sse.sh` — SSE runner (called by launchd)
- `~/sofar/mcp_substrate.py` — the MCP server itself (now dual-transport)
- `~/sofar/modelfiles/Modelfile.qwen3-substrate`, `Modelfile.gemma4-31b-substrate` — generated
- `~/sofar/openwebui-stack/docker-compose.yml`, `mcpo-config.json` — Phase 5b stack
- `~/.config/ollmcp/substrate.json` — points at `~/sofar/run_mcp_substrate.sh`
- `~/Library/LaunchAgents/com.sofar.substrate-sse.plist` — Phase 5c persistence
- `~/sofar/venv/bin/ollmcp` — installed via pip, version 0.28.0
- Built Ollama models: `qwen3-substrate:latest` (142GB), `gemma4-31b-substrate:latest` (19.8GB)

### On Windows daily-driver PC

- `~\.ssh\config` — `mac2` host entry
- `$PROFILE` — `substrate` PowerShell function
- Setup script: `~\Downloads\phase5a-fixed.ps1` (idempotent)

### Daily-driver launches

**TUI (Windows PowerShell)**:
```powershell
substrate              # gemma4-31b-substrate via ollmcp
substrate qwen3:235b   # raw qwen3 reserve via ollmcp
```

**Browser (any LAN device)**:
```
http://mac2.local:3000
```
Select model `gemma4-31b-substrate`, ensure substrate tools enabled below chat input.

**Reserve interactive deep-dive**:
```bash
~/sofar/venv/bin/ollmcp \
    --servers-json ~/.config/ollmcp/substrate.json \
    --model qwen3:235b
```

Note: uses **raw `qwen3:235b`, not `qwen3-substrate`**, to avoid v1 prompt's deliberation-spiral interaction.

## Architecture: model swap path

When a new local LLM ships and is worth evaluating:

1. `ollama pull <new-model>` on mac2
2. Edit `~/sofar/bundle7-phase2-rebuild-with-context.sh`, add a line to the `CANDIDATES` array: `"<new-model> <new-derived-name>-substrate"`
3. Run the script — Modelfile generated, `ollama create` builds the derived model
4. Smoke-test with the 4-prompt Phase 1 sequence
5. If smoke passes, run the 15-question corpus from `bundle-7-corpus-ground-truth.md`
6. Score against canonical answers. If score meaningfully exceeds gemma4-31b-substrate's 96/104, supersede this ADR with ADR-NNNN naming the new daily driver

The corpus + ground truth are reusable artifacts, not one-off. Future ADRs reference this ADR's empirical baseline.

**Specific candidates worth evaluating** (from 2026-04-26 model-landscape research):
- **`qwen3.5:27b`**: SWE-bench 72.4%, explicit `reasoning: false` tool-calling pattern recommended; addresses qwen3-substrate's deliberation-spiral failure mode directly
- **`qwen3.6:35b-a3b`**: skipped in Phase 1 due to Ollama issue #14493 (renderer mismatch); revisit when Ollama patches or migrate to vLLM (which uses Hermes-style parsing natively)
- **`granite4`**: IBM's enterprise-tuned tool-calling model
- **`gemma4:26b`**: faster variant of current daily driver; worth comparing on speed/quality tradeoff

## Future work (deferred from this ADR)

1. **Full Open WebUI corpus validation** — Phase 5b validated end-to-end pipeline with Q1 only; Q12 hung. Run Q1, Q5, Q7, Q9 against gemma4-31b-substrate via Open WebUI to confirm or invalidate `OPEN_WEBUI_TOOL_PIPELINE_DIVERGENCE_V1`. ~30 min effort.
2. **mac2 Ollama probing** — fix `EXTRACTOR_MAC2_OLLAMA_NOT_PROBED_V1` by adding mac2 to `~/scripts/config/nodes.yml` with `ollama_port: 11434`. ~5 min effort.
3. **Per-model prompt overlay layer** in the Modelfile build: v1-base + qwen-overlay vs v1-base + gemma-overlay. Closes the qwen3-deliberation issue without weakening gemma4-strict-compliance. Estimated effort: half a day.
4. **`benchmark_run` / `eval` entity type in substrate**: today's corpus run results live in this ADR's prose. Future runs need structured storage so comparison is queryable. Bundle 8 candidate.
5. **Substrate write capability for the local LLM**: today's bundle 7 LLM is read-only. Daily-driver use will inevitably want "capture this finding as a sentinel" or "write a benchmark_run record." Separate authorization model + tools. Bundle 8 or 9 candidate, deserves its own design spec.
6. **Static extractor enhancements** to capture env-file-mediated dependencies (closes Q8 corpus question's "literal 0 vs architectural truth" gap) and the Anthropic SDK call pattern in ai-synthesis (closes Q10 runtime-without-static for that specific case).
7. **`_log_tokens()` Ollama-shape support**: today's runtime data has zero tokens for all local-model calls. Real but not blocking.
8. **vLLM evaluation**: Ollama tool-call renderer issues for Qwen 3.5+ (#14493) make `qwen3.6:35b-a3b` and similar models hard to evaluate. vLLM uses Hermes-style parsing natively. Worth revisiting when local-expert workload saturates Ollama's throughput.
9. **Process improvement: handoff-declared sentinels need a route into the substrate.** Sentinels declared in handoffs but not in ADRs are not extracted. Either change extractor coverage, or require all sentinels to land in an ADR before they're "real."
10. **Open WebUI conversation extraction**: Open WebUI conversations live in its own SQLite store. Future bundle: extractor that pulls them into substrate as `conversation` entities linked to `tool_call` events for substrate-queryable analyst-history.

## Status

Accepted. Bundle 7 phases 1–5 complete with this ADR. All five spec phases shipped.
