# Handoff — 2026-05-03 Sunday afternoon

**Session window:** ~14:00 - 17:30 ET (mac2 keyboard, 4 SSH windows: mac1, mac2, spark-cfbd, spark-73ff).
**Predecessor:** 2026-05-02-saturday-evening-handoff + amendment.
**Theme:** Bug fixes from Saturday's amendment (summarizer + directors), plus designed-and-skeleton-built quant-research-scout v2 with hypothesis grounding (ADR-0014 §6).

This handoff uses `### ` headers throughout per `HANDOFF_SECTION_HEADER_CONVENTION_PROPOSED_V1` so `extract_handoffs.py` populates `sections_excerpt` instead of returning `{}` (the gap that bit me at session start when reading 2026-05-02-saturday-evening-handoff-amendment).

---

### What shipped today

Three concrete changes deployed to spark-cfbd, plus one design+skeleton that's parked at a sibling path pending follow-up implementation. All file backups follow the `.bak.YYYYMMDD-HHMM` convention from prior handoffs.

**1. research-summarizer.py — three reasoning-mode and JSON robustness patches.** Ported the reasoning-mode fallback pattern from data-gap-populator.py. New behavior: `reasoning_effort='none'` and `think=False` in payload to disable thinking on Ollama qwen3 family; if `message.content` is empty after the call, fall back to `message.reasoning` (qwen3.6:35b-a3b family routes output there under reasoning mode). Bumped `max_tokens` from 4096 to 8192 to absorb the 5-15 observations × 100-200 tokens output plus reasoning overhead. Added `repair_invalid_json_escapes()` that strips bare backslashes not followed by a valid JSON escape lead char (per RFC 8259 §7) — fixes the `\$1.6M` financial-figure case the model emits in LaTeX register. Layered as a third repair attempt after cheap-comma fixes. Smoke-tested with `--limit 2 --triggered-by test`: 9 observations inserted from one r/investing doc, status='completed', errors=0. Backup at `research-summarizer.py.bak.20260503-0745`.

