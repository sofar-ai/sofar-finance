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
---

## 9. Options Flow Pipeline

### Architecture Overview

```
ThetaData FPSS (market data feed)
    └─► ThetaData Terminal (Java, ports 25503 REST / 25520 WS)
            └─► WebSocket ws://localhost:25520/v1/events
                    └─► flow-daemon.py  (STREAM_BULK subscription)
                            └─► rolling-flow.json  (in-memory accumulation, $50k+ filter)
                                    └─► fetch-options-flow.sh  (every 30 min at :30)
                                            └─► options-flow.json / top-flow.json / flow-sentiment.json
                                                    └─► Vercel (static serve) → Frontend
```

### flow-daemon.py

Runs as a persistent user-level systemd service (`thetadata-flow-daemon.service`).

**Subscription:**
```json
{"msg_type": "STREAM_BULK", "sec_type": "OPTION", "req_type": "TRADE", "add": true, "id": 0}
```
Each reconnect increments `id` — required for the ThetaData terminal to resubscribe streams automatically.

**Trade filtering:**
- Only trades where `price × size × 100 ≥ $50,000` (configurable via `MIN_PREMIUM`)
- Market hours only: 9:30 AM–4:00 PM ET, Mon–Fri
- Strike raw value divided by 1000 → dollar value (ThetaData internal format)

