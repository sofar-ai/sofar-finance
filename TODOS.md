# SOFAR TODOs

Single source of truth for project state. Edit this file as work is completed or new items are identified. Future session handovers should reference this file rather than duplicate its content.

**Last updated:** 2026-04-19 (Sunday evening)

**Conventions:**
- `[ ]` = open
- `[~]` = in progress
- `[x]` = done (move to "Recently Completed" section)
- `[!]` = blocked
- Each item: short title, then optional context in italics on next line
- Add `→ ref:` for cross-references to file paths, DB tables, or related items

---

## Active (In Progress)

*Items currently being worked on. Move to In Progress when starting, back to priority section if paused.*

- [ ] *(none — Sunday session ended with everything complete or queued)*

---

## High Priority

### Security (carry-over from Vercel breach response)

- [ ] Rotate `ANTHROPIC_API_KEY`
  *Highest remaining blast radius. Console.anthropic.com → API Keys → create new (name `sofar-2026-04-rotated`), revoke old. Update `/etc/anthropic.env` on S1+S2, update Vercel env (Sensitive flag ON). Services using: Hermes gateway, synthesis-trigger, research-summarizer.*

- [ ] Rotate `FMP_API_KEY`
  *site.financialmodelingprep.com → regenerate. Update `/etc/fmp.env` on S1+S2, update Vercel.*

- [ ] Rotate `FINNHUB_API_KEY`
  *Vercel only (no `/etc/` file). Finnhub.io dashboard → regenerate.*

- [ ] Rotate `AUTH_COOKIE_SECRET`
  *Generate via `openssl rand -hex 32` on S1. Update Vercel only. Will invalidate all current sessions — you'll need to log in again to sofar.finance.*

- [ ] Rotate `AUTH_PASSWORD_OWNER` and `AUTH_PASSWORD_TRUSTED`
  *Vercel only. Use new strong passwords from password manager.*

- [ ] Verify no unauthorized usage in prior 72h
  *Anthropic usage dashboard, GitHub Security log, Neon connection logs. Check for anomalies between Apr 17 and now.*

- [ ] Migrate `~/fred.env` → `/etc/fred.env`
  *Consistency with other secret env files. chmod 600 bot1:bot1. Update `ingest-macro-signals.py` and `handler_fred.py` to read from new path.*

### Data Scout Phase 2 (extend proven pattern)

- [ ] `handler_treasury.py` — Treasury Direct API (no auth required)
  *Pattern from `handler_fred.py`. Endpoints: `daily_treasury_yield_curve_rates`, `debt_to_the_penny`, `tips_cpi_data`. Target table: `treasury_rates` (existing).*

- [ ] `handler_bls.py` — Bureau of Labor Statistics
  *Free API key needed (register at bls.gov). Common series: LNS14000000 (unemployment), CES0500000003 (avg hourly earnings). Target table: `bls_series` (new).*

- [ ] `handler_eia.py` — Energy Information Administration
  *Free API key needed. Common series: PET.WCRSTUS1.W (crude stocks), NG.RNGWHHD.D (Henry Hub). Target table: `energy_data` (new).*

- [ ] `handler_bea.py` — Bureau of Economic Analysis
  *Free API key needed. Series: T10101 (GDP components), T20600 (savings rate). Target table: `bea_series` (new).*

- [ ] `handler_worldbank.py` — World Bank Open Data (no auth)
  *Indicators: NY.GDP.MKTP.CD, FP.CPI.TOTL.ZG. Target table: `worldbank_series` (new).*

- [ ] `handler_noaa.py` — NOAA Climate Data
  *Free token needed. Heating/cooling degree days for energy demand signals. Target table: `weather_data` (new).*

- [ ] `handler_imf.py` — IMF Data API (no auth)
  *Balance of payments, exchange rates. Target table: `imf_series` (new).*

- [ ] `handler_oecd.py` — OECD Statistics (no auth)
  *Composite Leading Indicators (CLI). Target table: `oecd_series` (new).*

- [ ] After each handler: register in `HANDLER_REGISTRY` in `data-scout.py`, add catalog entry to `data-sources-catalog.md`

### Pipeline observability

