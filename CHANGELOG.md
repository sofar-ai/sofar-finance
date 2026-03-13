# Changelog

## 2026-03-13

### Features

- **Expiration dates in divergence alert banner** (`js/ai-synthesis.js`, `css/style.css`, `scripts/ai-synthesis.py`)
  — `notable_divergences[]` schema now includes `"expirations": ["YYYY-MM-DD"]` derived from the relevant flow trades
  — Frontend renders each expiration as a pill badge (e.g. "Apr 17") inline with the ticker and detail text
  — Backward compatible: badge hidden if field absent

- **Detection timestamp in divergence alert banner** (`js/ai-synthesis.js`)
  — Banner header now shows "Detected HH:MM AM/PM ET" so users know which synthesis run flagged the alert
  — Uses `data.generated_at` formatted in ET timezone

- **API error state for failed synthesis** (`scripts/ai-synthesis.py`, `js/ai-synthesis.js`)
  — When both Claude API attempts fail and no valid same-day data exists, writes `{"status":"api_error","error_message":"...","failed_at":"..."}` instead of fake NEUTRAL/0% signals
  — Frontend detects `status === "api_error"` in `renderPage()` and shows a clean ⚠️ unavailable message with failed-at time and next scheduled run time
  — Never shows empty tickers or zero-confidence data to users

- **README sections 9–11 restored** (`README.md`)
  — Section 9 (Options Flow Pipeline): fully rewritten for daemon architecture — STREAM_BULK subscription, rolling-flow.json, daemon-health.json, bash health check, cron schedule table, contrarian gating, manual refresh path, retry/guard logic
  — Sections 10–11: updated for current paths, token management via `gh` CLI (no hardcoded tokens), flow daemon systemd setup, new troubleshooting entries

### Fixes

- **renderContrarian + renderDivergences scope fix** (`js/ai-synthesis.js`)
  — Both functions were called from `initPage()` where `ci` and `data` are out of scope (local to `load()`)
  — Fixed: moved both calls to end of `renderPage(data, stats, log, ci)` where parameters are in scope

- **Countdown UTC arithmetic fix** (`js/ai-synthesis.js`)
  — `nextScheduledRun()` was using `.setHours()` which applies local timezone offsets
  — Rewrote using `Date.UTC()` pure UTC arithmetic; countdown is now correct regardless of viewer's local timezone

- **Options flow tape TypeError fix** (`js/options-flow.js`)
  — ThetaData daemon emits integer `condition` codes (e.g. `131`, `132`); `.toUpperCase()` crashed on non-string
  — Fixed: `String(trade.side ?? trade.condition ?? '').toUpperCase()` + `COND_MAP` for integer → label mapping
  — `detectSweep()` updated to match condition codes 131 (SWEEP) and 133 (SWEEP)

- **Accuracy track record label fix** (`js/ai-synthesis.js`)
  — Middle column was showing bare "Mon" on Fridays — misleadingly implied the 72% figure was Monday-specific
  — Fixed to "Next Trading Day" (constant across all days)

### Reliability

- **Claude API retry with same-day data guard** (`scripts/ai-synthesis.py`)
  — On HTTP 529 (Overloaded) or any API exception: wait 60s, retry once before giving up
  — If both attempts fail and valid same-day synthesis exists (`confidence > 0`): skip save, log "Keeping good data", exit 0
  — Only writes api_error placeholder if no valid same-day data at all
  — Contrarian double-fire guard: re-reads `contrarian-ideas.json` from disk before persisting (prevents retry-cycle duplicate)

- **Trigger SHA staleness fix** (`scripts/refresh-poller.py`)
  — All writes to `data/refresh-trigger.json` now go through `gh_put_safe()`: on 409 Conflict, re-fetches current SHA and retries once
  — Persistent failures are logged explicitly (no silent swallow)
  — Fixes button stuck at "running" after concurrent git pushes changed the file's SHA

- **Analyze-ticker race condition fix** (`scripts/analyze-ticker.py`)
  — Added second `git pull --rebase --autostash` immediately before the final push
  — Picks up any concurrent GitHub API commits (trigger state writes) that landed during analysis
  — Prevents divergent fork on the main branch

