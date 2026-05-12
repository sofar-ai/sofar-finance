# 2026-05-11 Monday evening — session handoff

**Author:** bot1 (with Claude)
**Session focus:** Started as Path B graduation-criteria work; pivoted to live infrastructure investigation when director-evening crashed against mac1 at the daily 16:30 cron run. Resolution led to model fleet re-routing, surfacing of a 3-week-silent parser bug, and a broader audit of pipeline scope.

---

## TL;DR for next session

Two real production changes shipped tonight, several findings filed:

1. **Director routed mac1 → mac2.** `/etc/sofar-llm.env` flipped to `OLLAMA_URL=http://localhost:11435/api/generate` and `DIRECTOR_MODEL=qwen3.6:35b-a3b-mlx-bf16`. Tomorrow's 07:30 director-morning + Tuesday 16:30 director-evening will pick up automatically. Eliminates mac1 contention with flow-structure-analyzer.

2. **Director promotion-directive parser fixed.** Regex updated from `hyp-[a-zA-Z0-9\-]+` to `(?:hyp|qr|exp)-[a-zA-Z0-9\-]+` in research-director-evening.py line 252. Committed as `b91bf2b` on sofar-scripts master. **This was a 3+ week silent bug** — director's Section 7c PROMOTE/REJECT directives have been parsed 0-of-N since at least April 20. Tonight's first successful parse applied 7 of 7 directives.

3. **Tonight's 7 directives applied:**
   - PROMOTE → pending_experiment: `qr-202604202313-001` (TDA on IV surface), `qr-202604202313-002` (sentiment-gamma latency), `qr-202604202313-005` (yield curve velocity / macro lead)
   - REJECT: `qr-202604191525-002`, `qr-202604191525-004`, `qr-202604202313-003`, `qr-202604202313-004` (all cite flow_trades history depth as constraint)

Path B (ADR-0026 graduation criteria) was the original session goal and was again deferred. Real work tomorrow.

---

## Sequence of events tonight

**Started:** intended to begin ADR-0026 graduation-criteria work. Threshold tradeoffs (α=margin vs γ=DSR) were discussed; we landed on α + PSR-displayed as the v1 design.

**Pivoted at "why are we even running director while the pipeline is paused":** investigated director-evening's actual workload, found it's doing real work (flow-analysis triage, data-source registry maintenance, hypothesis priority updates, daily summary generation) independent of the paused quant-research pipeline.

**Pivoted again at director-evening crashed at 16:40:** today's 16:30 cron'd run hit a urllib socket timeout against mac1's Ollama. Investigation showed:
- mac1 was contended by flow-structure-analyzer's intraday ~6 calls/hour pattern from spark-73ff
- Director's 24k-token prompt + qwen3:235b generation collided with that load
- urllib's default socket timeout (~10 min) fired before generation completed
- mac1 GPU was observed at 129W sustained AFTER director's client disconnected — Ollama runner kept generating

**Solution decided:** route director to mac2's qwen3.6:35b-a3b-mlx-bf16. Benchmarks per Artificial Analysis: Qwen 3.6 35B A3B Reasoning scores 43 on AAI Index v4.0, reportedly surpassing the older qwen3-235B-A22B on reasoning per Alibaba's release notes. BF16 precision, MLX backend, ~190 tok/s on Apple Silicon.

**Three director-evening test runs needed:**
1. First run (num_predict=8192): 168s, 6222 chars, eval_count=8192. Truncated mid-section-3.
2. Second run (num_predict=16384): 156s, 8867 chars, eval_count=8876. Still truncated — hit implicit num_ctx=32768 boundary (24k prompt + 8.8k output = 32.8k).
3. Third run (num_ctx=65536 added): 113s, 9966 chars, eval_count=6422. Model finished naturally. Section 7c with 7 directives present in DB. Parser STILL reported 0 — leading to the parser-regex discovery.
4. Fourth run (parser regex widened): 7 of 7 directives parsed and applied.

**Pivoted to discord question:** confirmed morning's research-Discord notifications HAVE been working (every `morning-*` row has `posted_to_discord=True` back to April 30). Evening doesn't post by design — morning consolidates and posts. Tomorrow's morning post should show richer content from tonight's applied directives.

**Pivoted to topology mapping:** mapped LLM fleet across mac1, mac2, spark-cfbd, spark-73ff, macmini after operator pushed back that I was missing spark-cfbd's local Gemma usage.