- [ ] Observe and validate Monday's first autonomous Director cycle
  *First Discord brief under new gate logic. Check: PROMOTE/REJECT/NEEDS_DATA/PARK on ~7 proposed hypotheses, DATA_REGISTRY directive on fred:DGS10 pilot, no parser failures in `~/logs/director-morning.log`.*

---

## Medium Priority

### Director quality improvements

- [ ] Move Evening Director cron from 16:30 → 17:30
  *Run AFTER quant-scout (23:00) and data-scout (17:15) to compress idea→test latency. Edit crontab on S1.*

- [ ] Add similarity-to-existing check in Director
  *Reject duplicate hypotheses by comparing text + required_tables against historical experiments. Prevents scout from re-proposing the same idea repeatedly.*

- [ ] Add data sufficiency thresholds in Director
  *Reject hypothesis if `required_tables` row count < N or date range < M. Use catalog as reference for thresholds per source.*

- [ ] Add regime coverage requirement
  *Hypothesis must work across ≥2 market regimes (risk-on / risk-off / neutral) — Director rejects single-regime signals.*

- [ ] Director rejection reasoning feeds back to scout prompts
  *Scout prompt should include "Reject patterns to avoid: [list from last 30d rejections]". Creates a learning loop.*

### Paper portfolio

- [ ] Build paper portfolio tracking for promoted scout signals
  *New table `scout_signal_paper_performance` in research DB. Daemon-promoted signals get N weeks (proposed: 12) of paper tracking before eligible for `published_signals`. Real-world OOS validation beyond backtest.*

### Frontend (research.html)

- [ ] Director brief panel
  *Spans full width, top of page. Loads marked from `cdn.jsdelivr.net/npm/marked/marked.min.js`. Before 16:30 ET show morning brief, after show evening. Reads from `/api/director-summary`.*

- [ ] Pending decisions counter panel
  *Counts of proposed/pending_experiment/experimenting/results_ready hypotheses. Reads from `/api/hypotheses?action=stats`.*

- [ ] Pilot data sources awaiting review panel
  *List of `data_source_registry WHERE status='pilot'`. Show pilot age, rows ingested, target table.*

- [ ] Data Scout escalations panel
  *List of `data_gaps WHERE status IN ('needs_human_routing', 'needs_paid_source', 'quality_review')`.*

- [ ] Migrate research.html thesis queue from localStorage → DB
  *Use `/api/hypotheses` POST endpoint to persist hypotheses to DB instead of browser storage.*

### Infrastructure

- [ ] Logrotate for all `~/logs/*.log`
  *Will grow unbounded. Critical: `director-morning.log`, `director-evening.log`, `data-scout.log`, `overnight-research.log`, `quant-research-scout.log`. Standard `/etc/logrotate.d/sofar` config.*

- [ ] Cron watchdog alerts
  *Extend existing `cron-watchdog.sh` to alert via Discord if Director or Data Scout fails to run within N minutes of scheduled time.*

- [ ] S2 systemd `daemon-reload`
  *Warning persists about flow-analyzer unit file changed on disk. `ssh bot1@spark-73ff.local 'sudo systemctl daemon-reload'`.*

- [ ] Clean up Saturday migration backup files
  *`api/*.pre-multidb-*` backup files in `~/sofar-finance/` from Saturday's multi-DB migration. Safe to delete now that migration is verified stable.*

- [ ] Standardize on `apply-data-scout-schema.py` pattern for future schema work
  *The shell-based SQL splitter in `install-data-scout-v2.sh` broke on multi-line CREATE TABLE. Future DDL applies via Python with each statement as literal string.*

---

## Low Priority / Future

### Additional scouts

- [ ] Market Scout — pre-market 04:00 ET context aggregator
  *Not in original architecture. Would feed daily Director with pre-market regime/news/flow context. Consider after Phase 2 data handlers are stable.*

- [ ] Signal Scout — post-experiment analyzer
  *Reads `hypotheses WHERE status='results_ready'`, suggests follow-up hypotheses based on what worked. Closes a learning loop.*

### Tier 2 paid data sources (each requires user approval via approve-gap CLI)

- [ ] X (Twitter) Basic API handler
  *$125/mo for 25k post reads. SIGINT for retail sentiment, ticker mentions, Fed official statements. Routes through `approve-gap` CLI workflow.*

