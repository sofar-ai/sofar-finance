# SOFAR Finance — Quantitative Market Intelligence & Trading System

> Live at **https://sofar-finance.vercel.app**

An AI-powered quantitative trading system combining LightGBM machine learning, 80 market signals, options analytics, and real-time market intelligence. Built on a Renaissance Technologies-inspired architecture of systematic signal discovery, non-linear feature engineering, and walk-forward validated predictions.

---

## System Performance

| Metric | Value |
|--------|-------|
| **Walk-Forward Accuracy** | 90.8% across 30 years (62 test windows) |
| **Model** | LightGBM v6 with 75 features |
| **Signals** | 80 total, 1.25M+ computed values |
| **Options Data** | 34.7M rows, 10 symbols, 2020-present |
| **Greeks/IV Data** | 1.85M rows with real implied volatility |
| **Regime Accuracy** | Pinned: 91.0% · Tension: 92.6% · Explosive: 92.2% |
| **Confidence Calibration** | 90-100% confidence = 98.9% accurate |

## Architecture
```
Data Ingestion (13 sources) → Signal Computation (80 signals)
  → Feature Engineering (75 features) → LightGBM Prediction
  → Trade Construction (specific options trades with Kelly sizing)
  → 7 daily AI Synthesis checkpoints → Frontend Dashboard
```

### Core Pipeline

| Time | Action |
|------|--------|
| Overnight | 4x global market scans (ES futures, Asia, Europe, VIX) |
| 7:00 AM | Morning brief — overnight thesis adjustment |
| 9:10 AM | Pre-market AI synthesis |
| 10:00 AM, 12:00 PM, 2:00 PM, 3:30 PM | Intraday AI synthesis |
| 4:40 PM | Full signal computation → LightGBM prediction → Trade construction |
| 6:00 PM | Evening AI synthesis with next-day analysis |

### Tech Stack

| Layer | Technology |
|-------|------------|
| **ML Model** | LightGBM (gradient boosted trees) |
| **Signals** | 80 signals: technical, options-derived, macro, alternative data |
| **Options Data** | ThetaData Terminal v3 (34.7M rows, real Greeks/IV) |
| **AI Synthesis** | Anthropic Claude (7 daily checkpoints) |
| **Market Data** | FMP, Yahoo Finance, FINRA, Polymarket |
| **Frontend** | Vanilla HTML/CSS/JS, Bloomberg-dark theme |
| **Hosting** | Vercel (static + serverless) |
| **Database** | Neon Postgres (cloud) |
| **Infrastructure** | Ubuntu WSL2, 40 cron jobs |
| **Repo** | GitHub: `sofar-ai/sofar-finance` |

---

## Signal Framework (80 signals)

### Base Technical (14)
RSI (5, 14, 21-day), MA position, Bollinger Band position, MACD, ATR regime, EMA trend, Stochastic K, Williams %R, CCI-20, ADX-14, ROC (5, 10, 20-day), OBV trend, volatility ratio, distance from MA200, range ratio

### Engineered Features (52)
- **Lagged signals** (27): 1-day, 2-day, 5-day lags of top 9 features
- **Signal momentum** (12): 2-day and 5-day rate of change
- **Cross-asset** (4): QQQ/SPY z-score, IWM/SPY z-score, ES futures gap, VIX 5-day ROC
- **IV-derived** (3): IV rank, IV 5-day ROC, put/call IV skew
- **Interaction** (6): RSI×vol_ratio, stochastic×ATR, BB×GEX, MACD×EMA, dark_pool×RSI, Williams×range

### Options/Flow (3)
GEX regime, vol regime (explosive/pinned/tension/transitioning), options flow (put/call ratio)

### Macro/Sentiment (5)
VIX level, yield curve, news sentiment (Claude-scored), Polymarket macro composite, overnight global signal

### Alternative Data (2)
FINRA dark pool short volume ratios, overnight market scanner (15 global markets)

---

## Data Sources

| Source | Data | Rows | Update |
|--------|------|------|--------|
| **ThetaData v3** | Options EOD (OHLCV, OI, Greeks) | 34.7M | Daily + streaming |
| **ThetaData v3** | Greeks/IV backfill | 1.85M | Completed 2020-present |
| **FMP Stable API** | Daily prices (19 tickers) | 112K+ | Daily 4:30 PM |
| **FMP Stable API** | Treasury rates | 7,800+ | Daily |
| **FMP Stable API** | Earnings calendar | 4,000+ | Daily |
| **FMP Stable API** | News headlines | On demand | 4x daily |
| **FINRA ADF** | Dark pool short volume | 752 days | Daily 5 PM |
| **Polymarket** | Prediction market probabilities | Daily | Daily 5:15 PM |
| **Yahoo Finance** | ES/NQ futures, global indices | 1,815 days | 4x overnight |
| **RSS/Scrapers** | Headlines (MarketWatch, WSJ, etc.) | Continuous | Every 6 hours |

---

## LightGBM Model Details

### Model: v6 (75 features)

**Walk-forward validation:** 62 rolling windows across 30 years of data. Each window: 504 days training, 126 days testing, stepping 126 days forward. No look-ahead bias.

**Performance by regime:**
| Regime | Accuracy | Notes |
|--------|----------|-------|
| Pinned | 91.0% | GEX-supported, mean reversion works |
| Tension | 92.6% | Best regime — resolution imminent |
| Explosive | 92.2% | High vol, model captures reversals |
| Transitioning | 85.4% | Smallest sample, lower but still strong |