**Pivoted to pipeline-runner failure side-quest:** the 18:00 pipeline-runner cron failed earlier with three simultaneous step timeouts (Macro Signals, Dark Pool, Signals: Fast). Investigation showed it was transient — re-running `--step 2` 90 min later completed all 18 remaining steps cleanly in 21m. While inside that side-quest, surfaced two architectural findings (multi-ticker signal compute is SPY-only-consumed, macro tickers orphaned since March 21).

---

## Production changes shipped tonight

### /etc/sofar-llm.env (system config)
```
OLLAMA_URL=http://localhost:11435/api/generate
DIRECTOR_MODEL=qwen3.6:35b-a3b-mlx-bf16
```
Was previously pointing at mac1.local:11434 with qwen3:235b. Effective immediately for next cron run (07:30 Tuesday director-morning).

### research-director-evening.py (commit b91bf2b)
Three changes in one commit:
- Line 252: regex widened from `hyp-` to `(?:hyp|qr|exp)-` prefix matching
- Line 973: num_predict 8192 → 16384
- Line 974 (new): num_ctx: 65536 added to options dict

### research.hypotheses (DB state)
7 rows updated tonight via apply_promotion_directives:
- 3 → status=pending_experiment with director's promotion reasoning
- 4 → status=rejected with director's rejection reasoning

---

## LLM fleet topology (post-tonight)

| Host | Role | Models | Active LLM consumers |
|---|---|---|---|
| **mac1** | frontier-inference (effectively single-purpose) | qwen3:235b (193GB VRAM, pinned forever) | flow-structure-analyzer (spark-73ff systemd, ~6 calls/hr intraday) |
| **mac2** | multi-inference | qwen3.6:35b-a3b-mlx-bf16 (~70GB BF16), qwen3.6-substrate, qwen3.5:9b variants, more | **research-director-{evening,morning} (NEW tonight)**, substrate small-model workloads, MCP via macmini |
| **spark-cfbd** | data + cron + local-Gemma inference | gemma4:e4b (8B), gemma4:26b (25.8B), gemma4:31b (31.3B) | 14 tracked scripts: event-monitor, flow-intelligence, market-monitor-daemon, generate-daily-summary, overnight-synthesis, overnight-research-daemon (paused), quant-research-scout (paused), research-summarizer (paused), news sentiment scoring, ticker analysis, more |
| **spark-73ff** | flow analysis compute | none (calls mac1) | flow-structure-analyzer systemd |
| **macmini** | workstation + Claude Desktop host | n/a | SSH client, MCP tool surface, operator's primary work env |

Substrate's node table currently has only mac1 and mac2 (probed every ~24h). mac1's role label `frontier-inference` is now accurate for one workload only. mac2's role label `mcp-host` is incomplete — should expand to reflect director-inference role. spark-cfbd's Gemma fleet isn't surfaced as a node-level role at all (coverage gap).

---

## Findings worth filing as sentinels

