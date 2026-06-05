-- 20260605100000_tag_convergence_concept_aware.sql
--
-- Cross-language fix for the tag-convergence magic moment.
--
-- notify_tag_convergence (latest def 20260530090000) fires "你貼了 #X —
-- N 友也是" when a friend already holds the SAME tag. But it matched on
-- `fut.tag_id = NEW.tag_id` — a LITERAL tag_id equality. So if you tag
-- 養貓 and your friend tagged 貓奴 / cat (same tag_concepts.concept_id,
-- different tag_id), the moment NEVER fired — the single most on-thesis
-- surface (people who share a concept across language/wording) was the
-- one silently missing the concept layer.
--
-- FIX: expand NEW.tag_id to its concept siblings (all tags sharing its
-- concept_id) before the friend match. Gated on concept_id IS NOT NULL —
-- a still-unlinked tag falls back to exact tag_id match, so NO regression
-- (an unlinked tag behaves exactly as before until the 5-min linker /
-- sync-alias trigger gives it a concept). Friends are DISTINCT-deduped
-- before counting so a friend who holds two sibling tags counts once.
--
-- Everything else preserved VERBATIM from 20260530090000:
--   * title computation (1 / ≤3 / >3 phrasing)
--   * ≥1 match gate, 50-row cap
--   * data jsonb shape
--   * ON CONFLICT (user_id, type, ref_id) WHERE ref_id IS NOT NULL
--     — the partial-index predicate. DO NOT drop this clause or the
--     42P10 bug (rolled-back tag inserts) from 20260530090000 returns.
--
-- "也是" semantics: the friend shares the CONCEPT (cat-person), not
-- necessarily the identical surface string — which is exactly the
-- product's promise. No copy change needed.

CREATE OR REPLACE FUNCTION public.notify_tag_convergence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_name text;
  v_concept_id uuid;
  v_match_count integer;
  v_preview_names text[];
  v_title text;
BEGIN
  SELECT name, concept_id INTO v_tag_name, v_concept_id
    FROM public.piktag_tags WHERE id = NEW.tag_id;
  IF v_tag_name IS NULL THEN RETURN NEW; END IF;

  WITH friends AS (
    SELECT DISTINCT c.connected_user_id AS friend_id
    FROM public.piktag_connections c
    WHERE c.user_id = NEW.user_id
  ), matched_friends AS (
    -- A friend matches if they hold ANY tag sharing the added tag's
    -- concept (cross-language), or — when the added tag is still
    -- unlinked — the exact same tag_id (unchanged legacy behaviour).
    SELECT DISTINCT f.friend_id
    FROM friends f
    JOIN public.piktag_user_tags fut ON fut.user_id = f.friend_id
    JOIN public.piktag_tags ft ON ft.id = fut.tag_id
    WHERE
      (v_concept_id IS NOT NULL AND ft.concept_id = v_concept_id)
      OR (v_concept_id IS NULL AND fut.tag_id = NEW.tag_id)
  ), matched AS (
    SELECT mf.friend_id, p.full_name, p.username
    FROM matched_friends mf
    JOIN public.piktag_profiles p ON p.id = mf.friend_id
    LIMIT 50
  )
  SELECT COUNT(*)::integer,
         ARRAY_AGG(COALESCE(full_name, username) ORDER BY full_name)
           FILTER (WHERE COALESCE(full_name, username) IS NOT NULL)
  INTO v_match_count, v_preview_names FROM matched;

  IF v_match_count IS NULL OR v_match_count < 1 THEN RETURN NEW; END IF;

  v_title := '你貼了 #' || v_tag_name || ' — ';
  IF v_match_count = 1 THEN
    v_title := v_title || v_preview_names[1] || ' 也是';
  ELSIF v_match_count <= 3 THEN
    v_title := v_title || array_to_string(v_preview_names[1:v_match_count], '、') || ' 也是';
  ELSE
    v_title := v_title || array_to_string(v_preview_names[1:3], '、') || ' + '
               || (v_match_count - 3)::text || ' 人';
  END IF;

  -- `WHERE ref_id IS NOT NULL` mirrors the partial unique index
  -- idx_notif_user_type_refid (see 20260530090000). Keep it.
  INSERT INTO public.piktag_notifications (user_id, type, title, ref_type, ref_id, data)
  VALUES (
    NEW.user_id, 'tag_convergence', v_title, 'tag', NEW.tag_id::text,
    jsonb_build_object(
      'tag_id',        NEW.tag_id,
      'tag_name',      v_tag_name,
      'match_count',   v_match_count,
      'preview_names', to_jsonb(v_preview_names)
    )
  )
  ON CONFLICT (user_id, type, ref_id) WHERE ref_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;
