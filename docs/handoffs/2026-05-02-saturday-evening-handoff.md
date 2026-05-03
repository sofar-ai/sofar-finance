# Handoff — 2026-05-02 Saturday Evening Session

**Date:** 2026-05-02 (Saturday)
**Duration:** ~9 hours (afternoon → late evening)
**Operator:** bot1
**Cluster state at end of session:** all 4 hosts healthy; mac2 sustained-busy with summarizer drain; cron paused-research entries selectively un-paused for directors

---

## TL;DR

Built and deployed the substrate-canonical research subsystem v2 end-to-end:

- 4 ADRs ingested (0014, 0015, 0016, 0017)
- 1 schema migration applied (research-library-v1: 5 new tables + cited_doc_ids on hypotheses)
- 3 production scripts rebuilt v2 (summarizer, lab-scraper, scout-scraper) — all promoted, all validated end-to-end
- 1 systemd unit deployed (mac2-ollama-tunnel)
- 1 stale config fix (OLLAMA_URL deprecated IP)
- 1 new script shipped (data-gap-populator) with LLM-curated tier classification
- X-headlines pipeline restored after 17-day silent failure (cron PATH bug + git divergent branch + local pull)
- Both research directors patched with ADR-0014 §3 context expansion + un-paused in cron

**Production state at session end:**
- 190 documents in research.documents (101 lab + 88 scout + 1 test)
- 582 observations across 160 summarized docs
- 63 data_gaps (53 active new, 5 superseded, 1 ingested test, 4 added during session iteration)
- Summarizer drain `drain-resume` running, 30 docs remaining (~35 min)

**Quant subsystem (ADR-0004 builds 1-6) remains paused.** This session was the research half. Hypotheses still don't generate until quant-research-scout v2 ships next session.

---

## Work shipped this session (in order)

### 1. ADR ingestion
- ADR-0014 External Research System (id 2829)
- ADR-0015 Substrate ingestion conventions (id 2830, updated with placeholder fix)
- ADR-0016 mac2 Ollama SSH tunnel (id 2964)
- ADR-0017 Research scraper v2 architecture (id 2969)
- Files at `/home/bot1/sofar-finance/docs/adr/`
- Substrate canonical via `extract_adrs.py --verbose`

### 2. Schema migration `RESEARCH_LIBRARY_SCHEMA_V1`
- File: `/home/bot1/sofar-finance/migrations/20260502-research-library-v1.sql`
- Created 5 tables: documents, observations, research_themes, document_decisions, scout_runs
- Added `cited_doc_ids UUID[]` to hypotheses
- Substrate canonicalized: 83 data_tables, 1235 columns
- `documents.content_hash` already had UNIQUE constraint
- PK naming inconsistency captured: `RESEARCH_LIBRARY_PK_NAMING_INCONSISTENT_V1`

### 3. db.py patched
- +5 entries in TABLE_DB_MAP routing documents/observations/research_themes/document_decisions/scout_runs to research
- 16 total research tables in routing map
- Backup: `/home/bot1/scripts/db.py.bak.20260502-1922`

### 4. /etc/sofar-llm.env stale-IP fix
- `OLLAMA_URL` changed from `http://192.168.50.15:11434/api/generate` → `http://mac1.local:11434/api/generate`
- DIRECTOR_MODEL=qwen3:235b confirmed
- Backup: `/etc/sofar-llm.env.bak.20260502-1948`
- Sentinel: `DIRECTOR_OLLAMA_URL_DEPRECATED_PRE_FIREWALLA_IP_V1`

### 5. mac2-ollama-tunnel.service deployed
- File: `/etc/systemd/system/mac2-ollama-tunnel.service` (1967 bytes)
- Tunnel: spark-cfbd:11435 → mac2:localhost:11434
- ssh -N with ServerAliveInterval=30, ExitOnForwardFailure=yes, BatchMode=yes, MemoryMax=256M, Restart=always
- Active running, end-to-end verified (both /api/tags and chat completion)

### 6. research-summarizer.py v2 promoted
- File: `/home/bot1/scripts/research-summarizer.py` (25467 bytes)
- Backup: `.legacy.bak.20260502-1633`
- Endpoint: `http://localhost:11435/v1/chat/completions` (tunnel)
- Model: qwen3.6:35b-a3b
- Reads documents WHERE NOT IN observations (idempotent), per-doc LLM call, 12000 char raw_text cap
- Patched `execute_many` rowcount bug (returns `len(rows)`)
- Smoke tests: 5/5 OK at scale; quality validated
- Sentinel: `SUMMARIZER_REFRAME_VALIDATED_2026-05-02_V1`