### Fixed tonight
- **`DIRECTOR_PROMOTION_PARSER_REGEX_HYP_PREFIX_MISMATCH_V1`** — parser regex required `hyp-` prefix but production hypothesis IDs use `qr-` prefix. Silently dropped all promotion directives from at least 2026-04-20 (probably earlier — that's just the oldest log line we checked). Fixed in commit `b91bf2b`.
- **`DIRECTOR_OLLAMA_NUM_CTX_DEFAULT_32K_TRUNCATES_LARGE_PROMPT_RESPONSES_V1`** — Ollama defaults num_ctx to 32768. Director's 24k-token prompt left only ~8k of output budget regardless of num_predict. Mitigated by explicit num_ctx=65536 in the script.

### Outstanding (real findings, no current action)
- **`DIRECTOR_HTTP_NO_TIMEOUT_AGAINST_MAC1_OLLAMA_V1`** — director's urllib calls inherit Python's default socket timeout (~10 min on most configs). With qwen3:235b generation under mac1 contention, this caused today's 16:40 crash. After tonight's mac2 routing, the path is less contended but the underlying timeout discipline issue remains. Real fix: explicit `timeout=1800` on the urllib request + use `/api/cancel` if budget exceeded so Ollama doesn't keep generating to dead clients.
- **`OLLAMA_GPU_STAYS_PINNED_AFTER_CLIENT_DISCONNECT_V1`** — observed 129W GPU on mac1 for 30+ min after director's urllib disconnect. Ollama's `aborting completion request due to client closing the connection` log message is the INTENT to abort, not the COMPLETION of abort. Workaround: `kill <runner_pid>`; parent Ollama re-spawns runner on next request. Upstream Ollama issue worth tracking.
- **`SUBSTRATE_STATIC_ANALYSIS_MISSES_ENV_DRIVEN_MODEL_TARGETS_V1`** — substrate's `find_llm_calls` for qwen3:235b returns only flow-structure-analyzer.py. Misses director-{evening,morning} which set model via `DIRECTOR_MODEL` env var sourced from `/etc/sofar-llm.env`. Static analysis pattern-matches literal model name strings; env-driven config invisible.
- **`SUBSTRATE_NODE_ATTRS_MISS_MULTI_ROLE_INFERENCE_HOSTS_V1`** — spark-cfbd has 3 loaded Gemma models and 14 active scripts calling its local Ollama, but isn't represented in the substrate `node` table at all (only mac1 + mac2 are). mac2's `role: mcp-host` doesn't capture the new director-inference role.
- **`PIPELINE_RUNNER_18Z_TRANSIENT_TIMEOUT_CASCADE_V1`** — at 18:00 today, three pipeline-runner steps (Macro Signals, Dark Pool, Signals: Fast) timed out simultaneously, both retries failed. 90 min later all three completed in <50s each. Strongly suggests transient external/network/cold-start cause. If recurs at 18:00 tomorrow, becomes pattern; if not, transient.
- **`PIPELINE_RUNNER_STEP_VALIDATOR_SINGLE_SIGNAL_COVERAGE_V1`** — every pipeline-runner step's `validate` lambda checks ONE signal/file. Step 5 (Signals: Fast) iterates many tickers but validator checks only `rsi_14 == today`. ^VIX has been silently stale for 7+ weeks (since 2026-03-19) and pipeline never noticed. This is structural to the validator pattern, not isolated to step 5.
- **`LGBM_PRODUCTION_PIPELINE_SPY_ONLY_DESPITE_MULTI_TICKER_SIGNAL_COMPUTE_V1`** — compute_fast.py writes signals for 12 equity tickers daily (SPY, QQQ, IWM, DIA, AAPL, NVDA, TSLA, META, MSFT, AMD, AMZN, GOOGL). lgbm-predictor only ever runs with `--ticker SPY`. 11 of 12 tickers' signals are computed daily and unconsumed.
- **`MACRO_TICKER_SIGNALS_ORPHANED_FROM_2026-03-21_BACKFILL_V1`** — 5 macro tickers (GLD, UNG, USO, ^GSPC, ^VIX) have 4 signal_names each in signal_values, all stuck on 2026-03-19, all written in a single batch at `computed_at=2026-03-21 15:47 UTC` by `compute_and_store.py`. Not part of compute_fast.py's all-tickers list. No active writer, no current consumer.

---

## What was deferred AGAIN tonight

**ADR-0026 (graduation criteria + PSR module + sandbox-graduator + graduation-surfacer)** — the original session goal at start of evening. Design discussion advanced; decisions locked on:
- Thresholds: sharpe_delta > 0.10 AND new_signal_rank ≤ 3 AND validation_days ≥ 2000 (4 of 7 current sandbox validations pass)
- Decision authority: operator-reviewed via `sandbox-graduator.py` with `approve` + `execute` subcommands mirroring ADR-0023 executor pattern
- Surfacing: separate cron'd `graduation-surfacer.py` posting to Discord daily, re-notify-until-graduated-or-dismissed pattern
- Statistics: α + PSR-displayed for v1 (DSR-gating deferred to future ADR after we resolve the trial-count question)
- Out of scope: auto-graduation, director re-decision against sandbox sharpes, multi-version concurrent graduation, demotion

**Implementation pieces NOT started:**
- `~/scripts/psr.py` — Probabilistic Sharpe Ratio helper (closed-form, ~50 lines, no DB)
- `migrations/20260512-experiments-graduation-tracking.sql` — adds `graduated_at`, `graduated_to_version`, `review_dismissed_at`, `review_dismissed_reason` columns + index
- `migrations/20260512-add-psr-columns.sql` — adds `enhanced_psr`, `enhanced_psr_benchmark` to experiment_sandbox_validations
- Extend `validate-sandbox-signal.py` to compute and store PSR per signal
- `~/scripts/sandbox-graduator.py` — operator-invoked approve/execute tool
- `~/scripts/graduation-surfacer.py` — cron'd Discord notifier
- ADR-0026 document (writeup after implementation, Option-3 pattern matching ADR-0025)

This is the work to start tomorrow if not deferred further.

---

## State changes worth re-checking tomorrow

### Tomorrow 07:30 ET — director-morning runs against new config
First time director-morning hits mac2/qwen3.6:35b on production cron. Watch:
- `~/logs/director-morning.log` for any timeout or error
- `daily_summaries WHERE run_id = 'morning-2026-05-12'` for posted_to_discord=True
- Discord research channel for actual post content quality
- The post should be richer than recent ones because tonight's 7 applied directives changed hypothesis state in ways morning will see

### Tomorrow 16:30 ET — director-evening runs against new config
First time director-evening hits mac2 on production cron (tonight's were manual --force runs).
- Should complete cleanly under 200s now (vs. today's 10-min timeout on mac1)
- Should parse N > 0 promotion directives now
- More directives = more hypothesis state changes accumulating

### Tomorrow 18:00 ET — pipeline-runner
If today's 18:00 timeout cascade recurs at 18:00 Tuesday → pattern worth investigating. If not → confirmed transient.

---

## Operator notes carried forward

- macmini is the workstation NOW (running Claude Desktop). Not mac2 anymore. macmini is the SSH origin, the MCP tool host, and the future cron-migration target.
- Substrate is reliable; my discipline of using it wasn't. Lesson: substrate-first, hosts-second, code-on-disk-third for any topology/fleet question.
- Schema-check the table before writing a query against it. Multiple wasted round trips tonight on column-name guesses (signal_values, prices_daily, daily_summaries, hypotheses).
- /etc/sofar-llm.env is the single source of truth for director's model + endpoint. Direct env-var override at invocation works for testing. System config change for production.
- When sed misbehaves on regex characters, switch to a Python heredoc with explicit `content.replace()` rather than wrestling shell escaping.
- "We're at the operator intervention, i have to prompt to even see what surfaced?" — your point on graduation-surfacing carries forward as design constraint. Push-style notifications (Discord) over pull-style queries.

---

## Files SCP'd / committed tonight

- `~/scripts/research-director-evening.py` — edited in place on spark-cfbd, committed as `b91bf2b` on sofar-scripts master
- `/etc/sofar-llm.env` — edited via sudo sed (system config, not in git)

No new ADRs committed tonight. No new migrations.

---

## Git commits this session

In sofar-scripts (master):
- `b91bf2b` — DIRECTOR_PROMOTION_PARSER_REGEX_HYP_PREFIX_MISMATCH_V1: widen ID regex (also includes num_predict + num_ctx bumps)

In sofar-finance (main):
- None this session.

---

## Next-session direction (revised)

**Tomorrow (Tuesday 2026-05-12):**

1. Verify morning director run via Discord post + log + DB row (5 min audit, no action needed if clean)
2. Start ADR-0026 implementation: PSR module → migrations → validator extension → sandbox-graduator → graduation-surfacer
3. ADR-0026 writeup at end, Option-3 pattern

**This week:**
- Path B finish (ADR-0026 + implementation)
- ADR-0027 candidate: director re-decision against experiment_sandbox_validations.enhanced_sharpe
- Maybe begin substrate node attrs refresh to reflect tonight's topology changes

**Path A still queued:**
- quant-research-scout v2 phases 1/3/4 implementation per `/home/bot1/sofar-finance/docs/specs/quant-research-scout-v2-design.md` (locked design from 2026-05-03)
- Un-pause scrapers v2, eventually un-pause daemon

Real total to close the loop: ~3-5 sessions from here.

---

## Working tree hygiene flag (carries forward from last handoff)

sofar-scripts repo still has substantial uncommitted state: 11 modified files (db.py, research-director-morning.py, research-lab-scraper.py, research-scout-scraper.py, research-summarizer.py, synthesis-trigger.py, activate-weights.py, heartbeat-cron.sh, models/*.json) plus ~40 untracked files (substrate extractors, data-gap-populator.py, form4-*, cot-*, quant-research-scout-v2-wip.py, send_discord.py, more). Not tonight's problem. Tonight only research-director-evening.py was added to the committed set.
