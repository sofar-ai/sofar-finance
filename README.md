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
- **AI market intelligence** — Claude Opus analyzes all data streams every 2 hours, produces short-term (2h) and long-term (30d) signals with trade ideas
- **Accuracy tracking** — Every AI prediction is backchecked 2 hours later; rolling accuracy stats displayed

### Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Vercel (static + serverless functions) |
| Frontend | Vanilla HTML/CSS/JS — no framework |
| Charts | TradingView Lightweight Charts v4.2 |
| Fonts | IBM Plex Mono + Inter (Google Fonts) |
| Market data | Yahoo Finance (no key), Finnhub (key required) |
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
| AI Analysis | `/ai-analysis.html` | Short/long-term signals, news+flow impact, tickers to watch, trade ideas, accuracy track record |

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
├─ Yahoo Finance + Anthropic Claude Opus
│   └─ ai-synthesis.sh (cron 9:40/11:40/13:40/15:40 ET Mon-Fri)
│       ├─ Reads all data files above
│       ├─ Fetches current prices from Yahoo Finance
│       ├─ Loads last 10 accuracy records for calibration
│       ├─ Sends everything to Claude Opus
│       └─ Writes: data/ai-synthesis.json
│
└─ Yahoo Finance (price verification)
    └─ backcheck-predictions.sh (cron 11:35/13:35/15:35/17:35 ET Mon-Fri)
        ├─ Reads previous ai-synthesis.json prediction
        ├─ Fetches actual current prices
        ├─ Scores directional and price accuracy per ticker
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

- **Used for:** Chart OHLCV data, live quote fallback, underlying prices in scripts
- **No API key required**
- **Base URL:** `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}`
- **Required header:** `User-Agent: Mozilla/5.0 ...` (empty responses without it)
- **Ticker formats:**
  - US ETFs/stocks: `SPY`, `QQQ`, `AAPL`
  - Indices: `^VIX`, `^GSPC`, `^DJI`, `^N225`, `^KS11`, `^TWII`
  - Commodities: `GC=F` (gold), `SI=F` (silver), `CL=F` (WTI), `BZ=F` (Brent)
  - Crypto: `BTC-USD`
- **Chart intervals used:** `5m` (1D), `30m` (1W), `1d` (1M), `1wk` (1Y)
- **Response path:** `chart.result[0].timestamp`, `chart.result[0].indicators.quote[0]`

### Finnhub

- **Used for:** Real-time stock quotes in the browser (via `/api/quote` serverless function)
- **Key:** `FINNHUB_API_KEY` — stored in Vercel environment variables only
- **Base URL:** `https://finnhub.io/api/v1/`
- **Endpoints used:**
  - `GET /quote?symbol={ticker}&token={key}` → `{c, d, dp, h, l, o, pc}`
- **Note:** Free tier does NOT support `/stock/candle` — charts use Yahoo Finance instead

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
- **Premium estimation:** `ask × ask_size × 100` (options contract = 100 shares)
- **Session:** ThetaData Terminal must be running; only one instance at a time
- **Session error string:** `"Invalid session ID. This can occur if more than one terminal is running."`

### Anthropic Claude

- **Used for:**
  1. **Options flow ranking** — Claude Sonnet analyzes top 60 trades → returns top 5 JSON array with reasoning
  2. **Market intelligence** — Claude Opus analyzes all data streams → returns dual ST/LT signal JSON
- **Models:**
  - `claude-sonnet-4-5` — options flow analysis (called from `fetch-options-flow.sh`)
  - `claude-opus-4-20250514` — market synthesis (called from `ai-synthesis.sh`)
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