### 7. research-lab-scraper.py v2 promoted (ADR-0017)
- File: `/home/bot1/scripts/research-lab-scraper.py` (26063 bytes)
- Backup: `.legacy.bak.20260502-1722`
- Per-source-as-function pattern: fetch_arxiv, fetch_substacks, fetch_github_trending, fetch_spotgamma
- Drops SEEN_FILE — uses ON CONFLICT DO NOTHING on documents.content_hash UNIQUE
- 3-attempt retry with 5/15/45s backoff
- Bug discovered + fixed: `TIMESTAMP_DOUBLE_TZ_MARKER_BUG_V1` — `.isoformat() + 'Z'` produces malformed `+00:00Z`
- 104 docs in DB across 4 sources after promotion
- Sentinel: `LAB_SCRAPER_V2_PROMOTED_2026-05-02_V1`

### 8. research-scout-scraper.py v2 promoted
- File: `/home/bot1/scripts/research-scout-scraper.py` (25951 bytes)
- Backup: `.legacy.bak.20260502-2206`
- 4 fetchers: fetch_x_fintwit (file-based), fetch_seeking_alpha, fetch_reddit (REDDIT_MIN_SCORE=20, 1-sec rate-limit), fetch_quantpedia
- Same timestamp fix in SA + Quantpedia fetchers
- KNOWN_TICKERS + FINTWIT_ACCOUNTS + SA_RSS_URLS + REDDIT_SUBS preserved verbatim
- 88 scout docs in DB after final run including 20 X items
- Sentinel: `SCOUT_SCRAPER_V2_PROMOTED_2026-05-02_V1`

### 9. X-headlines pipeline restored (3 distinct bugs)
- **Cron PATH bug** (`HEADLINES_X_CRON_NODE_NOT_IN_PATH_V1`): 13 cron entries used bare `node`, `which node` = `/home/bot1/.local/bin/node`. cron's PATH excluded that. Fixed via crontab sed in-place edit. Backup: `~/crontab.bak.20260502-2208`.
- **Git divergent branch in temp clone** (`SCRAPE_X_GIT_TEMP_CLONE_DIVERGED_V1`): 17 days of unpushed commits accumulated in `/tmp/sofar-finance-x-cron`. Reset via `rm -rf`. Captured fresh file (copied to canonical first).
- **Local checkout needs git pull** (`SCRAPE_X_WRITES_VIA_TEMP_CLONE_LOCAL_NEEDS_PULL_V1`): script writes via temp clone → GitHub remote, never updates `~/sofar-finance/` directly. Manual `git pull` brought local in sync.
- Sentinel: `HEADLINES_X_PIPELINE_RESTORED_2026-05-02_V1`
- Minor: 3-5 X accounts return selector failures (`SCRAPE_X_3_ACCOUNTS_SELECTOR_FAILS_V1`)

### 10. data-gap-populator.py deployed (ADR-0014 §4)
- File: `/home/bot1/scripts/data-gap-populator.py` (23756 bytes)
- LLM-curated tier classification using qwen3.6:35b-a3b
- Reads observations.data_sources_mentioned, finds vendors not in registry/data_gaps, classifies via LLM (tier 1/2/3 + reasoning + suggested_source/identifier + proposed_vendors)
- Routed to spark-73ff for this session via `GAP_POPULATOR_ENDPOINT='http://spark-73ff.local:11434/v1/chat/completions'` env override (true parallelism with mac2 drain)
- Three bugs found + fixed:
  - `DATA_GAP_POPULATOR_DOUBLE_UNNEST_BUG_2026-05-02_V1` — caused cartesian product duplicate rows
  - `DATA_GAP_POPULATOR_REASONING_MODE_BUG_V1` — qwen3.6:35b-a3b put output into `message.reasoning` not `message.content` when reasoning mode engaged; hit 500-token cap before JSON. Fixed via `reasoning_effort: none` + `think: false` + fallback to reasoning field at parse time + max_tokens=2000
  - `DATA_GAP_POPULATOR_DEDUP_USES_WRONG_FIELD_V1` — dedup CTE compared vendor name to suggested_source URL. Fixed to use suggested_identifier + extract from data_description regex `'as "([^"]+)"'`. Excludes superseded/wont_fix rows.
- Final state: **63 data_gaps rows** total (53 active new, 4 added later, 5 superseded dupes [gap_ids 2-6], 1 ingested test row)
- Tier distribution: 2 tier-1 (Polymarket, FINRA), ~11 tier-2 (Quantpedia, SpotGamma, Tokyo Stock Exchange, etc.), ~50 tier-3
- Sentinel: `DATA_GAP_POPULATOR_DEPLOYED_2026-05-02_V1`

