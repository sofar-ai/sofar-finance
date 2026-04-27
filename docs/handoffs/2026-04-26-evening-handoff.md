# Handoff — 2026-04-26 evening

**Session window**: 2026-04-26 morning through evening (single working session)
**Primary work**: Bundle 7 (local LLM consumer of substrate) — phases 1 through 5 shipped
**Per**: ADR-0006 four-layer continuity protocol

---

## Layer 1: What ships today (the empirical facts)

### Bundle 7 is complete

All five spec phases shipped end-to-end on 2026-04-26. The substrate now has TWO daily-driver paths to a local LLM analyst, sharing the same audit log and substrate state:

```
ollmcp (mac2 or via SSH from Windows)──→ stdio ──→ mcp_substrate.py ──→ Neon
                                                          │
Browser (mac/Windows/iPad on LAN) ──→ Open WebUI ──→ mcpo container ─┘
                                       (port 3000)    (host.docker.internal:9000/sse)
```

ADR-0012 captures the architecture in detail. Don't repeat it here.

### Phase-by-phase shipped state

- **Phase 1**: smoke tests on raw `qwen3:235b` and `gemma4:31b`. qwen3 passed all 4. gemma4 confidently failed prompt 3 with `attrs_filter` instead of top-level `status`. `qwen3.6:35b-a3b` skipped (Ollama renderer issue #14493).
- **Phase 2**: system prompt v1 written, Modelfiles built with `temperature=0.3`, `top_p=0.9`, `num_ctx=32768`. First build at default `num_ctx=4096` failed; rebuild with 32768 fixed it. Both derived models then passed all smoke prompts. **gemma4's Phase 1 attrs_filter bug closed.**
- **Phase 3**: 15-question corpus run with locked ground truth. **gemma4-31b-substrate scored 96/104 (~92%) across 13 attempted, zero hallucinations**. qwen3-substrate scored 24/40 across 5 attempted before deliberation-spiral pattern locked.
- **Phase 4**: ADR-0012 written and ready to file (this handoff session).
- **Phase 5a**: Windows PowerShell `substrate` function for one-command ollmcp launch over SSH. Validated end-to-end with Q1 prompt.
- **Phase 5b**: Open WebUI + mcpo Docker stack on mac2. Required adding SSE transport to `mcp_substrate.py` (host can't run macOS Python venv inside Linux container). Q1 succeeded through Open WebUI; Q12 hung on first attempt.
- **Phase 5c**: launchd plist for SSE persistence across reboots.

### Concrete artifacts produced today

**On spark-cfbd** (after this handoff lands and is pushed):
- `~/sofar-finance/docs/specs/local-llm-system-prompt.md` — system prompt v1 (committed earlier today)
- `~/sofar-finance/docs/specs/bundle-7-corpus-ground-truth.md` — corpus + scoring rubric (PENDING commit — see action items)
- `~/sofar-finance/docs/adr/0012-bundle7-local-llm-consumer.md` — bundle 7 ADR (PENDING commit)
- `~/sofar-finance/docs/handoffs/2026-04-26-evening.md` — this file (PENDING commit)

**On mac2**:
- `~/sofar/local-llm-system-prompt.md` — working copy
- `~/sofar/bundle7-phase1-setup.sh` — installs ollmcp, configures
- `~/sofar/bundle7-phase2-rebuild-with-context.sh` — Modelfile builder with num_ctx=32768
- `~/sofar/bundle7-phase5b-openwebui-setup.sh` — Open WebUI + mcpo Docker stack
- `~/sofar/bundle7-phase5b-add-sse-transport-v2.sh` — SSE transport patch for mcp_substrate.py
- `~/sofar/bundle7-phase5c-launchd-persist.sh` — launchd plist installer
- `~/sofar/run_mcp_substrate.sh` — stdio runner (used by ollmcp, Claude Desktop)
- `~/sofar/run_mcp_substrate_sse.sh` — SSE runner (called by launchd)
- `~/sofar/mcp_substrate.py` — patched, dual-transport (stdio + SSE)
- `~/sofar/openwebui-stack/{docker-compose.yml,mcpo-config.json}` — Phase 5b stack
- `~/Library/LaunchAgents/com.sofar.substrate-sse.plist` — Phase 5c persistence
- `~/.config/ollmcp/substrate.json` — ollmcp MCP server config
- Built Ollama models: `qwen3-substrate:latest` (142GB), `gemma4-31b-substrate:latest` (19.8GB)

**On Windows daily-driver PC**:
- `~\.ssh\config` — `mac2` host entry
- `$PROFILE` — `substrate` PowerShell function
- `~\Downloads\phase5a-fixed.ps1` — Phase 5a setup script

### Daily-driver launches (validated working)

```powershell
# From any Windows PowerShell window:
substrate                    # gemma4-31b-substrate via ollmcp TUI
substrate qwen3:235b         # raw qwen3 reserve via ollmcp TUI
```

```
http://mac2.local:3000       # Open WebUI in browser, any LAN device
```

---

## Layer 2: What was learned (sentinels and findings)

### New sentinels (all captured in ADR-0012)

11 new sentinels surfaced today:

1. **`MCP_TOOL_STATUS_VOCAB_FIX_V1`** — substrate_search_entities default fixed from literal `status='active'` to `status != 'archived'` to handle ADR `accepted`, model `loaded`/`needs_review`, etc.
2. **`BUNDLE7_PROMPT_V1_UNCERTAINTY_RULE_INSUFFICIENT_V1`** — system prompt v1's "be honest about uncertainty" rule didn't transfer to meta questions; both models loop or spiral.
3. **`OLLMCP_DEFAULT_LOOP_LIMIT_3_INSUFFICIENT_FOR_META_V1`** — raise to 10 with `/loop-limit` for exploratory questions.
4. **`OLLMCP_HIL_SESSION_SEMANTICS_V1`** — `s/session` is per-tool, not session-wide; `d/disable` is the true off-switch.
5. **`OLLMCP_CONVERSATION_HISTORY_ACCUMULATION_V1`** — use `/clear` between independent corpus questions.
6. **`SHELL_PATH_HYGIENE_V1`** — recurring papercut; every node's shell init must source brew/env.
7. **`BUNDLE7_SPEC_GEMMA4_BENCHMARK_MISATTRIBUTION_V1`** — spec confused gemma4:31b (86.4%) with gemma4:e4b (42.5%).
8. **`BUNDLE7_SUBSTRATE_DUAL_TRANSPORT_V1`** — substrate now supports stdio + SSE; both share audit log + tier filtering.
9. **`MCPO_SUBPATH_TOOL_REGISTRATION_V1`** — Open WebUI tool URL must be `http://mcpo:8000/<server-name>`, NOT root.
10. **`OPEN_WEBUI_TOOL_PIPELINE_DIVERGENCE_V1`** — Q1 worked through Open WebUI, Q12 hung; pipeline differs meaningfully from ollmcp.
11. **`EXTRACTOR_MAC2_OLLAMA_NOT_PROBED_V1`** — substrate doesn't see mac2's loaded models because `extract_systems_state.py` doesn't probe mac2.

### Methodology findings worth preserving

**Corpus + ground truth as a regression suite, not a one-off.** Today's 15-question corpus turned "is this model better?" into measured data. Every future model evaluation runs the same questions against the same canonical answers. The corpus is reusable artifact, the ground truth is canonical, future ADRs reference this ADR's empirical baseline. This is the analyst-grade-eval pattern that should compound.

**System prompts are not model-agnostic in practice.** Same v1 prompt closed gemma4-31b-substrate's gaps AND caused qwen3-substrate's deliberation spirals. Per-model prompt overlay is the future-work fix; one-size-fits-all is empirically wrong.

**Architecture is model-agnostic at three layers, model-specific at one.** Adding a new local LLM is a one-line edit to the CANDIDATES array in the Phase 2 builder + a re-run. The MCP server, MCP client, and prompt artifact don't need to change. This is the swap path for bundle 8+.

**Spec correction discipline matters.** Bundle 7 spec was helpful as a starting point but had 9 specific errors that contact with reality changed (pip name, config path, prompt installation mechanism, gemma4 benchmark misattribution, grep pattern, loop limit default, HIL semantics, transport requirement for Open WebUI, mcpo subpath URL). All captured inline in ADR-0012. Pattern: write the spec to start, capture the corrections inline in the ADR rather than rewriting the spec.

**Substrate access through Claude Desktop's MCP changed mid-session.** Substrate tools became available to the cloud Claude session through a Claude Desktop config change. That meaningfully sped up the second half of today's work — direct queries replaced paste-back-log diagnostics. Confirms the bundle 7 sovereignty thesis from a different angle: substrate access from the analyst's primary tool is high-leverage regardless of which analyst tool that is.

---

## Layer 3: What's pending (action items, ranked by leverage)

### Immediate (must commit before next session)

1. **File ADR-0012 to spark-cfbd and git commit.** scp from mac2 Downloads, drop in `~/sofar-finance/docs/adr/`, commit with descriptive message. Auto-pusher picks up within minutes.
2. **Commit bundle-7-corpus-ground-truth.md to spark-cfbd.** Same pattern, drop in `~/sofar-finance/docs/specs/`.
3. **Commit this handoff doc to spark-cfbd.** Drop in `~/sofar-finance/docs/handoffs/2026-04-26-evening.md`.

### High-leverage, real follow-ups (next session)

4. **Full Open WebUI corpus validation.** Q1 worked, Q12 hung. Run Q1, Q5, Q7, Q9 against gemma4-31b-substrate via Open WebUI to confirm or invalidate `OPEN_WEBUI_TOOL_PIPELINE_DIVERGENCE_V1`. Two outcomes either way are useful: (a) Open WebUI is a true second daily driver, (b) Open WebUI is a UI-only fallback and ollmcp via SSH is the real analyst-grade path. Estimated effort: 30 minutes.

5. **Fix `EXTRACTOR_MAC2_OLLAMA_NOT_PROBED_V1`.** Add mac2 to `~/scripts/config/nodes.yml` with `ollama_port: 11434`. Re-run `extract_systems_state.py`. Validate substrate sees `qwen3-substrate`, `gemma4-31b-substrate`, and `gemma4:26b` as loaded entities. Estimated effort: 15 minutes.

6. **Bundle 6 setup script patch.** From earlier today's findings: events table audit columns mismatch — code uses `(type, source, attrs)` but schema is `(kind, actor, delta)`. mac2 was patched in place; the on-disk script is stale. Fix before any other Mac picks up bundle 6.

7. **`_log_tokens()` Ollama-shape support.** Today's runtime data has zero tokens for all local-model calls (corpus Q2 confirmed). Real but not blocking. Closes a real coverage gap that affects future cost estimation accuracy.

### Bundle 8 candidates (real design work, not today)

8. **Per-model prompt overlay layer.** Closes qwen3-deliberation-spiral without weakening gemma4-strict-compliance. Half-day effort. The most leveraged single follow-up because it expands the daily-driver candidate pool.

9. **`benchmark_run` / `eval` entity type in substrate.** Today's corpus results live in ADR-0012 prose. Future runs need structured storage so comparison is queryable. Pattern: write the spec first, build second, like bundle 7. Without this, the regression-suite methodology surfaces but doesn't compound — every new model eval is again prose-only.

10. **Substrate write capability for the local LLM.** Daily-driver use will inevitably want "capture this finding as a sentinel" or "write a benchmark_run record." Separate authorization model + tools. Deserves its own bundle spec like bundle 7 had. **Note auth question**: with SSE transport added in Phase 5b, an authoritative substrate write capability needs to bind to localhost AND require a token, because the read-only-localhost-trust model that bundle 7 uses doesn't extend cleanly to writes.

### Strategic / backburner

11. **vLLM evaluation** as alternative to Ollama for the qwen3.6:35b-a3b case. vLLM uses Hermes-style parsing natively, may unblock Ollama issue #14493. Worth revisiting when local-expert workload saturates Ollama's throughput.

12. **Open WebUI conversation extraction.** Open WebUI conversations live in its own SQLite store, not substrate. Future bundle: extractor that pulls them in as `conversation` entities linked to `tool_call` events. Gives substrate-queryable analyst-history, compounds over time.

13. **Process improvement: handoff-declared sentinels need a route into the substrate.** Sentinels declared in handoffs but not in ADRs aren't extracted. Either change extractor coverage or require all sentinels to land in an ADR.

14. **Hardware**: relocate or replace TP-Link 10G switch (loud); plug in Thunderbolt 5 cable mac1↔mac2 (purchased but not installed); GB10 (3rd Spark) on order.

---

## Layer 4: What's broken or fragile (for the next session to be aware of)

### Substrate state vs reality drift

**The most important pattern for the next session to know about**: substrate is canonical for entities it tracks, but its coverage is not complete.

- **mac2's loaded models are invisible.** `qwen3-substrate`, `gemma4-31b-substrate`, `gemma4:26b` are loaded on mac2 but substrate has zero record. The daily driver per ADR-0012 isn't a substrate entity. Fix is in action item #5.
- **Today's bundle 7 sentinels are not yet substrate entities.** They land when ADR-0012 is filed AND `extract_adrs.py` runs. Until then, querying for `BUNDLE7_*` sentinels returns nothing. Plan ahead.
- **Today's corpus run results are in ADR-0012 prose only**, not structured substrate entities. No queryable benchmark history yet. Bundle 8 candidate fixes this.

### Operational fragility worth knowing

- **qwen3-substrate** (the derived qwen3 with v1 prompt baked in) is operationally fragile. Don't use as daily driver. Use raw `qwen3:235b` if you need the reserve.
- **Open WebUI's tool pipeline** validated only on Q1 so far. Q12 hung. Don't trust for analyst-grade work without running the validation in action item #4.
- **`OLLMCP_DEFAULT_LOOP_LIMIT_3_INSUFFICIENT_FOR_META_V1`** — raise to 10 with `/loop-limit` for any exploratory or multi-tool work.
- **`OLLMCP_CONVERSATION_HISTORY_ACCUMULATION_V1`** — use `/clear` between unrelated corpus questions.

### Ollama-specific knowns

- **Issue #14493** (Qwen 3.5+ tool-call renderer) still open as of writing. Blocks `qwen3.6:35b-a3b`. Workaround: vLLM (future).
- **Apple Silicon Docker resource overhead** is real but bounded. Open WebUI + mcpo containers use ~2-4 GB RAM at idle, scales under load. Not meaningful on a 192 GB Mac Studio but worth knowing on smaller Macs.

### Process notes for the next session

- The substrate MCP tools are now available in Claude Desktop on mac2 (substrate tools appear in the conversation tool list). This is a meaningful capability change — the cloud analyst session can directly query substrate instead of relying on paste-back diagnostics. Use it.
- Auto-pusher on spark-cfbd commits every ~2 minutes; commits land via the canonical git path.
- SSH key `id_ed25519_shared` between spark-cfbd↔mac2 still in place.
- Windows daily-driver PC has the `substrate` PowerShell function — single-command launch from any PowerShell window.
- The launchd-managed SSE server runs at boot. If reboots happen between sessions, no manual relaunch needed.

---

## Continuity protocol checks

Per ADR-0006:

**Layer 1 (facts shipped)**: documented above.
**Layer 2 (lessons learned)**: 11 sentinels + 5 methodology findings, all captured.
**Layer 3 (action items)**: 14 ranked with effort estimates.
**Layer 4 (fragile state)**: documented with workarounds.

Next session should be able to pick up by reading this handoff + ADR-0012 + the bundle-7 corpus ground truth, and have full context for action items 4-7 (the high-leverage immediate follow-ups).

---

**Filed**: 2026-04-26 evening
**Next session**: target action items 4-7 first; bundle 8 design spec second
