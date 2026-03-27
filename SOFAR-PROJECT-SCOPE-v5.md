# SOFAR Finance — Project Scope v5
## AI-Powered Quantitative Market Intelligence & Trading System
**Updated: March 26, 2026 (End of Session 4)**

---

## System Overview

SOFAR Finance is a quantitative trading system combining a LightGBM ML model (75 features, 90.8% walk-forward accuracy across 30 years) with AI-powered synthesis (Claude), 80 market signals, real-time options analytics, and a 5-strategy paper trading simulator. Runs on Windows PC via WSL2, deploys frontend to Vercel, uses Neon Postgres for data storage, and Discord bot (OpenClaw) for monitoring.

**Goal:** $100K to $1M paper portfolio by March 2027.

**Current LightGBM Prediction (March 26):** BEARISH 95% confidence

---

## Critical Architecture: Pipeline Runner (NEW Session 4)

The post-close Phase 2 pipeline is now orchestrated by pipeline-runner.py, replacing 12 individual cron entries with sequential execution + validation + retry logic.

**First live run: March 26, 2026 — 16/16 steps passed, 0 failures, 28m39s total.**
```
Step  0: FMP Prices (3.5s)
Step  1: Yahoo Futures (2.0s)
Step  2: Dark Pool (16.8s) [optional]
Step  3: Vol Regime (0.0s)
Step  4: Signals: Fast (77.1s)
Step  5: Signals: Multi-Timeframe (169.7s)
Step  6: Signals: Batch (16.7s)
Step  7: Options EOD (698.0s) — 11 symbols, SPXW is bottleneck
Step  8: Greeks/IV (563.8s) — 11 symbols sequential
Step  9: Signal Bridge (0.7s) — GEX/Vol/Flow to signal_values
Step 10: Feature Engineering (50.6s) — 52 features, incremental mode
Step 11: LightGBM Predict (2.0s)
Step 12: Trade Constructor (2.7s)
Step 13: Paper Portfolio Equity (0.0s)
Step 14: Evening AI Synthesis (111.5s)
Step 15: Git Push (1.5s)
```

Key features: sequential execution with validation, retry logic, --only N for debugging, --step N to resume, writes pipeline-run.json for monitoring.

---

## Intraday Data Guardian (NEW Session 4)

Validates data burst outputs before synthesis runs. Retries stale scripts once. Alerts Discord via OpenClaw on failures.

Schedule: 9:58 AM, 12:40 PM, 2:40 PM, 3:40 PM

Checks: event-analysis.json, flow-sentiment.json, gex-data.json, vix-structure.json, vol-regime.json

---

## Full Daily Cron Schedule (ET) — 96 Active Entries

### Always-On (24/7)
| Interval | Job | Script |
|----------|-----|--------|
| Every 1 min | Refresh poller | refresh-poller.sh |
| Every 2 min | Git push queue | git-push-queue.sh |
| Every 15 min | Health check | health-check.py |
| Every 30 min | Cron health | cron-health.sh |
| Every 30 min | Cron watchdog | pgrep cron / restart |

### Overnight
| Time | Job |
|------|-----|
| 10:00 PM | Headlines + X + Scanner + Conditional Synthesis (10:05) |
| 12:00 AM | Headlines + X |
| 1:55 AM | Headlines + X (pre-Asia) |
| 2:00 AM | Overnight Scanner |
| 2:30 AM | Research Lab Scraper |
| 3:00 AM | Research Summarizer |
| 4:55 AM | Headlines + X (pre-Europe) |
| 5:00 AM | Overnight Scanner (Europe) |

### Pre-Market
| Time | Job |
|------|-----|
| 6:30 AM | Morning Health Heartbeat |
| 6:55 AM | Headlines + X (pre-brief) |
| 7:00 AM | Morning Brief + Scanner |
| 8:30 AM | Polymarket |
| 8:33 AM | Headlines + X |
| 8:38 AM | Sentiment Scoring |
| 8:45 AM | FIXED AI Synthesis |

