# SOFAR Finance — Project Context for Claude

**This file is the canonical project-context document for SOFAR. It is auto-loaded by the Claude Code CLI if used. For claude.ai chat sessions (the primary interface), explicitly tell Claude to read this at session start: *"Read ~/sofar-finance/CLAUDE.md, ~/sofar-finance/docs/SYSTEM-STATE.md, and the most recent file in ~/sofar-finance/docs/handoffs/ before we start."***

Sentinel of the continuity protocol that defines this file: `CONTINUITY_PROTOCOL_V1`. See `docs/CONTINUITY-PROTOCOL.md` for the full layering model. This file holds *durable* project context only — current state lives in `docs/SYSTEM-STATE.md`, decisions live in `docs/adr/`, recent work lives in `docs/handoffs/`.

---

## What SOFAR is

SOFAR is a single-developer financial research and trading system. It ingests options flow, equity prices, macro data, sentiment data, and CFTC positioning data; runs LLM-based synthesis on top of it; produces a public-facing dashboard with intraday and overnight views; and feeds a (currently paused) quant-research subsystem.

The user (`bot1`) is the sole developer. Claude is the primary engineering collaborator. The system runs on a personal hardware fleet (DGX Spark nodes + Mac Studio + Neon-hosted Postgres) with Vercel serving the dashboard.

---

## Repos

This project spans **two repos**:

- **`sofar-finance`** (this repo) — dashboard, API endpoints, migrations, docs, and the data files daemons write to. Vercel deploys from `main`. Public-facing.
- **`sofar-scripts`** — daemons, ingest scripts, ML pipeline, db.py routing layer, all cron-driven backend code. Lives at `~/scripts/` on the production node. Private GitHub repo (added April 2026).

If you're modifying a daemon or ingest script → it's in `sofar-scripts`. If you're modifying the dashboard, an API endpoint, a migration, or docs → it's in `sofar-finance`.

---

## Three-database architecture

Three Neon Postgres databases, each with distinct lifecycle and purpose. Auto-routed by `~/scripts/db.py` via `TABLE_DB_MAP`.

- **`market`** — externally-sourced data + signal outputs. Tables: `prices_daily`, `flow_trades`, `options_eod`, `cftc_cot_*`, `signal_values`, `ingestion_log`, `data_source_registry`, `migrations_applied`, etc.
- **`production`** — trading state. Tables: `positions`, `predictions`, `accuracy_log`, `weight_change_log`, etc.
- **`research`** — experiments, hypotheses, signal registry. Tables: `experiments`, `hypotheses`, `weight_sets`, `published_signals`, `director_decisions`, etc.

**Always pass `db=` explicitly when in doubt.** The routing layer has a known bug where `EXTRACT(YEAR FROM col)` misroutes (it picks up `col` as the "table"). See SYSTEM-STATE issue C.

Credentials at `/etc/neon-{market,production,research}.env`. Loader: `. ~/scripts/db-env.sh`.

Full rationale: ADR-0001.

---

## Conventions

### Sentinels
Format: `UPPER_SNAKE_NAME_VN` (e.g. `CFTC_COT_V1`, `GIT_PUSH_QUEUE_V2`). Used in code comments, commit messages, doc references, and the `migrations_applied` table. Full rules: ADR-0005.

### Git workflow
- All daemons write files only — they never call git directly
- A centralized cron (`~/scripts/git-push-queue.sh`, V2) commits and pushes every 2 minutes
- Interactive git uses `~/scripts/git-safe.sh` wrapper to serialize against the cron
- Commit message format: `SENTINEL_NAME: one-line description` followed by detailed body
- The `git-push-queue` log is at `~/logs/git-push.log` — heartbeats on minutes :00 and :30

Full rationale: ADR-0003.

### Migrations
SQL migrations go in `migrations/YYYYMMDD-slug.sql`. Each ends with:
```sql
INSERT INTO migrations_applied (name) VALUES ('SENTINEL_VN') ON CONFLICT DO NOTHING;
```
Test in a transaction (BEGIN / ROLLBACK) via `db.get_connection(db='market')` before committing the real run.

### Sessions and handoffs
Each Claude session ends with a handoff doc at `docs/handoffs/YYYY-MM-DD-{period}.md`, formatted per `docs/HANDOFF-TEMPLATE.md`. Anything durable that comes up during a session should be promoted into this file (CLAUDE.md), an ADR, or SYSTEM-STATE.md — handoffs are for ephemeral session-delta only.