# Prediction backcheck — 11:35, 13:35, 15:35, 17:35 ET Mon-Fri (~2h after each synthesis)
35 11,13,15,17 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh >> /home/bot1/logs/backcheck.log 2>&1
```

### Scripts

| Script | Trigger | Description |
|---|---|---|
| `~/scripts/scrape-headlines.sh` | Every 6h | Fetches RSS feeds, writes `headlines.json` + `trends.json`, git pushes |
| `~/scripts/fetch-options-flow.sh` | 4× daily Mon-Fri | ThetaData → filter → Claude Sonnet → JSON files → git push |
| `~/scripts/ai-synthesis.sh` | 4× daily Mon-Fri | Reads all data → Yahoo prices → Claude Opus → `ai-synthesis.json` → git push |
| `~/scripts/backcheck-predictions.sh` | 4× daily Mon-Fri | Verifies 2h price predictions → updates accuracy log/stats → git push |

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
| `FINNHUB_API_KEY` | `/etc/finnhub.env` | Finnhub key for script-side price fetching (fallback; Yahoo Finance used if missing) |

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
| `data/ai-synthesis.json` | `ai-synthesis.sh` | `js/ai-synthesis.js` | Full dual-signal analysis: `{short_term, long_term, news_impact, options_flow_impact, risks, tickers_to_watch, trade_ideas, prices_at_generation, data_sources, generated_at, next_update}` |
| `data/accuracy-log.json` | `backcheck-predictions.sh` | `js/ai-synthesis.js`, `ai-synthesis.sh` | Array of prediction check results — appended every backcheck run |
| `data/accuracy-stats.json` | `backcheck-predictions.sh` | `js/ai-synthesis.js` | Rolling accuracy stats: `{total_predictions, correct, accuracy_pct, by_signal, avg_price_error_pct, best_ticker, worst_ticker}` |

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

### ai-analysis.html — AI Analysis

| Component | JS File | Data Sources |
|---|---|---|
| `AISynthesis` (page) | `js/ai-synthesis.js` | `/data/ai-synthesis.json`, `/data/accuracy-stats.json`, `/data/accuracy-log.json` |

Six sections: Dual signal cards → News+Flow impact → Tickers to Watch (predicted prices) → Trade Ideas → Key Risks → Accuracy Track Record → Raw Data Used (collapsible).

---

## 8. AI Synthesis Layer

### How `ai-synthesis.sh` Works

1. **Sources credentials** from `/etc/anthropic.env`
2. **Reads all data files:** `headlines.json`, `trends.json`, `data/top-flow.json`, `data/flow-sentiment.json`, `data/options-flow.json`
3. **Loads accuracy history** — last 10 entries from `data/accuracy-log.json` for Claude calibration
4. **Fetches current prices** for 10 symbols from Yahoo Finance (falls back from Finnhub if key missing)
5. **Constructs Claude Opus prompt** with all data inline
6. **Parses JSON response** — strips accidental markdown fences
7. **Injects metadata** — `data_sources` dict, ensures `generated_at`/`next_update` are set
8. **Saves** `data/ai-synthesis.json`
9. **Git stash → pull --rebase → commit → push → stash pop** (avoids race conditions with other cron jobs)

### System Prompt Strategy

Claude Opus is given an elite analyst persona that:
- Has access to its own past predictions and outcomes
- Distinguishes explicitly between intraday (2h) and 30-day outlooks
- Is instructed to be specific and avoid generic statements
- Uses past accuracy to calibrate confidence levels

### JSON Output Structure

```json
{
  "short_term": { "signal": "BEARISH", "confidence": 75, "summary": "...", "key_driver": "..." },
  "long_term":  { "signal": "BEARISH", "confidence": 80, "summary": "...", "key_driver": "..." },
  "news_impact": "...",
  "options_flow_impact": "...",
  "risks": ["...", "...", "..."],
  "tickers_to_watch": [
    { "ticker": "SPY", "short_term_bias": "BEARISH", "long_term_bias": "BEARISH",
      "reason": "...", "predicted_price_2h": 675.10, "predicted_price_30d": 650.00 }
  ],
  "trade_ideas": [
    { "idea": "...", "ticker": "SPY", "type": "puts", "timeframe": "intraday",
      "thesis": "...", "risk": "..." }
  ],
  "generated_at": "2026-03-10T14:40:00Z",
  "next_update": "2026-03-10T16:40:00Z",
  "prices_at_generation": { "SPY": { "price": 678.32, "change": 0.05, "change_pct": 0.01 } },
  "data_sources": { "headlines_count": 25, "trends_count": 12, "flow_trades": 4074, ... }
}
```

### Backcheck / Learning System (`backcheck-predictions.sh`)

1. **Deduplicates** — skips if `prediction_time` already in `accuracy-log.json`
2. **Fetches actual current prices** via Yahoo Finance for each `tickers_to_watch` ticker
3. **Scores each ticker:**
   - `actual_direction` = BULLISH/BEARISH if price moved >0.1% from prediction time, else NEUTRAL
   - `correct` = predicted short_term_bias matches actual direction
   - `price_error_pct` = `|actual - predicted_2h| / predicted_2h × 100`
4. **`overall_accuracy`** = fraction of tickers with correct directional call
5. **Appends** to `accuracy-log.json`
6. **Recalculates** `accuracy-stats.json` from full log: total, by-signal breakdown, avg price error, best/worst ticker

Claude receives the last 10 accuracy records in every synthesis prompt — allowing it to adjust confidence if it has been consistently wrong on a signal type.

---

## 9. Options Flow Pipeline

### Data Fetching (`fetch-options-flow.sh`)

1. **Get expirations** — for each symbol, calls `/v3/option/list/expirations` and filters to the next 35 days, caps at 6 expirations per symbol
2. **Snapshot quotes** — for each symbol+expiration, calls `/v3/option/snapshot/quote` which returns CSV of all contracts at that expiration
3. **Filter** — keep only contracts where estimated premium ≥ $25,000
4. **Premium estimation** — `ask × ask_size × 100` (since size = number of contracts, each = 100 shares)
5. **Sort** by premium descending, keep top 200 for tape

### Sentiment Calculation

```
call_premium = sum of all call premiums (right == 'C')
put_premium  = sum of all put premiums (right == 'P')
pc_ratio     = put_premium / call_premium
sentiment    = BEARISH if pc_ratio > 1.2
             = BULLISH if pc_ratio < 0.8
             = NEUTRAL otherwise
