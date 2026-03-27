# SOFAR Finance — Changelog
## Session 4: March 26, 2026

### Pipeline Runner — DEPLOYED AND VERIFIED
- **REWRITE: pipeline-runner.py** — Corrected dependency ordering (signals before options), removed broken ES/SPY gap placeholder, added retry logic, --only flag, git push step, file-existence guards on signal bridge.
- **VERIFIED: First live run** — 16/16 passed, 0 failures, 1719s (28m39s).
- **CUTOVER: 12 Phase 2 cron entries disabled** — Prefixed with # PIPELINE: for easy rollback.
- **FIX: Timeout calibration** — Options EOD 900s to 1200s, Greeks 600s to 900s based on actual runtimes.
- **FIX: Pipeline cron typo** — pipeline-runne.py to pipeline-runner.py (character dropped in copy-paste).

### Intraday Data Guardian — NEW
- **NEW: intraday-guardian.py** — Validates data burst JSON freshness, retries stale scripts, alerts Discord on failures.
- **DEPLOYED: 4 cron entries** — 9:58 AM, 12:40 PM, 2:40 PM, 3:40 PM.
- **Writes: intraday-health.json** for frontend monitoring.

### News Freshness Coverage — FIXED
- **NEW: Overnight pre-scanner scrapes** — Headlines + X at 1:55 AM, 4:55 AM, 6:55 AM. Morning brief was using 7-hour-old headlines.
- **NEW: Pre-synthesis scrapes** — 9:45 AM (before 10:00 fixed), 3:20 PM (before 3:45 conditional).
- **NEW: Pre-pipeline macro refresh** — 5:45 PM headlines + X, 5:48 PM sentiment, 5:50 PM Polymarket.
- **NEW: Pre-overnight scrape** — 10:00 PM headlines + X before 10:05 PM conditional synthesis.
- **RESULT: Every synthesis now has news data less than 15 minutes old.**

### Data Sources
- **NEW: Gasoline futures (RB=F)** — Added to ingest-yahoo-futures.py. 505 rows backfilled (2 years). Component for TACO signal.

### Bug Fixes
- **FIX: Overnight scanner log typos** — 3 cron entries had overnight-scanne.log (missing r).
- **FIX: Pipeline cron typo** — pipeline-runne.py fixed.

### TACO Pain Point Index — RESEARCHED
- Methodology confirmed: standardized simple average of 1-month change in 6 components.
- 4/6 data sources already in DB. Bloomberg CPI swap (USSWIT1) and approval rating pending.
- Implementation deferred to Session 5.

### Cron Schedule Changes (14 new entries, 12 disabled)
| Time | Action | Change |
|------|--------|--------|
| 1:55 AM | Headlines + X | NEW |
| 4:55 AM | Headlines + X | NEW |
| 6:55 AM | Headlines + X | NEW |
| 9:45 AM | Headlines + X | NEW |
| 9:58 AM | Intraday Guardian | NEW |
| 12:40 PM | Intraday Guardian | NEW |
| 2:40 PM | Intraday Guardian | NEW |
| 3:20 PM | Headlines + X | NEW |
| 3:40 PM | Intraday Guardian | NEW |
| 5:45 PM | Headlines + X | NEW |
| 5:48 PM | Sentiment | NEW |
| 5:50 PM | Polymarket | NEW |
| 6:00 PM | Pipeline Runner | NEW (replaces 12 entries) |
| 10:00 PM | Headlines + X | NEW |
| 6:08-6:50 PM | 12 Phase 2 jobs | DISABLED |

### System Stats at Session End
- 96 active cron entries
- 80/80 signals current
- 34.9M options rows, 2.19M signal rows, 116.9K price rows
- LightGBM: BEARISH 95% (flipped from BULLISH 81% yesterday)
- Pipeline: 16/16 passed on first live run