---

## Key file paths (this repo)

```
sofar-finance/
├── CLAUDE.md                          # this file
├── SYSTEM-CHANGELOG.md                # human-readable change history
├── api/                               # Vercel serverless functions
│   ├── flow-trades.js                 # SESSION_DATE_FALLBACK_V1
│   ├── flow-analysis.js               # SESSION_DATE_FALLBACK_V1
│   ├── flow-aggregates.js             # API_BIFURCATE_V1 (canonical session pattern)
│   └── unusual-flow.js                # API_BIFURCATE_V1
├── js/
│   ├── options-flow.js                # main dashboard JS
│   └── ai-synthesis.js                # DUAL_FILE_READ_V1 — merges evening + intraday
├── options-flow.html                  # date dropdown lives HERE, not in js/
├── data/                              # daemon-written JSON; Vercel serves as static
│   ├── ai-synthesis.json              # Opus-generated, evening + conditional triggers
│   ├── ai-synthesis-intraday.json     # qwen-generated, 6×/day market hours
│   └── many other *.json
├── migrations/
│   └── *.sql                          # one per migration, with sentinel header
├── docs/
│   ├── CONTINUITY-PROTOCOL.md         # how this all works
│   ├── HANDOFF-TEMPLATE.md            # session handoff structure
│   ├── SYSTEM-STATE.md                # ← always check this for current state
│   ├── adr/                           # architectural decisions
│   │   ├── README.md                  # index
│   │   ├── template.md
│   │   └── NNNN-*.md                  # the actual ADRs
│   └── handoffs/
│       └── YYYY-MM-DD-*.md            # session handoffs
└── tools/
    └── changelog-add.sh               # wrapper for SYSTEM-CHANGELOG entries
```

---

## Key commands the user runs

- `~/sofar-finance/tools/changelog-add.sh "[TAG] message" --commit` — append to changelog and commit/push in one step
- `~/scripts/git-safe.sh add/commit/push` — interactive git that serializes with the cron
- `cd ~/scripts && . ~/scripts/db-env.sh` — load DB credentials before running scripts
- `python3 ~/scripts/ingest-cftc-cot.py --weekly --report all` — CFTC weekly ingest

---

## Operating principles (the user's preferred working style)

These have surfaced repeatedly across sessions and should be followed by default:

1. **Audit before patch.** Read the actual file, run the actual query, check the actual log — before proposing a change. Don't guess at the schema or the file's contents.
2. **Silent failure must be made loud.** When code can fail in a way that produces normal-looking logs, fix that classification problem urgently — silent failures are the bug class that hurts most.
3. **Every change has a sentinel + a backup.** Before modifying a script, copy it to `script.pre-<reason>-<timestamp>` first.
4. **No timeframing or fatigue projection.** Don't say "you must be tired" or "this'll take 30 minutes." Just do the work.
5. **Cross-asset / multi-horizon / smart-money lens.** When evaluating signals, think Renaissance-style: what does positioning across asset classes tell us, over multiple horizons, with focus on what informed money is doing?
6. **Config-as-data.** Universe selections, schedules, thresholds — prefer expressing as data structures over hardcoding.
7. **Pause before propagating.** When a problem class is identified (hallucinated signals, silent failures), pause the source rather than try to filter at every consumer.

---

## Known pitfalls Claude should avoid

- **Don't `git commit` directly during a session.** Use `~/scripts/git-safe.sh commit` instead, to avoid colliding with the auto-push cron.
- **Don't write to `~/scripts/signals/experimental/`.** Quant-research is paused (ADR-0004); writing there is what got us in trouble.
- **Don't add `assert len(...) == N` style checks based on counts that might change.** Got bitten on UNIVERSE_TFF/UNIVERSE_DCOT count assertions.
- **Don't use `EXTRACT(YEAR FROM col)` without explicit `db='...'`.** db.py routing bug; see SYSTEM-STATE issue C.
- **Don't infer credentials.** Always source `~/scripts/db-env.sh`. Never hardcode connection strings.
- **Don't reach for new infrastructure when discipline would suffice.** Especially: don't reach for vector DBs, multi-agent frameworks, or complex orchestration when the file-based system is working.

---

## Where to find more

