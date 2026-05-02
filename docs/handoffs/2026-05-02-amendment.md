# Session Amendment — 2026-05-02 Early Morning

**Filed**: 2026-05-02 ~04:00 ET
**Amends**: 2026-05-01-evening-handoff.md
**Captures**: Stages 1-3 of DATA_SOURCE_MAPPING_PENDING_V1 shipped, plus
new sentinel for TABLE_DB_MAP routing gaps surfaced by Stage 3 dry-run.

## What shipped tonight

After tonight's Firewalla cutover handoff, work continued on substrate dev:

### Quick wins (closed earlier sentinels)

1. **`SUBSTRATE_SYSTEMD_UNIT_FILTER_TOO_NARROW_V1` → resolved**
   - extract_systemd_units.py v3 walks both system and user systemd dirs
   - Allowlist broadened: sofar-*, hermes-*, thetadata*, ollama*
   - User-scope detection uses XDG_RUNTIME_DIR=/run/user/$(id -u bot1) for
     correct connection to user systemd manager
   - hermes-gateway.service now extractor-canonical (was manual seed only)
   - 9 systemd_units tracked (was 6)

2. **`SUBSTRATE_NO_NETWORK_TOPOLOGY_V1` → resolved**
   - Manual SQL seed for 2 network entities (home-net, cluster-net)
   - cluster-net carries reserved_ips for all 4 hosts in attrs
   - Relationships: cluster-net → upstream → home-net, all 4 nodes →
     on_network → cluster-net

### Data registry (Stage 1-3 of DATA_SOURCE_MAPPING_PENDING_V1)

**Stage 1: data_source entities — dynamic discovery**

- New file: `~/scripts/config/data_source_metadata.yml` (curated provider
  reference data: base_url, requires_api_key, env_file, env_var,
  cost_model, rate_limit_note, plus discovery hints)
- New script: `~/scripts/extract_data_sources.py` walks all script entities,
  applies discovery rules from yml (env_file_match, filename_prefix_match,
  ollama_url_substring, additional_callers), upserts data_source entities
  for providers actually referenced, emits `script -> reads_from -> data_source`
- 11 data_source entities canonical (anthropic, cftc, finra, fmp, fred,
  google_trends, ollama-local, polymarket, sec_edgar, thetadata, yahoo)
- 2 yml entries unreferenced (ollama-mac1, openai) — awaiting actual usage
- 33 reads_from relationships
- Cron: 40 3 * * * (after extract_scripts at :30 and extract_systemd_units :35)

**Stage 2: data_table entities — aggregated from existing column entities**

- New script: `~/scripts/extract_data_tables.py`
- 77 data_table entities (29 market, 33 production, 15 research)
- Per-table attrs: column_count, columns array (ordinal-sorted),
  column_types dict, timestamp_columns list (signal for Stage 4 freshness),
  has_id_column flag
- Auto-archives orphan entities when extract_db_schema drops columns
- Cron: 45 3 * * *

**Stage 3: writes_to / reads_from relationships — script ↔ data_table lineage**

- New script: `~/scripts/extract_data_relationships.py`
- Re-parses script source files for SQL operations (INSERT/UPDATE/DELETE/
  FROM/JOIN regexes after stripping comments)
- Critical design decision: parses `db.py`'s `TABLE_DB_MAP` dict directly
  via `ast.literal_eval` (safe). Uses it as authoritative routing source
  for every script that imports db.py. This eliminates the ambiguity that
  comes from tables existing in multiple databases (e.g., gex_historical
  in both market and production)
- 162 lineage relationships emitted (60 writes_to, 102 reads_from)
- 121 of 132 scripts processed (11 skipped — no path attr or unreadable)
- 7 scripts with ambiguous refs (see sentinel below)
- Cron: 50 3 * * *

### Verification queries that now work against substrate

```
-- Who writes prices_daily?
SELECT s.name FROM relationships r
  JOIN entities s ON s.id=r.src_id
  JOIN entities d ON d.id=r.dst_id
WHERE d.name='market.public.prices_daily' AND r.type='writes_to';
-- → ingest-fmp-prices.py, ingest-yahoo-futures.py

-- Who depends on gex_historical?
SELECT s.name, r.type FROM relationships r
  JOIN entities s ON s.id=r.src_id
  JOIN entities d ON d.id=r.dst_id
WHERE d.name='market.public.gex_historical'
  AND r.extractor='extract_data_relationships.py';
-- → backcompute-gex.py (writes_to + reads_from)
-- → backcompute-vol-regime.py, experiment-orchestrator.py, health-check.py (reads_from)

-- Walk: data_source → ingester → table
-- (combine reads_from on data_source side + writes_to on data_table side)
```

## Sentinels captured this amendment

### New sentinel for TABLE_DB_MAP gaps

**`DB_PY_TABLE_DB_MAP_INCOMPLETE_V1`**

