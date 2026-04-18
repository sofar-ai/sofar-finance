# SOFAR Finance — Pending Work (as of 2026-04-17 23:15 ET)

## High priority
- [ ] **Staging environment** — Vercel preview branch + Neon DB branch. Prevents live-prod debugging cycles.
- [ ] **Rebuild Apr 17 afternoon gap** via `rebuild-flow-history.py` (after midnight ET when ThetaData unlocks)
- [ ] **`/api/flow-aggregates` endpoint + frontend panel wiring** — makes panels work on any date

## Medium priority  
- [ ] Fix broken `backfill_today()` in daemon to use v3 endpoint (replace with rebuild-script logic, top 30 symbols, <5min at startup)
- [ ] Remove `--backfill` flag from `/etc/systemd/system/sofar-flow-tape.service`
- [ ] Yearly cron to regenerate trading_calendar (December each year, using pandas_market_calendars)

## Lower priority / polish
- [ ] Periodic DBWriter.stats() + AggregatesRefresher.stats() log line for Monday-open visibility
- [ ] Aggregate-staleness indicator on frontend (show "data refreshed N seconds ago" when last_refreshed_at > 120s)
- [ ] Monday morning: verify WebSocket keepalive ping timeouts resolved now that DB writes are non-blocking

## Documentation
- Update docs/architecture-notes.md to reflect trading_calendar + fn_session_date() additions ✓ (done in this message)
