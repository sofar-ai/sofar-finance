# ADR-0019: Data gap auto-populator with LLM-curated tier classification

**Date:** 2026-05-02
**Status:** accepted
**Deciders:** bot1
**Related ADRs:** ADR-0014 (external research system, §4 specifies auto-population), ADR-0010 (LLM cluster routing)

---

## Context

ADR-0014 §4 specified that vendor mentions in `observations.data_sources_mentioned` should be auto-populated as rows in `research.data_gaps` so the existing data-scout cron (17:15 ET weekdays) can attempt resolution. The mechanism was captured as `DATA_GAP_AUTO_POPULATION_V1` but not yet built.

By 2026-05-02 evening session, `observations.data_sources_mentioned` was populating from the summarizer drain. The first 50+ distinct vendor mentions appeared, ranging from genuine market data signals (Polymarket, FINRA, QuantConnect) to crypto/DeFi protocols (Uniswap, PancakeSwap), academic datasets (BeMTPL97, All-Daily-News Dataset), trading platforms (TradingView, Tastytrade), and python libraries (PyTorch, NumPy, torch.compile).

A naïve diff-and-insert approach would create ~50 gap rows including ~40 noise rows (libraries, DeFi protocols, indexes, paper-specific datasets). The data-scout would burn cycles attempting to resolve irrelevant vendors, and real signal would be buried.

Three options considered:
- **Option 1 (naïve):** Insert every unknown vendor; humans curate downstream as `wont_fix`. Simplest but noisiest.
- **Option 2 (frequency threshold):** Only insert vendors mentioned ≥N times. Misses occasional-but-important sources; threshold is arbitrary.
- **Option 3 (LLM-curated):** LLM classifies each vendor with tier (1/2/3) + reasoning + suggested_source/identifier. Matches the data_gaps schema's intent (tier_reasoning text column, proposed_vendors jsonb).

## Decision

Build `data-gap-populator.py` as Option 3. Architecture:

1. **Diff query** finds vendors in `observations.data_sources_mentioned` that are NOT in `data_source_registry` (source or identifier columns) AND NOT in `data_gaps` (matched on `suggested_identifier` OR encoded original-vendor in `data_description`, excluding `superseded`/`wont_fix` rows).

2. **Per-vendor LLM call** to qwen3.6:35b-a3b with system prompt enforcing firm scope (US equities/ETFs/options/macro). Includes 3 sample observation excerpts as classification context. Returns JSON with canonical_name, vendor_type, tier, tier_reasoning, data_description, suggested_source URL, suggested_identifier, proposed_vendors (alternatives).

3. **Validation + INSERT** into data_gaps with all fields populated, encoding original vendor name in `data_description` as `'as "<name>"'` for future dedup.

4. **scout_runs lifecycle** — open/close pattern reused from scrapers v2 with `documents_inserted` repurposed as `gaps_inserted`.

5. **Routing flexibility** — `GAP_POPULATOR_MODEL` and `GAP_POPULATOR_ENDPOINT` env vars allow per-run targeting. Long-term home is mac2 (`MAC2_RESEARCH_EXTRACTION_ROLE_V1`), but tonight's run was routed to spark-73ff via env override (`GAP_POPULATOR_ROUTED_TO_S73FF_TONIGHT_V1`) because mac2 was saturated by the summarizer drain — true parallel execution.

## Consequences

### Positive

- 53 vendor classifications produced in ~6 minutes wall time; quality validated against human judgment (Polymarket→tier 1, BeMTPL97→tier 3, Quantpedia→tier 2 etc.)
- Tier distribution sensible for firm scope: 2 tier-1, ~10 tier-2, ~40 tier-3
- LLM correctly applied conservative defaults from system prompt (DeFi → tier 3 unless firm trades DeFi, LLM providers → tier 3, single-paper datasets → tier 3)
- Schema's tier_reasoning column gets meaningful content ("US-focused firm, India is out of scope" for BSE)
- Data-scout cron's queue is meaningfully populated for first time
- Director context expansion (ADR-0018) now has rich vendor-mention signal to surface in briefings

### Negative

- 3 bugs found and fixed during deployment (added 1 hour to deployment time):
  - `DATA_GAP_POPULATOR_DOUBLE_UNNEST_BUG_2026-05-02_V1` — CTE had two unnest() calls creating cartesian product
  - `DATA_GAP_POPULATOR_REASONING_MODE_BUG_V1` — qwen3.6:35b-a3b emitted output to `message.reasoning` instead of `message.content` when reasoning mode engaged. Fixed via `reasoning_effort: none` in payload + fallback to reasoning field at parse time + bumped max_tokens to 2000
  - `DATA_GAP_POPULATOR_DEDUP_USES_WRONG_FIELD_V1` — initial dedup CTE compared vendor name to suggested_source URL (URLs and names don't match). Fixed to compare against suggested_identifier and against original vendor name encoded in description text

- 5 duplicate rows created during iterative testing (gap_ids 2-6 from --limit 5 run, then re-classified in full run). Marked as `status='superseded'` rather than deleted to preserve audit trail.

- LLM curation introduces non-determinism: re-running could produce slightly different classifications. Acceptable because LLM choices are persisted per-row and don't change retroactively.

- Cost: ~7 sec/vendor on s73ff (qwen3.6:35b-a3b). At ~50 vendors/run × daily cron, that's ~6 min/day of GPU time. Negligible.

### Risks

- LLM classifications have biases. The system prompt enforces "US equities/ETFs/options/macro" scope, which means international markets get tier 3 (BSE, NSE classified that way). If firm scope changes, system prompt must be updated and existing rows re-evaluated.

- Vendor name normalization is imperfect. "Quantpedia" and "Quantpedia Pro" classify as separate gaps even though they're the same service at different tiers. Future canonicalization pass needed.

- Free-text vendor names from observations include garbage like "high-frequency tick data" or "public WebSocket order-book feed" — these are descriptions not vendors. The LLM correctly classifies them but they still consume a classification round-trip. Future summarizer prompt tuning could reduce this (`SUMMARIZER_DATA_SOURCES_SOMETIMES_DESCRIPTIONS_NOT_NAMES_V1`).

## Sentinels

`DATA_GAP_AUTO_POPULATION_V1` (canonical for this script, resolved by this ADR)
`DATA_GAP_POPULATOR_DEPLOYED_2026-05-02_V1`
`DATA_GAPS_INITIAL_POPULATION_53_NEW_V1`
`DATA_GAP_POPULATOR_DOUBLE_UNNEST_BUG_2026-05-02_V1` (resolved)
`DATA_GAP_POPULATOR_REASONING_MODE_BUG_V1` (resolved)
`DATA_GAP_POPULATOR_DEDUP_USES_WRONG_FIELD_V1` (resolved)
`GAP_POPULATOR_ROUTED_TO_S73FF_TONIGHT_V1` (architectural deviation; long-term home is mac2)

## Files

- New: `/home/bot1/scripts/data-gap-populator.py` (23756 bytes, 555 lines)
- No backup needed (wasn't replacing an existing script)
- Not yet on cron — manual invocation only this session. Cron entry to add next session.

## Future work

- Move long-term home from spark-73ff to mac2 once drain scheduling permits
- Add cron entry: probably nightly after summarizer drain (e.g., `30 4 * * *`)
- Vendor-name canonicalization pass (consolidate "Quantpedia" + "Quantpedia Pro" + "QuantPedia")
- Periodic re-evaluation of `wont_fix` rows when firm scope changes
