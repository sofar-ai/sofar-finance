# Panic Recovery — If Something Goes Wrong

## "I just ran a bad UPDATE/DELETE on Neon"

**Within last 7 days → Point-in-Time Restore:**
1. Go to https://console.neon.tech → your project → Backup & Restore
2. Under "Instant point-in-time restore", pick a timestamp BEFORE the bad operation
3. Click "Preview data" to verify the old state looks right
4. Click "Restore to point in time"
5. Compute briefly restarts, old state is restored

**Within last 30 days → Daily Snapshot:**
1. Same page, scroll to "Or restore from a snapshot"
2. Pick the most recent snapshot from BEFORE the incident
3. Click Restore

**Older than 30 days → Weekly (Mon) / Monthly (1st) snapshot:**
1. Same page, pick the closest Monday or 1st-of-month snapshot
2. Trade-off: you'll lose more recent data, but old state is preserved

## "Bad code deployed to prod"

**Vercel instant rollback:**
1. https://vercel.com/dashboard → sofar-finance project → Deployments
2. Find the last known-good deployment (usually one before the bad one)
3. Click "..." → "Promote to Production"
4. Live in ~30 seconds

## "Daemon crashed / stopped writing"

1. SSH to S1: `sudo systemctl status sofar-flow-tape`
2. Check logs: `sudo journalctl -u sofar-flow-tape -n 100 --no-pager`
3. Restart: `sudo systemctl restart sofar-flow-tape`
4. Verify it's writing: wait 30s, then check row count via `. ~/scripts/db-env.sh && python3 -c "from db import execute_query; r = execute_query('SELECT MAX(ts) AS latest FROM flow_trades'); print(r[0])"`

## "I broke Neon connection from my scripts"

DATABASE_URL lives in `/etc/neon.env` on each machine. If you lose it:
1. Neon dashboard → your project → Connection Details
2. Copy the connection string
3. On each machine that needs it: `sudo nano /etc/neon.env` → paste

## "Mac Studio Ollama stopped responding"

1. SSH to Mac
2. Check: `ollama ps` and `ps aux | grep ollama`
3. If runner is dead: `~/start-ollama.sh &`
4. If runner is stuck with stale model: `kill <PID of runner>` then `ollama run qwen3:235b` to reload

## What's covered / not covered

| Incident | Covered by |
|----------|------------|
| Bad SQL UPDATE/DELETE (minutes ago) | PITR |
| Bad SQL UPDATE/DELETE (hours ago) | PITR |
| Bad SQL UPDATE/DELETE (days ago) | Daily snapshots |
| Bad SQL UPDATE/DELETE (weeks ago) | Weekly snapshots |
| Bad code deploy (recent) | Vercel rollback |
| Local file loss on S1/S2/Mac | No automatic coverage — git for code only |
| Lost SSH keys | Physical machine access required |
| Ollama model corruption | Re-pull from Ollama Hub |

## Prevention > Recovery

Before any large DB operation:
1. Create a Neon branch (dashboard → Branches → Create) as a named rollback point
2. Run the operation in a TRANSACTION if possible (`BEGIN; ... COMMIT/ROLLBACK`)
3. Verify row counts and sample output before committing
4. Keep the branch for 24-48 hours as a safety net, then delete
