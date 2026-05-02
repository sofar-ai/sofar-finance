# Session Handover — 2026-05-01 (Friday) Evening

**Filed**: 2026-05-01 late evening
**Sentinel-tagged**: this handoff captures multiple new sentinels for substrate auto-promotion

## What shipped today

### 1. Pipeline recovery from afternoon network outage

The 6 PM ET evening pipeline failed (16 FAIL / 1 OK / 3 WARN) because the user disconnected the network mid-pipeline while working on Firewalla setup. After network restored:

- Pipeline manually rerun via `python3 /home/bot1/scripts/pipeline-runner.py 2>&1 | tee -a ~/logs/pipeline-runner.log`
- PID 344119 confirmed active with `pgrep -af pipeline-runner`
- Step 9 (Greeks/IV) was the visible work — 11 ticker ingest in sequence (SPY/QQQ/IWM/AAPL/NVDA/TSLA/META/MSFT/AMD/AMZN/SPXW)
- Pipeline completed successfully with fresh data files

### 2. mDNS hardening across all hardcoded cluster IP references

Substrate audit + grep on disk found 3 functional references to 192.168.50.x cluster IPs (excluding backup .bak files and historical handoff docs):

1. `sofar-flow-analyzer.service@spark-73ff` — `OLLAMA_URL=http://192.168.50.15:11434/api/generate`
2. `~/scripts/config/nodes.yml` on spark-cfbd — `ip: 192.168.50.15` (mac1) and `ip: 192.168.50.242` (mac2)
3. `~/scripts/extract_llm_calls.py` line 58 — ENDPOINT_TO_LOCUS table mapping

All three converted to mDNS names:

```
sofar-flow-analyzer.service:
    OLLAMA_URL=http://192.168.50.15:...  →  http://mac1.local:...

nodes.yml:
    ip: 192.168.50.15   →  ip: mac1.local
    ip: 192.168.50.242  →  ip: mac2.local

extract_llm_calls.py ENDPOINT_TO_LOCUS:
    Added new tuple: ('mac1.local', 'mac1', 'ollama_remote')
    Kept historical: ('192.168.50.15', 'mac1', 'ollama_remote') for matching old runtime events
```

This closes `SYSTEMD_HARDCODED_IP_BRITTLE_V1` from the 2026-04-27 flow-analyzer disaster postmortem
permanently. Cluster IPs can now change without breaking any sofar service.

Verification: sofar-flow-analyzer restarted, active running, extract_systems_state.py probed all
4 hosts via mDNS without errors, 0 health_issues.

### 3. Firewalla Purple Plus install in router mode for cluster isolation

**Topology achieved:**
```
FIOS Gateway → ASUS primary → ASUS satellite → Firewalla → Switch → cluster (4 hosts)
                                              (router-mode)
```

**Cluster subnet changed**: 192.168.50.0/24 → 192.168.51.0/24

**Configuration:**
- Firewalla LAN: 192.168.51.1/24
- DHCP range: 192.168.51.1 - 192.168.51.254
- WAN: DHCP from ASUS at 192.168.50.x
- Mode: Router Mode (chosen over Bridge for isolation rather than just visibility)

**Cluster IPs after cutover (random DHCP assignments, then locked via Reserved):**
- mac1 → 192.168.51.174
- mac2 → 192.168.51.132
- spark-73ff → 192.168.51.164
- spark-cfbd → 192.168.51.137

**Cutover sequence used:**
1. Pre-cutover: mDNS hardening (above) so IP changes wouldn't break services
2. Firewalla LAN configured for 192.168.51.0/24 (initially errored when tried 192.168.50.x — Firewalla refuses LAN/WAN subnet overlap)
3. Physical cutover: cable from satellite → Firewalla WAN; cable from Firewalla LAN → switch
4. DHCP renew on each host to pick up new subnet IPs:
   - Linux: `sudo systemctl restart networking || sudo systemctl restart NetworkManager`
   - More forceful: `sudo ip link set IFACE down && sudo ip link set IFACE up`
   - macOS: `sudo ipconfig set en0 BOOTP && sleep 2 && sudo ipconfig set en0 DHCP`
5. Reserved each device's IP in Firewalla app to lock the assignment

**Verified post-cutover:**
- Internet works from cluster (`ping 8.8.8.8` clean)
- mDNS resolution works cross-host (spark-cfbd → spark-73ff via spark-73ff.local)
- sofar-flow-analyzer.service active running, reaching mac1 via mac1.local
- extract_systems_state.py extraction clean, 0 health_issues

### 4. Discord post-UPS sentinel cleanup

Earlier in week ThetaData v2 endpoint deprecation surfaced false-positive alerts. Patched
heartbeat-cron.sh to use v3 endpoint check (`/v3/option/list/expirations?symbol=SPY` with
HTTP 200 check). Closes `HEARTBEAT_THETADATA_HEALTH_CHECK_USES_DEPRECATED_V2_ENDPOINT_V1`.

