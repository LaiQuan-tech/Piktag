-- 20260624000000_biolink_click_source_and_admin_stats.sql
--
-- Two related changes around piktag_biolink_clicks (icon/link click stats):
--
-- 1. Add a `source` column so we can tell WHERE a click happened:
--      * 'friend_detail' — a logged-in user tapped a FRIEND's link (the
--        only path that recorded clicks until now; existing rows backfill
--        to this).
--      * 'user_detail'   — a viewer tapped a link on a scanned / public /
--        not-yet-friend profile (the strategically valuable install-funnel
--        click that was NOT being recorded before; mobile now inserts it).
--      * NULL / 'web'    — anonymous public web profile hits (anon RLS
--        insert path already exists via referer/user_agent; left as-is).
--
-- 2. Gate notify_biolink_click(): record EVERY click for stats, but only
--    NOTIFY the owner for friend-context clicks. Stranger ('user_detail')
--    clicks are recorded silently — turning them into owner notifications
--    (a "warm lead" signal) is a deliberate future product call, not a
--    side effect of adding stats. Friend clicks keep the existing in-app +
--    push behaviour unchanged.
--
-- 3. admin_biolink_click_stats(p_days) — read-only aggregate RPC for the
--    admin backend's new "連結點擊" page (ops data lives in admin, not the
--    user app). Excludes the official @piktag account (counting-surface
--    rule). Service-role granted, SECURITY DEFINER.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / guarded grants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. source column + backfill
-- -----------------------------------------------------------------------------

ALTER TABLE public.piktag_biolink_clicks
  ADD COLUMN IF NOT EXISTS source text;

-- Every pre-existing row was inserted by FriendDetailScreen (the only
-- client path that recorded clicks before this migration).
UPDATE public.piktag_biolink_clicks
   SET source = 'friend_detail'
 WHERE source IS NULL;

-- -----------------------------------------------------------------------------
-- 2. notify_biolink_click() — record-all, notify-friends-only
--    (reproduces 20260428120006 verbatim + the user_detail early-return)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_biolink_click()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner            uuid;
  v_platform         text;
  v_label            text;
  v_clicker_username text;
  v_clicker_avatar   text;
  v_already_exists   boolean;
  v_dedup_window     interval := interval '60 minutes';
  v_body             text;
  v_push_token       text;
  v_auth_key         text;
  v_base_url         text;
BEGIN
  -- 1. Resolve biolink owner + platform/label from the parent biolink row.
  SELECT user_id, platform, label
    INTO v_owner, v_platform, v_label
    FROM public.piktag_biolinks
   WHERE id = NEW.biolink_id;

  -- Defensive: if biolink has been deleted between click and trigger fire.
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Skip self-clicks (owner clicking their own link).
  IF NEW.clicker_user_id IS NOT NULL AND NEW.clicker_user_id = v_owner THEN
    RETURN NEW;
  END IF;

  -- 2b. Stranger-profile clicks (UserDetailScreen, source='user_detail') are
  --     RECORDED for stats but must NOT notify the owner. Only friend-profile
  --     clicks notify. (Opting strangers into a "warm lead" notification is a
  --     future product decision — flip this guard if/when the founder wants it.)
  IF NEW.source = 'user_detail' THEN
    RETURN NEW;
  END IF;

  -- 3. Dedup: same biolink already notified within the 60-min window?
  SELECT EXISTS (
    SELECT 1
      FROM public.piktag_notifications
     WHERE user_id = v_owner
       AND type    = 'biolink_click'
       AND data->>'biolink_id' = NEW.biolink_id::text
       AND created_at > now() - v_dedup_window
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RETURN NEW;
  END IF;

  -- 4. Resolve clicker profile fields (when authenticated).
  IF NEW.clicker_user_id IS NOT NULL THEN
    SELECT COALESCE(username, full_name, ''),
           avatar_url
      INTO v_clicker_username, v_clicker_avatar
      FROM public.piktag_profiles
     WHERE id = NEW.clicker_user_id;
  END IF;

  IF v_clicker_username IS NULL OR v_clicker_username = '' THEN
    v_clicker_username := 'Someone';
  END IF;

  v_body := 'clicked your ' || COALESCE(v_platform, 'bio') || ' link';

  -- 5. Insert notification.
  INSERT INTO public.piktag_notifications (
    user_id, type, title, body, data, is_read, created_at
  )
  VALUES (
    v_owner,
    'biolink_click',
    '',
    v_body,
    jsonb_build_object(
      'clicker_user_id', NEW.clicker_user_id,
      'username',        v_clicker_username,
      'avatar_url',      v_clicker_avatar,
      'biolink_id',      NEW.biolink_id,
      'platform',        v_platform,
      'label',           v_label
    ),
    false,
    now()
  );

  -- 6. Optional Expo push via pg_net using Vault secrets. Failure must never
  --    block the click insert — wrap in BEGIN/EXCEPTION.
  BEGIN
    SELECT push_token
      INTO v_push_token
      FROM public.piktag_profiles
     WHERE id = v_owner;

    IF v_push_token IS NOT NULL AND v_push_token <> '' THEN
      SELECT decrypted_secret INTO v_auth_key
        FROM vault.decrypted_secrets
       WHERE name = 'piktag_service_role_key'
       LIMIT 1;

      SELECT decrypted_secret INTO v_base_url
        FROM vault.decrypted_secrets
       WHERE name = 'piktag_supabase_url'
       LIMIT 1;

      IF v_auth_key IS NOT NULL AND v_base_url IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Accept',        'application/json',
            'Authorization', 'Bearer ' || v_auth_key
          ),
          body    := jsonb_build_object(
            'to',       v_push_token,
            'title',    v_clicker_username,
            'body',     v_body,
            'sound',    'default',
            'priority', 'high',
            'data', jsonb_build_object(
              'type',            'biolink_click',
              'clicker_user_id', NEW.clicker_user_id,
              'biolink_id',      NEW.biolink_id,
              'user_id',         v_owner
            )
          )
        );
      ELSE
        RAISE WARNING
          'notify_biolink_click: vault secrets missing (piktag_service_role_key / piktag_supabase_url)';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_biolink_click push dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_biolink_click() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_biolink_click() TO postgres, service_role;

