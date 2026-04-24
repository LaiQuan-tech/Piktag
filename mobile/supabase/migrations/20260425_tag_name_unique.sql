-- piktag_tags.name must be globally unique. Without this, two concurrent
-- "select-by-name → insert-if-missing" flows can race and create two rows
-- with the same name, fanning out to duplicate tag chips across profiles.
--
-- We dedupe first so the index creation can't fail on legacy duplicates:
-- keep the oldest row per name (by created_at, falling back to id) and
-- repoint any child rows (piktag_user_tags, piktag_connection_tags) at it,
-- then drop the losers.

BEGIN;

-- 1. Collapse duplicates. `keeper` = oldest row per lowercased name.
WITH ranked AS (
  SELECT
    id,
    name,
    row_number() OVER (
      PARTITION BY lower(name)
      ORDER BY created_at NULLS LAST, id
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY lower(name)
      ORDER BY created_at NULLS LAST, id
    ) AS keeper_id
  FROM piktag_tags
),
losers AS (
  SELECT id, keeper_id FROM ranked WHERE rn > 1
)
-- Repoint user-tag links.
UPDATE piktag_user_tags ut
SET tag_id = l.keeper_id
FROM losers l
WHERE ut.tag_id = l.id;

WITH ranked AS (
  SELECT
    id,
    name,
    row_number() OVER (
      PARTITION BY lower(name)
      ORDER BY created_at NULLS LAST, id
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY lower(name)
      ORDER BY created_at NULLS LAST, id
    ) AS keeper_id
  FROM piktag_tags
),
losers AS (
  SELECT id, keeper_id FROM ranked WHERE rn > 1
)
-- Repoint connection-tag links.
UPDATE piktag_connection_tags ct
SET tag_id = l.keeper_id
FROM losers l
WHERE ct.tag_id = l.id;

-- Drop orphan losers after links are repointed.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(name)
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM piktag_tags
)
DELETE FROM piktag_tags WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Enforce uniqueness going forward. Case-insensitive so "Coffee" and
-- "coffee" collapse into one tag instead of two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_piktag_tags_name_unique
  ON piktag_tags (lower(name));

COMMIT;
