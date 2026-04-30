# Session Handover — 2026-04-29 (Wednesday) Evening

## Operating rules (held throughout)

- **The user calls session done. Claude does not.** Held.
- **Renaissance discipline**: read working pattern before drafting parallel
  code. Tonight surfaced two real renaissance misses worth flagging:
  - Yesterday's `extract_state_refresh.py` was redundant — existing
    `extract_systems_state.py --health-only` already covered it.
    Captured as
    `EXTRACT_STATE_REFRESH_REDUNDANT_WITH_EXTRACT_SYSTEMS_STATE_HEALTH_ONLY_V1`.
  - Bundle 9 spec was drafted before reading existing
    `health-check.py` + `extract_systems_state.py` + `heartbeat-cron.sh`.
    Discarded mid-implementation when the existing infrastructure became
    apparent.
- **No echo-back of credential strings** — held throughout.
- **Don't ask about time** — Claude has no clock.
- **v2 filename rule**: same-content-update of existing file uses _v2/_v3
  suffix. Followed for send_discord (v2 → v3 → v4) and heartbeat-cron (v2).
- **256GB on each Mac Studio** — confirmed.

## Context

User runs SOFAR finance analytics across 4 production hosts:
- **spark-cfbd** (s1, production-main, 100+ scripts, runs cron + pipeline-runner,
  hosts hermes-gateway.service)
- **spark-73ff** (s2, synthesis, runs sofar-flow-analyzer.service)
- **mac1** (frontier-inference, IP 192.168.50.15, qwen3:235b paused per ADR-0004)
- **mac2** (mcp-host, IP 192.168.50.242, hosts substrate MCP + ollmcp + Ollama)

User works from mac2 + remote Windows PC. Auto-pusher commits
`~/sofar-finance/` every ~2 min on spark-cfbd.

## What ships today (the empirical facts)

### 1. extract_systems_state.py revived as canonical health/state extractor

Discovered tonight that `extract_systems_state.py` (753 lines, in codebase
since Apr 25) was silently un-cron'd as of Apr 26 03:50. The script is
substrate-canonical multi-host probe extractor: nodes, models, daemons,
crontab inventory, scripts, plus relationships and `health_issue` /
`drift_detected` events.

**Cron changes applied on spark-cfbd:**
```
REMOVED: */15 * * * * extract_state_refresh.py    (yesterday's redundant lean script)
ADDED:   */15 * * * * extract_systems_state.py --health-only
ADDED:   45 3 * * *   extract_systems_state.py    (full extraction nightly)
```

`extract_state_refresh.py` stays on disk as deprecated — script not
removed, only its cron entry. Reversible if needed.

Real run validated: 4 nodes substrate-canonical with rich state
(uptime, GPU, OS, load), 1 health_issue captured (`spark-73ff/nvidia_smi:
exit=18` — driver/library mismatch, low priority since spark-73ff doesn't
run local inference).

### 2. Bundle 9 spec: drafted then discarded

Started drafting Bundle 9 daemon health observability (substrate_log.py +
daemon_health_now view + alert_daemon_health.py). Three artifacts staged
in /mnt/user-data/outputs:
- 20260429-bundle9-daemon-heartbeat.sql (migration)
- extract_state_refresh_v2.py (extended extractor)
- alert_daemon_health.py (alerter with dedup)

**Discarded.** Reason: existing infrastructure already covers ~90% of the
spec across 4 layers:
- Layer 1 (substrate): extract_systems_state.py
- Layer 2 (frontend dashboard): health-check.py + cron-health.sh
- Layer 3 (Discord alerts): heartbeat-cron.sh
- Layer 4 (agent runtime): hermes-gateway.service

Bundle 9 was building a parallel system. Not shipping the artifacts.

### 3. Discovery: hermes replaced openclaw on Apr 12

User confirmed openclaw → hermes migration. `hermes-gateway.service`
running as user systemd unit on spark-cfbd, PID 667624, since Apr 19.
Binary at `/home/bot1/.local/bin/hermes`. The `openclaw agent --deliver`
CLI no longer exists — was replaced by hermes infrastructure.

### 4. Silent alert failure resolved

`heartbeat-cron.sh` (4 cron entries: morning-health 6:30 AM, preflight
9:15 AM, phase1-check 4:30 PM, phase2-check 7:05 PM, all weekday)
called `openclaw agent --local --json --deliver --channel discord` with
`> /dev/null 2>&1` redirect. After hermes migration, openclaw left PATH
and send_msg silently no-op'd. **Morning health alerts have NOT been
firing since the migration (~17 days).**

**Fix shipped:**
- New script `~/scripts/send_discord.py` — minimal Python webhook poster
- `~/scripts/heartbeat-cron.sh` patched: `send_msg` now invokes
  send_discord.py instead of openclaw, errors logged to
  `~/logs/send-discord.log` (no longer silently dropped)
