# ADR-0016: Cross-host Ollama access via SSH tunnel — mac2 stays localhost-only

**Date:** 2026-05-02
**Status:** accepted
**Deciders:** bot1
**Related:** ADR-0008 (Macs as independent hosts), ADR-0014 (External Research System), ADR-0015 (substrate ingestion conventions)
**Sentinel:** MAC2_OLLAMA_SSH_TUNNEL_V1

---

## Context

ADR-0014 (External Research System) places research-summarizer.py on
spark-cfbd but routes its LLM inference to mac2 — chosen as the research
extraction host per `MAC2_RESEARCH_EXTRACTION_ROLE_V1` because mac2 has
significant idle capacity (256GB unified memory, only OLLMCP-serving load
during interactive use) and putting summarizer load there avoids
contention with intraday-synthesis on spark-73ff and the 18:00 ET
pipeline-runner cascade.

Discovery while wiring this up: mac2's Ollama daemon binds to
**localhost only**. Verified empirically — `curl http://mac2.local:11434/api/tags`
from spark-cfbd returns `Connection refused` (the host resolves, the
network reaches it, the port is just not listening on the LAN
interface). This is consistent with mac2's role as primarily an
interactive workstation / MCP host, where exposing Ollama to the LAN
is unnecessary and adds attack surface.

This contrasts with mac1, where Ollama binds to all interfaces
(`OLLAMA_HOST=0.0.0.0:11434` per ollama.service) because flow-analyzer
on spark-73ff needs direct cross-host HTTP access to qwen3:235b@mac1.

The question: how should research-summarizer reach mac2's Ollama? Two
shapes considered: (a) reconfigure mac2 Ollama to bind LAN-wide, matching
mac1's pattern, or (b) keep mac2 localhost-only and tunnel through SSH.

ADR-0008 (Macs as independent hosts) frames each Mac's exposure as a
deliberate choice. mac1's LAN bind is justified by an existing consumer.
mac2 has no such consumer today; flipping its bind to satisfy one new
consumer (the summarizer) sets a precedent that future scripts will
quietly assume LAN-wide access. The SSH tunnel preserves mac2's
defensive default.

OLLMCP from spark-cfbd to mac2 already works (per `qwen3.6-substrate`
canonical-local-expert use, ADR-0013) by SSHing into mac2 and running
ollmcp locally on the box — never crossing the network as raw HTTP.
The tunnel approach is consistent with this pattern; the new wrinkle
is making the tunnel persistent and HTTP-shaped rather than
SSH-and-execute per-call.

Captured discovery sentinels:
- `MAC2_OLLAMA_LOCALHOST_ONLY_BY_DESIGN_V1` — the bind address is intentional
- `MAC2_OLLAMA_SSH_TUNNEL_V1` — the persistent tunnel pattern, this ADR

## Decision

Run a persistent SSH tunnel from spark-cfbd to mac2 as a systemd-managed
service. The tunnel forwards spark-cfbd:11435 to mac2:localhost:11434.
Cross-host scripts on spark-cfbd that need mac2 Ollama point at
`http://localhost:11435/...` and never see the SSH layer. mac2's Ollama
bind address remains localhost-only; no firewall changes; no exposed
ports on the LAN beyond what the rest of the cluster already has.

Implementation: a systemd unit `mac2-ollama-tunnel.service` on spark-cfbd
runs `ssh -N -L 11435:localhost:11434 bot1@mac2.local` with reasonable
ServerAlive options for fast failure detection. systemd's `Restart=always`
handles network blips, mac2 sleeping/waking, and SSH dropping.

The `research-summarizer.py` script (and any future cross-host consumer
of mac2 Ollama from spark-cfbd) uses `http://localhost:11435/v1/chat/completions`
as its endpoint. From the script's perspective, this looks like local
HTTP — there is no SSH-related code in any consumer.

The substrate model registry records the actual model location via
`extracted_by_model_id` on observation/scout_runs rows. Cross-host
attribution stays canonical even though the network path is tunneled.

### Reverse direction not provided

This ADR establishes spark-cfbd → mac2 only. mac2 → spark-cfbd does not
need an Ollama tunnel today (no scripts on mac2 call Ollama on cfbd or
elsewhere). If that need arises, a parallel ADR establishes the reverse
tunnel; do not add reverse forwarding to this service.

