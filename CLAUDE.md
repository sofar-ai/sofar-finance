# SOFAR Finance — Project Context for Claude

**This file is auto-loaded at the start of every Claude Code session.**

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