### Market Hours
| Time | Job |
|------|-----|
| 9:15 AM | Preflight Heartbeat |
| 9:35 AM | Paper Execute + Backchecks |
| 9:40 AM | Paper AI Execute |
| 9:45 AM | Headlines + X (pre-open synth) |
| 9:50-9:57 | DATA BURST 1 (event, flow, GEX, sentiment, VIX, vol-regime) |
| 9:58 AM | Intraday Guardian |
| 10:00 AM | FIXED AI Synthesis |
| 10:30 AM | Research Scout Scraper |
| 10:35 AM | Intraday Backcheck |
| 11:00 AM | Research Summarizer |
| 12:00 PM | Paper Mark-to-Market |
| 12:20 PM | Headlines + X |
| 12:25-12:37 | DATA BURST 2 |
| 12:40 PM | Intraday Guardian |
| 12:45 PM | CONDITIONAL Synthesis |
| 2:20 PM | Headlines + X |
| 2:25-2:37 PM | DATA BURST 3 |
| 2:40 PM | Intraday Guardian |
| 2:45 PM | CONDITIONAL Synthesis |
| 3:20 PM | Headlines + X (pre-close) |
| 3:25-3:37 PM | DATA BURST 4 |
| 3:40 PM | Intraday Guardian |
| 3:45 PM | CONDITIONAL Synthesis |
| 3:55 PM | Paper Exits |

### Post-Close Phase 1
| Time | Job |
|------|-----|
| 4:01 PM | Intraday Backcheck |
| 4:05 PM | Daily Summary |
| 4:30 PM | FMP Prices + Headlines + X + Phase 1 Heartbeat |
| 4:35 PM | FMP Treasury + Earnings + Yahoo Futures |
| 4:50 PM | Polymarket |
| 5:00 PM | LightGBM Weekly Train (Sundays only) |

### Post-Close Phase 2 (PIPELINE RUNNER)
| Time | Job |
|------|-----|
| 5:45 PM | Pre-pipeline: Headlines + X + Sentiment + Polymarket |
| 6:00 PM | PIPELINE RUNNER (16 steps, ~29 min) |
| 7:05 PM | Phase 2 Heartbeat |

---

## Signal Framework (80 Signals)

| Category | Count | Source |
|----------|-------|--------|
| Base Technical | 21 | compute_fast (4) + sig_multi_timeframe (13) + compute_batch (4) |
| Lagged Features | 27 | feature-engineering.py |
| Momentum Features | 12 | feature-engineering.py |
| Cross-Asset | 4 | feature-engineering.py |
| IV-Derived | 3 | feature-engineering.py |
| Interaction | 6 | feature-engineering.py |
| Options/Flow | 3 | Pipeline signal bridge |
| External/Macro | 4 | Various ingest scripts |

NEW: TACO Pain Point Index (Signal #81) — In Development. Awaiting Bloomberg CPI swap CSV.

---

## Database

| Table | Rows | Notes |
|-------|------|-------|
| options_eod | 34.9M | 11 symbols, 2020-present, includes Greeks |
| signal_values | 2.19M | 80 signals, SPY primary |
| prices_daily | 116.9K | FMP + Yahoo, includes ES=F, NQ=F, RB=F |
| treasury_rates | 9.1K | FMP, 1990-present |

---

## Reliability Layers

| Layer | What | Frequency |
|-------|------|-----------|
| Cron Watchdog | Restart cron if dead | Every 30 min |
| Health Check | DB + table freshness | Every 15 min |
| Heartbeats | Discord alerts on issues | 4x daily |
| Intraday Guardian | Validate + retry data bursts | 4x daily |
| Pipeline Runner | Sequential Phase 2 with validation | 6:00 PM daily |
| Git Push Queue | Centralized push with conflict handling | Every 2 min |

---

## TODO — Priority Ordered

### CRITICAL
1. Build TACO Pain Point Index signal — awaiting Bloomberg CSV
2. Signal freshness dashboard on frontend
3. Scripts version control — ~/scripts/ has NO git

### HIGH
4. Approval rating scraper for TACO component
5. OpenClaw IT/maintenance agent
6. Daily report AM/PM format
7. Backtest validation with all 80 signals

### MEDIUM
8. Signal compute consolidation
9. Feature engineering optimization
10. Composite signal plugin framework
11. Research page updates

### LOW
12. Long Put R/R fix
13. WF Accuracy display (actual 90.8%)
14. 0DTE timing investigation
