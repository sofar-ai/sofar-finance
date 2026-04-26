-- 20260426-substrate-v3-model-pricing.sql
-- Sentinel: SUBSTRATE_V3_MODEL_PRICING
--
-- Populates model.attrs.pricing and model.attrs.capabilities for the
-- LLM models we observe in the codebase + runtime data. This is the
-- canonical pricing table for cost calculations.
--
-- WHY: Embedding prices in SQL queries (CTE/VALUES) makes them brittle —
-- prices change quarterly, new models appear, conditions vary
-- (batch/cache/region multipliers). Storing pricing in model.attrs
-- means: one source of truth, queryable, updatable without touching
-- query SQL.
--
-- All pricing is per million tokens (MTok). Adjust if Anthropic
-- changes rates. Verified April 2026 from anthropic.com/pricing.
--
-- Schema (informal — JSONB allows additions):
--   model.attrs.pricing = {
--     "input_per_mtok": numeric,
--     "output_per_mtok": numeric,
--     "currency": "USD",
--     "verified_date": "YYYY-MM-DD",
--     "source": "anthropic.com/pricing",
--     "batch_discount_pct": 50,         -- if batch API supported
--     "cache_read_multiplier": 0.10,    -- cache reads at 10% of input
--     "cache_write_5min_mult": 1.25,
--     "cache_write_1h_mult": 2.0,
--     "notes": "..."
--   }
--   model.attrs.capabilities = {
--     "context_window_tokens": int,
--     "max_output_tokens": int,
--     "modalities": ["text", "vision", ...],
--     "tool_use": bool,
--     "streaming": bool
--   }
--   model.attrs.aliases = ["opus", "opus-4-7", ...]
--
-- DEPLOY:
--   psql "$NEON_META_URL" -f migrations/20260426-substrate-v3-model-pricing.sql

BEGIN;

-- Helper: upsert a model with pricing + capabilities + aliases
CREATE OR REPLACE FUNCTION _upsert_model_pricing(
  p_name        TEXT,
  p_pricing     JSONB,
  p_caps        JSONB,
  p_aliases     JSONB,
  p_provider    TEXT,
  p_inference_locus TEXT
) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
  v_existing_attrs JSONB;
BEGIN
  SELECT id, attrs INTO v_id, v_existing_attrs
    FROM entities WHERE type='model' AND name=p_name;

  IF v_id IS NULL THEN
    INSERT INTO entities (type, name, attrs, source_ref, extractor, tier, status)
    VALUES (
      'model', p_name,
      jsonb_build_object(
        'pricing',          p_pricing,
        'capabilities',     p_caps,
        'aliases',          p_aliases,
        'provider',         p_provider,
        'inference_locus',  p_inference_locus
      ),
      'migrations/20260426-substrate-v3-model-pricing.sql',
      'manual_seed', 1, 'active'
    ) RETURNING id INTO v_id;
  ELSE
    -- Merge on top of existing attrs (preserve other extractor fields)
    UPDATE entities
       SET attrs = v_existing_attrs
                  || jsonb_build_object(
                    'pricing',         p_pricing,
                    'capabilities',    p_caps,
                    'aliases',         p_aliases,
                    'provider',        p_provider,
                    'inference_locus', p_inference_locus
                  ),
           updated_at = NOW()
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;


-- ─── Anthropic API models ─────────────────────────────────────────────
-- Pricing source: anthropic.com/pricing, verified 2026-04-26
-- Opus 4.x family: $5 input / $25 output per MTok
-- Sonnet 4.x family: $3 input / $15 output per MTok
-- Haiku 4.5+: $1 input / $5 output per MTok

