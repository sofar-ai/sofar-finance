# SOFAR Finance — Bloomberg-Style Market Intelligence Dashboard

> Live at **https://sofar-finance.vercel.app**

A real-time financial terminal combining options flow, AI market analysis, technical charts, FX rates, and news in a Bloomberg-dark themed web dashboard. Fully serverless on Vercel, data updated by cron jobs running on a local Ubuntu machine.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Data Sources](#3-data-sources)
4. [Infrastructure](#4-infrastructure)
5. [Environment Variables](#5-environment-variables)
6. [Data Files](#6-data-files)
7. [Frontend Components](#7-frontend-components)
8. [AI Synthesis Layer](#8-ai-synthesis-layer)
9. [Options Flow Pipeline](#9-options-flow-pipeline)
10. [Setup Guide — Rebuild From Scratch](#10-setup-guide--rebuild-from-scratch)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Project Overview

SOFAR Finance is a three-page financial dashboard with:

- **Real-time market quotes** — US indices, commodities, FX rates refreshed every 30 seconds
- **TradingView-style charts** — SPY, QQQ, DIA, VIX with candlestick charts and MA/RSI overlays
- **Options flow tape** — Near-term options quotes from ThetaData Terminal, ranked by premium
- **AI market intelligence** — Claude Opus analyzes all data streams every 2 hours, produces intraday (2h), next-day, and long-term (30d) signals with trade ideas and SPY/QQQ benchmarks
- **Accuracy tracking** — Every AI prediction is backchecked after market close and intraday; rolling directional and price accuracy stats displayed
- **Self-calibration system** — Regime-tagged predictions stored in rolling archive; history injected into Claude prompt for continuous accuracy improvement

### Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Vercel (static + serverless functions) |
| Frontend | Vanilla HTML/CSS/JS — no framework |
| Charts | TradingView Lightweight Charts v4.2 |
| Fonts | IBM Plex Mono + Inter (Google Fonts) |
| Market data | Finnhub (US stocks), Yahoo Finance (intl indices + commodities, fallback) |
| Options data | ThetaData Terminal v3 (local, localhost:25503) |
| AI analysis | Anthropic Claude Opus (`claude-opus-4-20250514`) |
| AI options ranking | Anthropic Claude Sonnet (`claude-sonnet-4-5`) |
| News scraping | Python RSS parser (MarketWatch, WSJ, Reuters, Seeking Alpha) |
| Infrastructure | Ubuntu WSL2 on Windows, cron, systemd |
| Repo | GitHub: `sofar-ai/sofar-finance` |

---

## 2. Architecture Overview

### Three Pages

| Page | URL | Description |
|---|---|---|
| Market Dashboard | `/` | Quotes sidebar, 4-chart grid, options flow panel, headlines, trends, top flow, AI strip |
| Options Flow | `/options-flow.html` | Full options flow tape with filters, top tickers by volume, unusual activity, Greeks summary |
| AI Analysis | `/ai-analysis.html` | Intraday/next-day/long-term signals, SPY & QQQ benchmarks, news+flow impact, tickers to watch, trade ideas, accuracy track record |

### Data Flow

```
DATA SOURCES
│
├─ ThetaData Terminal (localhost:25503)
│   └─ fetch-options-flow.sh (cron 9:30/11:30/13:30/15:30 ET Mon-Fri)
│       ├─ Lists near-term expirations per symbol
│       ├─ Fetches snapshot quotes (CSV) for each symbol+expiration
│       ├─ Filters premium ≥ $25k
│       ├─ Fetches underlying prices from Yahoo Finance
│       ├─ Sends top 60 trades to Claude Sonnet → top 5 with reasoning
│       └─ Writes: data/options-flow.json, data/flow-sentiment.json, data/top-flow.json
│
├─ RSS Feeds (MarketWatch, WSJ, Reuters, Seeking Alpha)
│   └─ scrape-headlines.sh (cron every 6h)
│       └─ Writes: headlines.json, headlines-x.json, trends.json (root)
│
├─ Finnhub + Yahoo Finance + Anthropic Claude Opus
│   └─ ai-synthesis.sh (cron 9:40/11:40/13:40/15:40 ET Mon-Fri)
│       ├─ Reads all data files above
│       ├─ Fetches current prices (Finnhub for US stocks, Yahoo for intl indices + commodities)
│       ├─ Loads last 10 resolved predictions for calibration (regime-filtered when ≥5 same-regime)
│       ├─ Calls /home/bot1/scripts/ai-synthesis.py (Python subprocess)
│       ├─ Sends everything to Claude Opus (with calibration_notes required in output)
│       ├─ Stores TRIGGER_TYPE (scheduled|manual) in archive entry
│       └─ Writes: data/ai-synthesis.json, data/prediction-archive.json (rolling 200)
│
└─ Yahoo Finance (price verification)
    └─ backcheck-predictions.sh (cron 11:35/13:35/15:35/16:01 ET Mon-Fri)
        ├─ Reads previous ai-synthesis.json prediction
        ├─ Fetches actual current prices
        ├─ Scores directional accuracy (UP/DOWN/NEUTRAL with ±0.1% threshold)
        ├─ Grades price accuracy (Excellent/Good/Fair/Poor)
        ├─ Writes: data/accuracy-log.json (append)
        └─ Writes: data/accuracy-stats.json (recalculated)

ALL WRITES → Git commit + push → GitHub → Vercel auto-deploy

BROWSER (Vercel CDN)
├─ Static JSON files served at /data/*.json, /headlines.json, /trends.json
├─ Serverless functions: /api/quote, /api/chart
│   ├─ /api/quote → Finnhub (FINNHUB_API_KEY from Vercel env)
│   └─ /api/chart → Yahoo Finance (no key needed)
└─ JS widgets poll their JSON files every 5-30 minutes
```

---

## 3. Data Sources

### Yahoo Finance

- **Used for:** Chart OHLCV data, international indices, commodities, live quote fallback
- **No API key required**
- **Base URL:** `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}`
- **Required header:** `User-Agent: Mozilla/5.0 ...` (empty responses without it)
- **Ticker formats:**
  - US ETFs/stocks: `SPY`, `QQQ`, `AAPL`
  - Indices: `^VIX`, `^GSPC`, `^DJI`, `^N225`, `^KS11`, `^TWII`
  - TOPIX: `1306.T` (`^TOPX` unavailable on Yahoo Finance)
  - Commodities: `GC=F` (gold), `SI=F` (silver), `CL=F` (WTI), `BZ=F` (Brent)
  - Crypto: `BTC-USD`
- **Chart intervals used:** `5m` (1D), `30m` (1W), `1d` (1M), `1wk` (1Y)
- **Response path:** `chart.result[0].timestamp`, `chart.result[0].indicators.quote[0]`

### Finnhub

- **Used for:** Real-time US stock quotes — in the browser (via `/api/quote`) and in scripts (primary price source for US stocks)
- **Key:** `FINNHUB_API_KEY` — stored in Vercel environment variables (browser) and `/etc/finnhub.env` (scripts)
- **Base URL:** `https://finnhub.io/api/v1/`
- **Endpoints used:**
  - `GET /quote?symbol={ticker}&token={key}` → `{c, d, dp, h, l, o, pc}`
- **Note:** Free tier does NOT support `/stock/candle` — charts use Yahoo Finance instead
- **Fallback:** Yahoo Finance used for US stocks if Finnhub key is missing or returns an error

### ThetaData Terminal v3

- **Used for:** Options snapshot quotes (bid/ask/size per contract)
- **Local only — Vercel serverless cannot reach localhost**
- **Terminal URL:** `http://localhost:25503`
- **WebSocket:** `ws://localhost:25520`
- **MCP SSE:** `http://localhost:25503/mcp/sse`
- **Endpoints used:**
  - `GET /v3/option/list/expirations?symbol={SYM}` — CSV: `symbol,expiration`
  - `GET /v3/option/snapshot/quote?symbol={SYM}&expiration={YYYYMMDD}` — CSV with bid/ask/size
- **Expiration format:** `YYYYMMDD` (not `YYYY-MM-DD`)
- **Response format:** CSV with header: `timestamp,symbol,expiration,strike,right,bid_size,bid_exchange,bid,bid_condition,ask_size,ask_exchange,ask,ask_condition`
- **Premium estimation:** `ask × ask_size × 100` (options contract = 100 shares); falls back to `ask_size` when primary size field unavailable
- **Session:** ThetaData Terminal must be running; only one instance at a time
- **Session error string:** `"Invalid session ID. This can occur if more than one terminal is running."`

### Anthropic Claude

- **Used for:**
  1. **Options flow ranking** — Claude Sonnet analyzes top 60 trades → returns top 5 JSON array with reasoning
  2. **Market intelligence** — Claude Opus analyzes all data streams → returns multi-timeframe signal JSON with benchmarks and calibration notes
- **Models:**
  - `claude-sonnet-4-5` — options flow analysis (called from `fetch-options-flow.sh`)
  - `claude-opus-4-20250514` — market synthesis (called from `ai-synthesis.sh` via `ai-synthesis.py`)
- **API endpoint:** `https://api.anthropic.com/v1/messages`
- **Key:** `ANTHROPIC_API_KEY` — stored in `/etc/anthropic.env` on host machine
- **Required headers:** `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`

### RSS Feeds (News)

- **Used for:** Headlines and trending topics
- **Sources:** MarketWatch top stories, MarketWatch market pulse, WSJ Markets, Reuters Business, Seeking Alpha
- **Script:** `~/scripts/scrape-headlines.sh` (Python `urllib` + `xml.etree`)
- **Output format:** `{fetched_at, count, items: [{source, headline, timestamp, link}]}`

---

## 4. Infrastructure

### Host Machine

- **OS:** Ubuntu on WSL2 (Windows host: `LAPTOP-FOIBBO86`)
- **User:** `bot1`
- **Working repo:** `/home/bot1/sofar-finance/`
- **Scripts directory:** `/home/bot1/scripts/`
- **Logs directory:** `/home/bot1/logs/`
- **Java:** OpenJDK 21 (required for ThetaData Terminal)

### ThetaData Terminal (systemd)

```bash
# Check status
systemctl status thetadata

# Restart
sudo systemctl restart thetadata

# View logs
journalctl -u thetadata -f

# Service file location
/etc/systemd/system/thetadata.service
```

Terminal runs persistently, exposes REST on port `25503` and WebSocket on `25520`.
If you see `"Invalid session ID"` errors, only one Terminal instance may run at a time.

### Cron Jobs

```cron
# News scraping — every 6 hours
0 */6 * * * /bin/bash /home/bot1/scripts/scrape-headlines.sh >> /home/bot1/scripts/scrape-headlines.log 2>&1

# X/Twitter headlines — every 6 hours
0 */6 * * * cd /home/bot1/.scripts && export GH_TOKEN=$(gh auth token) && node scrape-x-headlines.js >> /home/bot1/scripts/scrape-x.log 2>&1

# Options flow fetch — 9:30, 11:30, 13:30, 15:30 ET Mon-Fri
30 9,11,13,15 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/fetch-options-flow.sh >> /home/bot1/logs/flow-fetch.log 2>&1

# AI synthesis — 9:40, 11:40, 13:40, 15:40 ET Mon-Fri (10 min after flow)
40 9,11,13,15 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/ai-synthesis.sh >> /home/bot1/logs/ai-synthesis.log 2>&1

# Prediction backcheck — intraday: 11:35, 13:35, 15:35 ET + 16:01 ET (right after market close)
35 11,13,15 * * 1-5   REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh intraday >> /home/bot1/logs/backcheck.log 2>&1
1 16 * * 1-5           REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh intraday >> /home/bot1/logs/backcheck.log 2>&1

# Prediction backcheck — next-day: 9:35 ET Mon-Fri
35 9 * * 1-5           REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh nextday >> /home/bot1/logs/backcheck.log 2>&1

# Prediction backcheck — long-term: 9:35 ET (monthly)
35 9 1-31 * 1-5        REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh longterm >> /home/bot1/logs/backcheck.log 2>&1
```

### Scripts

| Script | Trigger | Description |
|---|---|---|
| `~/scripts/scrape-headlines.sh` | Every 6h | Fetches RSS feeds, writes `headlines.json` + `trends.json`, git pushes |
| `~/scripts/fetch-options-flow.sh` | 4× daily Mon-Fri | ThetaData → filter → Claude Sonnet → JSON files → git push |
| `~/scripts/ai-synthesis.sh` | 4× daily Mon-Fri | Reads all data → fetches prices (Finnhub/Yahoo) → calls `ai-synthesis.py` → Claude Opus → `ai-synthesis.json` + `prediction-archive.json` → git push |
| `~/scripts/ai-synthesis.py` | Called by `ai-synthesis.sh` | Python subprocess handling Claude API call, prompt construction, self-calibration history injection |
| `~/scripts/backcheck-predictions.sh` | 5× daily Mon-Fri | Verifies price predictions by timeframe → updates accuracy log/stats → git push |

---

## 5. Environment Variables

### On Vercel (production)

| Variable | Used by | Description |
|---|---|---|
| `FINNHUB_API_KEY` | `api/quote.js` | Finnhub API key for real-time stock quotes. Free tier works for `/quote` endpoint only. |
| `POLYGON_API_KEY` | _(unused)_ | Legacy — kept in Vercel env but no longer referenced in code |

### On Host Machine (local scripts)

| Variable | File | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | `/etc/anthropic.env` | Anthropic API key for Claude Sonnet and Claude Opus calls |
| `FINNHUB_API_KEY` | `/etc/finnhub.env` | Finnhub key for US stock price fetching in scripts (Yahoo Finance used for intl indices + commodities) |
| `TRIGGER_TYPE` | Set at cron invocation | `scheduled` or `manual` — stored in `prediction-archive.json` per prediction entry |

### Protected Credential Files

```bash
# Format of /etc/anthropic.env
ANTHROPIC_API_KEY=sk-ant-...

# Format of /etc/finnhub.env
FINNHUB_API_KEY=...

# Both files: owned by root, world-readable (644)
# Scripts source them with: source /etc/anthropic.env && export ANTHROPIC_API_KEY
```

**Never commit actual key values to the repository.**

---

## 6. Data Files

All files in `data/` are generated by cron scripts and served as static assets by Vercel.
Root-level JSON files (`headlines.json`, `trends.json`) are generated by the news scraper.

| File | Generated by | Read by | Contents |
|---|---|---|---|
| `headlines.json` | `scrape-headlines.sh` | `js/news.js`, `ai-synthesis.sh` | `{fetched_at, count, items: [{source, headline, timestamp, link}]}` — up to 184 items from 5 RSS sources |
| `headlines-x.json` | `scrape-x-headlines.js` | `js/news.js` | X/Twitter financial posts |
| `trends.json` | `scrape-headlines.sh` | `js/trends.js`, `ai-synthesis.sh` | `{fetched_at, trends: [...]}` — 12 trending finance topics ranked by prominence |
| `data/options-flow.json` | `fetch-options-flow.sh` | `js/options.js`, `js/options-flow.js`, `ai-synthesis.sh` | `{fetched_at, market_open, total_trades, trades: [...200]}` — top 200 contracts by premium |
| `data/flow-sentiment.json` | `fetch-options-flow.sh` | `js/options-flow.js`, `ai-synthesis.sh` | `{fetched_at, market_open, pc_ratio, call_premium, put_premium, sentiment, total_trades}` |
| `data/top-flow.json` | `fetch-options-flow.sh` | `js/top-flow.js`, `ai-synthesis.sh` | `{fetched_at, market_open, top_trades: [...5]}` — Claude-ranked top 5 with reasoning |
| `data/ai-synthesis.json` | `ai-synthesis.sh` | `js/ai-synthesis.js` | Full multi-timeframe analysis — see [JSON Output Structure](#json-output-structure) below |
| `data/prediction-archive.json` | `ai-synthesis.sh` | `ai-synthesis.sh` (history injection) | Rolling 200-entry archive with full prediction context, regime tag, signal snapshot, and `trigger_type` |
| `data/accuracy-log.json` | `backcheck-predictions.sh` | `js/ai-synthesis.js`, `ai-synthesis.sh` | Array of prediction check results — appended every backcheck run |
| `data/accuracy-stats.json` | `backcheck-predictions.sh` | `js/ai-synthesis.js` | Rolling accuracy stats: `{total_predictions, correct, directional_accuracy_pct, by_signal, avg_price_error_pct, price_accuracy_by_timeframe, best_ticker, worst_ticker}` — best/worst by directional accuracy |
| `data/accuracy-baseline-2026-03-11.json` | _(one-time snapshot)_ | Reference only | Baseline accuracy snapshot captured before self-calibration system rollout |

---

## 7. Frontend Components

All components follow the same **IIFE module pattern:**
```js
const WidgetName = (() => {
  // private state
  function init(containerId) { /* fetch data, render, set interval */ }
  return { init };
})();
```

Initialized in an inline `<script>` at the bottom of each HTML page, no bundler needed.

### index.html — Market Dashboard

| Component | JS File | Data Source | Refresh |
|---|---|---|---|
| `Quotes` | `js/quotes.js` | `/api/quote` (Finnhub) | 30s |
| `FXRates` | `js/fx.js` | Frankfurter API (EUR,GBP,JPY,CNY,KRW,TWD) | 5m |
| `ChartComponent` | `js/chart.js` | `/api/chart` (Yahoo Finance) | On timeframe click |
| `Indicators` | `js/indicators.js` | Attached to chart instances | On toggle |
| `OptionsFlow` | `js/options.js` | `/data/options-flow.json` | 5m |
| `TopFlow` | `js/top-flow.js` | `/data/top-flow.json` | 5m |
| `TrendsFeed` | `js/trends.js` | `/trends.json` | On refresh click |
| `NewsFeed` | `js/news.js` | `/headlines.json`, `/headlines-x.json` | On refresh click |
| `AISynthesis` (strip) | `js/ai-synthesis.js` | `/data/ai-synthesis.json`, `/data/accuracy-stats.json` | 5m |

**Quote bar tickers:**
- Markets: SPY, QQQ, IWM, DIA, VIX, NKY (^N225), KOSPI (^KS11), TAIEX (^TWII)
- Commodities: VIX, GOLD (GC=F), SILVER (SI=F), WTI (CL=F), BRENT (BZ=F)
- FX: EUR/USD, GBP/USD, USD/JPY, USD/CNY, USD/KRW, USD/TWD

**Chart grid:** SPY · QQQ · DIA · VIX

**Timeframes:**
| Button | Yahoo interval | Yahoo range |
|---|---|---|
| 1D | 5m | 1d |
| 1W | 30m | 5d |
| 1M | 1d | 1mo |
| 1Y | 1wk | 1y |

**TA Indicators (togglable):**
- **MA 50/200** — Simple moving average overlay on price chart. MA50 = amber, MA200 = indigo. Recalculated from `inst.candles` on each toggle/timeframe switch.
- **RSI 14** — Sub-pane below chart with 70/30 overbought/oversold lines. Uses Wilder's smoothing method.
- Indicators persist across timeframe switches. Registry pattern in `js/indicators.js` — add new indicators by pushing to `REGISTRY` array.

**AI Strip (bottom bar):** Two signal pills (SHORT TERM / LONG TERM) + key drivers + accuracy badge. Clicking opens `ai-analysis.html`.

### options-flow.html — Options Flow

| Component | JS File | Data Source |
|---|---|---|
| `OptionsFlowPage` | `js/options-flow.js` | `/data/options-flow.json`, `/data/flow-sentiment.json` |

Features: ticker search filter, call/put toggle, min premium dropdown ($25k/$50k/$100k/$500k), DTE filter, sweeps-only toggle. Top tickers by premium (click to filter). Unusual activity detector (>2× average premium). Greeks/stats panel per ticker.

**Options flow status indicator:** Displays Live / Stale / No data (derived from `fetched_at` timestamp — no longer hardcoded "Connecting…").

**Trade display notes:**
- **Size** — falls back to `ask_size` when primary size field is unavailable
- **Side** — derived from `ask_size` vs `bid_size` comparison
- **Exchange** — hidden when field is unavailable in the data

### ai-analysis.html — AI Analysis

| Component | JS File | Data Sources |
|---|---|---|
| `AISynthesis` (page) | `js/ai-synthesis.js` | `/data/ai-synthesis.json`, `/data/accuracy-stats.json`, `/data/accuracy-log.json` |

**Sections:**
1. Three signal cards (Intraday / Next Day / Long-Term)
2. 📌 **SPY & QQQ Analysis** — benchmarks block with per-bias breakdown and predicted prices (above Tickers to Watch)
3. News + Flow impact
4. **Tickers to Watch** — standout tickers only (SPY/QQQ moved to benchmarks section); each card shows `reasoning`, `key_driver`, `conflicting_signals`; symbol row + badges row layout (wrapping bug fixed)
5. 🧠 **Calibration Notes** — shown when `calibration_notes` field is present in data
6. Trade Ideas
7. Key Risks
8. **Accuracy Track Record** — Performance tab with directional accuracy and price accuracy sections (see below)
9. Raw Data Used (collapsible)

**Performance Tab:**
- "Accuracy" renamed to **"Directional Accuracy"** throughout
- **Price Accuracy** section shows avg error % by timeframe with grade (Excellent / Good / Fair / Poor)
- History table includes 3 new columns: **Direction ✓**, **Avg Price Error**, **Best Call**
- Explanatory note distinguishes directional accuracy (was the signal direction correct?) from price accuracy (how close was the predicted price?)
- **Regime badge** displayed inline on signal cards when `regime` field is present

---

## 8. AI Synthesis Layer

### How `ai-synthesis.sh` Works

1. **Sources credentials** from `/etc/anthropic.env` and `/etc/finnhub.env`
2. **Reads all data files:** `headlines.json`, `trends.json`, `data/top-flow.json`, `data/flow-sentiment.json`, `data/options-flow.json`
3. **Loads calibration history** — 10 most recent resolved predictions from `data/prediction-archive.json`; regime-filtered (uses same-regime entries when ≥5 exist for current regime)
4. **Fetches current prices** — Finnhub for US stocks, Yahoo Finance for international indices and commodities
5. **Calls `ai-synthesis.py`** — Python script at `/home/bot1/scripts/ai-synthesis.py` handles prompt construction and Claude API call
6. **Parses JSON response** — strips accidental markdown fences; validates `calibration_notes` field present
7. **Injects metadata** — `data_sources` dict, `regime` tag, `signal_snapshot`, `prices_at_generation` (flat dict), ensures `generated_at` is set
8. **Stores `TRIGGER_TYPE`** (`scheduled` or `manual`) in the archive entry
9. **Appends to `data/prediction-archive.json`** — rolling 200-entry archive; trims oldest entries beyond 200
10. **Saves** `data/ai-synthesis.json`
11. **Git stash → pull --rebase → commit → push → stash pop** (avoids race conditions with other cron jobs)

### Self-Calibration System

Each prediction stored in `prediction-archive.json` includes a **signal snapshot** and **regime tag** allowing Claude to learn from past performance in similar market conditions.

**Signal snapshot** (stored per prediction):

```json
{
  "pc_ratio": 1.14,
  "flow_sentiment": "BEARISH",
  "top_flow_summary": "Heavy SPY put buying near ATM...",
  "vix": 22.3,
  "news_headlines": ["Fed minutes signal...", "..."],
  "regime": "high_vol_downtrend"
}
```

**Regime tagging:** `{high_vol|low_vol}_{uptrend|downtrend|choppy}`
- `high_vol` = VIX > 20; `low_vol` = VIX ≤ 20
- Trend determined by SPY vs 20-day SMA

**Per-ticker fields stored:**
- `reasoning` — truncated to 150 chars at storage
- `key_driver` — truncated to 150 chars at storage
- `conflicting_signals` — truncated to 150 chars at storage

**History injection logic:**
- Injects 10 most recent resolved predictions into Claude's prompt
- When ≥5 same-regime predictions exist, filters to regime-matched entries only

**Anti-neutrality guardrails (mandatory):**
- Max 20% NEUTRAL signals across tickers
- Confidence floor: 30
- Target price caps: intraday ≤1.5%, next-day ≤2.5%, 30d ≤8%

**Baseline snapshot:** `data/accuracy-baseline-2026-03-11.json` — captured before self-calibration rollout on 2026-03-11.

### System Prompt Strategy

Claude Opus is given an elite analyst persona that:
- Has access to its own past predictions and outcomes, regime-filtered for relevance
- Distinguishes explicitly between intraday (2h), next-day, and 30-day outlooks
- Must provide `calibration_notes` explaining how past performance is influencing current predictions
- Is instructed to be specific and avoid generic statements
- Applies anti-neutrality guardrails to ensure actionable signals

### JSON Output Structure

```json
{
  "calibration_notes": "Required string — how past accuracy is influencing this prediction",
  "intraday": {
    "signal": "BEARISH",
    "confidence": 72,
    "summary": "...",
    "key_driver": "...",
    "predicted_prices": { "SPY": 674.20, "QQQ": 465.10, "IWM": 198.50, "NVDA": 118.40, "AAPL": 211.30 }
  },
  "next_day": {
    "signal": "BEARISH",
    "confidence": 68,
    "summary": "...",
    "key_driver": "...",
    "predicted_prices": { "SPY": 671.00, "QQQ": 462.50, "IWM": 196.80, "NVDA": 116.00, "AAPL": 209.50 }
  },
  "long_term": {
    "signal": "BEARISH",
    "confidence": 80,
    "summary": "...",
    "key_driver": "...",
    "predicted_prices": { "SPY": 650.00, "QQQ": 445.00, "IWM": 188.00, "NVDA": 105.00, "AAPL": 200.00 }
  },
  "news_impact": "...",
  "options_flow_impact": "...",
  "risks": ["...", "...", "..."],
  "benchmarks": {
    "SPY": {
      "intraday_bias": "BEARISH",
      "next_day_bias": "BEARISH",
      "long_term_bias": "NEUTRAL",
      "analysis": "...",
      "key_driver": "...",
      "conflicting_signals": "...",
      "predicted_price_2h": 674.20,
      "predicted_price_nextday": 671.00,
      "predicted_price_30d": 650.00
    },
    "QQ