# Handoff Amendment — 2026-05-02 Saturday Evening (post-drain bugs)

After the main session handoff, summarizer drain `c1a4ddd6` and earlier `796b5bfa` exited partial. Log inspection revealed three distinct doc-level failure modes that retry-3-times couldn't recover from:

1. `SUMMARIZER_INVALID_JSON_ESCAPE_IN_OUTPUT_V1` — qwen3.6:35b-a3b emitted invalid JSON escape sequence (e.g. `\$` in financial figures). Deterministic at temp=0.2 so retries produced identical broken output. Affects ~1% of docs.

2. `SUMMARIZER_EMPTY_CONTENT_REASONING_MODE_BUG_V1` — same root cause as `DATA_GAP_POPULATOR_REASONING_MODE_BUG_V1`. Model emits output to `message.reasoning` instead of `message.content` when reasoning mode engages. Summarizer's `call_llm` only reads `content`, gets empty string. Affects ~1% of docs.

3. `SUMMARIZER_OUTPUT_TRUNCATED_AT_MAX_TOKENS_V1` — long outputs hit max_tokens cap mid-JSON. Currently 2000 tokens. Retries produce same truncation. Affects ~1% of docs.

Combined: ~3-5 doc failures per ~100-doc drain. Non-fatal but causes `status='partial'` and exit 1.

`SUMMARIZER_NEEDS_REASONING_MODE_PATCH_FROM_GAP_POPULATOR_V1` — apply the same patch we did to data-gap-populator: `reasoning_effort: none` + `think: false` in payload, fall back to `message.reasoning` if content empty, bump max_tokens. Will close #2 and #3. JSON-escape repair (replace bare `\$` etc. before parse) closes #1. ~30 line patch.

Drain state at session end: 182/190 summarized (96%), 8 remaining. Stragglers will be re-attempted by next summarizer run via `WHERE NOT IN observations`.
