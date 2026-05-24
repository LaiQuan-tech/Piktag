-- 20260525000000_local_contact_tag_promotion_and_search_cjk.sql
--
-- Two related fixes for natural-language search, both surfaced by the
-- same launch query "我想找養貓的朋友" / 「我要找做不動產的人」:
--
-- 1) `search_users` RPC gets CJK single-character decomposition.
--    Without this, Gemini's compound output "養貓" never matches the
--    short DB tag "貓派" via ILIKE — there's no substring overlap. By
--    also adding each individual CJK character as a search term, the
--    "貓" char bridges "養貓" (Gemini intent) ↔ "貓派" (canonical tag).
--    English / mixed terms behave exactly as before.
--
-- 2) Local-contact tags (text strings the viewer hand-typed on a
--    non-member friend's contact card) get promoted to canonical
--    piktag_tags rows. Without this, the SearchScreen contacts query
--    short-circuits whenever the typed tag isn't yet canonical:
--    `allTagNames = []` → `.overlaps('tags', allTagNames)` is skipped
--    → the contact never surfaces. Promotion is two-pass:
--    (a) one-off backfill of the existing rows
--    (b) trigger that auto-promotes any new tag string going forward
--    Together this guarantees "the same string the user typed is
--    findable" — the only invariant that the search code relies on.
--
-- Idempotent — safe to re-run. The trigger uses ON CONFLICT DO NOTHING
-- + the lower(name) pre-filter to avoid the unique-index race; both
-- the function and the trigger use CREATE OR REPLACE / DROP-then-CREATE.

-- ─── 1. search_users with CJK decomposition ────────────────────────
CREATE OR REPLACE FUNCTION public.search_users(p_query text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, is_verified boolean, matched_tag_count integer, match_score integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  q AS (
    SELECT btrim(replace(p_query, '#', '')) AS qtext
  ),
  -- Raw whitespace-split terms (original behaviour).
  raw_terms AS (
    SELECT DISTINCT btrim(piece) AS term
    FROM q,
         LATERAL regexp_split_to_table(q.qtext, '\s+') AS piece
    WHERE btrim(piece) <> ''
    LIMIT 6
  ),
  -- CJK char decomposition: for each pure-CJK multi-char term (2-6
  -- CJK chars), ALSO include each individual character as a search
  -- term. Bridges Gemini compound output ("養貓") ↔ short DB tag
  -- names ("貓派"); without this, ILIKE '%養貓%' misses "貓派"
  -- entirely. Non-CJK terms (English, mixed) are unchanged.
  -- Range 一-鿿 covers CJK Unified Ideographs (common Chinese / Kanji).
  cjk_decomp AS (
    SELECT substring(rt.term FROM i FOR 1) AS term
    FROM raw_terms rt, generate_series(1, length(rt.term)) AS i
    WHERE rt.term ~ '^[一-鿿]{2,6}$'
  ),
  terms AS (
    SELECT term FROM raw_terms
    UNION
    SELECT term FROM cjk_decomp WHERE term ~ '[一-鿿]'
    LIMIT 12
  ),
  name_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    WHERE EXISTS (
      SELECT 1 FROM terms te WHERE t.name ILIKE '%' || te.term || '%'
    )
    ORDER BY t.usage_count DESC
    LIMIT 30
  ),
  alias_concepts AS (
    SELECT DISTINCT a.concept_id
    FROM tag_aliases a
    WHERE EXISTS (
      SELECT 1 FROM terms te WHERE a.alias ILIKE '%' || te.term || '%'
    )
    LIMIT 10
  ),
  alias_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    JOIN alias_concepts ac ON ac.concept_id = t.concept_id
  ),
  sibling_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    JOIN name_tags nt ON nt.concept_id IS NOT NULL AND nt.concept_id = t.concept_id
  ),
  matched_tags AS (
    SELECT id FROM name_tags
    UNION
    SELECT id FROM alias_tags
    UNION
    SELECT id FROM sibling_tags
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM piktag_blocks WHERE blocker_id = auth.uid()
    UNION
    SELECT blocker_id AS uid FROM piktag_blocks WHERE blocked_id = auth.uid()
  ),
  candidate_tags AS (
    SELECT DISTINCT ut.user_id, ut.tag_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM matched_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
  ),
  per_user AS (
    SELECT user_id, COUNT(*)::int AS matched_tag_count
    FROM candidate_tags
    GROUP BY user_id
  )
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.is_verified,
    pu.matched_tag_count,
    pu.matched_tag_count * 10 + (CASE WHEN p.is_verified THEN 1 ELSE 0 END) AS match_score
  FROM per_user pu
  JOIN piktag_profiles p ON p.id = pu.user_id
  WHERE p.is_public = true
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$function$;

-- ─── 2. Backfill: promote existing local-contact tags ──────────────
-- The lower(name) pre-filter dodges the unique index on lower(name);
-- ON CONFLICT (name) DO NOTHING handles the direct-name unique constraint.
INSERT INTO public.piktag_tags (name, usage_count)
SELECT DISTINCT t, 0
FROM public.piktag_local_contacts, unnest(tags) AS t
WHERE length(btrim(t)) > 0
  AND length(t) <= 50
  AND NOT EXISTS (
    SELECT 1 FROM public.piktag_tags pt
    WHERE lower(pt.name) = lower(t)
  )
ON CONFLICT (name) DO NOTHING;

-- ─── 3. Trigger: auto-promote new local-contact tag strings ────────
-- Runs AFTER INSERT or UPDATE of `tags` on piktag_local_contacts.
-- SECURITY DEFINER lets it write to piktag_tags regardless of the
-- caller's role; the function is owner-private (RLS on piktag_tags
-- already restricts INSERT to authenticated users, so this trigger's
-- impact is bounded to rows the caller is allowed to write anyway).
CREATE OR REPLACE FUNCTION public.promote_local_contact_tags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tags IS NULL OR array_length(NEW.tags, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.piktag_tags (name, usage_count)
  SELECT DISTINCT t, 0
  FROM unnest(NEW.tags) AS t
  WHERE length(btrim(t)) > 0
    AND length(t) <= 50
    AND NOT EXISTS (
      SELECT 1 FROM public.piktag_tags pt
      WHERE lower(pt.name) = lower(t)
    )
  ON CONFLICT (name) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_local_contact_tags ON public.piktag_local_contacts;
CREATE TRIGGER trg_promote_local_contact_tags
  AFTER INSERT OR UPDATE OF tags ON public.piktag_local_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_local_contact_tags();