SELECT _upsert_model_pricing(
  'claude-opus-4-7',
  jsonb_build_object(
    'input_per_mtok',        5.0,
    'output_per_mtok',       25.0,
    'currency',              'USD',
    'verified_date',         '2026-04-26',
    'source',                'anthropic.com/pricing',
    'batch_discount_pct',    50,
    'cache_read_multiplier', 0.10,
    'cache_write_5min_mult', 1.25,
    'cache_write_1h_mult',   2.0,
    'notes',                 'released 2026-04-16; same rate as 4.6, but new tokenizer can use up to 35% more tokens'
  ),
  jsonb_build_object(
    'context_window_tokens', 1000000,
    'max_output_tokens',     128000,
    'modalities',            jsonb_build_array('text', 'vision'),
    'tool_use',              true,
    'streaming',             true
  ),
  jsonb_build_array('opus', 'opus-4-7', 'claude-opus-4.7'),
  'anthropic',
  'cloud_anthropic'
);

SELECT _upsert_model_pricing(
  'claude-opus-4-6',
  jsonb_build_object(
    'input_per_mtok', 5.0, 'output_per_mtok', 25.0, 'currency', 'USD',
    'verified_date', '2026-04-26', 'source', 'anthropic.com/pricing',
    'batch_discount_pct', 50, 'cache_read_multiplier', 0.10
  ),
  jsonb_build_object(
    'context_window_tokens', 1000000, 'max_output_tokens', 128000,
    'modalities', jsonb_build_array('text', 'vision'),
    'tool_use', true, 'streaming', true
  ),
  jsonb_build_array('opus-4-6', 'claude-opus-4.6'),
  'anthropic',
  'cloud_anthropic'
);

SELECT _upsert_model_pricing(
  'claude-sonnet-4-6',
  jsonb_build_object(
    'input_per_mtok', 3.0, 'output_per_mtok', 15.0, 'currency', 'USD',
    'verified_date', '2026-04-26', 'source', 'anthropic.com/pricing',
    'batch_discount_pct', 50, 'cache_read_multiplier', 0.10
  ),
  jsonb_build_object(
    'context_window_tokens', 1000000, 'max_output_tokens', 128000,
    'modalities', jsonb_build_array('text', 'vision'),
    'tool_use', true, 'streaming', true
  ),
  jsonb_build_array('sonnet', 'sonnet-4-6'),
  'anthropic',
  'cloud_anthropic'
);

SELECT _upsert_model_pricing(
  'claude-sonnet-4-20250514',
  jsonb_build_object(
    'input_per_mtok', 3.0, 'output_per_mtok', 15.0, 'currency', 'USD',
    'verified_date', '2026-04-26', 'source', 'anthropic.com/pricing',
    'batch_discount_pct', 50, 'cache_read_multiplier', 0.10,
    'notes', 'pinned date-versioned sonnet 4'
  ),
  jsonb_build_object(
    'context_window_tokens', 200000, 'max_output_tokens', 64000,
    'modalities', jsonb_build_array('text', 'vision'),
    'tool_use', true, 'streaming', true
  ),
  jsonb_build_array(),
  'anthropic',
  'cloud_anthropic'
);

SELECT _upsert_model_pricing(
  'claude-haiku-4-5',
  jsonb_build_object(
    'input_per_mtok', 1.0, 'output_per_mtok', 5.0, 'currency', 'USD',
    'verified_date', '2026-04-26', 'source', 'anthropic.com/pricing',
    'batch_discount_pct', 50, 'cache_read_multiplier', 0.10
  ),
  jsonb_build_object(
    'context_window_tokens', 200000, 'max_output_tokens', 64000,
    'modalities', jsonb_build_array('text', 'vision'),
    'tool_use', true, 'streaming', true
  ),
  jsonb_build_array('haiku', 'haiku-4-5'),
  'anthropic',
  'cloud_anthropic'
);


-- ─── Local Ollama models ──────────────────────────────────────────────
-- Pricing: $0 variable cost (local compute, just power/depreciation)
-- Inference locus: where the model is loaded (per cluster topology)

SELECT _upsert_model_pricing(
  'gemma4:26b',
  jsonb_build_object(
    'input_per_mtok', 0.0, 'output_per_mtok', 0.0, 'currency', 'USD',
    'verified_date', '2026-04-26',
    'source', 'local_inference_no_marginal_cost',
    'notes', 'local model on s1 - effectively zero variable cost'
  ),
  jsonb_build_object(
    'context_window_tokens', 262144, 'parameter_size_b', 25.8,
    'quantization', 'Q4_K_M', 'modalities', jsonb_build_array('text')
  ),
  jsonb_build_array(),
  'ollama_local',
  's1'
);

