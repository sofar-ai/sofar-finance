# Postmortem — flow-structure-analyzer outage, 2026-04-27

**Date**: 2026-04-27 (Monday market open)
**Severity**: production-disaster
**Time-to-diagnose**: ~5 hours of cloud-Claude time (should have been ~15 minutes)
**Time-to-fix**: 30 seconds (one `launchctl setenv` + Ollama restart) once the root cause was found
**Per**: ADR-0006 four-layer continuity protocol

---

## Layer 1: What happened

### Timeline of the outage

- **2026-04-24 (Friday) ~20:40 UTC**: last successful flow_analysis row written. 195 rows for the day, normal cadence.
- **2026-04-25/26 (Sat/Sun)**: market closed. User did weekend reconfig: renamed a Mac, swapped a 10G switch (kept old one eventually).
- **2026-04-27 (Monday) ~04:30 ET**: user expected premarket SPX/SPXW flow analysis output. Saw nothing. flow-structure-analyzer cycles were silently failing every 15 minutes with `<urlopen error [Errno 111] Connection refused>`.
- **~07:48 ET**: user restarted flow-intelligence.py (different script, different problem — turned out to be unrelated)
- **~08:00 ET**: user opened cloud-Claude session to diagnose.
- **~13:00 ET**: cloud-Claude finally identified the broken script — `flow-structure-analyzer.py` on spark-73ff (S2)
- **~13:10 ET**: identified root cause — Ollama on mac1 bound to 127.0.0.1:11434 (localhost-only) instead of 0.0.0.0:11434 (LAN). Reboot during weekend reconfig reset the binding.
- **~13:15 ET**: fix applied — `launchctl setenv OLLAMA_HOST 0.0.0.0:11434` + Ollama restart.
- **~13:18 ET**: Mac1 confirmed listening on `*:11434`, spark-cfbd successfully fetched `/api/tags` over LAN.
- **~12:46 ET cycle**: flow-structure-analyzer's first successful cycle in 3+ days. flow_analysis table started filling again. HTML page recovered.

### What was broken (the root cause)

The script `/home/bot1/scripts/flow-structure-analyzer.py` runs on **spark-73ff (S2)** as systemd service `sofar-flow-analyzer.service`. Every 15 minutes during RTH it picks 5 symbols, queries flow_trades from Neon, builds aggregated structures, and calls **qwen3:235b on mac1** at the hardcoded URL `http://192.168.50.15:11434/api/generate` for analysis. Successful responses get inserted into the `flow_analysis` table in Neon market DB, which the HTML page reads via Vercel-deployed `/api/flow-analysis` endpoint.

The mac1 reboot during weekend reconfig reset Ollama's listening interface to its macOS default (127.0.0.1 only). The systemd unit's hardcoded IP was still resolvable (mac1 was up, ping worked), but Ollama's TCP listener wasn't accepting connections from non-localhost. Every cycle, every symbol, every call: `Connection refused`. 195 rows on Friday → 0 rows Monday.

### Why this took 5 hours instead of 15 minutes

The substrate had no record of `flow-structure-analyzer.py`. The extractor `extract_scripts.py` only walks `~/scripts/` on **spark-cfbd**. Production scripts on s2, mac1, mac2 are entirely invisible to substrate. Cloud-Claude spent hours investigating other scripts that DO exist in substrate — `flow-intelligence.py`, `intraday-synthesis-local.py`, `fetch-options-flow.sh`, `synthesis-trigger.py` — because those were the only candidates substrate could surface. Each was investigated, ruled out, and the search continued in the same blind spot.

The actual diagnostic path that worked: user said "it's on S2." Then SSH'd to spark-73ff, grep'd the local filesystem for "flow_analysis," found the script in 2 seconds. The systemd unit, the journal logs, and the localhost-only Ollama binding were then all observable in another minute. **The substrate didn't help; it actively hurt.**

---

## Layer 2: What was learned

### Primary finding: substrate coverage is wrong-shaped for production

