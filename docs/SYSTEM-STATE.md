# SOFAR System State

**Updated:** 2026-04-25 (initial seed under CONTINUITY_PROTOCOL_V1)
**Purpose:** Single source of truth for "what is the system doing right now"
**Format:** see CONTINUITY-PROTOCOL.md § Layer 3

This file is *mutable* and *current*. When state changes, this file gets updated *in the same commit as the change*. It is NOT a history log — closed issues get removed; the audit trail lives in commit history + handoffs.

---

## Hardware inventory

| Node | Hostname | Role | Status |
|------|----------|------|--------|
| Spark #1 | spark-cfbd | Production main | running |
| Spark #2 | spark-73ff (S2) | GPU inference (Ollama) | running |
| Mac Studio | (TBD) | Status unclear — verify | unknown |
| Spark #3 | (GB10, on order) | Role TBD — see ADR pending | not yet provisioned |

Network: 8-port 10GbE switch planned; two Sparks linked via 200GbE ConnectX cable.

---

## Services

### Running on Spark #1 (spark-cfbd)

| Service | Type | Status | Notes |
|---------|------|--------|-------|
| sofar-flow-tape.service | systemd | running | Live ThetaData WebSocket ingest, $50K+ filter |
| git-push-queue (cron */2 min) | cron | running | V2 hardened (GIT_PUSH_QUEUE_V2). Heartbeat on :00 / :30. |
| sofar-research.service | systemd | **stopped** | Per ADR-0004 quant-research pause |

### Running on Spark #2 (S2)

| Service | Type | Status | Notes |
|---------|------|--------|-------|
| Ollama | daemon | running | Hosts qwen3.6:35b-a3b (Q4_K_M). Serves intraday-synthesis + research-director. |

---

## Crons — active and paused

### Production crons (active)
| Schedule | Script | Purpose |
|----------|--------|---------|
| `*/2 * * * *` | `git-push-queue.sh` | Auto-commit data files to GitHub, V2 |
| `0 7 * * 1-5` | `overnight-synthesis.py` | Morning brief (Opus) |
| `30 7 * * 1-5` | `research-director-morning.py` | **See open issue below** |
| `30 16 * * 1-5` | `research-director-evening.py` | **See open issue below** |
| `45 12,14,15 * * 1-5` | `synthesis-trigger.py` | Conditional Opus synthesis on material change |
| `5 22 * * 0-4` | `synthesis-trigger.py` | Evening conditional synthesis |
| `9 18 * * 1-5` | `pipeline-runner.py` | 20-step EOD pipeline, validator-only Step 0 |
| Various | `intraday-synthesis-local.py` | 6×/day market hours via qwen on S2 |
| Various | Ingest crons | FMP, FINRA, ThetaData, Yahoo, Polymarket, FRED, etc. |

### Paused crons (per ADR-0004)
| Schedule | Script | Why paused |
|----------|--------|-----------|
| (5 lines tagged `# QR-PAUSED:`) | quant-research generation crons | Hallucinated signals + orphan promotions; awaiting Builds 1-6 |

### Pending crons (queued but not installed)
| Schedule | Script | Status |
|----------|--------|--------|
| `30 09 * * 6` | `ingest-cftc-cot.py --weekly` | Designed, not yet added to crontab. After install, verify first Saturday fire then flip CFTC sources to status=production. |

---

## Data sources (per data_source_registry)

| Source | Tier | Status | Notes |
|--------|------|--------|-------|
| ThetaData flow trades | 2 | production | Live WebSocket; `flow_trades` table |
| FMP prices | (TBD) | production | |
| FMP earnings | (TBD) | production | |
| FINRA dark pool | (TBD) | production | |
| Yahoo futures | (TBD) | production | |
| FRED | (TBD) | production | |
| Polymarket | (TBD) | production | **Known issue:** registry row has `table_name='ingestion_log'` but data lands in `signal_values`. Fix queued. |
| CFTC TFF (`cftc_cot_tff`) | 1 | **pilot** | Initial backfill 2007-2026 complete (20,120 rows). Awaiting first weekly cron fire. |
| CFTC DCOT (`cftc_cot_dcot`) | 1 | **pilot** | Initial backfill 2007-2026 complete (30,222 rows). Awaiting first weekly cron fire. |