- **Recent work:** read the most recent file in `docs/handoffs/`
- **Current state:** `docs/SYSTEM-STATE.md`
- **Why something is the way it is:** scan `docs/adr/README.md` index, then read the relevant ADR
- **Schema:** `docs/SCHEMA.md` (auto-generated)
- **The big picture:** this file

---

## Recent architectural work (May 2026 additions)

The body of this file was last substantively updated 2026-04-25. The following ADRs and pipeline components shipped between 2026-05-02 and 2026-05-07 and supersede or extend the architecture described above. **Read these in full before recommending direction:**

### Research substrate stack (May 2 onward)
- **ADR-0014** — External Research System (documents, observations, data_gaps, hypothesis grounding)
- **ADR-0015** — Substrate ingestion conventions (ADRs + handoffs format)
- **ADR-0016** — mac2 Ollama SSH tunnel
- **ADR-0017** — Research scraper v2 architecture
- **ADR-0018** — Director context expansion (un-paused directors with rich research context)
- **ADR-0019** — Data gap auto-populator
- **v2-wip:** `quant-research-scout-v2-wip.py` is a deliberate skeleton (phases 1, 3, 4 stubbed). Design doc at `docs/specs/quant-research-scout-v2-design.md`. Hypothesis pipeline NOT operational pending v2-wip completion.

### Signal pipeline stack (May 4 onward)
- **ADR-0020** — Signal-graduation source-agnostic (the "graduator" / action layer; design exists, implementation pending)
- **ADR-0021** — SEC EDGAR Form 4 as second signal source
- **ADR-0022** — SOFAR ML Pipeline Architecture (canonical reference for production lgbm v7 family)
- Three production lightgbm models (v7_7day, v7_14day, v7_21day_macro). 75/75/133 features. Sunday retrain cadence. Full integration pathway documented in ADR-0022.
- New tables: `cot_signals`, `cot_returns`, `cot_contract_mappings`, `form4_filings`, `form4_transactions`, `form4_returns`.

### Sandbox convention for experimental signals
- **`signal_version='v_research_NNN'`** (3-digit sequence) for sandbox-isolated feature experiments in signal_values. v_research_001 currently populated for SPY with 8 CFTC z-score features + production v1.0 features copied for prototype training. Production lgbm scripts all filter `WHERE signal_version='v1.0'` so sandbox is safe.

### Empirically-verified action-layer gap (2026-05-07)
- 2 promoted experiments in `research.experiments` from April 15-16 (`spy_vol_price_coherence`, `spy_momentum_vol_decoupling`) have `decision='promoted'` set by director but ZERO rows in `signal_values`. Confirmed via direct query.
- Sentinel: `EXPERIMENT_PROMOTION_NO_ACTION_LAYER_V1`
- This is the priority unblock for the closed research → production loop.

### Empirically-verified trainer non-improvement (2026-05-07)
- Early stopping with chronological 15% val slice is HARMFUL for financial time series (-2.9pp accuracy, -0.5 Sharpe vs production v7 baseline).
- Sentinel: `EARLY_STOPPING_HARMFUL_FOR_FINANCIAL_TIME_SERIES_V1`
- ADR-0022 backlog item #1 was wrong. Do NOT re-attempt without alternative validation methodology (purged CV, random-sample within-window, or block-wise CV).

## Additional pitfalls (May 2026 patterns)

- **Schema-from-spec-not-data anti-pattern.** Three instances in one week (form4 filename suffix, form4 dates, cot VARCHAR(1) column type) of declaring schema/parser logic from documentation rather than inspecting actual source data. Sentinel: `SCHEMA_DESIGN_FROM_SPEC_NOT_DATA_RECURRING_PATTERN_V1`. Discipline: query one real sample before declaring schema.
- **N+1 query bugs disguised as set-oriented SQL.** LATERAL subqueries that re-execute a CTE per row produce N+1 runtime even though syntax looks set-oriented. Two instances this week. Fix pattern: two-phase materialization with temp table + index.
- **Pattern-matching before deep-reading at session start.** Recurring assistant failure: forming partial mental model from substrate name searches and excerpts, operating from incomplete model for hours before being corrected. Sentinel: `ASSISTANT_PATTERN_MATCH_BEFORE_DEEP_READ_AT_SESSION_START_V1`. **Discipline: read the latest handoff in full + read mentioned ADR bodies in full BEFORE recommending direction.**
- **Asserting certainty without verification.** Multiple instances per session of "yes the SQL is correct" or "the script is faithful" being said without checking. Verify before asserting.
