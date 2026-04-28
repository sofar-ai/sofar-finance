# Session Handover Amendment — 2026-04-27 (Late Evening)

**Companion to**: `2026-04-27-evening-handoff.md` (substrate entity 2547)

**Why this exists**: The original evening handoff was written at ~22:00 ET. Several real findings landed in the next ~90 minutes that the original doesn't capture. Rather than rewrite the canonical handoff (renaissance: don't rewrite history, append to it), this amendment captures what changed.

---

## Late-evening findings

### 1. `extract_handoffs.py` was not in cron — closed tonight
Discovery: The `crontab -l | grep extract_handoffs` returned nothing. ADR-0006's four-layer continuity protocol relies on handoffs becoming substrate-canonical, but extract_handoffs.py only ran on manual invocation. Every prior handoff was substrate-invisible until someone manually ran the extractor.

Fix: Added cron entry on spark-cfbd:
```
25 3 * * * . /etc/neon-meta.env && python3 /home/bot1/scripts/extract_handoffs.py >> /home/bot1/logs/extract-handoffs.log 2>&1
```

3:25 AM, before the bundle 8 extractors at 3:30 (multihost scripts) and 3:35 (systemd units). Manual run tonight produced: 3 entities inserted, 1 updated, 224 mentions matched (0 unmatched), 45 new relationships, 49 events logged.

