-- 20260530100000_notifications_unique_constraint_sweep.sql
--
-- Sweep follow-up after 20260530090000 fixed notify_tag_convergence.
-- That migration patched ONE call site (the trigger function) by
-- repeating `WHERE ref_id IS NOT NULL` inside its ON CONFLICT to match
-- the partial unique index. A grep across DB functions + edge functions
-- found SEVEN more upsert sites with the same bare
-- `ON CONFLICT (user_id, type, ref_id)` spec — all of them would
-- silently 42P10 against the partial index every time they fired:
--
-- DB functions (plpgsql, fire from cron):
--   - enqueue_on_this_day_notifications  (daily-on-this-day cron tick)
--   - enqueue_reconnect_notifications    (weekly reconnect-suggest)
--   - enqueue_tag_combo_notifications    (weekly tag-combo digest)
--   - notify_ask_bridges                 (AI ask-bridge)
--
-- Edge functions (PostgREST onConflict: 'user_id,type,ref_id'):
--   - weekly-reconnect-nudge   (supabase/functions/weekly-reconnect-nudge)
--   - daily-on-this-day        (supabase/functions/daily-on-this-day)
--   - weekly-tag-combo-digest  (supabase/functions/weekly-tag-combo-digest)
--
-- PostgREST upserts can't repeat a WHERE predicate, so the trigger-style
-- "add WHERE to ON CONFLICT" fix used in 20260530090000 doesn't scale.
-- Instead this migration changes the index itself:
--
--   1. CREATE a regular (non-partial) unique constraint on
--      (user_id, type, ref_id). Postgres treats NULLs as DISTINCT in
--      unique constraints by default, so multiple rows with NULL
--      ref_id are still allowed — functionally identical to the
--      previous `WHERE ref_id IS NOT NULL` partial behaviour for our
--      use case.
--
--   2. DROP the old partial index now that the regular constraint
--      covers the same enforcement.
--
--   3. CREATE OR REPLACE notify_tag_convergence to drop the WHERE
--      predicate from its ON CONFLICT (no longer needed; would in fact
--      break because there's no partial index to match anymore).
--
-- Pre-flight check (run during diagnosis 2026-05-30) showed zero
-- duplicate (user_id, type, ref_id) rows with non-NULL ref_id — safe
-- to add the constraint without backfill cleanup.
--
-- daily-birthday-check uses a different conflict tuple
-- (user_id, type, title) — NO matching index exists at all, so its
-- upsert ALSO silently fails. That's a separate fix (either add a
-- constraint or change the edge fn to use ref_id) tracked outside
-- this migration to keep the blast radius scoped.
--
-- Idempotent: DROP / ADD CONSTRAINT IF [NOT] EXISTS, DROP INDEX IF
-- EXISTS, CREATE OR REPLACE FUNCTION. CI auto-applies on push.

-- ── 1. Regular unique constraint ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.piktag_notifications'::regclass
      AND conname = 'piktag_notifications_user_type_refid_key'
  ) THEN
    ALTER TABLE public.piktag_notifications
      ADD CONSTRAINT piktag_notifications_user_type_refid_key
        UNIQUE (user_id, type, ref_id);
  END IF;
END $$;

-- ── 2. Drop the now-redundant partial index ────────────────────────
DROP INDEX IF EXISTS public.idx_notif_user_type_refid;

-- ── 3. Restore notify_tag_convergence without the WHERE predicate ──
-- (The WHERE in 20260530090000 was matching the partial index; now
-- the regular constraint matches a bare ON CONFLICT cleanly.)
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
  ON CONFLICT (user_id, type, ref_id) DO NOTHING;

  RETURN NEW;
END;
$$;