```

### Claude Options Ranking

- Top 60 trades by premium are sent to Claude Sonnet
- Each trade includes: symbol, right (C/P), strike, expiration, premium, size, bid, ask, underlying_price, otm_pct
- `otm_pct` = `(strike - underlying) / underlying × 100` for calls; negated for puts (positive = OTM in both cases)
- Claude returns JSON array of top 5 with `reason` field explaining significance
- Fallback: if Claude fails or key missing, top 5 by premium with auto-generated reason strings

### OTM% Context

Sending `underlying_price` and `otm_pct` to Claude significantly improves reasoning quality — Claude can distinguish between deep-ITM synthetic long exposure, near-ATM directional bets, and deep-OTM lottery/hedge plays.

---

## 10. Setup Guide — Rebuild From Scratch

### Step 1: GitHub Repository

```bash
# Create repo: sofar-ai/sofar-finance (public or private)
# Clone it
git clone https://github.com/sofar-ai/sofar-finance.git ~/sofar-finance
cd ~/sofar-finance
```

### Step 2: Vercel Setup

1. Go to [vercel.com](https://vercel.com), import `sofar-ai/sofar-finance` from GitHub
2. Framework preset: **Other** (static site)
3. Build command: _(leave empty)_
4. Output directory: _(leave empty — serves from repo root)_
5. Add environment variables in Vercel dashboard:
   - `FINNHUB_API_KEY` = your Finnhub API key

Vercel auto-deploys on every push to `main`.

### Step 3: Java (required for ThetaData)

```bash
sudo apt update
sudo apt install openjdk-21-jdk
java -version  # should show OpenJDK 21
```

### Step 4: ThetaData Terminal

1. Download ThetaData Terminal JAR from [thetadata.us](https://thetadata.us)
2. Create systemd service at `/etc/systemd/system/thetadata.service`:

```ini
[Unit]
Description=ThetaData Terminal
After=network.target

[Service]
User=bot1
ExecStart=/usr/bin/java -jar /home/bot1/thetadata-terminal.jar
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable thetadata
sudo systemctl start thetadata

# Verify it's up
curl -s http://localhost:25503/v3/option/list/expirations?symbol=SPY | head -3
```

### Step 5: Credential Files

```bash
# Anthropic key
echo "ANTHROPIC_API_KEY=sk-ant-YOUR-KEY" | sudo tee /etc/anthropic.env
sudo chmod 644 /etc/anthropic.env

# Finnhub key (optional — scripts fall back to Yahoo Finance)
echo "FINNHUB_API_KEY=YOUR-KEY" | sudo tee /etc/finnhub.env
sudo chmod 644 /etc/finnhub.env
```

### Step 6: Script Dependencies

```bash
# Python 3.9+ required (for zoneinfo)
python3 --version

# GitHub CLI (for authenticated git pushes)
# Install: https://cli.github.com
gh auth login

# Configure git identity in the repo
cd ~/sofar-finance
git config user.email "bot@sofar.finance"
git config user.name "Sofar Bot"
```

### Step 7: Create Directories and Copy Scripts

```bash
mkdir -p ~/scripts ~/logs

# Copy scripts from repo or recreate:
# ~/scripts/fetch-options-flow.sh
# ~/scripts/ai-synthesis.sh
# ~/scripts/backcheck-predictions.sh
# ~/scripts/scrape-headlines.sh

