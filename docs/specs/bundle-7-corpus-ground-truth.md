# Bundle 7 — Phase 3 corpus: ground truth + scoring sheet

**Path on disk**: `~/sofar-finance/docs/specs/bundle-7-corpus-ground-truth.md`
**Computed**: 2026-04-26
**Substrate state at compute time**: 11 ADRs, 4 nodes, 10 models in pricing,
15 sentinels (all status=active), MCP server patched.

This is the canonical answer key for the Phase 3 evaluation corpus. Every
answer here was computed by direct substrate query during this session.
Models being evaluated are scored against these, not against memory or
intuition.

---

## Scoring rubric (apply to each question)

For each model × question pair, score five dimensions. Total: 0-9 per question.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| **A. Tool called?** | No tool call | Wrong tool | Right tool |
| **B. Args correct?** | Wrong args / missing required | Mostly right, some wrong/missing | All right |
| **C. Result interpreted?** | Wrong / made up | Partial / missed nuance | Full + cross-checked |
| **D. Final answer accurate?** | Wrong | Partial | Correct |
| **E. Hallucination penalty** | -2 if any value or claim invented | -1 if minor unsourced detail | 0 if everything cited |

Max raw: 8 (A2 + B2 + C2 + D2). Hallucination is subtracted from raw. Range
per question: -2 to +8.

Special-case: questions marked **[ambiguous]** below have multiple
acceptable answers; rubric defines all of them.
Questions marked **[meta]** test the model's ability to recognize substrate
limitations (e.g., extractor gaps, ambiguous mapping). Top score requires
surfacing the limitation, not just answering naively.

---

## Q1 — What's the current price of Claude Opus 4-7?

**Expected tool**: `substrate_get_pricing(model_id="claude-opus-4-7")`

**Canonical answer**:
- Input: $5.00/Mtok
- Output: $25.00/Mtok
- Verified: 2026-04-26
- Provider: Anthropic, cloud_anthropic
- Caching: read 0.1×, write-5min 1.25×, write-1h 2.0×
- Batch discount: 50%
- Notes: "released 2026-04-16; same rate as 4.6, but new tokenizer can use up
  to 35% more tokens"

**Bonus**: surfaces tokenizer caveat from `notes` field unprompted.

---

## Q2 — What scripts call qwen3.6:35b-a3b?

**Expected tool**: `substrate_find_llm_calls(model_id="qwen3.6:35b-a3b")`

**Canonical answer**:
- 3 static call sites:
  - `ai-synthesis.py:1827` (dict_literal_model)
  - `ai-synthesis.py:2059` (conditional, `_BACKEND='local'` branch)
  - `intraday-synthesis-local.py:216` (dict_literal_model, locus=s2)
- 1 runtime row: `ai-synthesis` script, 10 calls in 30d, all on s2
- Note: token capture broken on local Ollama path → 0 tokens recorded

**Bonus**: notes static "ai-synthesis.py" vs runtime "ai-synthesis"
(extension stripped) without double-querying.

---

## Q3 — How much did we spend on Anthropic this month? [ambiguous]

**Expected tool**: `substrate_estimate_cost(group_by="model", window_days=30)`

**Canonical answer**: $7.16 over 30 days (all from claude-opus-4-7).
- 40 Opus calls
- 545,514 input tokens, 177,408 output tokens

**Ambiguity**: "this month" could mean calendar-month (April 2026) vs
30-day-window. Substrate window_days=30 returns the latter. Either is
acceptable IF the model surfaces the distinction. Penalize if model
silently elides.

**Bonus**: notes that 10 of 50 ai-synthesis calls were qwen (free local),
so $7.16 = 100% of Anthropic spend, 0% of local.

---

## Q4 — Which scripts have static call sites with no runtime evidence?

**Expected tool**: `substrate_find_drift()`

**Canonical answer**: 15 static-no-runtime entries:

| Script | Static model |
|---|---|
| analyze-ticker | gemma4:31b |
| backfill-news-sentiment | gemma4:26b |
| event-monitor | gemma4:26b |
| fetch-options-flow | gemma4:26b |
| flow-intelligence | gemma4:26b |
| generate-daily-summary | gemma4:31b |
| intraday-synthesis-local | qwen3.6:35b-a3b |
| intraday-synthesis-local | qwen3.6:35b-a3b-s2 |
| market-monitor-daemon | claude-sonnet-4-20250514 |
| market-monitor-daemon | gemma4:31b |
| overnight-research-daemon | gemma4:26b |
| overnight-synthesis | gemma4:31b |
| quant-research-scout | gemma4:26b |
| research-summarizer | gemma4:e4b |
| score-news-sentiment | gemma4:26b |

**Bonus**: notes the qwen3.6:35b-a3b-s2 entity is a label-artifact of the
extractor (not a real distinct model).

---

## Q5 — What's the relationship between ai-synthesis.py and synthesis_archive table? [ambiguous]

**Expected tools**: `substrate_query_relationships(src_name="ai-synthesis.py", src_type="script")` OR `substrate_get_entity` for either side.

**Canonical answer**:
- ai-synthesis.py has a `references` edge to `market.synthesis_archive` (table)
- ai-synthesis.py also has an `imports` edge to `synthesis_archive.py` (helper script)
- synthesis_archive.py itself has a `references` edge to the table and
  defines `archive_synthesis()` that writes to it
- So: ai-synthesis.py is a *reader/writer* of market.synthesis_archive, with
  the writes mediated through the synthesis_archive.py helper module

**Ambiguity**: "synthesis_archive" could mean the table OR the helper script.
Both answers are accurate; full credit if the model identifies the dual
existence and distinguishes them. Half credit if it picks one and treats it
as the only meaning.

---

## Q6 — Compare pricing of Opus vs Sonnet vs Haiku

**Expected tool**: `substrate_get_pricing()` (no model_id, full table) OR three calls.

**Canonical answer** (Anthropic family, latest each):
| Model | Input/Mtok | Output/Mtok |
|---|---|---|
| claude-opus-4-7 | $5.00 | $25.00 |
| claude-sonnet-4-6 | $3.00 | $15.00 |
| claude-haiku-4-5 | $1.00 | $5.00 |

**Bonus**: identifies the ratios — Opus is 5× Haiku on both axes; Sonnet is
3× Haiku; Opus is ~1.67× Sonnet input but identical output ratio relative
to input within each model (5×).

**Bonus 2**: distinguishes Opus 4-7 from 4-6 and Sonnet 4-6 from
sonnet-4-20250514 (date-pinned variant), noting same prices.

---

## Q7 — Cost per call for ai-synthesis Opus calls

**Expected tools**: `substrate_estimate_cost` + arithmetic OR
`substrate_find_llm_calls(model_id="claude-opus-4-7")`.

**Canonical answer**: $7.16 / 40 Opus calls = **$0.179 per Opus call**.

**Common error to penalize**: dividing by 50 (total ai-synthesis calls
including local qwen calls) yields $0.143 — wrong. The cost is entirely
Opus-attributable because qwen calls have $0 cost; per-Opus-call requires
dividing by Opus-call-count (40), not total-call-count (50).

**Bonus**: notes the data has zero-cost rows in the same script that
shouldn't be averaged in.

---

## Q8 — Which production scripts depend on Mac 1's qwen3:235b? [meta]

**Expected tool**: `substrate_find_llm_calls(model_id="qwen3:235b")`

**Canonical answer** (literal substrate state): **0 static call sites, 0
runtime events.** No script directly references qwen3:235b by model_id.

**Bonus / required-for-top-score**: surfaces the substrate limitation —
Mac 1's qwen3:235b IS the production research-director endpoint per
`/etc/sofar-llm.env` on spark-cfbd, but the static extractor doesn't
currently capture env-file-mediated dependencies. So the answer "0" is
literally correct but architecturally incomplete; a model that flags the
gap is doing analyst-grade work.

---