### 5. Hermes-gateway substrate-canonical seed

Earlier in week, manually seeded `hermes-gateway.service@spark-cfbd` as systemd_unit entity since
extract_systemd_units.py only walks `/etc/systemd/system/sofar-*.service` and misses user-level
units. Tactical fix; architectural fix (extract_systemd_units.py walking user-level dirs) deferred
as `SUBSTRATE_SYSTEMD_UNIT_FILTER_TOO_NARROW_V1`.

## Sentinels captured this session

### New sentinels for auto-promotion

- **`MDNS_HARDENING_COMPLETE_V1`** — All 3 hardcoded cluster IP references on production cluster converted to mDNS hostnames. mac1.local / mac2.local / spark-73ff.local / spark-cfbd.local resolve correctly. Cluster IP changes no longer break sofar daemons.
- **`FIREWALLA_PURPLE_INSTALLED_V1`** — Firewalla in router mode for cluster-only isolation. Cluster on 192.168.51.0/24, ASUS keeps 192.168.50.x for everything else. Double-NAT contained (cluster → Firewalla → ASUS → FIOS).
- **`CLUSTER_SUBNET_192_168_51_V1`** — Cluster network is now 192.168.51.0/24. Reserved IPs: mac1=.174, mac2=.132, spark-73ff=.164, spark-cfbd=.137.
- **`PIPELINE_NETWORK_INTERRUPT_RECOVERY_PATTERN_V1`** — When network outage interrupts pipeline mid-run: pipeline-runner.py can be invoked manually with same env (db-env.sh + anthropic.env) and will rerun from start. Fresh data files appear in `~/sofar-finance/data/` if successful.
- **`FIREWALLA_LAN_WAN_SUBNET_OVERLAP_REJECTION_V1`** — Firewalla refuses to set LAN to same subnet as WAN. When Firewalla is plugged into ASUS LAN as a client (so its WAN is 192.168.50.x), it cannot be configured for LAN=192.168.50.x. Must pick a different cluster subnet.
- **`CLAUDE_VERBAL_FILLER_REAL_TIC_V1`** — Claude developed habit of starting sentences with "Real" or "Real also" as filler. Called out twice in session. Should be dropped permanently.

### Already-resolved sentinels confirmed via tonight's work

- **`SYSTEMD_HARDCODED_IP_BRITTLE_V1`** (originally captured 2026-04-27 flow-analyzer disaster) — resolved via Change 1 of mDNS hardening.
- **`HEARTBEAT_THETADATA_HEALTH_CHECK_USES_DEPRECATED_V2_ENDPOINT_V1`** (captured 2026-04-29) — resolved via heartbeat-cron.sh v3 endpoint patch.
- **`HANDOFF_FALSE_MEMORY_FLOW_INTEL_PAUSE_DATE_V1`** (captured 2026-04-29) — formally amended via handoff amendment file.

## What's pending

### Immediate (tomorrow or next session)

1. **Verify Monday morning cron pipeline runs successfully** at 6:30 AM (heartbeat-cron morning-health) and 6 PM evening pipeline. mDNS path should work but first cron run after a network change is worth watching.
2. **Confirm Discord posting works on new network** via `bash ~/scripts/heartbeat-cron.sh morning-health` from spark-cfbd.

### Medium priority

3. **Patch `extract_systemd_units.py`** to walk user-level systemd dirs (`~/.config/systemd/user/`) and broaden filter beyond `sofar-*.service`. Closes `SUBSTRATE_SYSTEMD_UNIT_FILTER_TOO_NARROW_V1`. ~30 min.
4. **Reconcile `daemon` vs `systemd_unit` entity types** in substrate.
5. **Deprecate `cron-health.sh`** (redundant with health-check.py). ~5 min cleanup.
6. **Bundle7-phase2-modelfiles.sh extension** to include qwen3.6-substrate as canonical target.
7. **`extract_log_files.py`** — log-file → script relationships extractor.

### Strategic / deferred

8. **UPS cross-shutdown automation** (`UPS_CROSS_SHUTDOWN_AUTOMATION_PENDING_V1`) — pwrstatd hooks on each UPS-master Linux host (spark-cfbd for UPS1, spark-73ff for UPS2), Discord notify via send_discord.py, SSH paired-Mac shutdown, self-shutdown. Pairing per install: UPS1=spark-cfbd+mac1, UPS2=spark-73ff+mac2. ~3-4 hours focused work.
9. **Quant-research unpause readiness checklist** per ADR-0004 pause conditions.
10. **`P620_WORKSTATION_DECISION_PENDING_V1`** — user considering Lenovo P620 + 128GB RAM as quant-research/backtesting node. Decision deferred until: (a) quant-research unpause readiness checklist complete, (b) representative backtest workload profiled on existing hardware, (c) architectural fit reviewed (P620 vs another Mac Studio vs another Spark).
11. **`PENDING_CONSIDER_S2_TO_MAC2_CONSOLIDATION_V1`** — mac2 (256GB) underutilized.
12. **`SSH_KEYS_PASSPHRASELESS_BELT_SUSPENDERS_PENDING_V1`** — tighten authorized_keys to LAN-only with no forwarding. Note: now needs `from="192.168.51.0/24"` instead of 192.168.50.0/24 since cluster subnet changed.
13. **`HERMES_OLLMCP_INTEGRATION_PENDING_V1`** — strategic.
14. **`OLLMCP_CAN_GENERATE_SESSION_HANDOVER_PROMPT_V1`** — local expert capability.
15. **`DATA_SOURCE_MAPPING_PENDING_V1`** — substrate canonicalization of data sources → ingestion → tables → consumers.