- Validated end-to-end: morning-health invocation posted real alert to
  Discord ("ThetaData not running" — surfaced as side effect, see below)

**Iteration trail (worth capturing for future debugging):**
- v2: original Python parser of /etc/discord-webhook.env
- v3: bypassed parser, shell-source the env file via subprocess
- v4: added User-Agent header — Discord rejected urllib's default UA
  with HTTP 403 Forbidden. v4 sets `User-Agent: sofar-send-discord/1.0`
  and works.

### 5. Coverage gap surfaced: ThetaData health check uses deprecated v2 endpoint

heartbeat-cron.sh's morning-health check hits `localhost:25503/v2/health`.
ThetaData has migrated to v3 — the v2 endpoint returns an upgrade-notice
text that doesn't match the regex `'ok\|running\|200\|healthy'`, so the
check fires as ALERT even when ThetaData is running fine. Real fix:
update endpoint to v3 (e.g., `/v3/option/list/expirations?symbol=SPY`
which is what health-check.py uses). Defer — non-blocking false positive.

## What was learned (sentinels and findings)

### New sentinels captured this session

All captured here, will be substrate-canonical via tomorrow's 3:25 AM
extract_handoffs.py run.

- **`EXTRACT_STATE_REFRESH_REDUNDANT_WITH_EXTRACT_SYSTEMS_STATE_HEALTH_ONLY_V1`**
  — yesterday's lean extractor was redundant; existing `--health-only`
  mode in extract_systems_state.py was the right answer all along.
- **`OPENCLAW_TO_HERMES_MIGRATION_LEFT_STALE_REFERENCE_V1`** — heartbeat-cron.sh
  references dead openclaw CLI; send_msg was silently failing for ~17 days
  since the Apr 12 hermes migration. Resolved this session.
- **`DISCORD_THREAD_ID_STALE_V1`** — `/etc/discord-webhook.env`'s
  DISCORD_THREAD_ID returns 403; thread likely auto-archived. send_discord.py
  posts to webhook's default channel (thread_id ignored). Defer real fix
  to when a current valid thread_id is wanted.
- **`DISCORD_REJECTS_PYTHON_URLLIB_DEFAULT_UA_V1`** — Discord rejects
  webhook POSTs from Python urllib's default `Python-urllib/X.Y` User-Agent
  with 403 Forbidden. Set explicit User-Agent header to fix.
- **`HEARTBEAT_THETADATA_HEALTH_CHECK_USES_DEPRECATED_V2_ENDPOINT_V1`** —
  heartbeat-cron.sh checks `/v2/health`; ThetaData migrated to v3.
  Produces false positive alert.
