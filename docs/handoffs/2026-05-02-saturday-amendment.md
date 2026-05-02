# Session Amendment — 2026-05-02 Saturday

**Filed**: 2026-05-02 ~midday
**Amends**: 2026-05-02-amendment (early morning), 2026-05-01-evening-handoff
**Captures**: TABLE_DB_MAP investigation closed correctly, resolver v3 shipped,
plus design knowledge from database-routing.md + addendum that wasn't yet
captured in substrate.

## Corrections to prior amendment

The early-morning amendment recommended adding `signal_values: production` to
TABLE_DB_MAP. **That recommendation was wrong** per ADR-0001 +
database-routing.md. signal_values is canonical in **market** — it's a
"computed technical signal" which falls under market's lifecycle bucket per
the routing map. The current TABLE_DB_MAP entry pointing it to market is
correct and should not be changed.

The early-morning amendment also recommended adding `data_source_registry` to
TABLE_DB_MAP. **Also wrong** — per database-routing.md, this table is
intentionally duplicated in BOTH market AND research with different semantics,
and "Scripts must always specify `db=` explicitly for this table." It does
not belong in TABLE_DB_MAP at all. Removed during today's session.

## What shipped today

### Neon research DB password rotation
Connection strings (with credentials) appeared in chat output earlier this
week during psql verification. Rotated the research DB password via Neon
console, updated `/etc/neon-research.env`. extract_db_schema.py runs clean
against the new credentials (1404 column entities scanned, 20 updated, 0
errors).

### TABLE_DB_MAP corrections
- Removed `'data_source_registry': 'market'` entry from TABLE_DB_MAP per
  database-routing.md design rule (this table requires explicit `db=`)
- All other entries verified correct against ADR-0001 + database-routing.md

### extract_data_relationships.py v3 — resolver fix
- **Removed `uses_db_py` gate** in resolver Case C. Per ADR-0001 +
  database-routing.md, TABLE_DB_MAP is the canonical routing source globally
  — not just for scripts that import db.py. The earlier gate was overcautious
  and caused 7 scripts to come back ambiguous when they should have resolved
  via the canonical map.
- Result: relationship count went from 162 → 176 (gained 14)
- 4 scripts remain ambiguous — exactly the design-correct set: scripts
  touching `data_source_registry`. These need explicit `db=` per design rule.

### Stage 3 final state in substrate
- 65 writes_to relationships
- 113 reads_from relationships
- 176 total script ↔ data_table lineage relationships
- Quant pipeline traceable end-to-end (data_source → ingester → table → consumer)

## New sentinels captured from design docs

These were documented in `database-routing.md` and the
`database-routing-addendum-2026-04-20.md` but not yet substrate-canonical.

### Production cleanup pending

**`PRODUCTION_SHADOW_TABLES_PENDING_DROP_V1`**

database-routing.md lists ~25 tables in `sofar-production` that are leftover
from the pre-migration state. Production copies are NOT canonical and should
not be read from or written to. They're slated for DROP once the script
audit (Phase 2) confirms nothing still touches them.

Tables to drop from production:
- Research-side originals: `experiments`, `experiment_knowledge`, `backtest_runs`,
  `backtest_daily_results`, `weight_sets`, `weight_change_log`, `signal_attribution`
- Market-side originals: `flow_trades`, `flow_session_metrics`,
  `flow_sweep_rollups`, `flow_baselines`, `flow_analysis`, `options_eod`,
  `options_flow_historical`, `prices_daily`, `prices_intraday`,
  `dark_pool_volume`, `gex_historical`, `vix_daily`, `vol_regime_historical`,
  `treasury_rates`, `signal_values`, `trading_calendar`, `symbol_sectors`,
  `earnings_calendar`, `ingestion_log`

Pre-drop checklist:
1. Audit the 7 NEEDS-AUDIT scripts (sentinel below)
2. Verify no script still writes to production-side copies
3. Take pg_dump of production before drop
4. DROP tables in batches with monitoring

### Intentional duplication

**`DATA_SOURCE_REGISTRY_INTENTIONAL_DUAL_DB_V1`**

`data_source_registry` exists in BOTH market AND research with different
semantics — they share a name but are different registries:
- `market.data_source_registry`: sources of raw market data (FRED, Yahoo,
  FMP, ThetaData, etc.)
