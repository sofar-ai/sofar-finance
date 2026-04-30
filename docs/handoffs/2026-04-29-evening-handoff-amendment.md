# Handoff Amendment — 2026-04-29 evening (correction)

**Filed**: 2026-04-29 late evening, post-UPS install
**Amends**: 2026-04-29-evening-handoff.md
**Sentinel**: HANDOFF_FALSE_MEMORY_FLOW_INTEL_PAUSE_DATE_V1

## What needs correcting

The 2026-04-28 and 2026-04-29 handoffs both stated that
`sofar-flow-intel.service` was "intentionally paused on Apr 27 because
Discord alerts were noisy without spread context."

**This was a Claude false memory.** The user confirmed during post-UPS
verification on 2026-04-29 evening that they did not deliberately stop
sofar-flow-intel — neither on Apr 27 nor at any other point.

The substrate captured `state: inactive` and `last_exit_status: 15`
(SIGTERM) for sofar-flow-intel as of bundle 8 extraction (2026-04-28
03:35 AM). The timing or reason of that stop is not known to the user.
Most likely candidates:
- A transient stop during cluster maintenance that wasn't intentional
- A service that crashed and got SIGTERM'd by systemd's stop sequence
- Something stopped during an earlier session that wasn't captured cleanly

What the user actually described in the original conversation was a
**Discord messaging section commented out in one of the scripts**, which
is structurally different from a service that was stopped.

## Real impact

- The sentinel `FLOW_INTEL_VS_FLOW_ANALYZER_DISAMBIGUATION_V1` (which
  noted flow-intel as "paused") is partially incorrect. The
  disambiguation between flow-intelligence.py and flow-structure-analyzer.py
  remains valid; only the "paused" attribute on flow-intel was wrong.
- Post-UPS install (2026-04-29 evening), sofar-flow-intel.service came
  back up automatically because `enabled: true` was its real state.
- Substrate now reflects sofar-flow-intel as state=active again.

## What's still genuinely paused

- **sofar-research.service** — paused per ADR-0004 (quant-research pause).
  This was ALWAYS the user's explicit intent. Disabled across reboots
  via `systemctl disable` on 2026-04-29 evening.

## Real captured renaissance lesson

I (Claude) attributed both a date AND a reason to a substrate-captured
state without substrate evidence for either. Going forward:

- **For substrate-captured facts**: phrase as "substrate shows state=X
  with last_exit_status=Y" — only what substrate actually contains.
- **Don't add narrative attribution** (date + reason) unless I have
  substrate evidence for both, OR explicit confirmation from the user
  in the same session.
- **When uncertain**: phrase as "substrate shows X; the user has not
  confirmed why or when" rather than fabricating a story.

Real captured as `CLAUDE_NARRATIVE_ATTRIBUTION_REQUIRES_EVIDENCE_V1` —
an operating principle going forward.

## What new sessions should know

- sofar-flow-intel.service is the active Discord options flow messaging
  daemon. It's running. It's not deliberately paused.
- sofar-research.service IS deliberately paused per ADR-0004. Disabled
  across reboots.
- Any substrate `state: inactive` for a sofar-* service should NOT be
  interpreted as "user paused this." It might be transient state from
  any number of causes.
