-- 20260425-substrate-v2-nomic.sql
-- Sentinel: SUBSTRATE_V2_NOMIC
--
-- Migrate embedding column from vector(1024) -> vector(768) for nomic-embed-text.
--
-- WHY: bge-m3 (1024-dim) has unbounded NaN failures via Ollama's quantized math.
-- We've hit it on 3 entities during full re-embed AND on smoke-test inputs;
-- the failure surface is not bounded. nomic-embed-text (768-dim) is the
-- Continue.dev-recommended local default, ranked ADR-0001 #1 on our hardest
-- test query (others ranked it 2nd-3rd).
--
-- WHAT IT TOUCHES: only the entities.embedding column + its index. All
-- entity rows, attrs, relationships, events, proposals are PRESERVED.
-- Embeddings will be NULL after this; embed_entities.py rebuilds them.
--
-- REVERSIBLE: yes — drop column, recreate as vector(1024), re-embed with bge-m3.
--
-- DEPLOY:
--   psql "$NEON_META_URL" -f migrations/20260425-substrate-v2-nomic.sql

BEGIN;

-- Sanity check: substrate v1 must already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entities' AND column_name = 'embedding'
  ) THEN
    RAISE EXCEPTION 'entities.embedding column not found - substrate-v1 not deployed?';
  END IF;
END $$;

-- Drop the index first (it depends on the column type)
DROP INDEX IF EXISTS idx_entities_embedding;

-- Drop and recreate at 768 dim
-- Note: existing embeddings are dropped. embed_entities.py will rebuild.
ALTER TABLE entities DROP COLUMN embedding;
ALTER TABLE entities ADD COLUMN embedding vector(768);

-- Rebuild the HNSW index for cosine similarity at the new dim
CREATE INDEX idx_entities_embedding ON entities
  USING hnsw (embedding vector_cosine_ops);

-- Track in migrations_applied per ADR-0005 convention
INSERT INTO migrations_applied (filename, sentinel, applied_at)
VALUES ('20260425-substrate-v2-nomic.sql', 'SUBSTRATE_V2_NOMIC', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- Verify
\echo ''
\echo 'Migration applied. Verify column type:'
\d entities
\echo ''
\echo 'Next: re-embed against nomic-embed-text'
\echo '  python3 ~/scripts/embed_entities.py --reembed --verbose'