-- Trigger binding unchanged (still AFTER INSERT) — re-assert idempotently.
DROP TRIGGER IF EXISTS trg_notify_biolink_click ON public.piktag_biolink_clicks;
CREATE TRIGGER trg_notify_biolink_click
AFTER INSERT ON public.piktag_biolink_clicks
FOR EACH ROW EXECUTE FUNCTION public.notify_biolink_click();

-- -----------------------------------------------------------------------------
-- 3. admin_biolink_click_stats(p_days) — read-only aggregate for admin backend
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_biolink_click_stats(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clicks AS (
    SELECT
      c.id,
      c.created_at,
      c.clicker_user_id,
      COALESCE(c.source, 'friend_detail') AS source,
      b.user_id                            AS owner_id,
      b.platform                           AS platform
    FROM public.piktag_biolink_clicks c
    JOIN public.piktag_biolinks   b  ON b.id = c.biolink_id
    JOIN public.piktag_profiles   pr ON pr.id = b.user_id
    -- Exclude the official @piktag account (counting-surface rule).
    WHERE pr.is_official IS NOT TRUE
  )
  SELECT jsonb_build_object(
    'window_days',      p_days,
    'total_clicks',     (SELECT count(*) FROM clicks),
    'clicks_in_window', (SELECT count(*) FROM clicks
                          WHERE created_at > now() - make_interval(days => p_days)),
    'unique_clickers',  (SELECT count(DISTINCT clicker_user_id) FROM clicks
                          WHERE clicker_user_id IS NOT NULL),
    'by_source', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('source', source, 'clicks', n) ORDER BY n DESC)
        FROM (SELECT source, count(*) AS n FROM clicks GROUP BY source) s
    ), '[]'::jsonb),
    'by_platform', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('platform', platform, 'clicks', n) ORDER BY n DESC)
        FROM (
          SELECT platform, count(*) AS n
            FROM clicks
           GROUP BY platform
           ORDER BY count(*) DESC
           LIMIT 30
        ) p
    ), '[]'::jsonb),
    'top_owners', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'user_id',   owner_id,
                 'username',  username,
                 'full_name', full_name,
                 'clicks',    n
               ) ORDER BY n DESC)
        FROM (
          SELECT cl.owner_id, pr.username, pr.full_name, count(*) AS n
            FROM clicks cl
            JOIN public.piktag_profiles pr ON pr.id = cl.owner_id
           GROUP BY cl.owner_id, pr.username, pr.full_name
           ORDER BY count(*) DESC
           LIMIT 25
        ) o
    ), '[]'::jsonb),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', d, 'clicks', n) ORDER BY d)
        FROM (
          SELECT created_at::date AS d, count(*) AS n
            FROM clicks
           WHERE created_at > now() - make_interval(days => p_days)
           GROUP BY created_at::date
        ) dd
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_biolink_click_stats(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_biolink_click_stats(int) TO postgres, service_role;
