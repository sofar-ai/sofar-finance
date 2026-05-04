# Handoff Amendment 2 — 2026-05-03 Sunday evening

**Date:** 2026-05-03
**Period:** sunday-evening-handoff-amendment-2
**Amends:** 2026-05-03-sunday-evening-handoff and 2026-05-03-sunday-evening-handoff-amendment

### What this amendment captures

Reading 2026-05-04 morning director output triggered investigation into the quant-research pause's actual scope and gating conditions. Two pre-protocol documents read this session: `~/sofar-finance/docs/QUANT-RESEARCH-PAUSE.md` (the canonical pause doc) and `~/sofar-finance/SOFAR-SESSION-HANDOFF-TUESDAY-APRIL-21-2026.md` (the source of the Builds 1-10 trajectory). Neither is substrate-canonical (pre-protocol naming, outside docs/handoffs/). Findings:

**Pause date:** 2026-04-22 (Wednesday evening). Three-source agreement: ADR-0004 attrs (`"2026-04-25 (recording a decision originally made 2026-04-22)"`), Apr 23 evening handoff (`"Quant-research was paused Wed evening"`), QUANT-RESEARCH-PAUSE.md first line (`"Paused: 2026-04-22 (Wednesday evening session)"`). Fully canonical.

**Pause scope:** sofar-research.service stopped + 5 cron entries tagged `# QR-PAUSED:` and disabled (research-scout-scraper, research-summarizer x2, research-lab-scraper, quant-research-scout). Toggle via `~/scripts/quant-research-toggle.sh status|unpause` (already substrate-canonical, id 1619, 129 lines). Crontab backup at `~/crontab-backups/crontab.pre-pause-<timestamp>.txt`.

**What's NOT paused, by design:** AI synthesis, unusual flow detector, flow-tape, market-data ingestion, pipeline-runner, **and the research directors (morning 07:30 + evening 16:30)**. Per pause doc: directors *"write strategic narratives from existing data, do NOT generate signal code."* Today's morning director run is doing exactly what the pause doc sanctions; not regression evidence.

**Pause's two structural problems and their fixes:**

- **Problem 1 — hallucinated table names.** LLM-generated signal code (in `experiment-orchestrator.py` calling Claude, and `overnight-research-daemon.py` calling Ollama) referenced nonexistent tables: `treasury_data`, `prices_daliy`, `options_e0d`, etc. 496 fabricated files in `~/scripts/signals/experimental/`. Fix A: schema injection (full column dumps in prompts). Fix B / Build 5: smoke-test gate (execute compute function before storing).

- **Problem 2 — no integration path.** Even when signals worked and got `decision='promoted'`, no machinery published them. `published_signals` table: 0 rows. `signal_attribution`: 0 rows. LightGBM has never seen the 7 promoted signals. Fix: Builds 1-6.

**Builds 1-6 unpause checklist (from pause doc verbatim):**
1. promote-signal-to-production.py
2. bless-weights-proposal.py
3. Re-enable signal compute cron (`# PIPELINE:` lines currently commented)
4. batch-validate-candidates.py
5. Smoke-test gate (Fix B)
6. LightGBM retrain cron

Plus end-to-end test + regression test. Then `~/scripts/quant-research-toggle.sh unpause` lifts the pause.

### Corrected framing of scout v2's project position

The 2026-05-03-sunday-evening-handoff (main) implicitly framed scout v2 as the imminent next step toward un-pausing. **This was incorrect.** Scout v2 is a rebuild of `quant-research-scout.py` (one of the 5 paused crons), addressing hallucination at the *hypothesis-generation* layer via grounding-required + cited_doc_ids enforcement (per ADR-0014 §6, ADR-0017).

The unpause critical path runs through **Builds 1-6**, not scout v2. Scout v2 is hallucination-fix-adjacent but addresses a different layer than the unpause-gating fixes:

- **Builds 1-3** close Problem 2 (integration): graduate→publish→compute loop, the actual gate to un-pausing
- **Build 4** addresses sequential/greedy promotion gap (LightGBM-aware batch validation)
- **Build 5** closes Problem 1's *signal-code* hallucinations via smoke-test gate
- **Build 6** closes the retrain loop
- **Scout v2** closes Problem 1's *hypothesis-layer* hallucinations via cited_doc_ids grounding — distinct from Build 5's signal-code-layer fix

**Scout v2 + Builds 1-6 together = un-pause with quality.** Builds 1-6 alone delivers minimal-quality un-pause (integration loop closes, signal-code hallucinations gated, but hypothesis-layer hallucinations still occur via v1 scout). Scout v2 alone delivers improved hypothesis quality but doesn't lift the pause (paused subsystem stays paused regardless).

The user's framing — *"unpause the system ASAP (with quality)"* — implies pursuing both tracks. Order is a sequencing question, not an either-or.

### Sentinels filed

