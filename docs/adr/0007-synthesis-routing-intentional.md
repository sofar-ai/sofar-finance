# ADR-0007: LLM synthesis routing is intentional, not drift

**Date**: 2026-04-26
**Status**: accepted

## Context

While building the LLM-call substrate (substrate-day2 bundles), we
discovered our local synthesis pipelines have non-uniform model routing:

- `flow-intelligence.py` calls **gemma4:26b** on S1's local Ollama
- `intraday-synthesis-local.py` calls **qwen3.6:35b-a3b** on S2 (spark-73ff)
- `ai-synthesis.py` conditionally calls Anthropic Opus OR qwen3.6:35b-a3b
  based on `_BACKEND` flag
- `research-director-{morning,evening}.py` call **qwen3:235b** on Mac 1

Mac 1's qwen3:235b (193GB VRAM) is invoked only by the two director
scripts, fires twice per market day, and was 0 calls / 0 tokens in the
captured runtime window per substrate Q11. The capacity is genuinely
underutilized on cluster-best hardware.

The temptation: route intraday/flow synthesis to Mac 1's 235B since it
has headroom and 235B reasoning quality > 35B.

## Decision

**Keep current routing as-is. Do not move synthesis to Mac 1's 235B.**

## Rationale

Each model is right-sized for its workload:

- **Hourly intraday synthesis** (10-15 EST × 6 calls/day): a 50-second
  digest job. 35B is enough; 235B inference is 2-3× slower per token.
  Latency budget is tight (next call in 50min); slower model = compounding
  delay.
- **Flow synthesis**: continuous near-real-time options-flow analysis. 26b
  serves; 235B is overkill and would block on inference.
- **ai-synthesis.py Opus call**: deep reasoning over full market session
  context (~17K input, 5K output per call). Anthropic Opus at $5/$25 MTok
  costs ~$0.70/day for this. Substituting local 235B saves the API spend
  but adds 2-5min wait per call vs Opus's seconds-fast cloud inference.
  Quality of Opus at this task is judged worth the cost.

Mac 1's 235B is **deliberately reserved** for two future uses:
1. **Local expert / MCP server reasoning** (ADR-0008, future)
2. **Quant-research deep reasoning** when ADR-0004 unpauses

Routing routine synthesis through 235B today would:
- Add per-call latency to time-sensitive pipelines
- Crowd out the local-expert workload before it ships
- Break the "best hardware → highest-value, hardest-thinking work" pattern
  we want to establish

## Consequences

- Synthesis pipeline routing **stays on S1 and S2 for the foreseeable
  future**.
- Mac 1's 235B remains apparent under-utilization until local expert
  ships. This is not waste; it is reserved capacity for the next-tier
  workload.
- When local expert ships and consumes Mac 1 capacity, this ADR closes.
- If Anthropic Opus pricing changes drastically (>2× current rates), the
  ai-synthesis routing may need re-evaluation.

## Validation via substrate

After substrate-day2 ships, this ADR can be tested by:

```sql
-- Confirm Mac 1 is unused for synthesis today
SELECT COUNT(*) FROM llm_call_events
WHERE inference_locus = 'mac1'
  AND occurred_at > NOW() - INTERVAL '30 days';
-- Should be 0 today; should grow as local expert ships
```

## Related

- ADR-0004: Pause quant-research subsystem until Builds 1-6 ship
- ADR-0008: Defer Exo clustering, run Macs as independent local-expert hosts
- substrate-day2 bundles 1-4: produced the runtime data this ADR references