Stage 3 surfaced 7 scripts with ambiguous table references because db.py's
TABLE_DB_MAP doesn't include entries for these tables. Without TABLE_DB_MAP
entries, db.py routes calls to `_DEFAULT_DB` (production) — which means
scripts may be silently hitting the wrong database when invoked without
explicit `db=` kwarg.

**Tables missing from TABLE_DB_MAP (need to be added):**

| Table | Likely correct DB | Used by |
|---|---|---|
| `signal_values` | production | ai-synthesis.py, overnight-research-daemon.py, quant-research-scout.py |
| `flow_session_metrics` | market | ai-synthesis.py |
| `flow_trades` | market | flow-intelligence.py |
| `flow_analysis` | market or production | research-director-evening.py |
| `experiments` | research | overnight-research-daemon.py, quant-research-scout.py, research-director-evening.py, research-director-morning.py |
| `experiment_knowledge` | research | overnight-research-daemon.py |
| `data_source_registry` | research | data_scout_framework.py, research-director-evening.py, research-director-morning.py |

**Fix when convenient:** edit `~/scripts/db.py`, add these entries to
TABLE_DB_MAP. Re-run `python3 ~/scripts/extract_data_relationships.py`
afterward — the 7 ambiguous scripts will resolve cleanly and the
relationship count will go from 162 to ~180+.

This is non-blocking — substrate is functional without these. But it does
mean those 7 scripts may have silent wrong-DB risk if called without
explicit db= arg. Worth fixing before any production-critical refactor.

### Other follow-up sentinels

**`SUBSTRATE_DATA_SOURCE_DISCOVERY_BASEURL_MATCHING_PENDING_V1`**

extract_data_sources.py currently uses 4 discovery rules (env_file_match,
filename_prefix_match, ollama_url_substring, additional_callers). The
additional_callers list is a manual override — not ideal long-term. A
more dynamic approach would parse script source files for hostname matches
against data_source.attrs.base_url. This catches scripts that reference
a provider in code without env files or naming conventions.

Not urgent. Workaround (additional_callers) handles current cases.

**`STAGE_4_DATA_FRESHNESS_PENDING_V1`**

Stage 4 of data registry not yet implemented. Plan: walk data_table entities,
query the appropriate ingestion_log table (production or market depending on
table.attrs.database) for `MAX(completed_at) WHERE status='success' AND
table_name=<table>`. Update data_table.attrs with `last_ingested_at`,
`last_ingest_status`, `freshness_age_seconds`. Emit drift events when
freshness exceeds a per-table threshold.

This is the operational signal that turns the registry from descriptive
(what feeds what) into actionable (what's stale).

Estimated ~1 hour focused work. Deferred to next session.

## Operational notes for next session pickup

- Stage 1 (extract_data_sources.py): live, in cron @ 40 3 * * *
- Stage 2 (extract_data_tables.py): live, in cron @ 45 3 * * *
- Stage 3 (extract_data_relationships.py): live, in cron @ 50 3 * * *
- Stage 4: pending, see sentinel above
- Cron timing: scripts → systemd → data_sources → data_tables → relationships,
  in that order, each 5 min apart starting at 30 3

## Substrate state at end of session

- 4 nodes on 192.168.51.x (mDNS-resolved)
- 9 systemd_units (system + user scope, broader allowlist)
- 5 launchd_agents (mac1 + mac2)
- 2 network entities + cluster-net incoming edges + upstream edge
- ~155 scripts with host attribution
- 11 data_source entities (provider canonicalization)
- 77 data_table entities (across market/production/research)
- 24 llm_call entities
- 33 reads_from (script → data_source) relationships
- 162 lineage relationships (script ↔ data_table)
- DB schema (production + market + research)
- ~75+ sentinels canonical
- Pipeline: rerun successfully May 1 evening
- Discord alerting: working with User-Agent header (rotate webhook URL TODO
  for May 2)
- Substrate refresh: every 15 min via extract_systems_state.py --health-only

## Pending TODO list

### Immediate
1. **Rotate Discord webhook URL** — captured during this session
2. **Add TABLE_DB_MAP entries for 7 missing tables** in `~/scripts/db.py`
   per `DB_PY_TABLE_DB_MAP_INCOMPLETE_V1` sentinel above
3. **Stage 4: extract_data_freshness.py** — query ingestion_log for last
   completion per (source, table_name), populate data_table freshness attrs

### Strategic / deferred (unchanged from prior handoff)
- UPS cross-shutdown automation
- Quant research unpause readiness checklist (per ADR-0004)
- P620 workstation decision (defer until workload profiled)
- MLflow self-hosted vs Weights & Biases consideration
- NAS consideration (defer until storage is a constraint)
- s2 → mac2 consolidation
- SSH key passphraseless tightening (now needs from="192.168.51.0/24")
- Hermes-OLLMCP integration
- OLLMCP session-handover prompt generation capability