**Rolling file (`data/rolling-flow.json`):**
- Accumulates qualifying trades per trading day
- Rotates at midnight ET — previous day archived to `data/flow-archive/flow-YYYY-MM-DD.json`
- On mid-day restart: appends to existing file (doesn't reset intraday count)

**Health monitoring (`~/daemon-health.json`):**
```json
{
  "status": "streaming",          // streaming | reconnecting | stale | stopped
  "last_trade_ts": "2026-03-13T11:42:17-04:00",
  "trades_today": 347,
  "subscribed_at": "2026-03-13T09:30:05-04:00",
  "reconnects_today": 0
}
```

**Reliability features:**
- Reconnection with exponential backoff: 5s → 10s → 30s → 60s cap; resets after successful connection
- Staleness detection: if subscribed but no qualifying trade in 5 minutes during market hours → logs warning, sets `status: "stale"` (does not close socket)
- `INVALID_PERMS` or `MAX_STREAMS_REACHED` response → logs error and exits (requires manual restart)

### fetch-options-flow.sh

Runs at `30 9,11,13,15 * * 1-5` — 30 minutes before each synthesis run.

**Health check (bash, no Python deps):**
1. Reads `~/daemon-health.json`, extracts `status` and `last_trade_ts`
2. Uses `date -d "$last_trade_ts" +%s` (GNU coreutils) to compute age in minutes
3. If age ≤ 15 minutes → `DAEMON_USE=true` → loads trades from `rolling-flow.json`
4. If stale/missing → falls back to ThetaData REST snapshot queries per-symbol

**Output files:**
- `data/options-flow.json` — all qualifying trades (up to 200), with `fetched_at` and `market_open`
- `data/flow-sentiment.json` — call/put premium totals, P/C ratio, BULLISH/BEARISH/NEUTRAL
- `data/top-flow.json` — top 5 trades ranked by Claude Sonnet (or fallback top-5 by premium)

### Cron Schedule (ET, Mon–Fri)

| Time | Job |
|------|-----|
| 9:30 AM | `fetch-options-flow.sh` |
| 9:35 AM | `backcheck-predictions.sh nextday` (checks previous day's next-day predictions) |
| 9:40 AM | `ai-synthesis.sh` |
| 11:30 AM | `fetch-options-flow.sh` |
| 11:35 AM | `backcheck-predictions.sh intraday` |
| 11:40 AM | `ai-synthesis.sh` ← **Contrarian Watch** runs here only |
| 1:30 PM  | `fetch-options-flow.sh` |
| 1:35 PM  | `backcheck-predictions.sh intraday` |
| 1:40 PM  | `ai-synthesis.sh` |
| 3:30 PM  | `fetch-options-flow.sh` |
| 3:35 PM  | `backcheck-predictions.sh intraday` |
| 3:40 PM  | `ai-synthesis.sh` |
| 4:01 PM  | `backcheck-predictions.sh intraday` (market close) |
| 4:05 PM  | `generate-daily-summary.sh` |
| Every 6h | `scrape-headlines.sh` + `scrape-x-headlines.js` |

### Contrarian Module

- Generated at the 11:40 AM ET synthesis run only (`GENERATE_CONTRARIAN = hour in (11,12) and not has_today`)
- Only if no contrarian idea already exists for today (`_has_today_ci` check, re-verified before persist)
- Claude identifies a single 30-day contrarian setup using the technicals block (RSI + MA50/200)
- Stored in `data/contrarian-ideas.json` with `status: "active"` until resolved or expired (30 days)
- Committed to GitHub by `ai-synthesis.sh` git add (separate from main synthesis JSON)

### Manual Refresh Path

```
Browser button click
    └─► POST /api/trigger-refresh (Vercel serverless, writes data/refresh-trigger.json to GitHub)
            └─► refresh-poller.py (cron every minute, reads trigger file from GitHub)
                    ├─► Step 1: fetch-options-flow.sh (daemon health check → fresh flow data)
                    ├─► Step 2: ai-synthesis.sh (synthesis with latest flow)
                    └─► Step 3: Schedule backcheck entry
```

Note: If `GITHUB_TOKEN` is not set in Vercel environment variables, the trigger write fails silently. Verify at Vercel Dashboard → Settings → Environment Variables.

### API Error Handling

- Claude API failures (including HTTP 529 Overloaded) trigger a 60-second wait and one retry
- If both attempts fail and valid same-day synthesis exists (`intraday.confidence > 0`) → exit without overwriting
- If no valid same-day data: writes `{"status": "api_error", "error_message": "..."}` — frontend renders clean error state (no fake NEUTRAL/0% signals)

---

## 10. Setup Guide — Rebuild From Scratch

### Step 1: GitHub Repository

```bash
git clone https://github.com/sofar-ai/sofar-finance.git ~/sofar-finance
cd ~/sofar-finance
```

### Step 2: Vercel Setup

1. Go to [vercel.com](https://vercel.com), import `sofar-ai/sofar-finance` from GitHub
2. Framework preset: **Other** (static site), build command and output dir: leave empty
3. Add environment variables in Vercel dashboard:
   - `GITHUB_TOKEN` — a GitHub PAT with `repo` scope (used by trigger API functions to write `data/refresh-trigger.json`)
   - `GITHUB_REPO` — `sofar-ai/sofar-finance`
   - `FINNHUB_API_KEY` — optional; scripts fall back to Yahoo Finance

### Step 3: Java (required for ThetaData)

```bash
sudo apt update && sudo apt install openjdk-21-jdk
java -version  # should show OpenJDK 21
```

### Step 4: ThetaData Terminal

```bash
# Download ThetaTerminalv3.jar from thetadata.us
# Create start script at ~/start-theta.sh then run as a background service
# Verify:
curl -s "http://localhost:25503/v3/option/list/expirations?symbol=SPY" | head -3
```

### Step 5: Credential Files

```bash
# Anthropic key
echo "ANTHROPIC_API_KEY=sk-ant-YOUR-KEY" | sudo tee /etc/anthropic.env
sudo chmod 644 /etc/anthropic.env

# Finnhub key (optional)
echo "FINNHUB_API_KEY=YOUR-KEY" | sudo tee /etc/finnhub.env
sudo chmod 644 /etc/finnhub.env

# ThetaData credentials (root-only)
echo "THETADATA_USERNAME=your@email.com" | sudo tee /etc/thetadata.env
echo "THETADATA_PASSWORD=yourpassword" | sudo tee -a /etc/thetadata.env
sudo chmod 600 /etc/thetadata.env
```

### Step 6: Script Dependencies

```bash
# Python 3.9+ required (for zoneinfo)
python3 --version

# pip
curl https://bootstrap.pypa.io/get-pip.py | python3 --user

# WebSocket client (for flow daemon)
pip install websocket-client

# GitHub CLI (for authenticated git pushes — no hardcoded tokens)
# Install: https://cli.github.com
gh auth login --scopes repo,workflow

# Configure git identity in the repo
cd ~/sofar-finance
git config user.email "bot@sofar.finance"
git config user.name "Sofar Bot"
```

**Token management:** Scripts call `gh auth token` at runtime — no tokens are hardcoded in scripts or config files. To rotate: `gh auth login` to update the gh CLI store; update `GITHUB_TOKEN` in Vercel dashboard and redeploy.

### Step 7: Create Directories and Copy Scripts

```bash
mkdir -p ~/scripts ~/logs ~/sofar-finance/data/flow-archive

# Scripts live outside the git repo (not committed):
# ~/scripts/ai-synthesis.py       — main Claude synthesis (Opus 4)
# ~/scripts/ai-synthesis.sh       — bash wrapper + git commit
# ~/scripts/fetch-options-flow.sh — flow fetch with daemon health check
# ~/scripts/backcheck-predictions.sh
# ~/scripts/flow-daemon.py        — ThetaData WebSocket accumulator
# ~/scripts/refresh-poller.py     — manual trigger handler
# ~/scripts/scrape-headlines.sh
# ~/scripts/generate-trends.py
# ~/scripts/analyze-ticker.py
# ~/scripts/generate-daily-summary.sh

chmod +x ~/scripts/*.sh
```

### Step 8: Flow Daemon Service

```bash
# Install as user-level systemd service
mkdir -p ~/.config/systemd/user/
# Create thetadata-flow-daemon.service (see ~/scripts/thetadata-flow-daemon.service)
systemctl --user daemon-reload
systemctl --user enable thetadata-flow-daemon
systemctl --user start thetadata-flow-daemon
loginctl enable-linger $USER  # keep service running after logout

# Verify
systemctl --user status thetadata-flow-daemon
tail -f ~/logs/flow-daemon.log
```

### Step 9: Initialize Data Files

```bash
mkdir -p ~/sofar-finance/data
echo '{"fetched_at":null,"market_open":false,"total_trades":0,"trades":[]}' > ~/sofar-finance/data/options-flow.json
echo '{"fetched_at":null,"market_open":false,"pc_ratio":null,"call_premium":0,"put_premium":0,"sentiment":"NEUTRAL","total_trades":0}' > ~/sofar-finance/data/flow-sentiment.json
echo '{"fetched_at":null,"top_trades":[]}' > ~/sofar-finance/data/top-flow.json
echo '{"date":null,"count":0,"trades":[]}' > ~/sofar-finance/data/rolling-flow.json
echo '{"ideas":[]}' > ~/sofar-finance/data/contrarian-ideas.json
echo '[]' > ~/sofar-finance/data/daily-summaries.json
echo '{}' > ~/sofar-finance/data/watchlist.json

cd ~/sofar-finance && git add -A && git commit -m "init: data placeholders" && git push
```

### Step 10: Set Up Crontab

```bash
crontab -e
# Add (note: /bin/sh is dash on Ubuntu — use . not source):
. /etc/anthropic.env && export ANTHROPIC_API_KEY && 0 */6 * * * /bin/bash /home/bot1/scripts/scrape-headlines.sh
0 */6 * * * . /etc/anthropic.env && export ANTHROPIC_API_KEY && /bin/bash /home/bot1/scripts/scrape-headlines.sh >> /home/bot1/logs/scrape-headlines.log 2>&1
30 9,11,13,15 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/fetch-options-flow.sh >> /home/bot1/logs/flow-fetch.log 2>&1
40 9,11,13,15 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/ai-synthesis.sh >> /home/bot1/logs/ai-synthesis.log 2>&1
35 11,13,15 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh intraday >> /home/bot1/logs/backcheck.log 2>&1
1 16 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh intraday >> /home/bot1/logs/backcheck.log 2>&1
35 9 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh nextday >> /home/bot1/logs/backcheck.log 2>&1
5 16 * * 1-5 . /etc/anthropic.env && export ANTHROPIC_API_KEY && REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/generate-daily-summary.sh >> /home/bot1/logs/daily-summary.log 2>&1
* * * * * /bin/bash /home/bot1/scripts/refresh-poller.sh >> /home/bot1/logs/refresh-poller.log 2>&1
```

### Step 11: Smoke Test

```bash
# Flow daemon running?
systemctl --user status thetadata-flow-daemon
cat ~/daemon-health.json

# Test options flow (during market hours for daemon path; anytime for REST fallback)
REPO_PATH=~/sofar-finance bash ~/scripts/fetch-options-flow.sh

# Test AI synthesis (any time)
REPO_PATH=~/sofar-finance bash ~/scripts/ai-synthesis.sh

# Check token usage
cat ~/logs/token-usage.log | tail -5

# Check all logs
tail -20 ~/logs/ai-synthesis.log
tail -20 ~/logs/flow-fetch.log
tail -20 ~/logs/flow-daemon.log
```

---

## 11. Troubleshooting

### Flow daemon not receiving trades

```bash
# Check service status
systemctl --user status thetadata-flow-daemon
tail -50 ~/logs/flow-daemon.log

# Confirm WebSocket connection
ss -tnp | grep 25520

# Check health file
cat ~/daemon-health.json
```

**Common causes:**
- `status: "stale"` in health file → FPSS upstream disconnect; restart ThetaData terminal
- `MAX_STREAMS_REACHED` in log → another process connected to port 25520; kill it first
- `INVALID_PERMS` → Options Pro subscription required for Full Trade Stream
- Daemon was started before ThetaData terminal → restart: `systemctl --user restart thetadata-flow-daemon`

### ThetaData Terminal not responding

```bash
# Check REST port
curl -s "http://localhost:25503/v3/option/list/expirations?symbol=SPY" | head -3

# Check processes
ps aux | grep java

# Restart
bash ~/start-theta.sh
```

### fetch-options-flow.sh using stale REST fallback

```bash
cat ~/daemon-health.json
# If last_trade_ts is >15 minutes ago → health check fails, falls back to REST
# Fix: check if daemon is running and ThetaData has FPSS connection
systemctl --user restart thetadata-flow-daemon
tail -20 ~/logs/flow-daemon.log  # look for "Stream SUBSCRIBED"
```

### Claude API failures (HTTP 529 Overloaded)

- Script retries once after 60 seconds automatically
- If both attempts fail and valid same-day data exists → no overwrite (existing data preserved)
- If no same-day data → `{"status":"api_error"}` written; frontend shows clean error state
- Manual retry: `REPO_PATH=~/sofar-finance bash ~/scripts/ai-synthesis.sh`

### Vercel trigger button not responding (no step progress)

1. Check `GITHUB_TOKEN` is set in Vercel environment variables (Dashboard → Settings → Environment Variables)
2. Check that the token has `repo` scope: `gh auth status`
3. Token rotation: update in Vercel dashboard, trigger a redeploy, and run `gh auth login` on server
4. Verify trigger file: `cat ~/sofar-finance/data/refresh-trigger.json`

### Git push failing

```bash
cd ~/sofar-finance
git stash && git pull --rebase && git push && git stash pop
# All scripts include this pattern automatically
```

### AI strip showing "pending" or error state

```bash
# Check what's in the synthesis file
python3 -c "import json; d=json.load(open('~/sofar-finance/data/ai-synthesis.json')); print(d.get('status'), d.get('generated_at'), d.get('intraday',{}).get('signal'))"

# Manually trigger synthesis
REPO_PATH=~/sofar-finance bash ~/scripts/ai-synthesis.sh

# Check last synthesis log
tail -30 ~/logs/ai-synthesis.log
```

### Contrarian Watch not populating

- Only generates at the 11:40 AM ET run (`hour in (11, 12)`)
- Check: `grep "GENERATE_CONTRARIAN" ~/logs/ai-synthesis.log | tail -5`
- If `GENERATE_CONTRARIAN=False`: check ET hour and whether today's idea already exists
- Manual test: `python3 -c "import json; print(json.load(open('~/sofar-finance/data/contrarian-ideas.json')))"`

---

*Last updated: March 2026*