**2. research-director-morning.py + research-director-evening.py — column-name fix.** `fetch_data_scout_escalations()` referenced `ingestion_attempts` and `last_attempt_at` in both the SELECT list and the ORDER BY clause; actual columns in `data_gaps` are `scout_attempts` and `scout_last_attempt`. Evening had an additional reference at line 805 in the prompt formatter (`e.get('ingestion_attempts')`); morning had no analogous formatter call. Two edits in morning, three in evening, all narrow string replacements. Schema verified via `\d data_gaps` before patching. In-place `sed -i.bak.20260503-1145` with verification grep. Validation deferred to Monday 07:30 ET cron fire (the directors' own canary). Backups at `*.bak.20260503-1145` for both files.

**3. quant-research-scout-v2-wip.py — design + skeleton (steps 1-7 of impl order).** New file at `/home/bot1/scripts/quant-research-scout-v2-wip.py`, sibling to v1 (which remains untouched). Skeleton contains: constants block with env-driven per-phase model config; `PhaseConfig` class for `plan`/`synthesize`/`reflect` resolved from `/etc/sofar-llm.env`; `scout_runs` lifecycle (`open_scout_run`/`close_scout_run` with `documents_inserted` repurposed as `hypotheses_inserted` per Decision 7); the corpus query (Decision 6 SQL — recency + ticker overlap as primary, theme tags as secondary sort signal); shared `call_llm` with all summarizer-v2 patches built in plus reasoning posture configurable per-call (Decision 2 A/B test surface); `validate_hypothesis_grounding` with five distinct rejection reasons per Decision 5 layer 2; `log_validation_failure` emitting single-line structured JSON. Phase functions (`phase_plan`, `phase_synthesize`, `phase_reflect`) and `write_to_hypotheses_table` are stubs that raise `NotImplementedError` — pending follow-up. Two smoke-test CLI flags: `--smoke-corpus` (29 rows returned against live research DB) and `--smoke-validate` (8/8 PASS on curated cases). Final form: 864 lines.

**4. Design doc at `~/sofar-finance/docs/specs/quant-research-scout-v2-design.md`.** 17672 bytes, auto-pusher committed. Specifies the eight architectural decisions with rationale: Y-pure grounding, tiered models, drop daemon mode, three enforcement layers, corpus filter strategy, plan-output schema additions, scout_runs column repurposing, top-N observation priority. Includes Decision 6 SQL skeleton, scout_runs JSONB shape, implementation order, and explicit out-of-scope items. Future Claude can implement steps 8-12 from this doc without rereading the chat.

---

### Sentinels resolved

These were the explicit close-out targets going into the session. All four resolved by patches above; the production-validation canary for #5 fires Monday 07:30 ET:

`SUMMARIZER_NEEDS_REASONING_MODE_PATCH_FROM_GAP_POPULATOR_V1` — closed by patch ported into research-summarizer.py.
`SUMMARIZER_EMPTY_CONTENT_REASONING_MODE_BUG_V1` — closed by content/reasoning fallback in `call_llm`.
`SUMMARIZER_OUTPUT_TRUNCATED_AT_MAX_TOKENS_V1` — closed by max_tokens 4096→8192 bump.
`SUMMARIZER_INVALID_JSON_ESCAPE_IN_OUTPUT_V1` — closed by `repair_invalid_json_escapes` (negative-lookahead strip semantics, validated against 8 test cases locally before deploy).
`DIRECTOR_FETCH_DATA_SCOUT_ESCALATIONS_BROKEN_COLUMN_NAME_V1` — closed by sed-patches to both director scripts; production canary fires Monday 07:30.

---

### Sentinels filed (new this session)

Twelve sentinels created during this session's work. Half are scout-v2 design captures, half are bookkeeping/hygiene observations. All should ingest via `extract_handoffs.py` when this handoff lands.

**Scout v2 design sentinels:**

`HYPOTHESIS_GROUNDING_REQUIRED_V1` (existing — closed when v2 ships and first cycle inserts non-empty cited_doc_ids).
`QRS_RECENCY_WINDOW_30D_TBD_AS_CORPUS_GROWS_V1` — 30-day recency window is a current-corpus choice; revisit when corpus exceeds ~1000 docs.
`QRS_USES_SUBSTRATE_FOR_SCHEMA_NIGHTLY_LAG_ACCEPTED_V1` — design doc resolves this in favor of substrate-canonical lookup with up-to-24h schema lag accepted.
`QRS_SYNTHESIZE_PROMPT_HARDCODED_SIGNAL_LIST_V1` — synthesize prompt currently inlines the signal_values table description as text; deferred to dedicated future session, do not inflate scope of this rebuild.
`SCOUT_RUNS_DOCUMENTS_INSERTED_REPURPOSED_FOR_HYPOTHESES_V1` — column reuse decision, captured for future coordinated migration to `entities_produced` + discriminator.
`QRS_CORPUS_LIMIT_30_DOCS_TUNABLE_V1` — top-30 docs cap on corpus result; tune empirically as quality-vs-breadth signal develops.
`QRS_OBSERVATION_PRIORITY_FINDING_OVER_METHOD_V1` — within-doc observation rank: high-strength finding > high-strength claim > etc. Captured as composite ORDER BY in the corpus SQL.
`QRS_CORPUS_91_PCT_ZERO_TICKER_FILTER_HIGH_PRECISION_LOW_RECALL_V1` — empirical: 173/190 docs have empty `tickers_detected`. Plan prompt should advise the LLM that ticker filter is high-precision-low-recall; only set `target_tickers` when ticker-relevance is essential.
`QRS_SQL_DRAFTED_WITHOUT_SUBSTRATE_SCHEMA_LOOKUP_V1` — instance of ADR-0011 violation. I drafted the corpus SQL referencing `o.observation_id` (hallucinated column name); actual column is `obs_id`. Caught by smoke-test failure. Lesson: query substrate before drafting SQL — the cost of asking is one tool call; the cost of guessing is a runtime error.
`HYPOTHESIS_VALIDATION_FAILURES_TABLE_PROPOSED_V1` — log-line is the v1 form; promote to a real table if the failure pattern recurs.
`SUBSTRATE_OLLAMA_MODEL_CAPABILITIES_NOT_EXTRACTED_V1` — ollama models in substrate have null `provider`, `inference_locus`, `capabilities`. Substrate coverage gap. Worth extending an extractor to ingest `ollama list` + per-model capability flags from each host.

**Bookkeeping sentinels:**

`SCRIPT_BACKUP_ADR_TAGGING_PROPOSED_V1` — proposal to suffix backups with ADR number when the change is large enough to warrant an ADR (e.g. `*.bak.adr0017-20260502-1634`); bare-timestamp backups are session-level safety nets.
`EXTRACT_HANDOFFS_NO_SECTIONS_FALLBACK_PENDING_V1` — extractor improvement: when handoff has no `### ` headers, populate `sections_excerpt['_body']` with the truncated full body so substrate readers don't see `{}`.
`HANDOFF_SECTION_HEADER_CONVENTION_PROPOSED_V1` — convention: every handoff and amendment uses `### ` headers, even short ones, so the section-aware extractor populates fields.
`SUMMARIZER_PERMA_STRAGGLER_TINY_DOCS_NO_OBSERVATIONS_V1` — observation: tiny docs (≤30 char title-only stubs) consistently produce zero extractable observations. Current `WHERE NOT EXISTS observations` query catches them on every run forever. Fix is a `documents.summarization_status` column or `processed_but_empty` marker so the next run skips them.
`EXTRACT_SPECS_NOT_SUBSTRATE_CANONICAL_V1` — design docs in `docs/specs/` are not ingested by any extractor; visible to humans + future Claudes via `cat`, but not queryable via substrate. Consider an `extract_specs.py` if this becomes a regular artifact type.

---

### What is pending

**Quant-research-scout v2 — steps 8-14 of implementation order** (per design doc §11). The skeleton at `quant-research-scout-v2-wip.py` exits with `NotImplementedError` for plan/synthesize/reflect phases. Concretely remaining:

Step 8 — phase_plan prompt rewrite to include `target_tickers` and `target_themes` in plan output schema. Plan-phase prompt should explicitly tell the LLM these fields are optional and to leave empty for conceptual cycles. Plan prompt should also know about the corpus's ticker-sparseness per `QRS_CORPUS_91_PCT_ZERO_TICKER_FILTER_HIGH_PRECISION_LOW_RECALL_V1`.

Step 9 — phase_synthesize prompt rewrite. Must enumerate available `doc_id` UUIDs and require every hypothesis to populate `cited_doc_ids` from that exact set (Decision 5 layer 1). Must restructure to consume the corpus dict shape (doc + top_observations[]) rather than the v1 web-content list.

Step 10 — phase_reflect port from v1. Mostly unchanged; new shape uses `PhaseConfig` instead of global `SCOUT_MODEL`.

Step 11 — `write_to_hypotheses_table` rewrite. Must include `cited_doc_ids` in the INSERT column list. Per-cycle hypothesis_id format from v1 is preserved (`qr-YYYYMMDDHHMM-NNN`). Also: legacy JSON file outputs (`quant-research-queue.json`, `scout-scored-quant-YYYYMMDD.json`) — preserve or drop based on Open Question 10.3 in the design doc (who consumes these? if no current consumer, drop).

Step 12 — main cycle wiring. Compose the phases into a single `run_cycle(memory, ad_hoc_query)` function with the scout_runs lifecycle wrapping the whole thing, per-phase metrics captured into `sources_status['phase_metrics']`, validation breakdown into `sources_status['validation']`, corpus filter into `sources_status['corpus_filter']`. Return appropriate exit code based on final_status.

Step 13 — end-to-end smoke test. `--triggered-by test --query "test theme"` against live research DB and live mac2 Ollama. Verify scout_runs row, hypotheses row with non-empty cited_doc_ids, log file shape.

Step 14 — cron schedule. Add line to crontab on spark-cfbd. Initial guess: hourly during market hours. Calibrate after first week.

**Open questions captured in design doc §10.** mac1 LLM endpoint (does the SSH tunnel exist? need to verify); cron cadence; scout-scored-quant-YYYYMMDD.json file consumer (drop or preserve?); plan-phase schema input format (rendered string vs structured JSON).

**Reasoning-mode A/B test for synthesize.** Ships with `QRS_SYNTHESIZE_REASONING_EFFORT=none`. After ≥3 cycles' worth of metrics in scout_runs, flip to `medium`, run ≥3 more, query the metrics for hypothesis quality + completion rates, lock the winner in `/etc/sofar-llm.env`. Per-cycle metrics captured in `sources_status->'phase_metrics'->'synthesize'` make this queryable rather than impressionistic.

**Substrate ingestion run.** At session end (this handoff): run `extract_scripts.py` to refresh stale script edges (research-summarizer.py, both directors, quant-research-scout-v2-wip.py — none currently reflect today's changes), then run `extract_handoffs.py` to ingest this handoff and file all twelve new sentinels. The bare-timestamp on `extract_scripts.py.updated_at` shows it last ran 2026-04-29 23:51 — five days stale.

---

### Operational state and notes

**Hosts:** mac1 (frontier qwen3:235b — endpoint TBD per design doc Open Question 10.1), mac2 (Ollama with qwen3.6 family, mac2-ollama-tunnel.service exposes localhost:11435 from cfbd), spark-cfbd (canonical research-side script host + scout_runs DB writes), spark-73ff (alternative inference host, ran the gap-populator drain Saturday).

**Research DB credentials:** `/etc/neon-research.env` keys `DATABASE_URL` and `DATABASE_URL_DIRECT`. Use subshell-scoped sourcing pattern `( source /etc/neon-research.env && psql "$DATABASE_URL" -c "..." )` to avoid `Done` job-notification leaks revealing the URL in shell history.

**Pause state.** ADR-0004's quant-research pause is partially lifted: directors un-paused Saturday evening (cron-driven), but `sofar-research.service` remains disabled across reboots per 2026-04-29 amendment. The scout v2 we're building feeds the directors' research context but is not the same thing as the paused systemd service.

**Drain state from Saturday evening + this session:** 182/190 → 191/190 once the Reddit doc inserted today is counted. 8 stragglers remain (1 r/investing 830 chars, 7 SeekingAlpha title-stubs ≤71 chars). The r/investing one was today's smoke-test target. The SA stubs perma-fail per `SUMMARIZER_PERMA_STRAGGLER_TINY_DOCS_NO_OBSERVATIONS_V1` — fixing requires the marker-column work.

**Tickers in corpus:** 91% empty. `KNOWN_TICKERS` regex+whitelist is showing limits. Real fix is LLM-side ticker resolution at observation-extraction time. Future work, not blocking.

**File deployment convention this session:** generated patched files in chat → user downloaded to mac2 Downloads → user `scp`'d to spark-cfbd from mac2 → in-place swap or sibling-file deploy on cfbd. For very narrow edits (the director column-name fix, two files × 2-3 line edits), used in-place `sed -i.bak.YYYYMMDD-HHMM` directly on cfbd. Both patterns worked.

**Git auto-pusher** commits + pushes within ~2 minutes of file changes in `/home/bot1/sofar-finance/`. It does NOT run substrate extractors — those are on cron (`extract_handoffs.py` at 03:25 ET, `extract_systems_state.py` 02:00-03:55 ET) OR run manually at session end.

---

### Where to pick up next session

Read order for fast context:

1. This handoff (`2026-05-03-sunday-afternoon-handoff.md`).
2. The design doc at `~/sofar-finance/docs/specs/quant-research-scout-v2-design.md` — eight decisions + implementation order, complete spec for steps 8-14.
3. The skeleton at `~/scripts/quant-research-scout-v2-wip.py` — current state, the stubs you'll be replacing.
4. ADR-0014 §6 (`HYPOTHESIS_GROUNDING_REQUIRED_V1`) and ADR-0017 (`RESEARCH_SCOUT_V2_REBUILD_NOT_MIGRATION_V1`) for architectural backing.

Then proceed with design doc §11 step 8 (phase_plan prompt). The largest design surface is the synthesize-phase prompt (step 9) — that's where the `cited_doc_ids` enumeration logic and the schema-aware hypothesis structure live. Renaissance frame: don't rush the prompts. They define what the scout actually does.

**First action of next session:** check Monday's 07:30 ET director output (item #4 from the original 2026-05-02 handoff backlog — it was time-gated and is now in the past). Validates director column-name fix produced non-empty escalations section.

**Second action:** verify mac1 LLM endpoint exists/works before writing the synthesize phase. `cat /etc/sofar-llm.env | grep -i mac1` and `ss -tlnp | grep 1143` (or whatever port). The skeleton currently defaults synthesize to `http://localhost:11436/v1/chat/completions` which is a placeholder — Open Question 10.1 in design doc.
