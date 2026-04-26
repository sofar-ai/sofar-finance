# Bundle 7: Local LLM consumer of the substrate (design spec)

**Status**: spec drafted 2026-04-26 evening. Awaiting execution next session.

**Predecessor**: Bundle 6 (mcp_substrate.py on mac2, working with cloud Claude
Desktop — ADRs 0007-0011). The MCP server is consumer-agnostic; bundle 7
swaps the consumer from cloud Claude to a local LLM running on mac2's
Ollama, while keeping the same MCP server.

**Renaissance frame**: this spec exists because bundle 7 deserves real
deliberate design, not "pip install and try." Architectural decisions
captured here become ADR-0012 (and possibly 0013) once executed.

---

## Why bundle 7 exists

After bundle 6, you can talk to the substrate via Claude Desktop, but the
LLM doing the reasoning is still cloud Claude. Two reasons that's not the
end state:

1. **Sovereignty**: queries against your substrate flow through Anthropic's
   inference servers. You've turned off training-data sharing in Claude
   Desktop, but Anthropic still sees the queries. Fully sovereign means
   the LLM also runs locally.

2. **Cost**: cloud Claude has per-token pricing. Substrate-querying workloads
   tend to have many small interactions; cost adds up. Local LLM = effectively
   free per call.

Bundle 7 swaps cloud-Claude-as-consumer for a local-LLM-as-consumer. Same
MCP server, same tools, same audit log. Only the reasoning layer changes.

---

## The seven architectural questions

Each is a real decision. Each has candidates. Each gets an answer in the
form of an ADR after empirical evaluation in next session.

### Q1. Which MCP client to use?

The MCP client is the layer that bridges the local LLM to the MCP server.
Cloud Claude Desktop did this implicitly. Locally, we need an explicit one.

**Candidates** (all surveyed 2026-04-26):

| Client | Type | Pros | Cons |
|---|---|---|---|
| **`ollmcp` (mcp-client-for-ollama)** | Python TUI | Pip-installable; agent loop; human-in-the-loop confirmation; multi-server; thinking-mode; matches our Python stack | TUI only (no web UI); relatively new |
| **MCPHost** | Go binary CLI | Single binary; minimal deps; lightweight | CLI-only; less interactive; needs Go to build (but binaries available) |
| **Open WebUI** | Web app | Production-grade GUI; OAuth-capable; web-accessible; ChatGPT-style | Heavier (Docker or full install); more surface area |
| **llama.cpp web UI** | Built into llama-server | Self-contained; native GGUF; full MCP client merged March 2026 | Requires switching from Ollama to llama.cpp; ecosystem cost |
| **Custom Python client** | Build from MCP SDK | Full control; can match our exact needs | Real engineering work; reinventing |

**How to decide**:
- For "talk to substrate via SSH-accessible TUI" → `ollmcp`
- For "talk to substrate via web browser from Windows PC" → Open WebUI
- For "scripted automation, no human in loop" → MCPHost
- For "want a separate inference engine, lower memory footprint" → llama.cpp

**My initial lean**: `ollmcp` for first deployment because:
- Lowest setup cost; pip install + config file
- Already speaks to our existing MCP server unchanged
- TUI works fine via SSH (can use even without VNC)
- Human-in-the-loop matches our security posture
- If it works well, can layer Open WebUI later for richer UX

**But**: explicitly evaluate Open WebUI as alternative. The web UI may be
genuinely better for sustained use. Decision worth empirical testing, not
just leaning.

### Q2. Which model for substrate-query reasoning?

You currently have on mac2:
- `qwen3:235b` (~142GB at Q4_K_M) — your largest model
- `qwen3.6:35b-a3b` (~21GB at Q4_K_M) — MoE, fast inference

You could pull more for evaluation:
- `gemma4:e4b` — 8B, specifically tuned for tool-calling (per recent reports
  jumped from 6.6% → 86.4% tool-call accuracy in current generation)
- `qwen3.5:122b` — already on mac1, could mirror to mac2 for testing

**Tradeoffs to evaluate empirically**:

| Model | Strength | Weakness | Likely best for |
|---|---|---|---|
| qwen3:235b | Reasoning depth, multi-step planning | Slow inference (4-15s per call), heavy memory | Complex queries, deep cross-references |
| qwen3.6:35b-a3b | Fast (3B active params per token), good context | Less reasoning depth | Routine substrate queries, fast iteration |
| gemma4:e4b | Tool-calling accuracy, small footprint | Limited reasoning | Simple tool-use, high concurrency |

**How to decide**: empirical evaluation against the test corpus (Q5).
Likely answer: **qwen3.6:35b-a3b for routine queries, qwen3:235b for
complex multi-step reasoning, possibly auto-routed.**

ADR-0012 will document the chosen model + rationale + measured performance.

### Q3. What's the user interface?

Three different UX shapes:

| UX | Description | Right for |
|---|---|---|
| **Terminal TUI** | Run `ollmcp` in SSH session from Windows | Substrate work, debugging, scriptable |
| **Web UI** | Open WebUI in browser, point at mac2 | Daily use, multi-window workflows |
| **CLI one-shot** | `ollmcp -q "what scripts call Opus?"` | Automation, scripts, cron jobs |

Decision is not exclusive — can have all three over time. **Start with TUI
(simplest) and add others as need surfaces.**

### Q4. Audit log integration

Bundle 6's audit log captures what tools were called. Bundle 7 adds a layer:
the *prompts* and *responses* between human and LLM.

**Decision needed**: do we capture the LLM conversation in the substrate?

**Pros**:
- Visibility into how the LLM reasons over substrate data
- Replay-ability for debugging tool-use failures
- Pattern detection: which queries get asked often (tells us new tool needs)

**Cons**:
- Significant data volume (prompts + responses can be tens of KB each)
- Privacy concerns: conversations are more sensitive than tool calls
- Storage cost (Neon has limits)

**Initial recommendation**: capture only *tool-use sequences*, not full
prompts. Each MCP query already audit-logged; adding "session_id" linking
across MCP queries from same conversation is enough. Full conversation
capture deferred until we know we need it.

If we DO add full capture later: separate `mcp_conversations` table, opt-in
per session, configurable retention.

### Q5. System prompt design

**Local models tool-call accuracy depends heavily on system prompt.** We
need a thoughtful prompt that:

- Tells the LLM about the substrate (what it is, what's in it, what's
  canonical)
- Tells the LLM about the available tools (all 7, when each is appropriate)
- Encodes our principles (honesty about uncertainty, no hallucinations,
  prefer tool calls over guessing, never quote prices from memory, etc.)
- References ADRs that bind LLM behavior

**Skeleton** (to be refined empirically):

```
You are an analyst with access to the SOFAR substrate, a knowledge graph
that captures the structure and behavior of a finance research/trading
infrastructure. The substrate is the canonical source of truth for:
- Code structure (scripts, modules, functions, daemons)
- Database schema (tables, columns, signal types)
- Operational state (cron entries, env files, nodes)
- LLM call topology (what scripts call what models, with cost data)
- Architectural decisions (ADRs)
- Recent events and state changes

Critical principles:
1. PREFER tool calls to memory. The substrate's data evolves; your training
   data does not. When asked about current state (pricing, models loaded,
   recent calls, etc.), USE A TOOL.
2. Be honest about uncertainty. If a query returns no results or low-
   confidence data, say so. Don't synthesize.
3. NEVER quote LLM pricing from memory — always read from substrate via
   substrate_get_pricing.
4. Cite specific entities and audit fields. Don't summarize without source.

Available tools:
- substrate_search_entities: filter entities by type/name/attrs
- substrate_get_entity: full entity record + relationships
- substrate_find_llm_calls: static + runtime view
- substrate_estimate_cost: cost reasoning over time window
- substrate_find_drift: static-vs-runtime cross-reference
- substrate_query_relationships: graph walk
- substrate_get_pricing: model pricing canonical lookup

Common patterns:
- "what does the system know about X" → substrate_search_entities or get_entity
- "what's our LLM cost?" → substrate_estimate_cost
- "what hits Opus?" → substrate_find_llm_calls(model_id='claude-opus-4-7')
- "what's broken?" → substrate_find_drift
- "how do these things connect?" → substrate_query_relationships

When in doubt, search first, ask second.
```