### 11. Director context expansion + un-pause (ADR-0014 §3)
- `research-director-evening.py` patched: 84 lines added
  - 3 new ctx keys (recent_observations, recent_documents_summary, top_vendors_mentioned)
  - 3 new prompt sections in build_user_prompt
  - Extended log.info to include observation/doc/vendor counts
  - Backup: `.bak.20260503-0122`
- `research-director-morning.py` patched: 86 lines added
  - New fetcher `get_research_observations_context(today)`
  - `build_morning_prompt` signature extended with `research_ctx=None` kwarg
  - New prompt sections inside build_morning_prompt
  - main() updated to gather + pass research_ctx
  - Backup: `.bak.20260503-0127`
- Smoke tests both passed: evening prompt 29,635 chars (~7,408 tokens); morning prompt 21,595 chars (~5,398 tokens)
- Cron un-paused via sed: removed `# QR-PAUSED-DIRECTORS: ` prefix from both lines
- Crontab backup: `~/crontab.bak.20260503-0130`
- Evening fires Mon-Fri 16:30 ET, morning fires Mon-Fri 07:30 ET
- First real run: Monday 2026-05-04 morning
- Sentinel: `DIRECTORS_UNPAUSED_2026-05-02_AFTER_CONTEXT_EXPANSION_V1`

---

## Pre-existing bug surfaced (not fixed this session)

`DIRECTOR_FETCH_DATA_SCOUT_ESCALATIONS_BROKEN_COLUMN_NAME_V1` — `fetch_data_scout_escalations()` references `ingestion_attempts` and `last_attempt_at` but actual columns are `scout_attempts` and `scout_last_attempt`. Pre-existing in both directors. Non-fatal but escalations always come back empty. Worth a 5-min fix next session.

---

## Substrate coverage gaps captured

Many. Key ones:

- `EXTRACT_LLM_CALLS_MISSES_INTERACTIVE_OLLMCP_USAGE_V1`
- `EXTRACT_LLM_CALLS_MISSES_ENV_VAR_DRIVEN_MODELS_V1`
- `EXTRACT_LLM_CALLS_FALLBACK_DEFAULT_LITERAL_V1` (proposed mitigation)
- `EXTRACT_SYSTEMS_STATE_MISSES_MAC2_OLLAMA_V1`
- `EXTRACT_CRON_ENTRIES_NOT_CANONICAL_V1`
- `EXTRACT_DATA_RELATIONSHIPS_AMBIGUOUS_UPDATE_SELECT_V1`
- `EXTRACT_DATA_TABLES_MISSES_VIEWS_V1`
- `EXTRACT_SCRIPTS_MISSES_REDDIT_FEED_URLS_V1`
- `HARDWIRED_VALUES_AUDIT_PENDING_V1` (broader pattern)
- `KNOWN_TICKERS_HARDCODED_IN_SCRAPERS_V1`, `KNOWN_TICKERS_TO_CANONICAL_TABLE_PROPOSED_V1`
- `SCOUT_FINTWIT_ACCOUNTS_HARDWIRED_V1`, `SCOUT_FINTWIT_ACCOUNTS_DEAD_VARIABLE_V1`
- `SCOUT_REDDIT_SUBS_HARDWIRED_V1`, `SCOUT_SA_RSS_URLS_HARDWIRED_V1`
- `SCRAPER_V2_HELPERS_DUPLICATED_ACROSS_SCRIPTS_V1` (ripe for shared scraper_lib.py)
- `CRON_PATH_VS_INTERACTIVE_PATH_DRIFT_V1` (broader pattern)
- `MACRO_COMPASS_FEED_DORMANT_2026-05-02_V1`, `MOONTOWERMATH_FEED_RETURNS_ZERO_ENTRIES_V1`
- `SUMMARIZER_DATA_SOURCES_UNDEREXTRACTED_V1`, `SUMMARIZER_JSON_PARSE_FRAGILE_ON_LONG_OUTPUTS_V1`
- `SUMMARIZER_DATA_SOURCES_SOMETIMES_DESCRIPTIONS_NOT_NAMES_V1`
- `SCOUT_REDDIT_LIVE_NEW_ITEMS_BETWEEN_RUNS_V1`, `SCOUT_REDDIT_VOLUME_VARIES_BY_WEEKDAY_V1`
- `TICKER_DETECTION_TWO_LAYER_V1`
- `LAB_SCRAPER_TIMESTAMP_MISSING_DROPS_ITEM_V1`
- `LAB_SCRAPER_TYPICAL_DAILY_VOLUME_~10_V1`
- `MAC2_HAS_SEVEN_MODELS_INCLUDING_PROMPT_BAKED_VARIANTS_V1`
- `DIRECTOR_FRONTIER_QWEN235B_MAC2_MIRROR_PROPOSED_V1`
- `MAC2_FRONTIER_ROLE_TBD_V1`, `MAC2_RESEARCH_EXTRACTION_ROLE_V1`, `MAC2_OLLAMA_LOCALHOST_ONLY_BY_DESIGN_V1`
- `OBSERVATIONS_LATENT_VALUE_PENDING_CONSUMERS_V1`
- `OBSERVATIONS_IMMEDIATE_VALUE_QUERY_AND_OLLMCP_V1`
- `RESEARCH_DOCUMENTS_INITIAL_POPULATION_169_V1` (pre-X items) → 190 at session end
- `DATA_GAPS_INITIAL_POPULATION_53_NEW_V1`
- `GAP_POPULATOR_ROUTED_TO_S73FF_TONIGHT_V1` (architectural deviation note — long-term home is mac2)
- `SUMMARIZER_FIRST_RUN_BACKLOG_DRAIN_PATTERN_V1` — when un-pausing summarizer cron, first invocation should cap at --limit N

