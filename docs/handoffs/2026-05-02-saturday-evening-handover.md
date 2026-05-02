# Session Handover — 2026-05-02 Saturday Evening

**Filed**: 2026-05-02 ~13:30 EDT
**Amends**: 2026-05-02-saturday-amendment (midday)
**Captures**: Stage 4 ship, full UPS automation across both UPSes, hard lessons
about NUT defaults that caused two outages today.

## What shipped today (full list)

### Earlier in the session (already canonical via midday amendment)
- Neon research DB password rotated (with shell-metachar lessons about `$` in passwords)
- TABLE_DB_MAP correction: `data_source_registry` removed (per database-routing.md
  intentional duplication design — must specify `db=` explicitly)
- extract_data_relationships.py v3 — removed `uses_db_py` gate, TABLE_DB_MAP is
  canonical routing globally per ADR-0001
- 176 lineage relationships in substrate (up from 162)
- Saturday midday amendment ingested with 9 entities, 8 sentinels

### Late session (this handover captures)

**Stage 4: extract_data_freshness.py SHIPPED LIVE**
- 77 data_tables now have freshness signals
- Per-database strategy: market → ingestion_log MAX, production → not_tracked
  (shadow), research → table MAX(timestamp_column)
- Heuristic freshness windows by table-name pattern
- Final state: 33 not_tracked, 10 stale, 10 fresh, 9 tracked, 10 no_signal,
  5 dormant
- Cron added at `55 3 * * *`
- Closes `DATA_SOURCE_MAPPING_PENDING_V1` entirely

**UPS2 / mac2 automation: COMPLETE**
- PowerPanel Business Local for Mac (v4.12.0) installed
- `sofar-ups.sh` v3 in `/Applications/CyberPower PowerPanel Business/extcmd/`
- Discord notification via direct curl (no SSH dependency on spark-cfbd)
- Cross-host shutdown: mac2 → mac1 via SSH key + NOPASSWD shutdown rule
- Validated end-to-end with real power pulls (UTILITY_FAILURE OCCUR/FINISH,
  Command Test, SSH+sudo+shutdown chain)
- Per-event Active/Command/Delay/Duration configured in PPB UI

**UPS1 / spark-cfbd automation: COMPLETE (but with painful path)**
- PowerPanel Business Linux is x86_64-only — does NOT support aarch64
- NUT (Network UPS Tools) used instead — wide standard for ARM64 Linux
- nut + libusb-1.0-0-dev + udev rule for vendor 0764 (CyberPower)
- 4 NUT config files: ups.conf, upsd.conf, upsd.users, upsmon.conf
- `sofar-ups-event.sh` v2 in `/etc/nut/`
- Discord direct curl, SSH key + NOPASSWD shutdown to spark-73ff
- Cross-host shutdown: spark-cfbd → spark-73ff
- Validated end-to-end with real power pulls (ONBATT/ONLINE pings landed)

## New sentinels captured

### NUT-specific (UPS1 path)

**`NUT_REPLACES_PPB_ON_AARCH64_V1`**
PowerPanel Business for Linux is x86_64-only. CyberPower has not released
an aarch64 build. NUT (Network UPS Tools, in distro repos as `nut`) is the
canonical alternative on ARM64. CyberPower UPSes are well-supported via
the `usbhid-ups` driver. This is the right path for any future ARM64 host
that needs UPS automation.

**`NUT_DEADTIME_15S_TOO_AGGRESSIVE_V1`**
Default `DEADTIME 15` in upsmon.conf is too aggressive for CyberPower USB
connections. Causes FSD (forced shutdown) when the driver hits a 15-second
USB hiccup, which is common with this hardware. **Use `DEADTIME 60`
minimum for production.** This caused a real outage today.

**`NUT_SHUTDOWNCMD_NEEDS_DELAY_V1`**
Default `SHUTDOWNCMD "/sbin/shutdown -h +0"` fires immediately when
upsmon decides to shutdown. No abort window if it fires spuriously.
**Use `SHUTDOWNCMD "/sbin/shutdown -h +2"` minimum** — gives 2-minute
window where `sudo shutdown -c` can intercept. Combined with DEADTIME 60
this is reasonable defensive defaults.

**`NUT_LOG_DIR_VAR_LOG_NUT_V1`**
NUT-invoked scripts run as the `nut` user, NOT as root. They cannot write
to `/var/log/sofar-ups.log` (root-owned). Log files must go in
`/var/log/nut/` which the nut user owns. The directory must exist with
correct permissions: `mkdir -p /var/log/nut && chown nut:nut /var/log/nut`.