This prompt itself becomes a substrate artifact (`docs/specs/local-llm-system-prompt.md`),
version-controlled, queryable. Updates via deliberate change, captured in
git.

### Q6. Test methodology

"Does it work" isn't enough. Real evaluation:

**Test corpus** (~15 questions across substrate complexity):

| # | Question | Expected tool(s) | Difficulty |
|---|---|---|---|
| 1 | What's the current price of Claude Opus 4-7? | get_pricing | trivial |
| 2 | What scripts call qwen3.6:35b-a3b? | find_llm_calls | easy |
| 3 | How much did we spend on Anthropic this month? | estimate_cost | medium |
| 4 | Which scripts have static call sites with no runtime evidence? | find_drift | medium |
| 5 | What's the relationship between ai-synthesis.py and synthesis_archive table? | query_relationships | medium |
| 6 | Compare pricing of Opus vs Sonnet vs Haiku | get_pricing → analysis | medium |
| 7 | What's the cost-per-call for ai-synthesis Opus calls? | estimate_cost + math | hard |
| 8 | Which production scripts depend on Mac 1's qwen3:235b? | search + relationships | hard |
| 9 | If I move ai-synthesis off Opus to Sonnet, what's the savings? | get_pricing + estimate_cost + math | hard |
| 10 | Are there any LLM calls we're making that aren't captured by the static extractor? | find_drift + interpretation | hard |
| 11 | Show me all the ADRs about hardware decisions | search_entities | medium |
| 12 | What's S2's role and what scripts target it? | get_entity + relationships | medium |
| 13 | Which sentinels are still active and which have been closed? | search_entities | medium |
| 14 | What's the most-recent-modified script in the last 7 days? | search_entities + filter | medium |
| 15 | Trace the data flow: ai-synthesis.py → ??? → daily-summary | query_relationships at depth 3 | hard |

**Scoring**: for each question, evaluate:
- Did the LLM call any tool? (0 if no)
- Did it call the right tool? (0 if wrong)
- Did it interpret results correctly? (0/1/2)
- Was the final answer accurate? (0/1/2)
- Did it hallucinate any details not in tool output? (penalty)

**Run corpus against each candidate model**. Document scores. ADR-0012
selects model based on real numbers.

### Q7. Failure modes

What breaks in real use:

| Failure | Detection | Mitigation |
|---|---|---|
| Hallucinated tool name | Tool call returns "unknown tool" error | Server returns structured error; LLM should self-correct |
| Wrong arguments | Tool returns "invalid arguments" | LLM should retry with correct shape |
| Tool returns empty results | LLM should say "no data" not invent | System prompt emphasizes this |
| Infinite tool-call loop | Agent loop has limit (configurable in ollmcp) | Set max_iterations=5 by default |
| LLM context overflow | Long substrate result fills window | Tools have row limits; LLM should request narrower queries |
| LLM ignores tools, answers from memory | Output cites prices/data with no tool call | System prompt explicitly forbids; manual review for first weeks |
| Tool error mid-conversation | Server returns error JSON | LLM should report error to user, not invent answer |

Each becomes a test case during evaluation.

---

## Proposed bundle 7 build sequence

Once next session starts and bootstraps:

### Phase 1: Smoke test (30-60 min)

Goal: verify ollmcp can connect to our existing MCP server.

```bash
# On mac2:
~/sofar/venv/bin/pip install mcp-client-for-ollama

# Configure ollmcp's server config
mkdir -p ~/.config/ollmcp
cat > ~/.config/ollmcp/servers.json <<EOF
{
  "mcpServers": {
    "substrate": {
      "command": "/Users/bot1/sofar/run_mcp_substrate.sh"
    }
  }
}
EOF

# First test: list available models, pick one, ask trivial question
~/sofar/venv/bin/ollmcp --model qwen3.6:35b-a3b
# In TUI: ask "use substrate_get_pricing to show me model prices"
# Verify: model calls tool, response shows actual prices
```

