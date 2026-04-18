# Architecture Notes

## Aggregate Refresh: Current vs. Preferred

**Current (implemented):** Daemon-triggered refresh
- `flow-tape-daemon.py` runs a background thread that fires `INSERT ... ON CONFLICT UPDATE` against
  `flow_session_metrics`, `flow_sweep_rollups` every 60 seconds
- Nightly baseline job (`flow_baselines`) also runs in the daemon at ~5 PM ET
- Advantage: no Neon config surgery, single process to debug
- Tradeoff: aggregates only refresh when daemon is alive (fine in practice — no daemon = no new data anyway)

**Preferred (future):** pg_cron inside Neon
- Same refresh SQL, but scheduled inside Neon via pg_cron
- Survives daemon restarts independently
- Cleaner separation: daemon = capture, database = maintenance
- **Blocker today:** Neon's pg_cron has `cron.database_name = 'postgres'` hardcoded; our data is in a different database
- **To enable:**
  1. Use Neon management API to set `cron.database_name = '<your db>'` on the endpoint settings
     - API: `PATCH /projects/{project_id}/endpoints/{endpoint_id}`
     - Body includes `endpoint.settings.pg_settings.cron.database_name`
     - Requires `NEON_API_KEY` and the project + endpoint IDs
  2. Restart Neon compute (~30s downtime)
  3. In the target database: `CREATE EXTENSION pg_cron;`
  4. Copy refresh SQL from daemon's `AggregatesRefresher` class into `cron.schedule(...)` calls:
     - `SELECT cron.schedule('refresh_session_metrics_today', '*/1 * * * *', $$ ... $$)` (every 60s)
     - `SELECT cron.schedule('refresh_sweep_rollups_today', '*/1 * * * *', $$ ... $$)`
     - `SELECT cron.schedule('compute_baselines', '0 22 * * 1-5', $$ ... $$)` (5 PM ET = 22:00 UTC, weekdays)
  5. Remove the `AggregatesRefresher` thread from `flow-tape-daemon.py`
- Migration is safe — aggregates are derived tables, re-runnable, no data loss risk

## Other Future Enhancements

### TimescaleDB hypertables
Neon supports the extension (Apache-2 features only). `flow_trades` could be converted to a hypertable
for faster time-range chunked queries. Not required — current indexes cover well for up to ~1M rows/day.
Worth revisiting if table grows past ~10M rows.

### Continuous aggregates
TimescaleDB Community feature — NOT available on Neon. If we ever migrate to a provider that supports
Community edition (e.g., self-hosted Postgres, Tiger Data Cloud), continuous aggregates would replace
both pg_cron and the daemon-triggered approach with automatic incremental maintenance.

### session_date correctness
`flow_trades.session_date` uses `CURRENT_DATE` at insert time, which could roll over to the next day
during extended-hours trades after 8 PM ET (= midnight UTC). Low-impact edge case but worth fixing
when we revisit the daemon insert path — compute session_date from the trade's actual ET date.

### Aggregate staleness indicator
Frontend should show "data refreshed N seconds ago" based on `flow_session_metrics.last_refreshed_at`
so users know if aggregates lag (e.g., during daemon restart windows).