---

## Known issues (open)

### A. Research-director narrates stale experiments during quant-research pause — **high priority**
The `research-director-morning.py` cron (7:30 AM) still runs. With quant-research paused, no new experiments occur — but the director reads existing `experiments`/`hypotheses` rows and narrates them as "overnight activity." Result: morning briefs sound like they reflect fresh work but reflect pre-pause backlog. Risk: user may act on PROMOTE directives thinking they're informed by new evidence.

**Fix options:** (a) explicitly pause the two director crons, OR (b) add a freshness gate that refuses to write a brief if no experiments completed in last 24h.

### B. SPX universe gap — `Consolidated` vs `E-MINI` — **medium priority**
The CFTC `E-MINI S&P 500` market name only has 219 rows (2022-02-08 onwards). The 16-year history is on `S&P 500 Consolidated` (827 rows from 2010). For SPX signals with >4yr lookback, query the Consolidated name. Both are in the universe and ingested; just need to use the right one.

### C. db.py `_detect_table` regex bug — **medium priority**
The regex matches `FROM` inside `EXTRACT(YEAR FROM col)`, causing misroute when query contains aggregations. Workaround: pass explicit `db='market'`. Real fix queued.

### D. Polymarket registry row wrong — **low priority**
`data_source_registry` for polymarket has `table_name='ingestion_log'`; data actually lands in `signal_values`. One-line UPDATE.

### E. Mac Studio status unclear — **low priority**
Used to host Ollama; current state unknown. Verify whether it's still in the picture.

### F. ~/scripts hygiene — secondary cleanup needed — **low priority**
- `signals/experimental/` directory empty but not write-protected
- `models/*.pkl` gitignored but not backed up off-disk
- `.pre-*` rollback file retention policy undefined

---

## Build queue

In rough priority order. Items get promoted to "open issues" when worked on.

1. Address research-director freshness (issue A above)
2. Install Saturday CFTC weekly cron + flip to production after first fire
3. Synthesis model-provenance in dashboard UI (`model` field in JSON, render alongside timestamp)
4. db.py `_detect_table` fix
5. Quant-research **Builds 1-6** (Schema injection / smoke-test gate / cleanup / promote-signal / bless-weights / re-enable compute)
6. ~/scripts secondary hygiene (issue F above)
7. CFTC-UNIVERSE-CATALOG.md (full IN/SKIP rationale doc)
8. Polymarket registry fix
9. GB10 provisioning when hardware arrives — role TBD
10. Continuity protocol meta-evolution (review effectiveness after ~10 sessions of use)

---

## Sentinels in active use

Non-exhaustive list of sentinels currently alive in code/DB:

- `MULTIDB_REFACTOR_V1` — initial three-DB split (ADR-0001)
- `DB_TABLE_ROUTING_V1` — db.py table-aware routing
- `CFTC_COT_V1` — CFTC ingestion (ADR-0002)
- `SESSION_DATE_FALLBACK_V1` — flow-trades + flow-analysis API
- `DATE_SELECT_GTH_AWARE_V1` — date dropdown
- `GIT_PUSH_QUEUE_V2` — current cron version (ADR-0003)
- `STEP0_VALIDATOR_ONLY_V1` — pipeline-runner Step 0
- `API_BIFURCATE_V1` — flow-aggregates + unusual-flow API
- `DUAL_FILE_READ_V1` — js/ai-synthesis.js merging two synthesis files
- `UNUSUAL_FLOW_DEDUP_V1` — earlier migration
- `SYNTHESIS_UNUSUAL_FLOW_V1` — earlier migration
- `CONTINUITY_PROTOCOL_V1` — this whole continuity system (ADR-0006)
