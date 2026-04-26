# ADR-0009: Local expert IS the reranker; no separate reranker layer

**Date**: 2026-04-26
**Status**: accepted

## Context

While testing semantic search on the substrate (yesterday's
embedding-model evaluation thread), we observed that retrieval results
sometimes ranked surface-keyword matches above conceptually-correct
answers. Example: "decisions about database architecture" ranked
ADR-0005 (sentinel/migration conventions, but contains the words "table"
and "convention") above ADR-0001 (literally "Three-database split").

A natural question arose: should we add an LLM-based reranker as a
second-stage in retrieval, where after embedding search returns top-N
candidates, an LLM reads them and re-orders by reading-comprehension?

In retrieval literature this is called two-stage retrieval or LLM
reranking. It works. It also adds complexity.

## Decision

**Do not build an in-pipeline LLM reranker.** Use a single-stage
embedding/lexical/graph retrieval and let the **local expert** (the
LLM consuming substrate query results) handle reasoning over the results.

## Rationale

1. **The local expert has reading comprehension by definition.** When
   the local LLM queries the substrate and receives top-5 candidates,
   it can read titles + content and pick the right one. That IS reranking
   — just at the consumer layer, not the retrieval layer.

2. **An in-pipeline reranker privileges embedding search over other
   tools.** The substrate's design (yesterday's decision) is "knowledge
   graph + multiple navigation tools (lexical / graph / vector / SQL)."
   A reranker bolted onto vector search makes that one tool more
   capable but skews choice toward it. Symmetric design is cleaner:
   all tools return raw results; the local LLM decides what to do with
   them, including ignoring weak vector results and trying graph
   traversal instead.

3. **Latency budget.** A reranker LLM call adds 1-30s per query
   depending on model size. The local-expert path will be query-heavy.
   Adding latency to every retrieval is expensive.

4. **The actual root cause of poor ranking is text quality, not
   ranking algorithms.** ADR-0001 ranked third because its embedding
   text doesn't contain "architecture decisions" — only "Three-database
   split". Better text construction (richer entity descriptions in
   `build_text()`) helps any model and any consumer, with no latency
   cost. Captured for future as substrate-text-enrichment.

5. **Local expert can opt into reranking.** If the local LLM finds
   a particular query's results unhelpful, it can ask the substrate
   to re-query differently, traverse relationships, or read a specific
   entity in detail. That's reasoning, not algorithmic reranking. It
   happens organically.

## Consequences

- **No separate reranker service.** Retrieval pipeline stays simple:
  query → tool → results → LLM consumer.
- **MCP server tools** expose individual retrieval methods (semantic
  search, graph walk, lexical search, exact lookup) and let the LLM
  choose. No "smart aggregator" tool that auto-reranks.
- **If retrieval quality becomes a binding pain point** post-MCP, the
  fix order is:
  1. Improve text builders (add natural-language descriptions for
     ADRs, scripts, daemons)
  2. Add more navigation tools (e.g., table-aware filters)
  3. THEN consider reranker, only if 1+2 don't help

## Validation via substrate

Once MCP is live, this ADR is tested by:
- Tracking how often the local LLM re-issues a query with different
  tool / scope after seeing initial results (event-table tracking)
- Tracking whether retrieval-quality complaints surface in real workflows
- If high re-query rate or quality complaints appear, ADR is revised

## Related

- substrate-day1 embedding model evaluation thread (bge-m3 → qwen3 →
  nomic; settled on nomic-embed-text)
- substrate-day1 finding: "text content is the bottleneck, not model
  choice"
- ADR-0006: continuity protocol
