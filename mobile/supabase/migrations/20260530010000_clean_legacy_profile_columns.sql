-- 20260530010000_clean_legacy_profile_columns.sql
--
-- Two pre-launch cleanups on piktag_profiles, both follow-ups to
-- decisions made 2026-05-29 / 30:
--
-- (1) DROP DEFAULT on `language`
--     The column has had DEFAULT 'en' set directly in Supabase
--     Studio (not in any migration — that's why grep finds
--     nothing). Every fresh signup got 'en' written even on
--     Chinese / Japanese / Spanish devices, which the old
--     SettingsScreen would then read back and force-flip the
--     whole app to English the first time the user opened
--     Settings. The client fix (8dd4c24, 2026-05-29) immunizes
--     the app from this — i18n now reads device locale + an
--     AsyncStorage explicit-pick cache, NEVER the DB column.
--     But the DB still silently mis-labels every new row, and
--     downstream features that may later legitimately want to
--     read it (e.g. localized email digests) would be looking
--     at a lie. Drop the default so new rows are honestly NULL.
--
--     We do NOT backfill existing 'en' rows to NULL — there's no
--     reliable signal distinguishing "user actively picked
--     English" from "DB defaulted them". Better to leave their
--     value alone than risk losing a real preference.
--
-- (2) DROP COLUMN `vibe_shift_notifications_enabled`
--     Subsumed by `notif_social` (migration 20260530000000).
--     Until now the notify_vibe_shift trigger AND-ed both flags
--     so an old opt-out still silenced vibe_shift even while the
--     user appeared opted-in to the new Social category. Pre-
--     launch user base is small enough that the legacy opt-outs
--     are negligible; post-launch the column would just be dead
--     weight. Trigger gets re-defined first to remove the column
--     reference, then the column drops cleanly.

-- ── 1. language DEFAULT 'en' → no default ───────────────────────
-- Wrapped in DO block so a CI replay on an environment where the
-- column doesn't exist (shouldn't happen, but defensive) is a
-- no-op rather than a hard error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'piktag_profiles'
      AND column_name  = 'language'
  ) THEN
    ALTER TABLE public.piktag_profiles
      ALTER COLUMN language DROP DEFAULT;
  END IF;
END;
$$;

COMMENT ON COLUMN public.piktag_profiles.language IS
  'User''s last explicitly-picked language code (zh-TW / en / ja /…). '
  'Written by SettingsScreen language picker; NEVER read back into '
  'the client i18n boot (boot reads AsyncStorage + expo-localization). '
  'NULL = never picked. Reserved for future server-side localized '
  'notification rendering.';

-- ── 2a. Re-define notify_vibe_shift without the legacy column ──
-- Same body as 20260513030000 minus the
-- `AND COALESCE(p.vibe_shift_notifications_enabled, true)` filter.
-- All other behavior preserved: 7-day dedup, snapshot actor fields,
-- never block the source INSERT on exception. The BEFORE INSERT
-- gate added in 20260530000000 now handles category opt-out via
-- notif_social — single source of truth.
CREATE OR REPLACE FUNCTION public.notify_vibe_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id        uuid := NEW.user_id;
  v_actor_username  text;
  v_actor_full_name text;
  v_actor_avatar    text;
  v_tag_name        text;
  rec               record;
BEGIN
  SELECT t.name INTO v_tag_name
  FROM piktag_tags t
  WHERE t.id = NEW.tag_id;

  IF v_tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT username, full_name, avatar_url
    INTO v_actor_username, v_actor_full_name, v_actor_avatar
  FROM piktag_profiles
  WHERE id = v_actor_id;

  -- Fan-out to every host who has this user in one of their Vibes.
  -- Category opt-out (notif_social) is enforced by the BEFORE
  -- INSERT trigger on piktag_notifications, not here.
  FOR rec IN
    SELECT DISTINCT c.user_id AS recipient_id
    FROM piktag_connections c
    WHERE c.connected_user_id = v_actor_id
      AND c.user_id <> v_actor_id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM piktag_notifications
      WHERE user_id = rec.recipient_id
        AND type = 'vibe_shift'
        AND data->>'actor_user_id' = v_actor_id::text
        AND lower(data->>'tag_name') = lower(v_tag_name)
        AND created_at > now() - interval '7 days'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO piktag_notifications (
      user_id, type, title, body, data, is_read
    ) VALUES (
      rec.recipient_id,
      'vibe_shift',
      '',  -- title rendered client-side via i18n key
      '',  -- body  rendered client-side via i18n key
      jsonb_build_object(
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
$$;

REVOKE ALL ON FUNCTION public.notify_vibe_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_vibe_shift()
  TO postgres, service_role;

-- The trigger binding from 20260513030000 still points at this
-- function — CREATE OR REPLACE doesn't change the binding.

-- ── 2b. Drop the now-unused column ──────────────────────────────
ALTER TABLE public.piktag_profiles
  DROP COLUMN IF EXISTS vibe_shift_notifications_enabled;