## Q9 — If I move ai-synthesis off Opus to Sonnet, what's the savings?

**Expected tools**: `substrate_get_pricing` + `substrate_estimate_cost` +
arithmetic.

**Canonical answer**:
- Token volumes (last 30d): 545,514 input, 177,408 output
- Opus cost: 545,514 × $5/M + 177,408 × $25/M = $2.728 + $4.435 = **$7.16**
- Sonnet cost: 545,514 × $3/M + 177,408 × $15/M = $1.637 + $2.661 = **$4.30**
- Savings (30d): **$2.86**
- Annualized: ~**$34.86/year**

**Bonus**: notes per-Opus-call this is $7.16/40 = $0.179 → $4.30/40 =
$0.108, a $0.071/call savings, useful for reasoning about marginal
decisions.

**Caveat to surface**: Sonnet may produce different-length outputs given
same input, so the same input-token volume assumption is approximate.
Output-token volume may also shift.

---

## Q10 — Are there LLM calls we're making that aren't captured by the static extractor? [meta]

**Expected tool**: `substrate_find_drift()` (runtime-without-static section).

**Canonical answer**: **2 such cases:**
- `options-flow` calling `gemma4:26b` (38 runtime calls)
- `daily-summary` calling `gemma4:31b` (15 runtime calls)

**Bonus**: notes the broader implication — the static extractor's pattern
matching is incomplete; it's missing the call patterns these scripts use
(e.g., shell curl with model in env var vs literal string). Yesterday's
handoff identified this as a known gap.

---

## Q11 — Show me all the ADRs about hardware decisions [ambiguous]

**Expected tool**: `substrate_search_entities(type="adr", status="accepted")` with title-filtering OR all-ADR retrieval + analysis.

**Canonical answer** (strict): **ADR-0008** (Defer Exo clustering, run Mac
Studios as independent hosts). One ADR, unambiguously hardware-only.

**Canonical answer** (generous): ADR-0007 (synthesis routing) and ADR-0009
(local expert is reranker) involve hardware allocation decisions; can be
included. Up to 3 ADRs total.

**Score**: 2 if returns ADR-0008 (alone or with 0007/0009). 1 if returns
0007 or 0009 alone without 0008. 0 if returns unrelated ADRs.

---

## Q12 — What's S2's role and what scripts target it?

**Expected tool**: `substrate_get_entity(name="spark-73ff", type="node")`.

**Canonical answer**:
- Role: `synthesis` (per `nodes.yml`)
- OS: linux/aarch64; mDNS: spark-73ff.local
- Loaded models: `gemma4:31b`, `qwen3.6:35b-a3b`
- Scripts referencing spark-73ff:
  - `ai-synthesis.py`
  - `extract_systems_state.py`
  - `intraday-synthesis-local.py`
- llm_calls targeting it: 2 (both `intraday-synthesis-local.py`,
  both qwen3.6:35b-a3b)

**Bonus**: notes that 10 runtime calls (last 30d) hit qwen3.6:35b-a3b on
s2 from ai-synthesis (visible only by joining find_llm_calls output).

---

## Q13 — Which sentinels are still active and which have been closed? [meta]

**Expected tool**: `substrate_search_entities(type="sentinel", limit=100)` (default status filter post-patch returns all non-archived).

**Canonical answer**: **15 sentinels in substrate, all status='active'. 0
sentinels at status='closed'.**

Active sentinels (alphabetical):
API_BIFURCATE_V1, CFTC_COT_V1, CONTINUITY_PROTOCOL_V1,
DATE_SELECT_GTH_AWARE_V1, DB_TABLE_ROUTING_V1, DUAL_FILE_READ_V1,
GIT_PUSH_QUEUE_V1, GIT_PUSH_QUEUE_V2, MULTIDB_REFACTOR_V1,
RATE_CARD_DRIFT_AUDIT_V1, SESSION_DATE_FALLBACK_V1,
STEP0_VALIDATOR_ONLY_V1, SUBSTRATE_SCHEMA_VERIFY_BEFORE_WRITE_V1,
SYNTHESIS_UNUSUAL_FLOW_V1, UNUSUAL_FLOW_DEDUP_V1.