### Features (continued — afternoon)

- **Ticker Deep Dives page** (`ticker-dives.html`, `js/ticker-dives.js`, `data/ticker-analyses.json`)
  — Dedicated page listing all ticker analyses from the last 30 days, newest first
  — Compact table: time (ET), ticker, bias (color-coded), signal summary, flow premium
  — Click any row → inline accordion expand: trade idea box, options flow, news sentiment, market context, key drivers, confidence bar, data freshness
  — Ticker search/filter at top; result count displayed
  — Mobile responsive: expanded view stacks to 1-col on <640px
  — `analyze-ticker.py` now appends each completed analysis to `ticker-analyses.json`; prunes entries older than 30 days
  — Nav updated on all pages: "Deep Dives" tab between Performance and Config

- **X/Twitter posts now feed into trends ranking** (`scripts/generate-trends.py`)
  — `generate-trends.py` was ignoring `headlines-x.json` entirely — X posts now loaded and sent to Haiku
  — Separate labeled block with explicit weighting instruction for Haiku
  — 24h staleness filter for X (tighter than RSS 48h); sources tracked per trend

### Fixes (continued — afternoon)

- **CORS `Access-Control-Allow-Headers` missing** (`api/trigger-ticker.js`, `api/trigger-refresh.js`)
  — Ticker deep dive POST sends `Content-Type: application/json` → triggers CORS preflight
  — Missing `Access-Control-Allow-Headers: Content-Type` caused "Load failed" browser error
  — Added to both trigger functions

- **Accuracy track record label** (`js/ai-synthesis.js`)
  — Middle column showed bare "Mon" on Fridays — implied accuracy figure was Monday-specific
  — Fixed to "Next Trading Day" across all days

- **`ticker-analyses.json` `_dt` import bug** (`scripts/analyze-ticker.py`)
  — Patch used `_dt.datetime` (alias only valid inside `_log_tokens`) instead of `datetime.datetime`
  — Fixed; META analysis manually backfilled

- **Ticker deep dive frontend timeout extended** (`js/ticker-deep-dive.js`)
  — Flow refresh + analysis takes 4–6 min; 5 min timeout caused false "timed out" on META
  — Extended to 8 minutes

### Reliability (continued — afternoon)

- **WSJ RSS permanently stale — replaced with CNBC** (`scripts/scrape-headlines.sh`)
  — `feeds.a.dj.com` stuck at January 27, 2025; all URL variants return same stale data
  — Replaced with CNBC Markets + CNBC Finance (both live and current)
  — 48h staleness filter added at ingest: skipped 36 stale articles on first run

- **48h headline validation at prompt-build time** (`scripts/ai-synthesis.py`, `scripts/analyze-ticker.py`, `scripts/generate-trends.py`)
  — Second filter layer at synthesis/trends generation — stale articles cannot reach Claude even if scraper misses them
  — Warns if fewer than 5 fresh headlines remain; X posts use tighter 24h filter in trends



## 2026-03-12

### Features