## Alternatives Considered

### Alternative 1: Reconfigure mac2 Ollama to bind 0.0.0.0
- **Pros:** Same shape as mac1; no tunnel to manage; trivially fast;
  one config change in `homebrew.mxcl.ollama.plist`
- **Cons:** Exposes mac2's Ollama to anything on 192.168.51.x. Today
  that's a small set of trusted hosts; tomorrow it could include guests,
  IoT devices, or LAN-resident services we haven't yet planned. Reversing
  the exposure later is harder than not enabling it now (existing
  consumers would break). Sets precedent that "any new consumer = open
  the bind address" rather than "new consumer = explicit access path."
- **Why not:** Per ADR-0008, each host's network exposure is a
  deliberate choice. mac1's LAN bind is justified; mac2's isn't.

### Alternative 2: Per-call SSH (no persistent tunnel)
- **Pros:** Stateless; nothing to manage; no long-lived process
- **Cons:** ~300ms SSH connect overhead per LLM call; quoting JSON
  payloads through `ssh bot1@mac2 'curl ...'` is fragile; doesn't
  compose with HTTP-shaped client libraries
- **Why not:** Summarizer is the first consumer; future consumers
  would inherit the same fragility. One persistent tunnel pays off
  across all of them.

### Alternative 3: autossh instead of plain ssh
- **Pros:** Purpose-built for tunnel maintenance; well-tested
  reconnect behavior in flaky networks
- **Cons:** Additional package dependency; modest reliability gain
  given systemd's `Restart=always` already handles failure cases
- **Why not:** Plain ssh + systemd is one less moving part. Network
  is wired and stable; autossh's edge-case advantages aren't
  load-bearing here. Revisit if tunnel reliability becomes a
  problem in practice.

### Alternative 4: VPN or WireGuard mesh
- **Pros:** Solves cross-host access at the network layer for ALL
  services, not just Ollama
- **Cons:** Major infrastructure change; introduces routing complexity;
  over-engineered for current scale (4 hosts on the same physical LAN
  behind firewalla); inconsistent with ADR-0008's "independent hosts"
  framing
- **Why not:** Tool too big for the problem.

### Alternative 5: Tailscale or similar zero-config VPN
- **Pros:** Easier than self-hosted WireGuard; works across NATs
- **Cons:** External dependency on a third-party service; LAN already
  works fine for inter-host comms (10Gb switch, Thunderbolt bridge
  between Macs); no NAT-traversal need
- **Why not:** Zero-config VPN solves problems we don't have.

## Consequences

### Positive

- **mac2's defensive default preserved.** Localhost-only Ollama means
  no LAN exposure of inference; consistent with mac2's interactive-host
  posture.
- **Existing pattern reinforced.** OLLMCP already SSHes from cfbd to
  mac2; the tunnel formalizes and persists that pattern as
  always-available HTTP, no new trust model.
- **Summarizer code stays clean.** From research-summarizer.py's
  perspective, the endpoint is local HTTP. No SSH code; no shell-out;
  no quoting concerns. The endpoint is configurable per ADR-0010
  for future host swaps.
- **Substrate-canonical.** The systemd unit is picked up by
  `extract_systemd_units.py` on next 03:35 cron run; the tunnel
  becomes a first-class entity in the lineage graph.
- **Future consumers free.** Any future cross-host script needing
  mac2 Ollama (theme-clustering, data_gap auto-populator, future
  scout fleet members) gets the tunnel for free.

### Negative

- **One more long-running service to monitor.** systemd handles
  restart but a silent prolonged failure is possible if logs
  aren't checked. Mitigated by health-check integration (see
  Implementation notes).
- **Single point of failure.** Tunnel down means no summarizer
  output until restart. Practically: scout_runs records errors,
  next cron retries, recovery is automatic on tunnel restart.
- **Slightly slower startup for first call after tunnel restart.**
  ~1-2 seconds for SSH session establishment + Ollama warm. Not
  perceptible in the 30-90s LLM-call timeframe.

### Risks

