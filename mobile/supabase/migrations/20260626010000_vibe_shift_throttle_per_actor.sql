-- 20260626010000_vibe_shift_throttle_per_actor.sql
-- =============================================================================
-- Fix the vibe_shift notification spam (founder 2026-06-26). vibe_shift fires
-- AFTER INSERT on piktag_user_tags and fans out to the actor's friends when
-- the actor self-tags. The throttle existed but was keyed per
-- (recipient, actor, TAG) — so a new member building their profile with 15
-- DIFFERENT self-tags in a week sent each friend 15 separate notifications
-- (the per-tag weekly guard never collapses distinct tags). New members DO
-- keep adjusting tags (great for the tag-graph), but it became a notification
-- disaster for their friends.
--
-- Two changes (founder-approved 甲+乙), everything else preserved VERBATIM from
-- the live definition in 20260612010000 (concept/official-aware fan-out, body,
-- data jsonb shape, EXCEPTION handler):
--   甲. Throttle PER-ACTOR, not per-tag: drop the `tag_name` match from the
--      dedup EXISTS. A friend now gets AT MOST ONE vibe_shift about a given
--      person per 7 days, no matter how many tags that person added (15 → 1).
--   乙. Stay silent during the actor's initial setup: skip entirely if the
--      actor's account is < 2 days old. The first-days tag-building is
--      profile SETUP, not a vibe "shift" — friends shouldn't be pinged for it.
--      Genuine later changes still notify (once/week per the 甲 cap).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_vibe_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id         uuid := NEW.user_id;
  v_actor_username   text;
  v_actor_full_name  text;
  v_actor_avatar     text;
  v_actor_created_at timestamptz;
  v_actor_display    text;
  v_tag_name         text;
  v_body             text;
  rec                record;
BEGIN
  SELECT t.name INTO v_tag_name
  FROM piktag_tags t
  WHERE t.id = NEW.tag_id;

  IF v_tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT username, full_name, avatar_url, created_at
    INTO v_actor_username, v_actor_full_name, v_actor_avatar, v_actor_created_at
  FROM piktag_profiles
  WHERE id = v_actor_id;

  -- 乙. Initial-setup grace period: a brand-new member's first days of
  -- tag-building is profile SETUP, not a vibe SHIFT — don't ping friends.
  IF v_actor_created_at IS NOT NULL
     AND v_actor_created_at > now() - interval '2 days' THEN
    RETURN NEW;
  END IF;

  v_actor_display := COALESCE(NULLIF(v_actor_username, ''),
                              NULLIF(v_actor_full_name, ''),
                              'A friend');
  v_body := 'added #' || v_tag_name;

  FOR rec IN
    SELECT DISTINCT c.user_id AS recipient_id
    FROM piktag_connections c
    WHERE c.connected_user_id = v_actor_id
      AND c.user_id <> v_actor_id
      AND NOT public.is_official_user(c.user_id)
      AND NOT public.is_official_user(v_actor_id)
  LOOP
    -- 甲. Per-ACTOR weekly throttle (no tag_name match): one vibe_shift about
    -- this person per recipient per 7 days, regardless of how many tags.
    IF EXISTS (
      SELECT 1
      FROM piktag_notifications
      WHERE user_id = rec.recipient_id
        AND type = 'vibe_shift'
        AND data->>'actor_user_id' = v_actor_id::text
        AND created_at > now() - interval '7 days'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO piktag_notifications (
      user_id, type, title, body, data, is_read
    ) VALUES (
      rec.recipient_id,
      'vibe_shift',
      '',
      v_body,
      jsonb_build_object(
        'username',         v_actor_username,
        'avatar_url',       v_actor_avatar,
        'actor_user_id',    v_actor_id,
        'actor_username',   v_actor_username,
        'actor_full_name',  v_actor_full_name,
        'actor_avatar_url', v_actor_avatar,
        'tag_name',         v_tag_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_vibe_shift failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- CREATE OR REPLACE keeps the existing trg_notify_vibe_shift binding; re-assert
-- defensively so this migration is self-contained + idempotent.
DROP TRIGGER IF EXISTS trg_notify_vibe_shift ON public.piktag_user_tags;
CREATE TRIGGER trg_notify_vibe_shift
  AFTER INSERT ON public.piktag_user_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_vibe_shift();

REVOKE ALL ON FUNCTION public.notify_vibe_shift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_vibe_shift() TO postgres, service_role;