- `research.data_source_registry`: sources Data Scout has discovered or
  piloted for hypothesis testing

Scripts using this table MUST specify `db=` explicitly. The resolver in
extract_data_relationships.py correctly leaves these references as ambiguous
to surface the requirement. Do NOT add this table to TABLE_DB_MAP.

Currently-affected scripts (must specify db= explicitly):
- `data_scout_framework.py`
- `research-director-evening.py`
- `research-director-morning.py`
- `verify-source.py`

### db.py shim bug pattern

**`DB_PY_SHIM_IMPORT_ORDER_BUG_V1`**

Documented in database-routing-addendum-2026-04-20.md. Scripts using the
multi-DB shim pattern can have a capture-time bug where:
```python
from db import execute_query   # ← captures original BEFORE shim
import db as _db_module
_original = _db_module.execute_query
def _patched(*args, **kwargs):
    kwargs.setdefault('db', 'market')
    return _original(*args, **kwargs)
_db_module.execute_query = _patched
```

The local `execute_query` name still points at the unpatched original. Calls
within the script silently route to default (production), while external
callers see the patched version. Confirmed in
`refresh-flow-aggregates.py` 2026-04-20.

**Audit needed**: scripts containing the shim pattern. Grep:
```bash
grep -lE "_db_module\.execute_query\s*=\s*_patched" ~/scripts/*.py
```
For each match, verify `from db import` happens AFTER patch assignment.

### Session date semantics

**`SESSION_DATE_USE_GET_REAL_SESSION_DATE_HELPER_V1`**

Per database-routing-addendum-2026-04-20.md (corrected 2026-04-21):
`CURRENT_DATE` and `fn_session_date(NOW())` both correctly return the CBOE
GTH session date — not a bug. The real issue is **session_date semantics
ambiguity** between ingestion (wants GTH session) and analysis (wants most
recent completed RTH-heavy session).

Right primitive for analytical queries:
`session_date_helper.get_real_session_date(conn, min_premium_usd=1e9)` —
returns the most recent session_date with > $1B total premium. Filters
out thin GTH-only sessions automatically.

Callers wired (do not change):
- `unusual-flow-detector.py` ✓ wired 2026-04-21
- `api/flow-aggregates.js` uses >$1B CTE (SESSION_DATE_FIX_V1)
- `ai-synthesis.py` uses `prior_real` CTE
- `flow-tape-daemon.py` writes session_date = CURRENT_DATE — **correct,
  do not change** (CBOE GTH semantics)

Callers that may need review:
- `flow-intelligence.py` line 213 — different use case (per-symbol last-seen)
- Any new script querying "today's session" — use the helper

### DDL migration assertion pattern

**`MIGRATION_TARGET_DB_ASSERTION_PATTERN_V1`**

Per database-routing-addendum-2026-04-20.md. Every DDL migration MUST begin
with a target-DB assertion that aborts the transaction if it lands in the
wrong DB:

```sql
BEGIN;

DO $assert$
DECLARE
    has_marker_table BOOLEAN;
    has_wrong_marker BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='macro_signals' AND table_schema='public') INTO has_marker_table;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='positions' AND table_schema='public') INTO has_wrong_marker;

    IF NOT has_marker_table THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: not the expected DB. Aborting.';
    END IF;
    IF has_wrong_marker THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: hit wrong DB. Aborting.';
    END IF;
END
$assert$;

-- ... actual migration here ...

COMMIT;
```

Use unique-table EXISTS checks because all three DBs return `neondb` from
`current_database()`. Marker tables per DB:
- Market-only: `macro_signals`
- Production-only: `positions`
- Research-only: `hypotheses`

### Neon endpoint mapping

**`NEON_ENDPOINT_PER_DB_V1`**

All three Neon DBs are named `neondb` internally — only the endpoint
hostname distinguishes them. `current_database()` and `inet_server_addr()`
return identical values across all three.

| DB | Endpoint hostname | Env file |
|----|-------------------|----------|
| sofar-production | `ep-dry-tooth-ankd0chu` | `/etc/neon-production.env` |
| sofar-market-data | `ep-rough-star-an3dv074` | `/etc/neon-market.env` |
| sofar-research | `ep-old-shadow-amf6u6f6` | `/etc/neon-research.env` |