**`DISCORD_WEBHOOK_ENV_NUT_GROUP_READABLE_V1`**
For NUT-invoked scripts to read `/etc/discord-webhook.env`, the file
ownership must allow the `nut` user access:
```bash
sudo chown root:nut /etc/discord-webhook.env
sudo chmod 640 /etc/discord-webhook.env
```
Default ownership (`bot1:bot1` 600) blocks the nut user.

**`CYBERPOWER_USB_RECONNECT_INSTABILITY_V1`**
The CyberPower CP1500PFCLCD (and family) exhibits USB disconnect/reconnect
behavior under usbhid-ups driver:
```
nut_libusb_get_report: Input/Output error
nut_libusb_get_string: Pipe error
```
Mitigation: systemd unit override at
`/etc/systemd/system/nut-driver@.service.d/override.conf`:
```ini
[Service]
Restart=always
RestartSec=10
```
Driver self-heals on USB hiccups. Combined with DEADTIME 60, this prevents
spurious FSD triggers from USB instability.

### General UPS testing safety

**`UPS_TESTING_PAM_NOLOGIN_BLOCKS_RECOVERY_V1`**
Never test cross-host shutdown by running `shutdown -h +N` and then
attempting to cancel via SSH. As soon as `shutdown` schedules itself,
pam_nologin activates and blocks **all non-root logins** including
`bot1` accounts. Cancel attempts fail with permission denied. Even
local console login may fail.

**Safe testing alternatives:**
- Test SSH+sudo chain via `wall` command instead of `shutdown`
- Use `shutdown -k +N` which broadcasts warning but doesn't actually
  schedule shutdown (DOES NOT block logins)
- Test on non-load-bearing host
- Accept that real-shutdown tests are destructive; treat them as such

This caused real outage during today's UPS1 testing. spark-73ff went
down while attempting to validate the SSH chain.

### UPS pairing

**`UPS_PAIRING_FINAL_V1`**
Confirmed final pairing after today's validation:
- **UPS1** (CyberPower CP1500PFCLCD, serial CXXQX7008712): both sparks
  (spark-cfbd USB-connected, spark-73ff blind)
- **UPS2** (CyberPower CP1500PFCLCD): both macs (mac2 USB-connected,
  mac1 blind)

USB-connected hosts run UPS automation (PPB on mac2, NUT on spark-cfbd).
Blind hosts receive shutdown signals via SSH from their pair-mate.

### Process / discipline lessons (also worth capturing)

**`UPS_FIRST_TEST_NOTIFY_ONLY_V1`**
When validating UPS hooks for the first time, run a notify-only test
script BEFORE wiring the real script that triggers shutdowns. Today's
mac2 setup did this correctly with `sofar-ups-test.sh` (Discord-only,
no SSH, no shutdown) and validated cleanly. The UPS1/NUT path skipped
this step and immediately enabled SHUTDOWNCMD. Result: one of the two
outages.