---

## Pending — for next session

### Highest priority

1. **quant-research-scout.py v2 migration** — the third scraper migration. Hypothesis grounding per ADR-0014 §5 (cited_doc_ids referencing observations). Has phase_plan/search/synthesize/reflect/run_cycle/write_to_hypotheses_table. Currently uses gemma4:26b. **This is when hypotheses start getting generated.** Without this, directors read empty hypotheses table.

2. **Read Monday 2026-05-04 director output** — first real director run with expanded context. Validate quality. Tune prompts if observations are ignored or noisy.

3. **Fix `DIRECTOR_FETCH_DATA_SCOUT_ESCALATIONS_BROKEN_COLUMN_NAME_V1`** — 5-min fix, both directors.

### ADR-0014 follow-ons

- Backfill `~/sofar-finance/data/research-raw/lab-raw-*.json` (30 days) into research.documents (`RESEARCH_RAW_BACKFILL_PENDING_V1`)
- `SUMMARIZER_LONG_DOC_CHUNKING_PENDING_V1` — chunked extraction for >12000-char docs
- Theme clustering job → research_themes
- BUSY_CHECK_PREFLIGHT pattern for cross-host LLM calls
- Substrate hardening: extract_systems_state.py should poll mac2; extract_llm_calls.py should pick up env-driven model selection
- Health-check probe for mac2-ollama-tunnel (`HEALTH_CHECK_MAC2_TUNNEL_PROBE_PENDING_V1`)
- Cron rewrite for v2 summarizer call shape (`SCRAPER_CRON_REWRITE_PENDING_V1`)
- gap-populator long-term home: route from spark-73ff back to mac2 (`MAC2_RESEARCH_EXTRACTION_ROLE_V1` says yes)

### ADR-0004 (quant unpause)

Builds 1-6 still required. Schema injection, smoke-test gate, cleanup, promote-to-production.py, bless-weights-proposal.py, re-enable signal compute cron. Out of scope for this weekend.

### Smaller cleanups

- 13 X-headlines cron entries: PATH fix is in. The 3-5 selector failures (`SCRAPE_X_3_ACCOUNTS_SELECTOR_FAILS_V1`) could be cleaned up
- Throwaway `~/scripts/load-test-documents.py` (8134 bytes) can be deleted
- gap-populator: not yet on cron. When added, runs nightly after summarizer drain
- `KNOWN_TICKERS_TO_CANONICAL_TABLE_PROPOSED_V1` ADR

---

## Files in /mnt/user-data/outputs/ (this session)

- `sofar-adrs/0014-external-research-system.md`
- `sofar-adrs/0015-substrate-ingestion-conventions.md`
- `sofar-adrs/0016-mac2-ollama-ssh-tunnel.md`
- `sofar-adrs/0017-research-scraper-v2-architecture.md`
- `sofar-adrs/20260502-research-library-v1.sql`
- `sofar-scripts/mac2-ollama-tunnel.service`
- `sofar-scripts/research-summarizer.py` (588 lines)
- `sofar-scripts/research-lab-scraper.py` (631 lines)
- `sofar-scripts/research-scout-scraper.py` (634 lines)
- `sofar-scripts/data-gap-populator.py` (555 lines, with both bug fixes)
- `sofar-scripts/load-test-documents.py` (193 lines, throwaway)
- `sofar-scripts/patch-director-evening.py` (this session)
- `sofar-scripts/patch-director-morning.py` (this session)