#### Active (open issues — 2)

**`QUANT_RESEARCH_PAUSED_2026_04_22_BUILDS_1_6_GATED_V1`**
The quant-research subsystem (sofar-research.service + 5 crons tagged `# QR-PAUSED:`) was paused on 2026-04-22 Wednesday evening. Two structural problems documented in `~/sofar-finance/docs/QUANT-RESEARCH-PAUSE.md`: (1) LLM hallucination of table names in generated signal code, (2) no integration path from `experiments.decision='promoted'` through to `published_signals`/`signal_values`/`active-weights.json`/LightGBM retrain. Authoritative sources: ADR-0004 (accepted), QUANT-RESEARCH-PAUSE.md, SOFAR-SESSION-HANDOFF-TUESDAY-APRIL-21-2026.md (source of Builds 1-10 trajectory). Toggle script `~/scripts/quant-research-toggle.sh` (substrate id 1619) handles the pause/unpause operation. Closes when Builds 1-6 ship per the unpause checklist (graduate-to-published; bless-weights; re-enable compute cron; batch-validate-candidates; smoke-test gate; LightGBM retrain), end-to-end flow tested, regression test passes, and `quant-research-toggle.sh unpause` runs successfully restoring the 5 crons + sofar-research.service. Scout v2 is NOT on the unpause critical path but is parallel-track hallucination-fix work at the hypothesis layer (vs. Build 5's signal-code-layer fix); scout v2 + Builds 1-6 together = un-pause with quality.

**`RESEARCH_DIRECTOR_PAUSE_DOC_INTENTIONALLY_RUNNING_NOT_REGRESSION_V1`**
The morning (07:30 ET) and evening (16:30 ET) research directors are intentionally running during the quant-research pause per `~/sofar-finance/docs/QUANT-RESEARCH-PAUSE.md` ("What's NOT paused" section, verbatim: *"Research directors ... write strategic narratives from existing data, do NOT generate signal code"*). Future sessions reading the 2026-04-23 evening handoff "issue B — research-director still generating overnight briefs despite pause" should NOT interpret that as a current regression to fix; the pause doc's design carve-out post-dates and supersedes it. The Apr 23 issue B's substantive concern about narrative quality (Director narrating pre-pause hypotheses/experiments as if live) remains a separate UX consideration — distinct from "is this a regression of the pause." Closes when either (a) the freshness-gate concern is resolved via ADR amendment or director script change, or (b) the unpause completes and the question becomes moot.

### Pickup pointer

The Builds 1-6 unpause work and the scout v2 work are parallel tracks. Both close `QUANT_RESEARCH_PAUSED_2026_04_22_BUILDS_1_6_GATED_V1` *partially*; neither alone closes it fully. Scout v2 also closes `HYPOTHESIS_GROUNDING_REQUIRED_V1` (ADR-0014 §6) on first cycle.

The scout v2 sentinels from the main handoff (`QRS_SYNTHESIZE_ENDPOINT_GAP_NO_MAC1_TUNNEL_V1`, the 4 ADR-0005-amendment-scope sentinels, the 2 EXTRACT_LLM_CALLS observations) all stay valid — scout v2 is real work worth doing, just not the *unpause* critical path.

The two amendment-1 sentinels (`EXTRACT_HANDOFFS_DOES_NOT_HONOR_ARCHIVED_ON_CREATION_CONVENTION_V1`, `SUBSTRATE_ARCHIVED_BY_FIELD_CONFLATES_ACTOR_AND_METHOD_V1`) also stay valid — convention-ratification work that's separate from both tracks above.

Net: tonight's session ends with three workstreams open, ranked roughly by un-pause leverage: (1) Builds 1-6 [highest leverage to lift pause], (2) scout v2 [parallel quality gate], (3) ADR-0005 amendment cluster [lower priority infrastructure]. The full re-organized plan is being produced as session-close synthesis.

### Cross-references

- Pre-protocol canonical docs read this session, **not yet substrate-canonical** (pre-protocol naming, outside docs/handoffs/):
  - `~/sofar-finance/docs/QUANT-RESEARCH-PAUSE.md`
  - `~/sofar-finance/SOFAR-SESSION-HANDOFF-TUESDAY-APRIL-21-2026.md`
- These could be migrated to substrate via rename-to-handoff-convention + extract_handoffs.py ingest, but that's a separate cleanup decision (changes path-history; deserves explicit moment).
- Toggle script `quant-research-toggle.sh` already substrate-canonical (id 1619, on spark-cfbd at `/home/bot1/scripts/quant-research-toggle.sh`).
- ADR-0004 (Quant-research pause) references this amendment via the new sentinel.
- ADR-0014 §6 (HYPOTHESIS_GROUNDING_REQUIRED_V1) closes when scout v2 ships first cycle — that closure event is parallel-track to the Builds 1-6 unpause work.