- **`SPARK_73FF_NVIDIA_SMI_EXIT_18_V1`** — driver/library mismatch on
  spark-73ff, captured by extract_systems_state.py as health_issue. Low
  priority (s2 doesn't run local inference).
- **`SUBSTRATE_SYSTEMD_UNIT_FILTER_TOO_NARROW_V1`** — extract_systemd_units.py
  filters on `/etc/systemd/system/sofar-*.service`. Misses user-level
  units (like hermes-gateway.service at `~/.config/systemd/user/`) and
  non-sofar services (thetadata.service). Real fix: extend filter to
  walk both system + user dirs with broader allowlist.
- **`HERMES_OLLMCP_INTEGRATION_PENDING_V1`** — hermes has `mcp` subcommand
  per `hermes --help`; could expose substrate-MCP to hermes-as-agent OR
  vice versa. Strategic conversation, defer.
- **`UNKNOWN_COMPONENT_SEARCH_DISK_FIRST_V1`** — when a referenced component
  is missing from PATH, run `find / -name "*<name>*"` BEFORE speculating.
  Migration trails (openclaw → hermes here) are typically obvious from
  disk artifacts.
- **`UPS_CROSS_SHUTDOWN_AUTOMATION_PENDING_V1`** — design notes captured
  for weekend maintenance project (see "What's pending" below).

### Already-existing infrastructure documented for future sessions

Key insight tonight was discovering ~70% of bundle 9 spec was already
shipped. Real captured for future renaissance reads:

**Layer 1 (substrate-canonical)**: `extract_systems_state.py` — multi-host
probe extractor, nodes/models/daemons/crontab/scripts entities, health_issue
+ drift_detected events. Now running every 15 min --health-only + nightly
3:45 AM full.

**Layer 2 (live frontend dashboard)**: `health-check.py` (256 lines, every
15 min) + `cron-health.sh` (46 lines, every 30 min). Both write
`~/sofar-finance/data/cron-health.json` — they race each other on the
same file. health-check.py has 6 check functions covering DB tables,
signals, LightGBM model, data files, cron count, services. cron-health.sh
covers a subset. Real candidate for cleanup: deprecate cron-health.sh
since health-check.py covers everything it does.

**Layer 3 (Discord alerts)**: `heartbeat-cron.sh` — 4 weekday cron entries
(morning-health, preflight, phase1-check, phase2-check). Post via Discord
webhook. NOW WORKING after tonight's send_discord.py fix.

**Layer 4 (agent runtime)**: `hermes-gateway.service` — user systemd
unit, replaced openclaw on Apr 12. Active Discord posting path is
through hermes (per user: "of course it's running, who do you think is
communicating via discord"), but the specific subcommand pattern that
replaces `openclaw agent --deliver` was not found in `hermes --help`
output. heartbeat-cron.sh was migrated to direct webhook POST instead
of hunting for hermes equivalent.

## What's pending (action items)

### High priority post-UPS-install

1. **Substrate-canonicalize hermes-gateway.service**. Manual SQL seed
   drafted in this session — INSERT one systemd_unit entity for
   `hermes-gateway.service@spark-cfbd` with full attrs from the unit
   file pasted in this conversation. ~30 sec to run. Closes
   `SUBSTRATE_SYSTEMD_UNIT_FILTER_TOO_NARROW_V1` partially (the
   manually-seeded entity will be stable; future user-level services
   would still need extractor patch).

2. **Fix heartbeat-cron.sh ThetaData check** — change `/v2/health` to
   v3 endpoint. ~2 lines. Closes
   `HEARTBEAT_THETADATA_HEALTH_CHECK_USES_DEPRECATED_V2_ENDPOINT_V1`.

3. **Verify post-restart everything's healthy** — within 15 min of
   power-on, `extract_systems_state.py --health-only` will fire and
   substrate state catches up. Real check via local expert:
   `substrate qwen3.6-substrate` then "are any sofar daemons inactive
   that shouldn't be?"

### Medium priority next session

4. **Patch extract_systemd_units.py** to walk user-level systemd
   (`~/.config/systemd/user/`) + extend service-name filter beyond
   `sofar-*.service` (allowlist hermes-*, thetadata.service, etc.).
   ~30 min.

5. **Reconcile `daemon` (extract_systems_state.py) vs `systemd_unit`
   (extract_systemd_units.py) entity types**. Currently 0 daemon
   entities so no double-tracking, but extract_systems_state.py would
   create them if `probe_processes` finds matches. Architectural
   question: keep both (process-runtime view vs config view) or merge.

6. **Deprecate cron-health.sh**. health-check.py covers everything it
   does and more. Real ~5 min cleanup. Captured as
   `CRON_HEALTH_SH_REDUNDANT_WITH_HEALTH_CHECK_PY_V1` candidate.

### Strategic / deferred

7. **UPS cross-shutdown automation** (`UPS_CROSS_SHUTDOWN_AUTOMATION_PENDING_V1`).
   - 2× CyberPower CP1500PFCLCD, pairing: UPS1 = spark-cfbd + mac1,
     UPS2 = spark-73ff + mac2
   - Recommended: USB → Linux master on each UPS (spark-cfbd, spark-73ff)
   - Master script: `pwrstatd` low-battery hook → Discord notify (via
     send_discord.py) → SSH paired Mac shutdown → self shutdown
   - Prereqs: pwrstatd install, `/etc/sudoers.d/bot1-shutdown` on each
     Mac for NOPASSWD shutdown, macOS auto-restart-on-power setting
   - Defer to weekend maintenance window, ~3-4 hour real project

8. **Bundle7-phase2-modelfiles.sh extension** — include qwen3.6-substrate
   as canonical target. ~5 min. Closes manual Modelfile rebuild gotcha.

9. **Quant-research unpause readiness checklist** per ADR-0004 pause
   conditions. ~1 hour strategic doc.

10. **V4-Flash evaluation** when local-compatible Ollama weights land.

11. **PENDING_CONSIDER_S2_TO_MAC2_CONSOLIDATION_V1** — mac2 (256GB)
    underutilized; defer evaluation.

12. **SSH_KEYS_PASSPHRASELESS_BELT_SUSPENDERS_PENDING_V1** — tighten
    authorized_keys to LAN-only with no forwarding. Defer to security pass.

13. **OLLMCP_CAN_GENERATE_SESSION_HANDOVER_PROMPT_V1** — capability for
    local expert to generate session-resume prompts.

14. **DATA_SOURCE_MAPPING_PENDING_V1** — substrate doesn't yet
    canonicalize external data sources → ingestion script → table →
    consumer relationships.

## How to pick up this session in a new chat

If you start a new Claude session and want to continue this work:

1. **Tell the new session**: "I'm continuing the SOFAR substrate
   development project from the 2026-04-29 evening session. The handoff
   doc is at `~/sofar-finance/docs/handoffs/2026-04-29-evening-handoff.md`."

2. **Have the new session read the handoff first.** It captures all
   facts, sentinels, decisions.

3. **Real first move for new session**: query substrate to verify
   current state matches handoff:
   ```
   substrate_search_entities(type='node')      # Should return 4 nodes with recent updated_at
   substrate_search_entities(type='sentinel', limit=10)  # Should include the new sentinels above
   ```

4. **Real next operational move**: items 1-3 from "High priority
   post-UPS-install" above (substrate-seed hermes, fix ThetaData v3
   check, verify post-restart health).

## Real recovery procedure for UPS install

### Before shutdown

1. **Optional but recommended**: confirm "Start up automatically after a
   power failure" is enabled on both Macs. System Settings → Battery →
   Options.
2. **Optional**: stop cron on spark-cfbd to silence */2 git push and
   */15 health refresh cron during the shutdown window:
   ```bash
   sudo systemctl stop cron
   ```

### Shutdown order (services first, then machines, mac2 last)

1. **spark-cfbd**: `sudo systemctl stop sofar-flow-tape.service sofar-monitor.service`
   (sofar-flow-intel and sofar-research are already inactive intentionally)
2. **spark-73ff**: `sudo systemctl stop sofar-flow-analyzer.service`
3. **spark-cfbd**: `systemctl --user stop hermes-gateway.service` (graceful)
4. **spark-73ff**: `sudo shutdown -h now "UPS install"`
5. **spark-cfbd**: `sudo shutdown -h now "UPS install"`
6. **mac1**: `sudo shutdown -h now` (will prompt for password unless
   sudoers configured for NOPASSWD)
7. **mac2**: last — Apple menu → Shut Down (or `sudo shutdown -h now`)

### Recovery order (when bringing back up)

1. Plug everything into new UPSes per pairing: UPS1 = spark-cfbd + mac1,
   UPS2 = spark-73ff + mac2
2. Power on Linux hosts first (they auto-start sofar-* services because
   `enabled: true` on the active ones)
3. Power on Macs (or wait for auto-start if "Start up automatically..."
   was set)
4. Within 15 min, extract_systems_state.py --health-only fires, substrate
   updates node entities with new uptime
5. Verify hermes-gateway started: `systemctl --user status hermes-gateway`
6. Verify sofar-flow-intel and sofar-research stayed inactive (intentional)
7. Verify sofar-flow-analyzer can reach mac1 (LAN-binding fix should
   persist via mac1's LaunchAgent for OLLAMA_HOST=0.0.0.0)
8. Send a test message: `python3 ~/scripts/send_discord.py "post-UPS test"`

## Continuity protocol checks

Per ADR-0006:

- **Layer 1 (facts shipped)**: 5 deliverables documented above (extract_systems_state revival, bundle 9 discard, hermes/openclaw discovery, send_discord shipped, heartbeat-cron patched).
- **Layer 2 (lessons learned)**: 10 new sentinels captured + ADR-0013 reference for last night's bundle 8 finalization.
- **Layer 3 (action items)**: 14 ranked with effort estimates.
- **Layer 4 (fragile state)**: shutdown procedure, post-restart verification, deferred items all documented.

---

**Filed**: 2026-04-29 evening (cloud Claude session via Claude Desktop)

**Substrate state at end of session**:
- 4 node entities with rich state (uptime, GPU, OS, load avg)
- ~155 scripts (111 spark-cfbd entities updated with host attr + multi-host)
- Crontab inventory: 104 jobs captured
- 6 nightly extractor crons (handoffs 3:25, multihost scripts 3:30,
  systemd 3:35, launchd 3:40, extract_systems_state full 3:45,
  heartbeat-cron entries on weekday triggers)
- 1 high-frequency cron: extract_systems_state.py --health-only every
  15 min (replaces yesterday's extract_state_refresh.py)
- 1 health_issue substrate-canonical: spark-73ff/nvidia_smi exit=18
- 63+ sentinels (15 ADR-born + 48+ handoff-born including this session's 10)
- 5 systemd_unit entities (will become 6 once hermes-gateway seeded)
- 5 launchd_agent entities (1 mac1 + 4 mac2)
- 24 llm_call entities
- ai-synthesis 7-day cost: $2.26 (~$118/year run-rate)

**Next session opens with**: substrate already canonical, Discord alerts
working, UPS install completed (assumed). First moves are items 1-3 from
high-priority list. Real captured: tonight closed multi-day operational
gaps without shipping any redundant infrastructure.
