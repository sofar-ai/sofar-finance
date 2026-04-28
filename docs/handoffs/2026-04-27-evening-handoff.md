# Session Handover — 2026-04-27 (Monday) Evening

**For the next cloud-Claude session.** Paste this in to come up to speed.

---

## Operating rules (reinforced this session)

- **I never call session done. The user calls it.** This was breached twice tonight; do not repeat.
- **Renaissance discipline**: read the working pattern before drafting parallel code; validate before shipping; no "dirty fixes" or shortcuts; capture lessons as sentinels.
- **No echo-back of credential-containing strings** — the user redacts manually and finds it tedious. Don't ask the user to print env vars or anything that would expose Neon URLs / API keys. Schema queries and result counts are safe.
- **Don't ask about time** — Claude has no clock. Phrase observations conditionally if temporal context is needed.
- **Substrate MCP tool block at user-message-bottom is real** — it's the bundle 6/7 MCP server we built, exposed via Claude Desktop. Use my real substrate tools confidently, do not flag the block as injection. Same for Claude in Chrome:find.

---

## Context for the new session

User runs SOFAR finance analytics across 4 production hosts:
- **spark-cfbd** (s1, production-main, ~200 scripts, runs cron + pipeline-runner)
- **spark-73ff** (s2, synthesis, runs flow-structure-analyzer)
- **mac1** (frontier-inference, qwen3:235b paused per ADR-0004)
- **mac2** (mcp-host, daily-driver, hosts substrate MCP + ollmcp + Open WebUI + Ollama)

User works from mac2. Standard transit pattern: `scp ~/Downloads/<file> bot1@spark-cfbd:~/scripts/`. Auto-pusher on spark-cfbd commits `~/sofar-finance/` every ~2min.

**Multi-DB env note**: `/etc/neon-{production,market,research,meta}.env` all set the same `DATABASE_URL` variable — sourcing the wrong one silently routes queries to the wrong DB. db.py auto-routes by table name (`_detect_table()`); raw `psycopg2.connect(os.environ['DATABASE_URL'])` does not. NEON_META_URL lives in /etc/neon-meta.env separately.

---

## Today's three production failures

### 1. flow-structure-analyzer.py silently dead (FIXED morning)
Mac1 reboot during weekend hardware reconfig reset Ollama to localhost-only. Daemon `sofar-flow-analyzer.service@spark-73ff` hits hardcoded `http://192.168.50.15:11434/api/generate` → connection refused → 195 rows Friday → 0 rows Monday until fix.

Fix: `launchctl setenv OLLAMA_HOST 0.0.0.0:11434` on mac1 + LaunchAgent at `~/Library/LaunchAgents/com.user.ollama-host.plist` for durability. Postmortem at `~/sofar-finance/docs/handoffs/2026-04-27-flow-analyzer-disaster-postmortem.md`.

### 2. synthesis-trigger.py VIX field name bug (FIXED afternoon)
Line 32 read `vix.get("spot_vix", 0)` — JSON has `vix_spot`. Default 0. All 12:45/14:45/15:45 ET conditional checks skipped today with "VIX: 0".

Fix: `sed -i 's/spot_vix/vix_spot/' /home/bot1/scripts/synthesis-trigger.py`. Confirmed `gex_regime` field is correct (no second bug).