Substrate's `extract_scripts.py` indexes one host's `~/scripts/` directory. Production architecture spans four hosts:
- **spark-cfbd (s1)** — production-main, ~200 scripts indexed
- **spark-73ff (s2)** — synthesis-tier, ZERO scripts indexed (today's broken script lives here)
- **mac1** — frontier-inference, ZERO scripts indexed
- **mac2** — MCP host, ZERO scripts indexed

The substrate is canonically wrong about which scripts exist. Today's outage was the consequence of acting on that wrong-but-confident-looking data. **Today's failure was foreseeable from substrate state alone if anyone had asked "where are the gaps."**

### Secondary findings (each is a real sentinel)

**`EXTRACTOR_SCRIPTS_ONLY_SPARK_CFBD_V1`** — confirmed today expensively. The most important production daemons live on hosts the extractor doesn't visit. Bundle 8 priority-1 work.

**`SUBSTRATE_RUNTIME_OLLAMA_SHAPE_MISSING_V1`** — `_log_tokens()` doesn't capture Ollama-shape responses. So even if substrate knew about flow-structure-analyzer.py, `substrate_find_llm_calls(model_id='qwen3:235b')` would still return "0 runtime calls in 30 days" because Ollama's response shape isn't logged. Today this produced false-negative diagnostics: substrate said "nothing has called gemma4:26b in 30 days" while flow_analysis had ~1000 rows from active cycles. **Substrate's runtime view is actively misleading**, not just incomplete.

**`OLLAMA_MAC_DEFAULTS_LOCALHOST_V1`** — the actual root cause. Ollama on macOS binds to 127.0.0.1:11434 by default. LAN exposure requires `OLLAMA_HOST=0.0.0.0:11434` set via `launchctl setenv`, which doesn't survive reboot without a LaunchAgent. Affects every Mac-targeted production daemon: `flow-structure-analyzer.py` (s2 → mac1), `intraday-synthesis-local.py` (s1 → s2 by design but could route to Mac in failover scenarios), and any future Mac-inference consumer.

**`SYSTEMD_HARDCODED_IP_BRITTLE_V1`** — `/etc/systemd/system/sofar-flow-analyzer.service` hardcodes `192.168.50.15:11434` instead of `mac1.local:11434`. The IP happened to stay constant (DHCP reservation or stable lease), but the binding-config change broke the connection silently. mDNS hostnames would have decoupled this from network state.

**`POST_HARDWARE_RECONFIG_VERIFICATION_CHECKLIST_V1`** — after any switch swap, Mac rename, or network change: ping every node from every node, curl every Ollama `/api/tags` from every consumer host, verify all systemd services on consumers still resolve their inference targets. This checklist would have caught today's outage Sunday afternoon. Without it, the failure surfaced 16 hours later when premarket flow analysis was needed.

**`MCP_SHOULD_DECLARE_COVERAGE_GAPS_V1`** — the MCP tool returned confident answers from incomplete data. `substrate_find_drift` showed "static-without-runtime" entries that had REAL runtime activity invisible to substrate. `substrate_search_entities` returned the scripts substrate knew about, with no signal that the most important script in the broken pipeline was missing. The MCP tool should detect and surface its own coverage limits — "I have no visibility into scripts on s2/mac1/mac2" — rather than answering past gaps with false confidence. Today this lesson has direct daily-driver implications: bundle 7's local LLM consumer would have made the same mistakes.

**`SUBSTRATE_NO_NETWORK_TOPOLOGY_V1`** — substrate doesn't track per-node network attributes (Ollama listening address, LAN binding state, resolution of host aliases to IPs, port-binding-survives-reboot status). The actual root cause today was a network/binding state, not a code state. Substrate has node entities with role attributes, but no infrastructure-state entities. Bundle 8 work: `node.attrs.ollama_listen_addr` extracted by probing `lsof -iTCP:11434 -sTCP:LISTEN` per node, refreshed daily.

**`SUBSTRATE_NO_SYSTEMD_UNIT_TRACKING_V1`** — `sofar-flow-analyzer.service` exists on s2's systemd, but isn't a substrate entity. Editing the unit file (changing the hardcoded IP, modifying ExecStart, etc.) is invisible to substrate's drift queries. Bundle 8 work: extract `systemd_unit` entities with `ExecStart`, `EnvironmentFile`, `Environment` attrs, last-modified timestamps.

### Methodology lesson — the most important one

Cloud-Claude (this session) defaulted to substrate-first diagnosis throughout the morning. When substrate returned no answer, the response was to query substrate harder, with different parameters, with relationship walks, with cost estimates — all in the same blind spot. **The right move was to ask early: "is this script in substrate at all?" and if not, "what's the canonical inventory of scripts that AREN'T in substrate?"**

The user's correction — "it's on S2" — was the diagnostic that resolved everything. That single sentence carried more information than substrate had to give. Bundle 8 needs an MCP-side answer to "what isn't in substrate" — both for the cloud-Claude consumer and the local-LLM-bundle-7 consumer.

---

## Layer 3: What's pending (action items, ranked)

### Immediate — must commit before next session

1. **Add today's eight new sentinels to bundle 7 evening handoff** (the file already drafted at `~/sofar-finance/docs/handoffs/2026-04-26-evening-handoff.md`) before committing. Sentinels: `EXTRACTOR_SCRIPTS_ONLY_SPARK_CFBD_V1`, `SUBSTRATE_RUNTIME_OLLAMA_SHAPE_MISSING_V1`, `OLLAMA_MAC_DEFAULTS_LOCALHOST_V1`, `SYSTEMD_HARDCODED_IP_BRITTLE_V1`, `POST_HARDWARE_RECONFIG_VERIFICATION_CHECKLIST_V1`, `MCP_SHOULD_DECLARE_COVERAGE_GAPS_V1`, `SUBSTRATE_NO_NETWORK_TOPOLOGY_V1`, `SUBSTRATE_NO_SYSTEMD_UNIT_TRACKING_V1`.

2. **File this postmortem** to `~/sofar-finance/docs/handoffs/2026-04-27-flow-analyzer-disaster-postmortem.md` and git commit alongside bundle 7 artifacts.

3. **Make the mac1 LAN binding survive reboot.** The current fix (`OLLAMA_HOST=0.0.0.0:11434 nohup ollama serve &`) doesn't survive reboot. Install the LaunchAgent on mac1:
   ```
   ~/Library/LaunchAgents/com.user.ollama-host.plist
   ```
   Sets OLLAMA_HOST at login. Ollama GUI app inherits the env at startup.

4. **Replace hardcoded IP in `sofar-flow-analyzer.service`.** On spark-73ff:
   ```
   sudo sed -i 's|192.168.50.15|mac1.local|' /etc/systemd/system/sofar-flow-analyzer.service
   sudo systemctl daemon-reload
   sudo systemctl restart sofar-flow-analyzer
   ```
   mDNS resolution decouples from DHCP and IP reassignment. Also clears the "unit changed on disk" warning we saw today.

### Tomorrow — high-leverage diagnostic prevention

5. **Multi-host script extraction.** Modify `extract_scripts.py` to walk `~/scripts/` on every node listed in `~/scripts/config/nodes.yml` via SSH, tagging each script entity with its `host` attribute. Closes the script invisibility gap. Estimated effort: half-day. **Without this, the next outage of this shape will take just as long.**

6. **Document flow-structure-analyzer.py as a substrate entity manually** until #5 lands. At minimum: name, host (s2), invocation, LLM target (mac1's qwen3:235b), output table (flow_analysis), cadence (15min RTH). One-time write via direct DB insert. Costs 5 minutes, gives tomorrow's session canonical knowledge of today's most important production script.

### Bundle 8 — design spec needed

7. **Substrate write capability + multi-host extractor agents** (Option B from this session's discussion): each host runs its own extractor cronjob, writing to substrate over the network. Resilient to SSH failures, lets each host take responsibility for its own canonical state. Day of work plus the bundle-7-style auth model design.

8. **Ollama runtime audit logging.** Either patch `_log_tokens()` to handle Ollama's response shape, or ship a separate `ollama_audit.py` library that production daemons import. Closes the runtime view's actively-misleading state. Until fixed, all substrate runtime queries silently lie about Ollama-driven scripts.

9. **Infrastructure entity types.** Add `systemd_unit` and `ollama_endpoint` as substrate entity types with attrs:
   - `systemd_unit.attrs`: ExecStart, EnvironmentFile, Environment dict, last-modified, current state
   - `ollama_endpoint.attrs`: host, listen_addr, port, models_loaded, listen_addr_persistent (LaunchAgent installed?)
   Drift queries can then surface "unit edited but not reloaded" and "endpoint became localhost-only" before the consequences hit production.

10. **MCP-coverage self-knowledge.** The MCP tool should expose a `substrate_coverage` query that returns: "extractor X covers Y; doesn't cover Z." When a consuming LLM asks "find script foo," and substrate returns nothing, the natural follow-up should be "would foo be covered by current extractors? If no, here's the gap." This lesson goes back into bundle 7's local LLM system prompt as well.

### Strategic / backburner

11. **A "morning bootstrap drift" cron**: every morning at 4 AM, verify that yesterday's daemons were producing data through close. Specifically check: flow_analysis row count > 100 for the prior session, ai-synthesis-intraday for prior session, cron-health.json freshness, SSH reachability across all 4 production hosts, Ollama LAN binding on each Mac. Email/Discord on failure. **This would have surfaced today's outage at 04:00 instead of having you discover it at 07:45.**

---

## Layer 4: What's broken or fragile

### Operational fragility surfaced today

**Mac1 Ollama LAN binding is currently held by a `nohup` process.** Any reboot, network reconfig, or process death loses the binding. The LaunchAgent fix (action item #3) is REQUIRED before reboot, not optional. Until then, the system is one Mac-restart away from re-disaster.

**Two other systemd units on s2 may have similar hardcoded-IP issues**: anything that hits mac1 or mac2's Ollama directly. Worth a sweep:
```
ssh bot1@spark-73ff.local 'grep -rE "192\.168\.|mac.\.local" /etc/systemd/system/sofar-*.service'
```

**The flow_analyzer rotation watchlist source is unknown.** The script picks 5 symbols per cycle from a larger pool — but where the pool comes from (DB query? config file? unusual-flow output?) wasn't traced today. Worth understanding because if that source is also fragile, it's the next failure mode.

### Substrate drift to watch

**Today's investigation populated NO new substrate entities.** flow-structure-analyzer.py is still invisible. mac1's Ollama listen-addr is still untracked. The systemd unit edit (action item #4 above) won't show up in drift queries. **Tomorrow's bootstrap report will look the same as today's: complete-but-wrong.**

**bundle 7's ADR-0012 daily-driver assignment has new evidence working against it.** The local LLM (gemma4-31b-substrate / qwen3:235b) would have made the same mistakes today, because they consume the same substrate. Until bundle 8 lands, neither cloud nor local analyst can diagnose s2/mac1/mac2 issues from substrate.

### Process notes for the next session

- The user spent multiple turns redirecting me away from wrong scripts (intraday-synthesis-local, fetch-options-flow, flow-intelligence, synthesis-trigger). Each redirect was correct. **In retrospect, the right response to the first "wrong script" was to stop searching substrate and ask the user "what host does the right script live on?"** Cloud-Claude defaulted to keep-using-the-tool-I-have. Bundle 7 local LLM would do the same.
- "It's on S2" was the highest-information sentence of the entire investigation. Shape of question that elicits this in 5 minutes instead of 5 hours: **"Before I keep searching, can you tell me what host the script runs on, and roughly what it does?"** That's the diagnostic-discipline fix for the human-AI loop.
- The user explicitly named this a "real live test of the MCP tool" that "FAILED miserably." The failure was real. Bundle 8 is the answer.

---

## Cross-references

- ADR-0012 (bundle 7 local LLM consumer): captures the existing substrate coverage gaps as future work, but understates the daily-driver impact. Worth amending after this postmortem to make bundle 8 priority work explicit.
- Bundle 7 evening handoff (2026-04-26-evening-handoff.md): doesn't yet include today's sentinels. Update before commit.
- Bundle 6 setup (`mcp_substrate.py`): no changes needed; the issue isn't in the substrate or MCP server, it's in extractor coverage upstream.
- ADR-0006 (continuity protocol): this postmortem follows the four-layer pattern.
- ADR-0008 (defer Exo, Macs as independent hosts): the architecture this ADR endorsed (independent hosts) is the architecture that today's outage happened within. Not wrong, but the operational consequences (per-host Ollama binding fragility, multi-host extractor need) weren't fully scoped.

---

**Filed**: 2026-04-27 13:15 ET
**Filed by**: cloud-Claude session via human user
**Next action**: commit alongside bundle 7 artifacts; bundle 8 design spec is the real follow-through.