**Performance by confidence:**
| Confidence | Accuracy | N predictions |
|------------|----------|---------------|
| 90-100% | 98.9% | 3,598 |
| 80-90% | 90.4% | 1,595 |
| 70-80% | 82.7% | 1,026 |
| 60-70% | 67.4% | 867 |

**Top features by importance:**
1. williams_r_lag1 (187) — yesterday's overbought/oversold
2. stochastic_k (179) — current momentum
3. bb_position (168) — Bollinger Band position
4. bb_position_lag1 (167) — yesterday's BB position
5. stochastic_k_lag1 (157) — yesterday's momentum

### Key insight
The model learned that **momentum trajectories** (where was the indicator yesterday vs today) are more predictive than point-in-time snapshots. This is why lagged features dominate the top 5.

---

## Trade Construction Engine

Converts LightGBM predictions into specific, risk-defined options trades:
```
LightGBM: BEARISH 65% → Regime: tension → Hold: 3 days
  → Bear Put Spread: Buy $660P / Sell $645P (Mar 23 exp)
  → Debit: $4.24 | Max Profit: $10.76 | Risk/Reward: 2.54x
  → Kelly sizing: Aggressive 12.5% | Conservative 1.2%
```

**Strike selection:** Uses GEX levels (put wall, call wall) as support/resistance for strike placement.

**Regime-adaptive holding:**
| Regime | Optimal Hold | Sharpe | Strategy |
|--------|-------------|--------|----------|
| Pinned | 1 day | 0.99 | Quick scalp, mean reversion |
| Tension | 3 days | 1.71 | Swing hold, best risk-adjusted |
| Explosive | 15 days | 0.52 | Patience, buy the crash |

---

## Frontend Pages

| Page | Description |
|------|-------------|
| **Market** | Real-time quotes, charts, rates, headlines |
| **Options Flow** | ThetaData streaming tape, sorted by premium |
| **AI Analysis** | LightGBM prediction, regime badge, trade recs, quant section |
| **Daily Summary** | End-of-day analysis and recap |
| **Ticker Deep Dives** | Single-ticker AI analysis with input |
| **Macro Events** | Event tree tracking (Iran conflict, tariffs, etc.) |
| **Performance** | Prediction accuracy tracking and backchecking |
| **Health** | System diagnostics for all data feeds and services |
| **Research** | AI research lab and signal discovery |

---

## Infrastructure

### Cron Schedule (40 jobs)
- **Overnight:** 4x global market scan, research scraping
- **Pre-market:** Morning brief (7 AM), pre-market synthesis (9:10 AM)
- **Market hours:** Options flow, GEX, sentiment, VIX every 2 hours; AI synthesis at 10 AM, 12 PM, 2 PM, 3:30 PM
- **Post-market:** Price ingest, signal computation, feature engineering, LightGBM prediction, trade construction, evening synthesis

### Services
- ThetaData Terminal v3 (options data, localhost:25503)
- Flow daemon (continuous streaming)
- Git push queue (every 2 min)
- Health check (every 15 min)

### Database (Neon Postgres)
| Table | Rows |
|-------|------|
| options_eod | 34.7M |
| signal_values | 1.25M |
| prices_daily | 112K |
| gex_historical | 4,682 |
| dark_pool_volume | 752 |
| experiments | 28 |

---

## Research & Development

### Signal Discovery Architecture
Two paths for finding new alpha:
1. **Systematic feature engineering** — mechanical creation of lagged, interaction, cross-asset, and IV-derived features. Tests in LightGBM walk-forward automatically.
2. **Thesis-driven discovery** — human research insights (e.g., "fertilizer stocks rising correlates with S&P declining") fed into orchestrator for automated testing.

### Experiment Orchestrator
Autonomous signal discovery loop adapted from R&D-Agent-Quant and Chain-of-Alpha architectures. Proposes signals, implements, backtests via LightGBM walk-forward, promotes or rejects. 28 experiments run, knowledge base accumulating.

### Progression
| Date | Model | Accuracy | Signals |
|------|-------|----------|---------|
| Mar 20 (Fri) | Linear weighted v5 | 51.2% | 6 |
| Mar 21 (Sat) | LightGBM v2 | 73.6% | 10 |
| Mar 21 (Sat) | LightGBM v3 | 81.2% | 10 |
| Mar 21 (Sat) | LightGBM v4 | 82.2% | 11 |
| Mar 21 (Sat) | LightGBM v5 | 83.6% | 24 |
| Mar 22 (Sun) | **LightGBM v6** | **90.8%** | **75** |

---

## Setup & Environment

### Requirements
- Ubuntu (WSL2 or native)
- Python 3.12+ with: lightgbm, psycopg2, requests, numpy, joblib
- ThetaData Terminal v3 (Java, localhost:25503)
- Neon Postgres database
- Anthropic API key (Claude)
- FMP API key

### Environment Files
```
/etc/neon.env        DATABASE_URL
/etc/anthropic.env   ANTHROPIC_API_KEY
/etc/fmp.env         FMP_API_KEY
```

### Key Directories
```
~/sofar-finance/     Frontend repo (Vercel deployment)
~/scripts/           All backend scripts
~/scripts/signals/   Signal computation modules
~/scripts/models/    LightGBM model files
~/logs/              Cron job logs
```