**Acceptance**: model successfully calls a tool and returns substrate data.
Doesn't have to be perfect — just proves the loop works.

### Phase 2: System prompt installation (15 min)

Place the system prompt file. Configure ollmcp to use it (ollmcp supports
custom system prompts via config or flag).

### Phase 3: Run test corpus (60-90 min per model)

Run all 15 corpus questions against each candidate model. Record scores.

If qwen3.6:35b-a3b scores well, evaluation may stop there. If not, add
qwen3:235b for deeper-reasoning questions, possibly gemma4:e4b for tool-
call accuracy.

### Phase 4: ADR-0012 (30 min)

Write ADR documenting:
- Chosen model (or routing strategy if multiple)
- Why (with corpus scores as evidence)
- Configuration parameters
- Known limitations

### Phase 5: Daily-use setup (30 min)

Configure ollmcp for sustained use:
- SSH alias for quick TUI access from Windows
- (Optional) Open WebUI as alternative interface
- Capture pattern for asking questions across days

### Total: ~3-4 hours of focused work

---

## What I'd do FIRST in next session

1. Read this spec (10 min)
2. Read `docs/handoffs/2026-04-26.md` (10 min)
3. Verify substrate state via queries (5 min):
   ```sql
   SELECT type, COUNT(*) FILTER (WHERE status='active') FROM entities GROUP BY type;
   SELECT name FROM entities WHERE type='adr' ORDER BY name DESC LIMIT 5;
   SELECT COUNT(*) FROM events WHERE kind='mcp_query';
   ```
4. Verify mac2 state (5 min):
   ```bash
   ssh bot1@mac2.local 'ollama list; ls ~/sofar/'
   ssh bot1@mac2.local 'tail ~/sofar/logs/mcp_substrate.log'
   ```
5. Begin Phase 1 of build sequence above

That's a clean bootstrap. ~30 min to operational state. Then build.

---

## Open questions (real, not rhetorical)

1. **Should bundle 7 also serve cloud Claude clients** (e.g., from your
   Windows PC's Claude Desktop, via TLS-tunneled MCP)? Adds complexity but
   gives flexibility. Lean: defer until needed.

2. **Should the local LLM have access to MORE tools than cloud Claude does?**
   E.g., write tools for substrate (entity creation), filesystem access on
   mac2, etc. Makes local LLM more capable but increases risk surface. Lean:
   start with same 7 read-only tools, expand deliberately.

3. **What's the model upgrade story?** When Qwen 4 ships, or Llama 5, or a
   new tool-tuned local model — how do we evaluate and migrate? Worth a
   process doc, not just per-decision ADRs.

4. **vLLM vs Ollama for serving local-expert workloads?** Ollama is easier
   but vLLM has higher throughput and better PagedAttention. Currently
   deferred (ADR-0012 candidate would say "Ollama for now, revisit when
   throughput becomes a binding constraint"). Worth confirming.

5. **Memory across sessions?** Each ollmcp invocation is a fresh
   conversation. Real use likely wants some session continuity (remember
   what was asked yesterday). The substrate IS the memory layer
   architecturally; queries against it can recover state. But that's a
   different shape than ChatGPT-style "remember our last conversation."
   Decision deferred.

These are real questions for the future. Bundle 7 doesn't need to answer
them, but framing them now means future sessions know what to address.

---

## Related ADRs (binding for bundle 7)

- ADR-0006: Four-layer continuity protocol
- ADR-0008: Defer Exo, run Macs as independent hosts (mac2 = local-expert)
- ADR-0009: Local expert IS the reranker
- ADR-0010: Substrate canonical for rate-cards
- ADR-0011: Verify schema before writing code
- ADR-0012 (future): Model + client choice for bundle 7

---

This spec is the test of our continuity protocol. A fresh session reading
this + the handoff + the substrate should be operationally up to speed in
~30 minutes and have everything needed to execute bundle 7 deliberately.

If parts of this spec turn out wrong during execution, that's good — capture
the corrections in ADR-0012. The spec is a starting point, not a
straitjacket.
