-- Tag Concepts + Aliases Migration
-- Enables semantic tag merging: "天上聖母" = "媽祖" = "Mazu"

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create tag_concepts table (canonical semantic concepts)
CREATE TABLE IF NOT EXISTS tag_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text UNIQUE NOT NULL,
  semantic_type text,
  embedding vector(3072),
  usage_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tag_concepts_canonical ON tag_concepts(canonical_name);
CREATE INDEX IF NOT EXISTS idx_tag_concepts_semantic_type ON tag_concepts(semantic_type);
-- NOTE: ivfflat index requires existing data. Run this AFTER embeddings are populated:
-- CREATE INDEX idx_tag_concepts_embedding ON tag_concepts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Create tag_aliases table (many aliases → one concept)
CREATE TABLE IF NOT EXISTS tag_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text UNIQUE NOT NULL,
  concept_id uuid NOT NULL REFERENCES tag_concepts(id) ON DELETE CASCADE,
  language text DEFAULT 'zh-TW',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tag_aliases_alias ON tag_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_tag_aliases_concept ON tag_aliases(concept_id);

-- 4. Add concept_id to piktag_tags
ALTER TABLE piktag_tags
  ADD COLUMN IF NOT EXISTS concept_id uuid REFERENCES tag_concepts(id);

CREATE INDEX IF NOT EXISTS idx_piktag_tags_concept ON piktag_tags(concept_id);

-- 5. Migrate existing tags → create 1:1 concepts + aliases
INSERT INTO tag_concepts (canonical_name, semantic_type, usage_count, created_at)
SELECT t.name, t.semantic_type, t.usage_count, t.created_at
FROM piktag_tags t
WHERE NOT EXISTS (
  SELECT 1 FROM tag_concepts c WHERE c.canonical_name = t.name
)
ON CONFLICT (canonical_name) DO NOTHING;

-- Link existing tags to their concepts
UPDATE piktag_tags t
SET concept_id = c.id
FROM tag_concepts c
WHERE c.canonical_name = t.name
  AND t.concept_id IS NULL;

-- Create aliases for existing tags (canonical name = alias)
INSERT INTO tag_aliases (alias, concept_id)
SELECT c.canonical_name, c.id
FROM tag_concepts c
WHERE NOT EXISTS (
  SELECT 1 FROM tag_aliases a WHERE a.alias = c.canonical_name
)
ON CONFLICT (alias) DO NOTHING;

-- Also create aliases from existing piktag_tags.aliases[] array
INSERT INTO tag_aliases (alias, concept_id)
SELECT unnest(t.aliases), c.id
FROM piktag_tags t
JOIN tag_concepts c ON c.id = t.concept_id
WHERE t.aliases IS NOT NULL AND array_length(t.aliases, 1) > 0
ON CONFLICT (alias) DO NOTHING;

-- 6. Function: resolve tag alias → concept_id
CREATE OR REPLACE FUNCTION resolve_tag_alias(input_text text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result_concept_id uuid;
BEGIN
  -- Exact alias match (case-insensitive)
  SELECT concept_id INTO result_concept_id
  FROM tag_aliases
  WHERE lower(alias) = lower(input_text)
  LIMIT 1;

  RETURN result_concept_id;
END;
$$;

-- 7. Function: find similar concepts by embedding
CREATE OR REPLACE FUNCTION find_similar_concepts(
  query_embedding vector(3072),
  similarity_threshold float DEFAULT 0.85,
  max_results int DEFAULT 5
)
RETURNS TABLE (
  concept_id uuid,
  canonical_name text,
  semantic_type text,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS concept_id,
    c.canonical_name,
    c.semantic_type,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM tag_concepts c
  WHERE c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT max_results;
END;
$$;

-- 8. Function: get tag by concept (find the primary piktag_tags record for a concept)
CREATE OR REPLACE FUNCTION get_tag_by_concept(input_concept_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result_tag_id uuid;
BEGIN
  SELECT id INTO result_tag_id
  FROM piktag_tags
  WHERE concept_id = input_concept_id
  ORDER BY usage_count DESC
  LIMIT 1;

  RETURN result_tag_id;
END;
$$;

-- 9. RLS policies
ALTER TABLE tag_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_aliases ENABLE ROW LEVEL SECURITY;

-- Everyone can read concepts and aliases
CREATE POLICY "tag_concepts_select" ON tag_concepts FOR SELECT USING (true);
CREATE POLICY "tag_aliases_select" ON tag_aliases FOR SELECT USING (true);

-- Authenticated users can insert concepts and aliases
CREATE POLICY "tag_concepts_insert" ON tag_concepts FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tag_aliases_insert" ON tag_aliases FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Only service role can update/delete (admin operations)
CREATE POLICY "tag_concepts_update" ON tag_concepts FOR UPDATE
  USING (auth.role() = 'service_role');
CREATE POLICY "tag_aliases_update" ON tag_aliases FOR UPDATE
  USING (auth.role() = 'service_role');