`/etc/neon.env` is a symlink to `neon-production.env` (legacy fallback).
`/etc/neon-market-reader.env` exists for read-only consumers.

For DDL/long transactions: use `$DATABASE_URL_DIRECT` (bypasses pgbouncer).
For short queries: use `$DATABASE_URL` (pooled).

### Scripts pending DB-routing audit

**`SCRIPTS_PENDING_DB_ROUTING_AUDIT_V1`**

Per database-routing.md, these scripts are flagged NEEDS AUDIT or NEEDS
VERIFICATION for DB-routing correctness:

| Script | Status | Concern |
|---|---|---|
| `flow-intelligence.py` | NEEDS AUDIT | reads/writes both unverified |
| `refresh-flow-aggregates.py` | NEEDS VERIFICATION | sweep_rollups 0 rows, possible shim bug |
| `pipeline-runner.py` | NEEDS AUDIT per-step | orchestrator delegates |
| `ai-synthesis.py` | NEEDS AUDIT | predictions write path |
| `market-monitor.py` | NEEDS AUDIT | unverified |
| `synthesis-trigger.py` | NEEDS AUDIT | unverified |
| `intraday-guardian.py` | NEEDS AUDIT | unverified |
| `ingest-macro-signals.py` | NEEDS VERIFICATION | macro_signals writes |
| `score-news-sentiment.py` | NEEDS AUDIT | broken 3 days pre-audit |

Estimated 30-60 min per script for audit. Should happen before production
shadow-table drop.

## Pending TODO list

### Today (Saturday 2026-05-02) afternoon
1. **.pgpass migration** for all 3 DBs — eliminates need to redact connection
   strings. ~15 min.
2. **Stage 4: extract_data_freshness.py** — query ingestion_log for last
   completion per (source, table_name), populate data_table freshness attrs.
   ~1 hour. Closes DATA_SOURCE_MAPPING_PENDING_V1 entirely.
3. **UPS cross-shutdown automation** — pwrstatd hooks on USB-connected hosts
   per UPS, send_discord.py notify, cross-host SSH shutdown for paired host,
   self-shutdown. Pairing: UPS1=both sparks, UPS2=both macs. PowerPanel
   Business already downloaded for macOS. ~3-4 hours focused work.

### Substrate dev (carried over)
- Reconcile `daemon` vs `systemd_unit` entity types
- Deprecate `cron-health.sh` (redundant with health-check.py)
- `extract_log_files.py` — log-file → script relationships
- Fix `extract_systemd_units.py` upsert bug — `extractor` field doesn't
  update on existing entities
- Fix `extract_systemd_units.py` false positive — skip 0.0.0.0/127.0.0.1/
  multicast in hardcoded_ips
- `SUBSTRATE_DATA_SOURCE_DISCOVERY_BASEURL_MATCHING_PENDING_V1` —
  parse script source for hostname matches against data_source.attrs.base_url

### Strategic / deferred
- Audit the 9 NEEDS-AUDIT scripts per `SCRIPTS_PENDING_DB_ROUTING_AUDIT_V1`
- DROP production shadow tables per `PRODUCTION_SHADOW_TABLES_PENDING_DROP_V1`
  (after audit)
- Quant research unpause readiness checklist (per ADR-0004)
- P620 workstation decision (defer until workload profiled)
- MLflow self-hosted vs Weights & Biases consideration
- NAS consideration (defer until storage is a constraint)
- s2 → mac2 consolidation
- SSH key passphraseless tightening (now needs from="192.168.51.0/24")
- Hermes-OLLMCP integration
- OLLMCP session-handover prompt generation capability

## Substrate state at end of session

- 4 nodes on 192.168.51.x (mDNS-resolved)
- 9 systemd_units (system + user scope)
- 5 launchd_agents (mac1 + mac2)
- 2 network entities + cluster-net incoming edges + upstream edge
- ~155 scripts with host attribution
- 11 data_source entities
- 77 data_table entities (across market/production/research)
- 24 llm_call entities
- 33 reads_from (script → data_source) relationships
- **176 lineage relationships (script ↔ data_table)** — up from 162
- DB schema (production + market + research)
- 80+ sentinels canonical
- Pipeline: rerun successfully May 1 evening
- Discord alerting working
- Substrate refresh: every 15 min via extract_systems_state.py --health-only