chmod +x ~/scripts/*.sh
```

### Step 8: Initialize Data Files

```bash
mkdir -p ~/sofar-finance/data

# Placeholder files (scripts will overwrite on first run)
echo '{"fetched_at":null,"market_open":false,"total_trades":0,"trades":[]}' > ~/sofar-finance/data/options-flow.json
echo '{"fetched_at":null,"market_open":false,"pc_ratio":null,"call_premium":0,"put_premium":0,"sentiment":"NEUTRAL","total_trades":0}' > ~/sofar-finance/data/flow-sentiment.json
echo '{"fetched_at":null,"market_open":false,"top_trades":[]}' > ~/sofar-finance/data/top-flow.json
echo '{"generated_at":null,"short_term":{"signal":"NEUTRAL","confidence":0},"long_term":{"signal":"NEUTRAL","confidence":0}}' > ~/sofar-finance/data/ai-synthesis.json
echo '[]' > ~/sofar-finance/data/accuracy-log.json
echo '{"total_predictions":0,"correct":0,"accuracy_pct":0}' > ~/sofar-finance/data/accuracy-stats.json

cd ~/sofar-finance && git add -A && git commit -m "init: data placeholders" && git push
```

### Step 9: Set Up Crontab

```bash
crontab -e
# Add these lines:
0 */6 * * * /bin/bash /home/bot1/scripts/scrape-headlines.sh >> /home/bot1/scripts/scrape-headlines.log 2>&1
30 9,11,13,15 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/fetch-options-flow.sh >> /home/bot1/logs/flow-fetch.log 2>&1
40 9,11,13,15 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/ai-synthesis.sh >> /home/bot1/logs/ai-synthesis.log 2>&1
35 11,13,15,17 * * 1-5 REPO_PATH=/home/bot1/sofar-finance /bin/bash /home/bot1/scripts/backcheck-predictions.sh >> /home/bot1/logs/backcheck.log 2>&1
```

### Step 10: Manual Test Each Script

```bash
# Test options flow (requires ThetaData running + market hours for live data)
REPO_PATH=~/sofar-finance bash ~/scripts/fetch-options-flow.sh 2>&1

# Test AI synthesis (any time)
REPO_PATH=~/sofar-finance bash ~/scripts/ai-synthesis.sh 2>&1

# Test backcheck (run after synthesis)
REPO_PATH=~/sofar-finance bash ~/scripts/backcheck-predictions.sh 2>&1

# Check logs
tail -50 ~/logs/flow-fetch.log
tail -50 ~/logs/ai-synthesis.log
tail -50 ~/logs/backcheck.log
```

---

## 11. Troubleshooting

### ThetaData Terminal not starting

```bash
# Check service status
systemctl status thetadata

# Check if port is in use
ss -tlnp | grep 25503

# View live logs
journalctl -u thetadata -f

# Force restart
sudo systemctl restart thetadata

# Manual test after restart
curl -s "http://localhost:25503/v3/option/list/expirations?symbol=SPY" | head -5
```

**Common causes:**
- `"Invalid session ID"` — another Terminal instance is running; kill it and restart service
- Port 25503 already in use — `sudo lsof -i :25503` to find and kill the process
- Java not found — verify `java -version` returns OpenJDK 21
- `"No data found"` from snapshot endpoint — normal outside market hours; data is EOD snapshots

### Charts not loading

1. **Check the API endpoint:** `curl https://sofar-finance.vercel.app/api/chart?ticker=SPY&timeframe=1D`
2. **403 from Finnhub** — Finnhub free tier doesn't support `/stock/candle`; charts should use Yahoo Finance via `api/chart.js`
3. **Empty response from Yahoo** — missing `User-Agent` header; verify `api/chart.js` sends it
4. **`timestamp` vs `timestamps`** — Yahoo Finance response uses singular `timestamp` (not plural)
5. **Null candles** — Yahoo returns null values for pre/post market; `api/chart.js` filters them out

### Git push failing

```bash
# Rejected push (another job pushed first)
cd ~/sofar-finance
git stash && git pull --rebase && git push && git stash pop

# All scripts include: git stash && git pull --rebase && git push && git stash pop
# If push still fails, check for merge conflicts:
git status
git log --oneline -5
```

### Claude not generating reasoning (falls back to top-5 by premium)

1. **Check key loaded:** Script logs `"API key found"` and `"ANTHROPIC_API_KEY in Python env: YES"`
2. **`source` without `export`** — the original bug; fix is `source /etc/anthropic.env && export ANTHROPIC_API_KEY`
3. **Timeout** — Claude Opus has 90s timeout; if hitting it, reduce `max_tokens` or trim input
4. **JSON parse error** — Claude occasionally wraps response in markdown fences; parser strips ` ```json ` automatically
5. **Test directly:**
   ```bash
   source /etc/anthropic.env && export ANTHROPIC_API_KEY
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{"model":"claude-sonnet-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
   ```

### Quote bar showing stale data

- Quotes auto-refresh every 30 seconds via Finnhub
- If all quotes show `--`: `FINNHUB_API_KEY` not set in Vercel environment variables
- Set it at: Vercel Dashboard → Project → Settings → Environment Variables

### AI strip showing "pending"

- Normal outside market hours — synthesis only runs Mon-Fri 9:40/11:40/13:40/15:40 ET
- If during market hours: check `~/logs/ai-synthesis.log` for errors
- Manually trigger: `REPO_PATH=~/sofar-finance bash ~/scripts/ai-synthesis.sh`

---

*Generated by Sofar AI assistant. Last updated: March 2026.*