## Network state reference

### Current topology

```
FIOS Gateway (ISP)
    ↓
ASUS primary mesh (192.168.50.1, router mode, DHCP for 192.168.50.x)
    ↓
ASUS satellite (mesh node)
    ↓
Firewalla Purple Plus (WAN: 192.168.50.x via DHCP from ASUS, LAN: 192.168.51.1, router mode)
    ↓
Network switch (cluster only)
    ↓
4 SOFAR cluster hosts on 192.168.51.x:
    - spark-cfbd (192.168.51.137, role: production-main)
    - spark-73ff (192.168.51.164, role: synthesis)
    - mac1       (192.168.51.174, role: frontier-inference)
    - mac2       (192.168.51.132, role: mcp-host)
```

### What's reachable from where

- **From upstream devices (192.168.50.x)**: cluster NOT directly reachable. Must go through Firewalla's WAN-side IP (whatever ASUS DHCP gives Firewalla) plus port forwarding rules if needed.
- **From cluster (192.168.51.x)**: internet works via Firewalla → ASUS → FIOS. Other 192.168.50.x devices reachable through Firewalla's NAT.
- **Cluster → Cluster**: direct on 192.168.51.x via mDNS (e.g., `mac1.local`).
- **Cluster → mac1 Ollama**: via `mac1.local:11434` (substituted in sofar-flow-analyzer.service env).

### What changed in nodes.yml and extract_llm_calls.py

```yaml
# ~/scripts/config/nodes.yml (post-mDNS-hardening)
nodes:
  - name: mac1
    ip: mac1.local         # was 192.168.50.15
    ...
  - name: mac2
    ip: mac2.local         # was 192.168.50.242
    ...
```

```python
# ~/scripts/extract_llm_calls.py ENDPOINT_TO_LOCUS table
[
    ('api.anthropic.com',   'cloud_anthropic',  'anthropic'),
    ('api.openai.com',      'cloud_openai',     'openai'),
    ('spark-73ff',          's2',               'ollama_remote'),
    ('192.168.50.15',       'mac1',             'ollama_remote'),    # historical events
    ('mac1.local',          'mac1',             'ollama_remote'),    # ADDED
    ('bot1s-Mac-Studio',    'mac1',             'ollama_remote'),
    ('localhost:11434',     's1',               'ollama_local'),
    ('127.0.0.1:11434',     's1',               'ollama_local'),
    ('11434',               's1',               'ollama_local'),
]
```

## Operating notes

- **No deadlines, ever**: Claude is reminded not to suggest deadlines or hard stops.
- **Verbal filler "Real"**: Claude has a tic of starting sentences with "Real" or "Real also" as filler. Called out twice. Drop permanently.
- **Trailing system blocks in user messages**: per user's explicit instruction, Claude does not bring up MCP tools or comment on inline `<system><functions>` blocks. The user has no control over these.

## How to pick up next session

If new Claude session starts and wants context, tell it:

> I'm continuing the SOFAR substrate development. Most recent handoff is at
> `~/sofar-finance/docs/handoffs/2026-05-01-evening-handoff.md` on spark-cfbd, also
> ingested as a `handoff` substrate entity. Cluster is now on 192.168.51.x behind a
> Firewalla in router mode. mDNS hardening is complete — all daemons use mac1.local /
> mac2.local instead of IPs. Read the handoff for full context.

First-move verification next session:

```bash
# [ON spark-cfbd]
. /etc/neon-meta.env
python3 ~/scripts/extract_systems_state.py --health-only --verbose 2>&1 | tail -10
# Expected: 4 hosts probed clean, 0 health_issues

# Check Discord posting
python3 ~/scripts/send_discord.py "session resume — verifying network and alerting"

# Check sofar-flow-analyzer
ssh bot1@spark-73ff 'systemctl status sofar-flow-analyzer.service | head -5'
```

---

**Substrate state at end of session**:
- 4 nodes on new 192.168.51.x subnet
- 6 systemd_units (one with mDNS-hardened OLLAMA_URL)
- ~155 scripts (3 with hardcoded-IP references converted to mDNS)
- 5 nightly extractor crons + 1 every-15-min health refresh
- Pipeline: rerun successfully tonight after afternoon network interruption
- Discord alerting: working on new network
- Firewalla: cluster-only isolation in router mode, IPs reserved
