-- 20260530090000_fix_notify_tag_convergence_partial_idx.sql
--
-- BUG: Every user adding a tag via EditProfile / ManageTags hit
-- "標籤加不了，待會再試一次。" when at least one of their connections
-- already had that same tag. armand7951 reproduced it 2026-05-30 trying
-- to add a "P…"-prefixed tag while a friend already held #PikTag.
--
-- Root cause: 20260513130000_on_this_day_and_tag_convergence.sql created
-- two things in the same file:
--   (a) a PARTIAL unique index
--       `idx_notif_user_type_refid ON piktag_notifications (user_id, type, ref_id)
--        WHERE ref_id IS NOT NULL`
--   (b) a trigger function notify_tag_convergence() containing
--       `INSERT … ON CONFLICT (user_id, type, ref_id) DO NOTHING`
--
-- Postgres cannot infer a partial unique index from a bare
-- `ON CONFLICT (cols)` — you must repeat the index's predicate inside
-- the ON CONFLICT (`ON CONFLICT (cols) WHERE ref_id IS NOT NULL`).
-- Without that, the planner errors with
--   42P10: there is no unique or exclusion constraint matching the
--   ON CONFLICT specification
-- and because notify_tag_convergence is an AFTER INSERT trigger, the
-- 42P10 propagates back, ROLLBACK-ing the original piktag_user_tags
-- INSERT. The client sees the INSERT failure and surfaces
-- manageTags.alertAddError.
--
-- The trigger only fires when ≥1 friend already has the tag, which is
-- why a fresh account never hits it. armand has 3 connections + 3
-- tags including overlap → consistent failure on the exact code path
-- the founder reported.
--
-- Fix: rewrite the function with the WHERE predicate on ON CONFLICT.
-- All other behaviour preserved verbatim — title computation, ≥1
-- match gate, 50-row LIMIT, friend-search via piktag_connections.
--
-- Idempotent (CREATE OR REPLACE FUNCTION). CI auto-applies on push.

CREATE OR REPLACE FUNCTION public.notify_tag_convergence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_name text;
  v_match_count integer;
  v_preview_names text[];
  v_title text;
BEGIN
  SELECT name INTO v_tag_name FROM public.piktag_tags WHERE id = NEW.tag_id;
  IF v_tag_name IS NULL THEN RETURN NEW; END IF;

  WITH friends AS (
    SELECT DISTINCT c.connected_user_id AS friend_id
    FROM public.piktag_connections c
    WHERE c.user_id = NEW.user_id
  ), matched AS (
    SELECT f.friend_id, p.full_name, p.username
    FROM friends f
    JOIN public.piktag_user_tags fut
      ON fut.user_id = f.friend_id AND fut.tag_id = NEW.tag_id
    JOIN public.piktag_profiles p ON p.id = f.friend_id
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

  -- THE FIX: `WHERE ref_id IS NOT NULL` mirrors the partial unique
  -- index `idx_notif_user_type_refid`. Without this clause Postgres
  -- 42P10s — see migration header for the full story.
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
