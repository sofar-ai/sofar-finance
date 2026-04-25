# ADR-0003: Centralized git-push-queue cron for daemon writes

**Date:** 2026-04-25
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0001 (three-DB split), ADR-0006 (continuity protocol)

---

## Context

Many SOFAR daemons and crons produce data files at `~/sofar-finance/data/*.json` that the dashboard reads (Vercel serves them as static assets directly from the repo). Originally, each daemon was responsible for committing and pushing its own outputs, which created several problems:

- **Lock contention:** Multiple daemons writing simultaneously triggered `.git/index.lock` collisions
- **Inconsistent state:** A daemon could write a file but die before pushing, leaving local-only changes
- **No serialization with interactive work:** When a developer was running git commands, daemons would conflict
- **Duplicated logic:** Every daemon re-implemented "stage, commit, pull-rebase, push, retry"

The dashboard freshness depends on these pushes reaching GitHub (Vercel reads from main branch). Silent failure of the push pipeline = stale dashboard, observed multiple times.

## Decision

All daemons and crons write files only — none of them call `git` directly. A single centralized cron, `git-push-queue.sh`, runs every 2 minutes, gathers all pending changes (diffs + untracked files), groups them into one commit, pulls/rebases, and pushes.

Interactive git operations are wrapped in `git-safe.sh`, which uses `flock -w 60 /tmp/git-push-queue.lock` to serialize against the cron.

## Alternatives Considered

### Alternative 1: Per-daemon git logic
- **Pros:** Each daemon's outputs are committed independently; finer-grained history
- **Cons:** Duplicated code, lock contention, inconsistent error handling
- **Why not:** Operationally fragile. Saw multiple silent-failure incidents.

### Alternative 2: Daemons write to a non-repo directory; a separate sync job copies to repo
- **Pros:** Clean separation; daemons never touch repo
- **Cons:** Adds a copy step, doubles disk usage temporarily, doesn't solve the "who commits" question (just moves it)
- **Why not:** Simpler to have daemons write directly to `data/` and let the queue handle git.

### Alternative 3: Commit-on-push via post-receive hook
- **Pros:** No client-side cron
- **Cons:** Requires self-hosted git server; doesn't solve "who decides when to commit"
- **Why not:** Adds infrastructure for marginal benefit.

### Alternative 4: Use a different store entirely (S3, R2, etc.) and skip git for data files
- **Pros:** No git semantics for data; static-asset-friendly
- **Cons:** Loses Vercel's automatic deploys; loses the audit trail; loses the ability to roll back data files via git
- **Why not:** Considered; might revisit if data volume grows. Currently data files are small enough that git history is reasonable.

## Consequences

### Positive
- One commit pattern across all data files. Easy to read history.
- Daemons are simpler — they only write files
- Single point to fix when push behavior needs to change
- `git-safe.sh` wrapper extends serialization to interactive git, eliminating user-vs-cron collisions

### Negative / trade-offs
- Single point of failure. If `git-push-queue.sh` is broken, ALL data file updates stall (observed: 2 incidents in 14 hours pre-V2 hardening)
- Coarse commit granularity — one commit can contain dozens of unrelated file updates
- 2-minute latency between file write and Vercel deploy

### Risks
- **Stale `.git/index.lock` from crashed git operations.** Hit this twice; mitigated in V2 with stale-lock detection (>120s + no git process = remove). Sentinel: `GIT_PUSH_QUEUE_V2`.
- **Silent failure pattern.** V1 misclassified lock failures as "nothing to commit" and exited 0. V2 captures stderr and classifies properly. Heartbeat log on minutes :00 and :30 makes "is it running" answerable.

## Implementation notes

- Script: `~/scripts/git-push-queue.sh` (V2)
- Cron: `*/2 * * * * flock -n /tmp/git-push-queue.lock /bin/bash /home/bot1/scripts/git-push-queue.sh 2>/dev/null`
- Wrapper for interactive git: `~/scripts/git-safe.sh`
- Log: `~/logs/git-push.log`
- Sentinels: `GIT_PUSH_QUEUE_V1` (original), `GIT_PUSH_QUEUE_V2` (April 2026 hardening)

## References

- Backup of V1 at `~/scripts/git-push-queue.sh.pre-v2-*`
- V2 commit on sofar-scripts: `5f007bd`
