-- 20260425-substrate-v2-nomic.sql (PATCH1)
-- Sentinel: SUBSTRATE_V2_NOMIC
--
-- Migrate embedding column from vector(1024) -> vector(768) for nomic-embed-text.
-- PATCH1: corrected migrations_applied INSERT to use actual column names
--   (name, applied_at — no `filename` or `sentinel` columns exist).
--
-- WHY: bge-m3 has unbounded NaN failures via Ollama's quantized math.
-- nomic-embed-text is the Continue.dev-recommended local default and
-- ranked ADR-0001 #1 on our hardest test query.
--
-- WHAT IT TOUCHES: only the entities.embedding column + its index.
-- All entity rows, attrs, relationships, events are PRESERVED.
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
ALTER TABLE entities DROP COLUMN embedding;
ALTER TABLE entities ADD COLUMN embedding vector(768);

-- Rebuild the HNSW index for cosine similarity at the new dim
CREATE INDEX idx_entities_embedding ON entities
  USING hnsw (embedding vector_cosine_ops);

-- Track in migrations_applied (correct schema: name + applied_at only)
INSERT INTO migrations_applied (name, applied_at)
VALUES ('20260425-substrate-v2-nomic.sql', NOW())
ON CONFLICT (name) DO NOTHING;

COMMIT;

\echo ''
\echo 'Migration applied. Verify column type:'
\d entities
\echo ''
\echo 'Next: re-embed against nomic-embed-text'
\echo '  python3 ~/scripts/embed_entities.py --reembed --verbose'