Always test in this order:
1. Synthetic invocation as the actual user the daemon will use
2. Real event with NOTIFY only (no destructive paths)
3. Real event with full destructive paths enabled (only after #2 validates)

**`UPS_AUTOMATION_REQUIRES_DEFENSIVE_DEFAULTS_V1`**
NUT and PPB defaults assume aggressive shutdown semantics that work in
typical home/office settings but fail in production cluster environments
where:
- USB connections may hiccup (CyberPower issue)
- Shutdown windows must allow cross-host signaling time
- Failures must be debuggable (logs, delays, abort windows)

Defensive baseline:
- DEADTIME ≥ 60s (NUT)
- SHUTDOWNCMD with ≥ 2min delay
- Hook scripts log to writable directory for daemon's user
- All notification channels work BEFORE enabling auto-shutdown
- Driver auto-restart on USB issues

## Files added/modified today

### spark-cfbd canonical files
- `/home/bot1/scripts/extract_data_freshness.py` — Stage 4 v6 LIVE in cron
- `/home/bot1/scripts/db.py` — `data_source_registry` line removed
- `/home/bot1/scripts/extract_data_relationships.py` — v3 with TABLE_DB_MAP
  unconditional resolution
- `/etc/nut/ups.conf` — UPS1 device definition
- `/etc/nut/upsd.conf` — server config (LISTEN 127.0.0.1)
- `/etc/nut/upsd.users` — monuser credentials (chmod 640 root:nut)
- `/etc/nut/upsmon.conf` — DEADTIME 60, SHUTDOWNCMD +2, all NOTIFYFLAG EXEC
- `/etc/nut/sofar-ups-event.sh` — v2 hook script (logs to /var/log/nut/)
- `/etc/nut/nut.conf` — `MODE=standalone`
- `/etc/udev/rules.d/62-nut-usbups.rules` — CyberPower vendor 0764 → nut group
- `/etc/systemd/system/nut-driver@.service.d/override.conf` — Restart=always
- `/var/log/nut/sofar-ups.log` — script log target (nut:nut owned)
- `/etc/discord-webhook.env` — re-permissioned to `root:nut 640`
- `/etc/sudoers.d/sofar-shutdown` (on spark-73ff) — bot1 NOPASSWD shutdown
- `/root/.ssh/id_ed25519` (on spark-cfbd) — root key for SSH to spark-73ff
- spark-73ff `~/.ssh/authorized_keys` — has spark-cfbd root pubkey

### mac2 canonical files
- `/Applications/CyberPower PowerPanel Business/extcmd/sofar-ups.sh` — v3
- `/Applications/CyberPower PowerPanel Business/extcmd/sofar-ups-test.sh`
  (kept for future testing)
- `/var/log/sofar-ups.log` — PPB-invoked script log (root-writable)
- `/var/root/.ssh/id_ed25519` — root key for SSH to mac1
- mac1 `~/.ssh/authorized_keys` — has mac2 root pubkey
- `/etc/sudoers.d/sofar-shutdown` (on mac1) — bot1 NOPASSWD shutdown
- `/etc/discord-webhook.env` (on mac2) — same webhook URL as spark-cfbd

## Pending TODO carryover

### Substrate dev (deferred)
- Reconcile `daemon` vs `systemd_unit` entity types
- Deprecate cron-health.sh
- extract_log_files.py
- Fix extract_systemd_units.py upsert bug (extractor field doesn't update)
- Fix extract_systemd_units.py false positive (skip 0.0.0.0/127.0.0.1)
- `EXTRACT_DATA_FRESHNESS_INGESTION_LOG_EMPTY_FALLBACK_V1` — 6 market tables
  show `ingestion_log_empty` instead of falling back to table MAX
- `SUBSTRATE_DATA_SOURCE_DISCOVERY_BASEURL_MATCHING_V1`

### .pgpass migration
Defer to fresh session — eliminates need to redact connection strings in
shell output. Low priority but easy when fresh.

### UPS hardening (post-MVP)
- Consider adding watchdog on each blind host (mac1, spark-73ff) that
  pings its pair-mate; if pair-mate goes silent during a power event,
  blind host initiates own shutdown. Hedges against the case where the
  USB-connected host crashes before signaling shutdown.
- `UPS2_MAC2_CRASH_LEAVES_MAC1_BLIND_V1` and equivalent
  `UPS1_SPARK_CFBD_CRASH_LEAVES_SPARK_73FF_BLIND_V1`
- Long term: consider PPB Remote on blind hosts pointing at USB-connected
  host as the local node (would auto-shutdown blind host based on UPS
  state without needing SSH chain)

### Strategic / deferred
- Audit 9 NEEDS-AUDIT scripts per `SCRIPTS_PENDING_DB_ROUTING_AUDIT_V1`
- DROP production shadow tables per `PRODUCTION_SHADOW_TABLES_PENDING_DROP_V1`
- Quant research unpause readiness checklist (per ADR-0004)
- P620 workstation decision
- MLflow self-hosted vs Weights & Biases
- NAS consideration (defer)
- s2 → mac2 consolidation (defer)
- SSH key passphraseless tightening with `from="192.168.51.0/24"`
- Hermes-OLLMCP integration

## Substrate state at end of session

- 4 nodes on 192.168.51.x (mDNS-resolved)
- 9 systemd_units (system + user scope)
- 5 launchd_agents (mac1 + mac2)
- 2 network entities + cluster-net edges
- ~155 scripts with host attribution
- 11 data_source entities
- 77 data_table entities WITH FRESHNESS attrs
- 24 llm_call entities
- 33 reads_from (script→data_source)
- 176 lineage relationships (script↔data_table)
- 90+ sentinels canonical (will be 100+ after this handover ingests)
- Pipeline rerun successful 2026-05-01 evening
- Discord alerting working from spark-cfbd, mac2, AND now via NUT/PPB hooks
- Both UPSes have full automation: cluster cross-host shutdown on critical events
- Substrate refresh: every 15 min via extract_systems_state.py --health-only

## Notes for next session start

- `.pgpass` migration is the obvious "easy win" to start with if you want a
  warm-up task
- Stage 4 has been running on cron — should have at least one auto-run
  by next session start
- spark-73ff went down twice today via my mistakes; uptime when checked
  was 1h 38m (post-recovery from second outage)
- Two outages on Claude in this session — be cautious about UPS-related
  commands that could destabilize cluster again