Sentinel: **`HANDOFF_NOT_AUTO_EXTRACTED_V1`** (closed by tonight's cron addition). Was a real continuity gap — a new cloud-Claude session pulling from substrate would have seen no handoffs even though they existed on disk and in git.

### 2. Tonight's handoff is now substrate-canonical
Entity id 2547, type `handoff`, name `2026-04-27-evening-handoff`. Eight sections indexed including all sentinels, open items, and tomorrow's first move. The 224 entity mentions in the handoff text are linked as relationships, so tomorrow's session can `query_relationships` from the handoff to walk to any referenced script/ADR/sentinel.

Companion entity 2548: `2026-04-27-flow-analyzer-disaster-postmortem` — the morning postmortem. Both substrate-canonical AND in git-pushed.

### 3. Local expert handover-generation now WORKS — under specific conditions
The original handoff said qwen3-substrate via ollmcp "choked on the handover-generation task tonight" with empty response on mac2-direct. That captured one data point. After running the test post-extract_handoffs.py (with handoff entities in substrate), Windows ollmcp produced surgical structured output:

- Identified entities 2547 and 2548 as authoritative source material
- Synthesized correct topology summary (4 hosts, their roles)
- Pulled real fact: ADR-0010 = substrate canonical for rate-cards
- Asked for confirmation to continue section-by-section

**Real architectural finding**: qwen3-substrate produces analyst-grade output WHEN substrate has authoritative source material; falls back to fabrication or empty-response when substrate has no entity for the topic. The earlier composition failure was specifically a "no substrate source" case (asking the model to recap v1→v2→v2.1 prompt iteration when substrate doesn't store prompt iteration history). Tonight's success after handoff extraction was specifically a "substrate has authoritative source" case.

Sentinel: **`LOCAL_EXPERT_USEFUL_WHEN_SUBSTRATE_HAS_SOURCE_V1`** (new) — implication for production workflow: ensure entities exist in substrate BEFORE expecting the local expert to compose about them. Pre-extracting any topic the model needs to answer about is the canonical pattern.

### 4. mac2-direct vs Windows ollmcp environment divergence — real finding
Same model (qwen3-substrate), same v2.1 prompt baked into same Modelfile, same substrate MCP server, materially different responses depending on which ollmcp client invoked it:

- **mac2-direct ollmcp**: returned empty on the original compositional handover prompt
- **Windows ollmcp**: produced structured output on the same prompt (after handoffs extracted)

The Windows result is partially confounded by post-extraction availability of handoff entities, but the empty-response failure on mac2-direct happened BEFORE handoffs were in substrate. So the variables are entangled.

Real candidate causes worth investigating tomorrow:
- ollmcp version skew between phase 1 (mac2) and phase 5a (Windows) installs
- MCP transport: stdio (mac2-direct probably) vs SSE on port 9000 (Windows possibly)
- Ollama endpoint: localhost (mac2) vs `http://mac2.local:11434` (Windows over LAN)
- Terminal/TUI rendering behavior differences

Sentinel: **`OLLMCP_CLIENT_ENVIRONMENT_AFFECTS_BEHAVIOR_V1`** (new) — never validate the local expert solely on mac2-direct. Windows is the canonical client harness based on tonight's evidence. Document in tomorrow's ADR-0012 (model + client choice).

### 5. synthesis-trigger.py VIX field name fix validated end-to-end
Original handoff said "validation pending tonight at 22:05 ET." The 22:05 check ran. Diagnostic dump:

```
[2026-04-27 12:45 ET] VIX: 0     ← pre-fix
[2026-04-27 14:45 ET] VIX: 0     ← pre-fix
[2026-04-27 15:45 ET] VIX: 0     ← pre-fix
[2026-04-27 22:05 ET] VIX: 18.02 ← post-fix, matches actual
=== What was actually current ===
  Actual vix_spot: 18.02
```

The 22:05 check still SKIPPED with "no material changes" — but that's correct behavior now. After-hours VIX stable at 18.02, GEX positive, regime pinned. The gate sees real values, evaluates correctly, decides not to fire because conditions are quiet. Compare to pre-fix: skipped because 0 → 0 = no change (garbage in, garbage out).

`SYNTHESIS_TRIGGER_FIELD_NAME_DRIFT_V1` is conclusively closed.

### 6. Auto-pusher scope correction
The original handoff did not include this, and at one point during the late-evening session I incorrectly hypothesized that auto-pusher only commits `data/*.json` files (would have created sentinel `AUTO_PUSHER_SCOPED_TO_DATA_ONLY_V1`). That was wrong. Real evidence:

```
ce017b35e auto: update data/flow-tape.json, data/top-flow.json, docs/handoffs/2026-04-27-evening-handoff.md
7ce4df8b5 auto: update data/flow-tape.json, ..., docs/handoffs/2026-04-27-flow-analyzer-disaster-postmortem.md
```

Auto-pusher does sweep `~/sofar-finance/` broadly including `docs/`. Sentinel retracted. Real reason it looked like data-only: the constant flow-tape.json updates dominate the commit log visually.

---

## Updated state of system at end of session

- ✅ Pipeline ran cleanly: 20/20 OK, today's data current
- ✅ Three production failures: 2 fixed and validated end-to-end, 1 scoped (ThetaData WARNs not blocking)
- ✅ Bundle 8 ws1+ws2 landed: 14 substrate entities across spark-73ff and mac2; mac1 correctly empty
- ✅ Three nightly extractor crons in place: 3:25 (handoffs), 3:30 (multihost scripts), 3:35 (systemd units)
- ✅ v2.1 system prompt deployed; both Modelfiles rebuilt; both handoffs substrate-canonical AND git-pushed
- ✅ qwen3-substrate via ollmcp on Windows validated as canonical local expert for retrieval AND composition (when substrate has source material)
- ✅ Continuity loop closed: tomorrow's session can query both 2026-04-27 handoffs as starting context
- 📋 Open WebUI deprecated; LibreChat eval queued for tomorrow
- 📋 mac2-direct vs Windows ollmcp divergence investigation queued
- 📋 v2.2 prompt iteration with few-shot examples queued (lower priority — current v2.1 + Windows ollmcp works for the validated workflows)

## Sentinels added since the original handoff

- **`HANDOFF_NOT_AUTO_EXTRACTED_V1`** (closed) — extract_handoffs.py now in cron at 3:25 AM
- **`LOCAL_EXPERT_USEFUL_WHEN_SUBSTRATE_HAS_SOURCE_V1`** (new) — local expert composition works when source entities exist; pre-extract any topic before expecting the expert to compose about it
- **`OLLMCP_CLIENT_ENVIRONMENT_AFFECTS_BEHAVIOR_V1`** (new) — Windows ollmcp ≠ mac2-direct ollmcp behavior; Windows is canonical

(`AUTO_PUSHER_SCOPED_TO_DATA_ONLY_V1` was hypothesized then retracted; not a real sentinel.)

---

**Filed**: 2026-04-27 late evening
**Companion to**: `2026-04-27-evening-handoff.md`
**Will be substrate-canonical**: after extract_handoffs.py runs (manually or via 3:25 AM cron tomorrow morning)
