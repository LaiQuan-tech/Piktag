-- Semantic Tag System Migration
-- Applies Semantic HTML concepts to PikTag's tag system

-- 1a. piktag_tags: rename category → semantic_type, add hierarchy + aliases
ALTER TABLE piktag_tags RENAME COLUMN category TO semantic_type;

ALTER TABLE piktag_tags
  ADD COLUMN IF NOT EXISTS parent_tag_id uuid REFERENCES piktag_tags(id),
  ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}';

-- 1b. piktag_user_tags: add weight + semantic_type override
ALTER TABLE piktag_user_tags
  ADD COLUMN IF NOT EXISTS weight integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semantic_type text;

-- 1c. piktag_connection_tags: add semantic_type
ALTER TABLE piktag_connection_tags
  ADD COLUMN IF NOT EXISTS semantic_type text DEFAULT 'relation';

-- Index for semantic type queries
CREATE INDEX IF NOT EXISTS idx_piktag_tags_semantic_type ON piktag_tags(semantic_type);
CREATE INDEX IF NOT EXISTS idx_piktag_user_tags_semantic_type ON piktag_user_tags(semantic_type);
CREATE INDEX IF NOT EXISTS idx_piktag_tags_parent ON piktag_tags(parent_tag_id);

-- Index for alias search
CREATE INDEX IF NOT EXISTS idx_piktag_tags_aliases ON piktag_tags USING gin(aliases);
