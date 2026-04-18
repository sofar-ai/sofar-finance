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

## Staging / Test Environment (PENDING — semi-high priority)

### Problem
All code changes go directly to production via the auto-bot commit+push → Vercel deploy pipeline. There's no pre-production validation step. Bugs like the `window.loadTickerAnalysis` infinite recursion, the `rebuildTape` missing `fetched_at`, and the 500-row slice were all caught by inspecting production — they should have been caught in staging.

### Requirements
- Separate Vercel deployment (preview branch or dedicated staging project)
- Pointed at a Neon branch (not production DB) so test writes don't contaminate real flow_trades
- Separate daemon instance (or simulated data) pushing to the staging Neon branch
- URL like `https://staging.sofar-finance.vercel.app` or use Vercel's preview URLs
- Clear indicator on the page that it's staging (banner, different theme, etc.)

### Implementation options

**Option 1: Vercel preview branches + Neon branch (recommended)**
- Create a `staging` branch in the GitHub repo
- Vercel auto-deploys every branch to a preview URL
- Neon supports zero-copy branching of databases — spin up a `staging` branch of the Neon project
- Set `DATABASE_URL` for staging deployment to point at the Neon staging branch
- Promote to main only after testing

**Option 2: Separate Vercel project**
- Fork the repo to `sofar-finance-staging`
- Separate Vercel project, separate domain
- Same Neon branching pattern
- More isolated but requires keeping two repos in sync

**Option 3: Local-only dev loop**
- `vercel dev` on local machine
- Local Neon branch or a dedicated staging DB
- Fastest iteration for frontend changes
- Doesn't test the Vercel deployment path itself

### What staging needs to test
1. Frontend JS changes against real Neon data (read-only queries)
2. API endpoint changes (`/api/flow-aggregates`, etc.)
3. Daemon changes (would need to run daemon locally pointed at staging Neon)
4. Migration SQL (new tables, triggers, functions)
5. Schema changes to flow_trades / flow_session_metrics without risking production

### Daemon staging consideration
The live daemon on S1 is the only source of real-time options flow. Running a second daemon for staging would require either:
- A second ThetaData connection (separate subscription quota — check terms)
- Replaying historical data from rebuild-flow-history.py at a fast pace to simulate live
- Proxying/teeing the production daemon's writes (read from flow_trades, publish to staging)

For v1 staging, simplest path: staging gets read-only access to production Neon data for UI testing. Daemon changes still go through a careful production deploy. As we scale, proper daemon staging becomes worth it.

### Priority ordering
1. Vercel preview branch + Neon branch setup (1-2 hours)
2. Clear staging indicator on the UI (~30 min)
3. Document the deploy workflow: feature → staging branch → test → PR to main → auto-deploy
4. Consider: auto-disable the auto-bot commit-push for branches other than main, so dev work doesn't leak

### Blocker on Neon branching
Need to check Neon's plan allows branching and how many branches — free tier has limits. Paid Launch plan allows more.