- [ ] RavenPack handler
  *$2000+/mo. Pre-cleaned news sentiment, event detection, 7000+ event categories.*

- [ ] Quiver Quant handler
  *$500/mo. Congressional STOCK Act trades, WSB mentions, government contracts.*

- [ ] Estimize handler
  *$500/mo. Crowd-sourced earnings estimates.*

- [ ] Kensho handler
  *Variable pricing. M&A deal probability, event-driven signals.*

### Tier 3 alt-data infrastructure

- [ ] Orbital Insight / Planet Labs satellite imagery
  *Retail foot traffic, oil storage, parking lot fill rates. Significant infrastructure project.*

- [ ] SafeGraph POI data
  *Point-of-interest visit data.*

- [ ] Credit card transaction data (Yipit, Second Measure)
  *Real-time consumer spending. Institutional pricing.*

### Architecture evolution

- [ ] Three-repo split (sofar-research, sofar-market-data, sofar-finance)
  *Per Wednesday's plan. Currently all in sofar-finance. Split when migration cost is justified by ops complexity.*

- [ ] Research dashboard self-hosting on Tailscale
  *Move research.html + research APIs off Vercel. Eliminate public-internet attack surface for research-only system. Post-breach hardening priority.*

- [ ] Evaluate Cloudflare Pages as Vercel alternative
  *If considering migration off Vercel for security or cost reasons.*

### EXO cluster

- [ ] Set up EXO across S1 + S2 + Mac Studio
  *512GB combined. Run DeepSeek V3.1 671B locally for all research agents.*

- [ ] Pull DeepSeek V3.1 671B via EXO
  *Built by High-Flyer Capital ($10B AUM, 56% returns 2025). MIT license. Hedge-fund-grade reasoning.*

- [ ] Swap Director OLLAMA_URL to EXO endpoint
  *Configuration change once EXO is operational and DeepSeek is loaded.*

### Compute utilization

- [ ] Audit idle compute time
  *Mac idle 4pm-4am (12h). S2 ~99% idle outside RTH. Identify research workloads to fill idle time.*

- [ ] 24/7 research scheduling plan
  *Use idle compute for additional scout cycles, longer Director reviews, or paper portfolio simulations.*

### Tech debt

- [ ] Fix flow-structure-analyzer duplicate DB write bug
  *Per-ticker immediate writes + batch writes both happening, creating duplicates in `flow_analysis` table.*

- [ ] Populate `sweep_id` in flow tape daemon
  *Currently all `flow_trades.sweep_id` values are empty. Daemon detects sweeps and alerts Discord but doesn't write the ID back.*

- [ ] Step 9 from Saturday migration (destructive)
  *Drop migrated tables from production DB now that they live in market DB. Was deferred for safety. Run only after extended verification.*

- [ ] Fill in `cost_monthly` for grandfathered paid vendors
  *9 grandfathered vendor entries in `data_source_registry` have NULL cost_monthly. Populate for accurate spend tracking.*

- [ ] Disable macOS Ollama app auto-launch on login
  *Mac Studio auto-launches Ollama bound to `localhost` only. User has to kill it and restart via `~/start-ollama.sh` (which sets `OLLAMA_HOST=0.0.0.0`). Disable autostart so manual launch is the only path.*

---

## Blocked

*Items waiting on external dependencies or other todos.*

- [ ] *(none currently)*

---

## Recently Completed

*Move items here when done. Prune after ~30 days.*

### 2026-04-19 (Sunday)

- [x] **Quant Research Scout DB integration**
  *Sentinel: HYPOTHESES_DB_WRITE_V1. Scout now inserts hypotheses to research DB with proposer='quant-scout', status='proposed'. Verified: 5 hypotheses (qr-202604191525-001 through 005) inserted on first run.*

- [x] **Daemon hypotheses queue integration**
  *Sentinel: HYPOTHESES_QUEUE_V1. Daemon checks queue at Stage 1, falls back to auto-gen. Wraps 6 return paths with finalize_queued_hypothesis(). Verified compile, restarted, sleeping until 19:00.*