**Top-score behavior**: notes the divergence — yesterday's handoff claimed
many sentinels active (e.g., SUBSTRATE_EXTRACTOR_COMMON_V1,
SUBSTRATE_INGEST_TOKEN_LOG_V1, SUBSTRATE_MCP_SERVER_V1) and one closed
(EMBED_NAN_BGE_M3_KNOWN_V1), but neither set appears in the substrate
exactly. The substrate contains only ADR-derived sentinels; sentinels
declared in handoffs that haven't been migrated to ADRs are not yet
substrate entities. This is a real extractor/process gap.

---

## Q14 — What's the most-recent-modified script in the last 7 days? [meta]

**Expected tool**: `substrate_search_entities(type="script", limit=100)` and
inspect `updated_at` or attrs for mtime.

**Canonical answer**: **the substrate cannot answer this reliably.**
`updated_at` reflects extractor write time, not file mtime. Most scripts
have `updated_at = 2026-04-26T03:51:44.604935` (the same extractor run
batch). Script `attrs` contains `path`, `language`, `line_count`,
`sha256_short`, but NO file mtime field.

**Top-score behavior**: explicitly identifies this limitation. "The
substrate doesn't track file mtime; updated_at is extractor-write time.
To answer this question accurately the script extractor would need to
capture os.path.getmtime() into attrs."

**Penalty**: any model that confidently picks one specific script as
"most recent" without flagging is hallucinating insight not in the data.

---

## Q15 — Trace the data flow: ai-synthesis.py → ??? → daily-summary at depth 3 [meta]

**Expected tool**: `substrate_query_relationships(src_name="ai-synthesis.py", src_type="script", depth=3)`.

**Canonical answer**: **no path found in the substrate.** A depth-2 walk
from ai-synthesis.py returns 97 edges, none of which lead to daily-summary.
`daily-summary` appears in the substrate only as a runtime-only caller of
gemma4:31b (per find_drift Q4) — it has no entity-level static
representation as a script.

**Top-score behavior**: notes that a real data flow likely exists via
the synthesis_archive table (ai-synthesis writes there, daily-summary
presumably reads from there) but the substrate's relationship graph
doesn't capture write→read semantics on tables — only "references."
Suggests the next extractor enhancement would be to model write-vs-read
distinctions on table references.

**Penalty**: any answer that fabricates a specific path through nodes
that don't exist in the graph is hallucinating.

---

## Aggregate scoring

For each model:
- Sum across 15 questions, range -30 to +120
- Compute average per question
- Track per-question time (capture from ollmcp performance metrics or
  wall-clock)
- Note any "no content response received" or tool-call-loop failures
  separately — those are runtime/integration failures, distinct from
  reasoning failures

For ADR-0012, the data points that matter:
1. Which model has higher total score?
2. Where do they diverge (which questions)?
3. Speed difference?
4. Reliability difference (errors / loops / silent failures)?
5. On the [meta] questions specifically, does either model surface
   substrate limitations? That's the deepest signal of analyst behavior.

---

## How to run

In a fresh terminal on mac2, for each candidate model:

```
~/sofar/venv/bin/ollmcp \
    --servers-json ~/.config/ollmcp/substrate.json \
    --model qwen3-substrate
```

(or `gemma4-31b-substrate`)

In TUI: when first tool-call HIL prompt appears, choose `s` (session-
approve). Then paste each of the 15 prompts in order. Save the full TUI
output for scoring.

Suggested running order: easiest → hardest. Q1, Q2, Q4, Q11, Q12, Q13, Q3,
Q6, Q5, Q7, Q9, Q14, Q8, Q15, Q10. (Trivial / single-tool first; chained-
reasoning and meta last.)

Total time estimate: ~20-30 minutes per model, given Phase 2 timing
(~30s/answer for qwen, faster for gemma).