SELECT _upsert_model_pricing(
  'gemma4:31b',
  jsonb_build_object(
    'input_per_mtok', 0.0, 'output_per_mtok', 0.0, 'currency', 'USD',
    'verified_date', '2026-04-26',
    'source', 'local_inference_no_marginal_cost',
    'notes', 'local model; loaded on s1 + s2'
  ),
  jsonb_build_object(
    'context_window_tokens', 262144, 'parameter_size_b', 31.3,
    'quantization', 'Q4_K_M', 'modalities', jsonb_build_array('text')
  ),
  jsonb_build_array(),
  'ollama_local',
  's1'
);

SELECT _upsert_model_pricing(
  'gemma4:e4b',
  jsonb_build_object(
    'input_per_mtok', 0.0, 'output_per_mtok', 0.0, 'currency', 'USD',
    'verified_date', '2026-04-26',
    'source', 'local_inference_no_marginal_cost'
  ),
  jsonb_build_object(
    'context_window_tokens', 131072, 'parameter_size_b', 8.0,
    'quantization', 'Q4_K_M', 'modalities', jsonb_build_array('text')
  ),
  jsonb_build_array(),
  'ollama_local',
  's1'
);

SELECT _upsert_model_pricing(
  'qwen3.6:35b-a3b',
  jsonb_build_object(
    'input_per_mtok', 0.0, 'output_per_mtok', 0.0, 'currency', 'USD',
    'verified_date', '2026-04-26',
    'source', 'local_inference_no_marginal_cost',
    'notes', 'MoE 36B with 3B active per token; loaded on s2'
  ),
  jsonb_build_object(
    'context_window_tokens', 262144, 'parameter_size_b', 36.0,
    'quantization', 'Q4_K_M', 'modalities', jsonb_build_array('text'),
    'architecture', 'qwen35moe', 'active_params_b', 3.0
  ),
  jsonb_build_array(),
  'ollama_local',
  's2'
);

SELECT _upsert_model_pricing(
  'qwen3:235b',
  jsonb_build_object(
    'input_per_mtok', 0.0, 'output_per_mtok', 0.0, 'currency', 'USD',
    'verified_date', '2026-04-26',
    'source', 'local_inference_no_marginal_cost',
    'notes', 'frontier-tier local MoE; loaded on Mac Studio 1 (193GB VRAM)'
  ),
  jsonb_build_object(
    'context_window_tokens', 262144, 'parameter_size_b', 235.1,
    'quantization', 'Q4_K_M', 'modalities', jsonb_build_array('text'),
    'architecture', 'qwen3moe'
  ),
  jsonb_build_array(),
  'ollama_local',
  'mac1'
);


-- Drop the helper function (it was only needed during this migration)
DROP FUNCTION _upsert_model_pricing;


-- Track migration
INSERT INTO migrations_applied (name, applied_at)
VALUES ('20260426-substrate-v3-model-pricing.sql', NOW())
ON CONFLICT (name) DO NOTHING;

COMMIT;

\echo ''
\echo 'Pricing seeded. Verify:'
\echo "  psql \"\$NEON_META_URL\" -c \"SELECT name, attrs->'pricing'->>'input_per_mtok' AS input_per_mtok, attrs->'pricing'->>'output_per_mtok' AS output_per_mtok, attrs->>'inference_locus' AS locus FROM entities WHERE type='model' ORDER BY name;\""
\echo ''
\echo 'To update a price (e.g., when Anthropic changes Opus rates):'
\echo "  UPDATE entities"
\echo "     SET attrs = jsonb_set(attrs, '{pricing,input_per_mtok}', '7.0'::jsonb),"
\echo "         attrs = jsonb_set(attrs, '{pricing,verified_date}', '\"2026-XX-XX\"'::jsonb),"
\echo "         updated_at = NOW()"
\echo "   WHERE type='model' AND name='claude-opus-4-7';"