- [x] **Director promotion gate**
  *Sentinel: DIRECTOR_PROMOTION_V1. Both Directors output PROMOTE/REJECT/NEEDS_DATA/PARK directives. Parser applies status transitions. Widened proposer filter to include quant-scout, human-web.*

- [x] **Manual hypothesis bootstrap for first cycle**
  *qr-001, qr-003, qr-005 promoted to pending_experiment with Renaissance-style rationale. qr-002 and qr-004 left as proposed (flow_trades insufficient history) for Director Monday review.*

- [x] **Vercel API endpoints deployed**
  *`/api/director-summary`, `/api/hypotheses`, `/api/data-gaps`. Auth-gated. Use `@neondatabase/serverless`. Verified `/api/hypotheses?action=stats` returns 5 quant-scout hypotheses.*

- [x] **CLI helpers**
  *`propose-hypothesis.py`, `add-followup.py`, `approve-gap.py`, `verify-source.py`. Installed on S1 at `~/scripts/`.*

- [x] **Security rotation: GITHUB_TOKEN**
  *New PAT created at github.com (sofar-bot-2026-04-rotated), old revoked. Updated `/etc/github.env` on S1+S2 and Vercel (Sensitive flag ON). Embedded-token URL fixed to use `x-access-token` magic username. Test push verified.*

- [x] **Security rotation: sofar-production DB password**
  *Neon UI Reset. Auto-synced to Vercel via integration. Updated `/etc/neon-production.env` on S1+S2. Restarted services. Verified DB query.*

- [x] **Security rotation: sofar-research DB password**
  *Neon UI Reset. Manually updated Vercel (NOT integration-managed). Updated `/etc/neon-research.env` on S1+S2. Verified.*

- [x] **Security rotation: sofar-market-data DB password**
  *Neon UI Reset. Manually updated Vercel. Updated `/etc/neon-market.env` on S1+S2. Verified flow_analysis table accessible.*

- [x] **Security rotation: research_reader role password**
  *Rotated 2x — first version exposed in chat paste, rotated again. Updated `/etc/neon-market-reader.env` on S1. Verified read access via Python (no shell export pattern).*

- [x] **Vercel integration fix: disable per-deploy Neon branch creation**
  *Was breaking every deploy after password rotation. Fix: Vercel → Integrations → Neon → Configure → UNCHECK "Create Database Branch For Deployment" Production. Both Production and Preview unchecked. Deploys succeeded after.*

- [x] **Data Scout build (Phase 1)**
  *Framework + 3 handlers (FRED, EDGAR Form 4, Google Trends) + agent + Director integration + schema. Smoke test passed: FRED DGS10 ingested 6859 rows in 2.74s, registered as pilot, logged.*

- [x] **Data Scout schema applied**
  *`data_source_registry` (was missing from Saturday), `data_scout_log` (new), added `suggested_source` + `suggested_identifier` columns to `data_gaps`. Applied via apply-data-scout-schema.py after install script's SQL splitter broke.*

- [x] **Director + Data Scout integration**
  *Sentinel: DIRECTOR_DATA_SCOUT_V1. Both Directors load data-sources-catalog.md, query pilot sources + escalations, output DATA_REGISTRY directives.*

- [x] **Cron schedule established**
  *Quant scout 23:00 daily, Data Scout 17:15 weekdays, Morning Director 07:30 weekdays, Evening Director 16:30 weekdays.*

- [x] **Comprehensive session handover**
  *SOFAR-SESSION-HANDOFF-SUNDAY-APRIL-19-2026-V2.md. Architecture summary, mistakes documented, roadmap with priorities.*

---

## Notes for Editing

When you complete an item:
1. Move it from its priority section to "Recently Completed"
2. Add the date if not already there
3. Add brief context on what was done (1-2 sentences)
4. Commit: `git commit -m "Mark X done in TODOs"`

When you start an item:
1. Move it from priority section to "Active (In Progress)"
2. Add date started

When you add a new item:
1. Place in appropriate priority section
2. Include enough context that you (or a new session) understands what's needed
3. Reference file paths, sentinels, or related items where applicable

When you abandon an item:
1. Move to "Recently Completed" with status `[~]` and brief reason
2. After ~30 days, prune

Update `Last updated` date at top after meaningful edits.