- **Stale local listener after upstream death.** ssh keeps port 11435
  bound on cfbd even if the SSH session has died and not yet
  reconnected; calls hang for the request timeout duration.
  Mitigation: `ServerAliveInterval=30 + ServerAliveCountMax=3`
  detects within 90 sec, ssh exits, systemd restarts. Per-call
  retries in the summarizer absorb the gap.
- **mac2 reboots/sleeps unexpectedly.** Tunnel re-establishes
  automatically on systemd's `Restart=always` once mac2 is back
  on network. No persistent corruption; only a window of failed
  summarizer calls.
- **SSH key revocation/rotation breaks tunnel silently.** Service
  enters restart-loop. Mitigation: `RestartSec=10` prevents tight
  loops; substrate's `last_exit_status` field on the systemd_unit
  entity surfaces persistent failures in normal queries; health
  check can probe `localhost:11435/api/tags` periodically.
- **Trust model: anyone-as-bot1-on-cfbd reaches mac2 Ollama.** This
  is not new exposure — anything running as bot1 on cfbd can already
  `ssh bot1@mac2` and execute arbitrary code on mac2. The tunnel
  doesn't escalate that. But it's worth being explicit: the
  trust boundary is "bot1's userspace on cfbd."

## Implementation notes

### Files

- `/etc/systemd/system/mac2-ollama-tunnel.service` — the unit file
  (deployed via scp to spark-cfbd, then `systemctl daemon-reload && enable --now`)
- `research-summarizer.py` — `DEFAULT_ENDPOINT` updated to
  `http://localhost:11435/v1/chat/completions`

### Sentinels introduced

- `MAC2_OLLAMA_SSH_TUNNEL_V1` — the tunnel pattern itself, this ADR
- `MAC2_OLLAMA_LOCALHOST_ONLY_BY_DESIGN_V1` — captured intent
  that mac2's bind address is deliberately not LAN-exposed
- `MAC2_RESEARCH_EXTRACTION_ROLE_V1` — broader role of mac2 as
  research-extraction host (referenced by ADR-0014)

### Health monitoring

The existing `health-check.py` cron (every 15 min) is the right
place to add a tunnel probe:

```python
# Pseudo-code; actual integration in a follow-up patch
try:
    r = urllib.request.urlopen('http://localhost:11435/api/tags', timeout=5)
    if r.status != 200:
        log_alert('mac2-ollama-tunnel: non-200 response')
except Exception as e:
    log_alert(f'mac2-ollama-tunnel: unreachable: {e}')
```

This integration is captured as
`HEALTH_CHECK_MAC2_TUNNEL_PROBE_PENDING_V1`. Not blocking for
ADR-0016 acceptance; ships as follow-up.

### Substrate canonicalization

After the unit is deployed, the next 03:35 ET run of
`extract_systemd_units.py` picks up the service and creates a
`systemd_unit` entity named `mac2-ollama-tunnel.service@spark-cfbd`.
The unit's `exec_start` field will reference `bot1@mac2.local`,
producing a relationship edge to the mac2 node entity. Lineage walk
from research-summarizer.py through the tunnel to mac2 Ollama
becomes substrate-queryable.

### Future scope expansion

If additional cross-host Ollama tunnels become needed (e.g.,
spark-73ff → mac2 for some reason), each gets its own systemd
service with a distinct local port. The `mac2-ollama-tunnel`
naming scheme supports `<src>-<dst>-<service>.service` if
patterns emerge.

## References

- ADR-0008 (Macs as independent hosts — informs why mac2's bind
  address is a deliberate choice)
- ADR-0010 (substrate canonical for rate cards — informs model
  swappability via env-driven config)
- ADR-0013 (Bundle 8 finalization — `qwen3.6-substrate` canonical
  on mac2 via ssh+ollmcp pattern that this ADR formalizes)
- ADR-0014 (External Research System — names mac2 as research
  extraction host, motivates this tunnel)
- ADR-0015 (substrate ingestion conventions — format this document
  follows)
- `homebrew.mxcl.ollama.plist@mac2` (substrate entity — current
  bind config, unchanged by this ADR)
- `ollama.service@spark-73ff` (substrate entity — for contrast,
  shows the LAN-bound pattern used elsewhere)
- `ollama.service@mac1` (substrate entity — same LAN-bound
  pattern, justified by flow-analyzer consumer)