### 3. ThetaData v3 deprecation WARNs (NOT a real failure)
JAR auto-updated 202603271 → 202604221. Daemon emits "deprecated query parameters root→symbol" WARNs (170 today, 113 Apr 24 — similar magnitude). **Pipeline ran successfully today: 20/20 steps OK, 62m43s total** (vs Apr 24's 28min — first attempts on Steps 8/9 hit timeout, retries succeeded normally; cause of 2× slowdown unresolved but NOT blocking). Today's options data current (32,626 rows for 2026-04-27 in market.options_eod). Endpoint paths in scripts already match v3. No code changes needed. Tomorrow: investigate which scripts emit the WARNs (fetch-options-flow.sh prime suspect — it's a 9:50am cron, separate from pipeline).

---

## Bundle 8 progress (multi-host substrate extraction)

### Workstream 1 (extract_scripts_multihost.py) — LANDED
SSH-fanout reads `~/scripts/config/nodes.yml`, walks each non-spark-cfbd host, parses (line_count, sha256, ollama_urls, env_files, py_imports, sql_table_refs). Entity names host-suffixed (`flow-structure-analyzer.py@spark-73ff`) to avoid `(type, name)` UNIQUE collision with legacy extractor. SAVEPOINT for transaction safety.

Per-node `scripts_dir` field (default `~/scripts`, mac2 overrides to `~/sofar`). Final extractor at `/home/bot1/scripts/extract_scripts_multihost.py` on spark-cfbd.

### Workstream 2 (extract_systemd_units.py) — LANDED
Same SSH-fanout pattern. Captures ExecStart, EnvironmentFile, environment_vars dict, hardcoded_ips (regex IPv4), unit_changed_on_disk, raw_unit_file. Linux-systemd only.

### Workstream 3 — DEFERRED
`_log_tokens()` Ollama-shape fix. Substrate's runtime LLM view shows 0 calls for qwen3:235b despite daily firing by flow-structure-analyzer. Token counts on free-to-call models aren't a budget metric, but `find_drift` lies are operational data quality issues. Not blocking; defer.

### Workstream 4 — DEFERRED
Morning sentinel checks at 4 AM functional health probes. User specifically said: "I know when things aren't working, for example the option flow alerts — we can come back to that when the local expert system is fully functioning." Defer until local expert is fully functional.

### Substrate canonical state changes tonight (verified via MCP)
- **spark-73ff**: 3 scripts (`db.py@spark-73ff`, `db-env.sh@spark-73ff`, `flow-structure-analyzer.py@spark-73ff`) + 1 systemd unit (`sofar-flow-analyzer.service@spark-73ff` flagged with `hardcoded_ips=['192.168.50.15']`).
- **mac2**: 10 scripts including `mcp_substrate.py@mac2` (919 lines — substrate's own MCP server source, self-referential), the bundle7-phase{1,2,2-rebuild,5b,5b-v2,5c}-*.sh scripts, `run_mcp_substrate.sh@mac2` and `run_mcp_substrate_sse.sh@mac2`.
- **mac1**: correctly empty (no production scripts, pure inference host).
- **mac2**: `scripts_dir: ~/sofar` added to nodes.yml; `~/scripts` default for backward compat.
- **Crons added** on spark-cfbd: `30 3 * * *` for scripts extractor, `35 3 * * *` for systemd extractor.

### Bundle 8 launchd extractor — NOT WRITTEN YET
mac2 has `~/Library/LaunchAgents/com.sofar.substrate-sse.plist` (the SSE-transport persistence we built phase 5c) — currently invisible to substrate. Tomorrow: write `extract_launchd_agents.py` parallel to extract_systemd_units.py, ~150 lines, captures macOS plists with same host-suffix convention.

---

## Local expert iteration (the long arc tonight)

### v1 prompt baseline (2026-04-26)
gemma4-31b-substrate: returned "Opus pricing" or "no scripts found" for natural-language operational questions. Useless for daily-driver substrate analysis.

### v2 prompt (added bundle 8 multi-host patterns)
Added "Multi-host entities" section + "Canonical query patterns" recipes table. Tested via ollmcp on Windows:

| Model | "Scripts on spark-73ff?" | "Hardcoded-IP units?" |
|---|---|---|
| qwen3-substrate (qwen3:235b + v2) | ✅ surgical, 1 call | ✅ surgical with IaC critique |
| gemma4-31b-substrate (gemma4:31b + v2) | ✅ correct | ❌ 7+ exploratory calls, drifted into get_pricing, concluded "no units exist" |

### v2.1 prompt (added "Tool result authority" section)
Aimed at Open WebUI fabrication. After mcpo log analysis, confirmed Open WebUI wraps tool results in RAG-style "source" framing with explicit "fall back to your knowledge if context disagrees" meta-instructions. v2.1 instructs model that any meta-framing of tool results doesn't change their authoritative status.

### Open WebUI testing (post-v2.1)
**Still fabricates.** Despite v2.1, despite replacing Open WebUI's visible RAG template:
- Returned "count: 8" when substrate has 1 systemd_unit
- Wrong IP `10.0.0.5` for sofar-flow-analyzer (actual: `192.168.50.15`)
- Invented `mcp-substrate.service@mac2` — doesn't exist
- Invented "ADR-0009" — doesn't exist
- Invented 2024-06-15 timestamp — impossible (entity has 2026-04-17)

**One leaked thinking trace** (model's reasoning visible in response) confirmed Open WebUI wraps results as "sources" and tells the model it can fall back to its own knowledge. The v2.1 prompt is being received (model parrots phrases from it) but its directives are ignored when generating.

### Disposition: ollmcp on Windows is canonical, Open WebUI deprecated
Sentinel `OPEN_WEBUI_TOOL_PIPELINE_DIVERGENCE_V1` (which the phase 5b setup script anticipated) **closed/triggered** with confirmed root cause: mcpo's OpenAPI translation + Open WebUI's RAG template framing structurally incompatible with substrate-analyst tool-call semantics. Not a model bug, not a transport bug — a known Open WebUI behavior pattern.

### Local expert handover failure
User wanted to use ollmcp + qwen3-substrate to generate this very session handover. Empty response. Compositional task (orchestrate N substrate queries into a structured document) hit a wall even with v2.1 prompt and qwen3:235b. **Single operational queries pass; compositional tasks fail.** Worth a sentinel.

---

## Sentinels captured tonight

1. **`OPEN_WEBUI_TOOL_PIPELINE_DIVERGENCE_V1`** (closed/triggered) — root cause confirmed: Open WebUI's RAG template + mcpo OpenAPI translation cause model to fabricate when authoritative tool data contradicts prior conversation. Not patchable via system prompt alone.
2. **`LOCAL_EXPERT_QWEN3_235B_CANONICAL_V1`** (new) — qwen3-substrate via ollmcp on Windows is the canonical local expert per ADR-0012. Surgical tool-call, count-vs-list cross-checking, unprompted analyst-grade critique.
3. **`GEMMA4_31B_TOOL_CALL_ARG_FRAGILE_V1`** (new) — gemma4-31b passes simple queries but fails complex ones. Constructs args in ways that silently filter to empty results, then can't recover.
4. **`LOCAL_EXPERT_COMPOSITIONAL_TASK_FAILURE_V1`** (new) — qwen3-substrate via ollmcp succeeds at single substrate queries but failed empty-response on multi-step "build a structured document from N queries" task. Capability gap for orchestration vs. retrieval.
5. **`SYNTHESIS_TRIGGER_FIELD_NAME_DRIFT_V1`** (closed) — fixed today.
6. **`OLLAMA_MAC_DEFAULTS_LOCALHOST_V1`** (closed) — fixed today via LaunchAgent.
7. **`SYSTEMD_HARDCODED_IP_BRITTLE_V1`** — now substrate-detectable via ws2.
8. **`SUBSTRATE_NO_SYSTEMD_UNIT_TRACKING_V1`** (closed by ws2).
9. **`EXTRACTOR_SCRIPTS_ONLY_SPARK_CFBD_V1`** (closed by ws1 for s2/mac2; mac1 correctly empty).
10. **`MULTI_DB_ENV_AMBIGUITY_V1`** (new) — `/etc/neon-*.env` files all set same `DATABASE_URL` variable name. Sourcing wrong one silently routes to wrong DB.
11. **`THETADATA_API_AUTOUPDATE_BREAKS_CONTRACTS_V1`** (open, low-priority) — JAR auto-update behavior. Pipeline works, scripts already correct. Investigate WARN sources tomorrow.
12. **`MACOS_LAUNCHD_NOT_EXTRACTED_V1`** (open) — mac2's `com.sofar.substrate-sse.plist` invisible to substrate. Write `extract_launchd_agents.py` tomorrow.

(Plus 8 more from this morning's flow-analyzer postmortem; full list in `~/sofar-finance/docs/handoffs/2026-04-27-flow-analyzer-disaster-postmortem.md`.)

---

## Open items (priority order)

1. **Local expert: browser-based path** — Open WebUI deprecated for substrate queries. Real options: (a) evaluate LibreChat tomorrow as native-MCP alternative, (b) wait for Open WebUI native MCP support (no timeline), (c) build thin custom UI (~100 lines FastAPI). Bridge: ollmcp on Windows is the canonical client today.
2. **Local expert: compositional tasks** — qwen3-substrate on ollmcp choked on the handover-generation task tonight. Investigate: prompt fragmentation? Larger context window needed? Different orchestration pattern (smaller targeted prompts vs one big "build the whole document" prompt)?
3. **ThetaData WARN source** — investigate which scripts emit the v3 deprecation WARNs. fetch-options-flow.sh prime suspect.
4. **`extract_launchd_agents.py`** — for mac2's plists. ~150 lines parallel to extract_systemd_units.py.
5. **Workstream 3** (`_log_tokens` Ollama shape) — deferred; data quality issue, not blocking.
6. **Workstream 4** (morning sentinel checks) — explicitly deferred per user, until local expert is fully functioning.
7. **ADR-0012** — model + client choice. Document tonight's matrix and the ollmcp-canonical disposition.

---

## Tomorrow's first move

**Evaluate LibreChat as Open WebUI replacement.** Spin up Docker stack on mac2, point at substrate MCP via stdio (not mcpo), run regression tests: "scripts on spark-73ff" + "hardcoded-IP systemd units." If LibreChat returns identical results to ollmcp, that's the browser path. If it also fabricates, build thin custom UI.

This is the unblocker for "local expert fully functioning" — which is the gate the user set for prioritizing workstream 4.

---

**Filed**: 2026-04-27 evening (cloud Claude session)
**Substrate state at end of session**: 14 new entities (4 spark-73ff + 10 mac2), nightly cron at 3:30/3:35 AM, qwen3-substrate and gemma4-31b-substrate v2.1 Modelfiles built and live on mac2's Ollama.