- **Daily Summary page** (`daily-summary.html`, `js/daily-summary.js`, `data/daily-summaries.json`)
  — AI-written market close briefing generated by Claude Sonnet at 4:05 PM ET Mon–Fri
  — Covers: headline, market summary, notable flow, prediction recap, ticker highlights, forward look
  — Two-column layout: main narrative + sidebar (Today's Close stats, Recent Sessions history)
  — Rolling 20-entry store; script: `/home/bot1/scripts/generate-daily-summary.sh`; cron: `5 16 * * 1-5`
  — First entry generated manually at 4:11 PM today

- **Divergence Alerts** (`js/ai-synthesis.js`, `scripts/ai-synthesis.py`)
  — Claude flags `notable_divergences[]` in synthesis JSON when institutional flow strongly contradicts a ticker's signal
  — Amber dismissable banner rendered at top of AI Analysis main content
  — Significance tiers: high = $1M+ or 5000+ contracts, medium = $250k–$1M
  — Rule #8 added to synthesis system prompt; `|| []` fallback prevents UI crash on older JSON

- **Contrarian Watch sidebar** (`ai-analysis.html`, `js/ai-synthesis.js`, `css/style.css`)
  — Compact card moved from main body to right sidebar, below Update Schedule
  — Shows active idea (purple border), truncated thesis, entry→target, issued date
  — Resolved history with win/loss score rendered below active card

- **ThetaData WebSocket flow daemon** (`/home/bot1/scripts/flow-daemon.py`)
  — Replaces snapshot-based options flow with continuous real-time trade accumulator
  — Protocol: `ws://localhost:25520/v1/events` (v3 JSON, discovered by decompiling `202603051.jar`)
  — Subscribe: `{"msg_type":"STREAM_REQ","sec_type":"OPTION","req_type":"TRADE","req_id":0}`
  — Filters trades ≥ $50k premium; accumulates in `data/rolling-flow.json`
  — Resets at 9:30 AM ET daily; archives previous day to `data/flow-archive/flow-YYYY-MM-DD.json`
  — Reconnects with exponential backoff (5→10→30→60s); flushes every 10 trades + every 60s
  — Installed as user-level systemd service: `~/.config/systemd/user/thetadata-flow-daemon.service`
  — `loginctl enable-linger bot1` set so daemon survives reboots without login

- **`fetch-options-flow.sh` updated for daemon integration**
  — Reads `data/rolling-flow.json` when today's daemon data is available
  — Falls back to ThetaData snapshot queries if daemon file is missing or empty
  — All downstream steps (sentiment, Claude analysis, git push) unchanged

### Fixes

- **Headlines cron broken since March 11 6 PM**
  — Root cause: `/bin/sh` is `dash` on this machine; `source` is a bash builtin, not POSIX
  — Cron entry used `source /etc/anthropic.env` which silently failed under dash, killing the job before the script ran
  — Fixed: changed to `. /etc/anthropic.env` (POSIX dot-source) in crontab
  — Manually re-ran scraper to refresh today's headlines

- **Next trading day awareness** (backcheck, synthesis prompt, frontend)
  — `backcheck-predictions.sh`: nextday mode now uses `last_trading_day()` — skips weekends
    so Friday predictions are correctly checked on Monday (previously skipped because `yesterday = Sunday`)
  — `ai-synthesis.py`: Friday synthesis runs inject a prompt note — "next-day predictions evaluate at Monday open, account for weekend gap risk"
  — `js/ai-synthesis.js`: `nextTradingDayLabel()` returns "Mon" on Fridays; schedule sidebar shows "Mon" not "Tomorrow" after last Friday run

- **`notable_divergences` fallback** (`js/ai-synthesis.js`)
  — `data?.notable_divergences` was returning `undefined` on older synthesis JSON (field didn't exist pre-today)
  — Fixed to `data?.notable_divergences || []` to prevent downstream `.filter()`/`.map()` crashes
  — Synthesis prompt changed from "omit if none" to "always include, use `[]` when none"

- **Regime display** (`js/daily-summary.js`)
  — `high_vol_downtrend` was rendering as `Regimehigh_vol_downtrend` in both stats strip and sidebar
  — Fixed with `.replace(/_/g, ' ')` in both rendering locations

- **Vercel CDN cache** (`vercel.json`)
  — Added `Cache-Control: no-store` headers for all `data/*.json` files
  — Prevents Vercel CDN from serving stale synthesis/flow/accuracy data

### Infrastructure

- **`websocket-client` 1.9.0** installed via `get-pip.py` + pip (no system pip was available)
- **`thetadata` SDK 0.9.12** installed from GitHub (PyPI version yanked); used only for protocol research, not runtime
- **`loginctl enable-linger bot1`** — user systemd services persist across reboots
- **Token usage logging** — `_log_tokens()` added to all four Claude call sites; log at `/home/bot1/logs/token-usage.log`; script at `/home/bot1/scripts/token-report.py`

### Known Issues / Pending

- **WebSocket trading hours validation**: Daemon running but market was closed during build — first live validation tomorrow at 9:30 AM ET. Watch `/home/bot1/logs/flow-daemon.log` for `FLOW #1:` entries
- **`right` field format from ThetaData v3 WS**: Daemon handles both `true`/`false` (boolean) and `"C"`/`"P"` (string) but actual v3 response format not confirmed under live conditions
- **README sections 9–11 truncated** (Options Flow Pipeline, Setup Guide, Troubleshooting) — last good commit: `bef94ab`; truncation introduced at `49ca661` — not yet restored
- **Contrarian Watch first idea**: Expected tomorrow at 11:40 AM ET run (first run since feature deployed)
- **Divergence banner live test**: First synthesis with `notable_divergences[]` in schema runs Monday 9:40 AM ET
- **Finnhub API key**: Not yet configured at `/etc/finnhub.env`; system uses Yahoo Finance fallback
- **Regime-filtered history injection**: Planned for week 2+ (need ≥5 same-regime entries to filter)


---

## 2026-03-13

### Fixed
- **Next-update countdown wrong** (`e56ab69`): `nextScheduledRun()` was using `.setDate()` / `.setHours()` on a manually ET-shifted Date object — those methods operate in browser local time, causing wrong results for non-ET browsers. Rewrote to use `Date.UTC()` throughout. "Next update in Xm" now calculates correctly.
- **1Y chart MA50/MA200/RSI wrong** (`0fc6f17`): 1Y timeframe was fetching weekly bars (`interval=1wk, range=1y` = 54 bars). MA200 never rendered (need 200 bars), MA50 only covered 9% of the view. RSI was 47.67 instead of correct 35.73. Fixed: now fetches `interval=1d, range=2y` (501 daily bars). Frontend splits into display window (last 251 bars = 1Y) and TA lookback (all 501). RSI verified at 35.70.
- **1M chart MA50 wrong** (`8eebcc3`): 1M was fetching only 22 daily bars — insufficient for MA50. Now fetches `range=3mo` (60 bars), displays last 30 days on x-axis, uses all 60 for MA50 lookback.
- **Indicator lines bleeding into hidden lookback** (`0fc6f17`): `indicators.js` MA and RSI lines now clipped to `displayFrom` timestamp so hidden lookback bars (2nd year) never appear on the chart x-axis.

### Added
- **Technical indicators in AI synthesis** (`ai-synthesis.py`): New `fetch_technicals()` function fetches `interval=1d&range=2y` daily bars for all synthesis tickers (SPY, QQQ, IWM, AAPL, NVDA, TSLA, META, MSFT, AMD, AMZN). Computes RSI-14 (Wilder's smoothing), MA50, MA200, and price position vs each MA (direction + % distance). Injected as `technicals` block in Claude's user prompt.
- **System prompt rule #9 — technicals**: Claude instructed to cite specific RSI/MA values. RSI<35 = notable oversold, RSI<30 = strong oversold / mean reversion setup, RSI>65 = approaching overbought, RSI>70 = strong overbought. Price below MA200 = bearish context. Price below both MAs with RSI<35 = high-conviction oversold.
- **Contrarian Watch technicals integration** (`ai-synthesis.py`): Contrarian schema now includes technicals instruction — RSI<30 below MA200 or RSI>70 above MA200 explicitly flagged as contrarian setup candidates.

### Fixed (latent bugs in ai-synthesis.py)
- **`contrarian_idea` missing from prompt schema**: The JSON schema returned to Claude did not include the `contrarian_idea` field — Claude was never asked to generate it. Field restored with technicals-aware instructions.
- **Contrarian setup variables undefined**: `GENERATE_CONTRARIAN`, `_today_str`, `regime_tag`, `_ci_data`, `_ci_path` were referenced but never defined in `ai-synthesis.py` (orphaned when script was extracted from .sh heredoc). Setup block restored before the persist section.

### Known Issues
- **1M timeframe MA200**: Still won't render on 1M view (only 60 bars available, need 200). Intentional — MA200 is not meaningful on a 1-month view.
- **Contrarian Watch**: First run since bug fix will be next 11:40 AM ET weekday run.
