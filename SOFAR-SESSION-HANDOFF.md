# SOFAR Finance — Session Handoff Brief
## For New Claude Session Pickup
**Date: March 26, 2026, 9:00 PM ET (Session 4)**

---

## What is SOFAR Finance?

An AI-powered quantitative trading system running on a Windows PC via WSL2. It combines:
- **LightGBM v6 ML model** — 75 features, 90.8% walk-forward accuracy across 30 years
- **Claude AI synthesis** — multi-timeframe market analysis updated 6+ times daily
- **80 market signals** — technical, cross-asset, IV-derived, sentiment, alternative data
- **Options analytics** — ThetaData Terminal v3, 34.9M+ EOD rows, real-time Greeks
- **Paper trading simulator** — 5 strategies, $100K starting capital, goal $1M by March 2027
- **Frontend dashboard** — 12-page Bloomberg-dark theme on Vercel (sofar-finance.vercel.app)

---

## What Changed in Session 4

### Pipeline Runner — DEPLOYED AND VERIFIED
- Rewrote pipeline-runner.py with corrected dependency ordering (signals before options)
- Removed broken ES/SPY gap placeholder (feature-engineering.py already handles it)
- Added retry logic, --only N flag, git push step, file-existence guards
- First live run: 16/16 passed, 0 failures, 28m39s total
- Replaced 12 Phase 2 cron entries (commented out with # PIPELINE: prefix)

### Intraday Data Guardian — NEW
- intraday-guardian.py validates data burst outputs before synthesis
- Retries failed scripts, alerts Discord on unrecoverable failures
- Runs at 9:58 AM, 12:40 PM, 2:40 PM, 3:40 PM

### News Freshness — FIXED
- Added headline scrapes before every overnight scanner (1:55, 4:55, 6:55 AM)
- Added scrapes before 10:00 AM and 3:45 PM syntheses
- Added pre-pipeline macro refresh at 5:45 PM (headlines, sentiment, Polymarket)
- Every synthesis now has news data less than 15 minutes old

### Gasoline Futures — ADDED
- RB=F added to Yahoo futures ingest, 505 rows backfilled (2 years)
- Needed for TACO Pain Point Index signal

---

## System State as of Session End

### Working
- 80/80 signals current for March 26
- LightGBM: BEARISH 95% (flipped from BULLISH 81% yesterday)
- Pipeline runner: 16/16 passed on first live run
- Options EOD: All 11 symbols current
- Greeks/IV: All 11 symbols current
- 96 active cron entries, all reliability layers active
- 34.9M options rows, 2.19M signal rows, 116.9K price rows

### Pipeline Runner Steps
```
 0: FMP Prices          -> prices_daily SPY == today
 1: Yahoo Futures       -> prices_daily ES=F == today
 2: Dark Pool [opt]     -> dark-pool.json < 4h
 3: Vol Regime          -> vol-regime.json < 4h
 4: Signals Fast        -> rsi_14 == today
 5: Signals Multi-TF    -> williams_r == today
 6: Signals Batch       -> bb_position == today
 7: Options EOD         -> options_eod SPY == today (timeout 1200s)
 8: Greeks/IV           -> IV data for today (timeout 900s)
 9: Signal Bridge       -> gex_regime == today
10: Feature Engineering -> bb_position_lag1 == today
11: LightGBM Predict    -> lgbm-prediction.json date == today
12: Trade Constructor   -> trade-recommendations.json < 4h
13: Paper Portfolio     -> paper-portfolio.json < 4h
14: Evening Synthesis   -> ai-synthesis.json < 2h (timeout 300s)
15: Git Push [opt]      -> triggers git-push-queue.sh
```

### Reliability Layers
1. Cron watchdog — every 30 min, restarts if dead
2. Health check — every 15 min, DB + table freshness
3. Heartbeats — 4x daily, alerts Discord
4. Intraday guardian — 4x daily, validates + retries data bursts
5. Pipeline runner — sequential Phase 2 with validation + retry
6. Git push queue — every 2 min, handles conflicts

---

## In Progress: TACO Pain Point Index (Signal #81)

Composite signal measuring economic/political pressure on the administration. Every major spike has preceded a policy reversal.

Methodology: standardized simple average of 1-month change in 6 components:
1. Inverse S&P 500 returns — HAVE (prices_daily SPY)
2. 10-yr Treasury yields — HAVE (treasury_rates rate_10y)
3. 30-yr mortgage rates — HAVE (treasury_rates rate_30y as proxy)
4. Gasoline futures — HAVE (prices_daily RB=F, backfilled 2 years)
5. 1-yr CPI swaps — NEED Bloomberg CSV (USSWIT1 Curncy)
6. Trump approval ratings — NEED scraper

Next: user exports Bloomberg CSV, we build compute script, signal #81 goes live.

---

## Key Files

| Path | Description |
|------|-------------|
| ~/sofar-finance/ | Frontend repo (Vercel auto-deploy) |
| ~/scripts/ | Backend scripts (NOT in git!) |
| ~/scripts/pipeline-runner.py | Phase 2 orchestrator (Session 4) |
| ~/scripts/intraday-guardian.py | Data burst validator (Session 4) |
| ~/scripts/signals/ | Signal computation scripts |
| ~/scripts/db-env.sh | DB connection wrapper |
| ~/scripts/feature-engineering.py | 52 features, incremental |
| ~/scripts/ai-synthesis.py | Claude synthesis |
| ~/scripts/synthesis-trigger.py | Conditional synthesis |
| ~/scripts/paper-portfolio.py | Paper trading (5 strategies) |
| ~/sofar-finance/data/pipeline-run.json | Last pipeline status |
| ~/sofar-finance/data/intraday-health.json | Last guardian status |

## Key Tables

| Table | Rows | Key Columns |
|-------|------|-------------|
| options_eod | 34.9M | symbol, expiration, strike, date, OHLCV, iv, greeks |
| signal_values | 2.19M | date, signal_name, signal_version, ticker, value |
| prices_daily | 116.9K | symbol, date, OHLCV, source (includes ES=F, NQ=F, RB=F) |
| treasury_rates | 9.1K | date, rate_10y, rate_30y, spread_10y_3m |

---

## TODO — Priority Ordered

### CRITICAL
1. Build TACO Pain Point Index — Bloomberg CPI swap CSV needed
2. Signal freshness dashboard on frontend
3. Scripts version control — ~/scripts/ has NO git

### HIGH
4. Approval rating scraper for TACO
5. OpenClaw IT/maintenance agent
6. Daily report AM/PM format
7. Backtest validation with all 80 signals

### MEDIUM
8. Signal compute consolidation
9. Composite signal plugin framework
10. Research page updates

### LOW
11. Long Put R/R fix
12. WF Accuracy display (actual 90.8%)

---

## Quick Commands
```bash
# Pipeline status
cat ~/sofar-finance/data/pipeline-run.json | python3 -m json.tool

# Run pipeline manually
. ~/scripts/db-env.sh && . /etc/anthropic.env && export ANTHROPIC_API_KEY && python3 ~/scripts/pipeline-runner.py

# Resume from step N
python3 ~/scripts/pipeline-runner.py --step 7

# Debug single step
python3 ~/scripts/pipeline-runner.py --only 9

# Signal freshness
. ~/scripts/db-env.sh && python3 -c "
import sys; sys.path.insert(0, '/home/bot1/scripts')
from db import execute_query
rows = execute_query(\"SELECT signal_name, MAX(date) as d FROM signal_values WHERE ticker='SPY' GROUP BY signal_name ORDER BY d\")
today = sum(1 for r in rows if str(r['d'])=='$(date +%Y-%m-%d)')
print(f'{today}/{len(rows)} signals current')
"

# Guardian check (no retries)
REPO_PATH=~/sofar-finance python3 ~/scripts/intraday-guardian.py --check

# Rollback: restore old Phase 2 cron entries
crontab -l | sed 's/^# PIPELINE: //' | crontab -
```
