# ADR-0008: Defer Exo clustering, run Mac Studios as independent hosts

**Date**: 2026-04-26
**Status**: accepted

## Context

Mac Studio 2 was originally purchased with the intent to pair with
Mac Studio 1 via Exo (distributed inference) for serving frontier-tier
models that don't fit on a single machine. That plan rested on assumptions:

1. We'd want to run a model bigger than 235B (current largest open model
   loadable on Mac 1's 193GB VRAM)
2. Exo's distributed-inference overhead would be acceptable
3. Mac 1 + Mac 2 paired into one logical machine was higher value than
   two independent machines

While building substrate-day2 and standing up the local-expert architecture,
none of those assumptions held strongly.

## Decision

**Defer Exo clustering until a binding constraint emerges that requires it.**
Run Mac Studio 1 and Mac Studio 2 as **independent local-expert hosts**.

## Rationale

1. **Exo solves a problem we don't have today.** No current workload
   requires > 235B parameters. Pairing Macs to run a hypothetical larger
   model is engineering effort allocated to a future maybe.

2. **Two independent Macs > one paired cluster** for our workload shape:
   - Mac 1 = hot path (MCP server endpoint, local-expert LLM, real-time
     query reasoning)
   - Mac 2 = warm capacity for batch/exploratory work, redundancy,
     specialized models loaded on demand
   - If we Exo-clustered, taking either Mac down (maintenance, model
     pulls, OS update) takes the cluster down. Independent Macs degrade
     gracefully.

3. **Exo's value depends on specific model sizes.** Models that fit on
   one Mac (≤193GB) get worse latency from Exo's network-fragmented
   inference. Only when a model genuinely won't fit on one machine does
   distributed inference win. That model doesn't exist in our stack today
   and isn't on the immediate horizon.

4. **Mac 2's capacity is now general-purpose.** When real workload
   pressure surfaces post-MCP, Mac 2 takes on whatever turns out to bind:
   batch synthesis, specialized models, the substrate-custodian process,
   reasoning headroom for the local expert. We don't need to commit
   in advance.

## Consequences

- **Mac 2 setup mirrors Mac 1**: macOS, Ollama, shared SSH key, hostname
  in `mac1`/`mac2` convention. No Exo software to install.
- **Local expert lives on Mac 1** initially. If/when it outgrows Mac 1,
  consider moving to GB10 (3rd Spark on order) rather than Exo-pairing
  the Macs.
- **Exo evaluation reopens** if/when:
  - We want to load a model > 193GB (e.g. larger qwen, future open-source
    frontier model)
  - Quant-research subsystem unpauses (ADR-0004) and demands models
    bigger than current largest
  - Network fabric upgrade to QSFP/200G changes Exo's overhead calculus

## Hardware plan (current)

| Node | Role today | Role planned |
|---|---|---|
| spark-cfbd (S1) | Production daemons + most LLM consumers | Keep as production server |
| spark-73ff (S2) | Synthesis pipeline target (intraday) | Keep; nvidia-smi NVML mismatch needs reboot |
| Mac Studio 1 | Reserved (qwen3:235b loaded, paused-system narration only) | MCP server + local-expert LLM endpoint |
| Mac Studio 2 | Setup today, models pulled but not pinned to workload | Allocated post-MCP based on real demand |
| GB10 (3rd Spark) | On order | Likely local-expert host long-term, freeing Macs for frontier compute or Exo if Exo-need emerges |

## Related

- ADR-0006: Four-layer continuity protocol
- ADR-0007: Synthesis routing is intentional
- substrate-day2 Q11 (per-node load): showed Mac 1 at 0 runtime calls
  despite 193GB VRAM — confirmed underutilization that justifies
  re-purposing for local expert
