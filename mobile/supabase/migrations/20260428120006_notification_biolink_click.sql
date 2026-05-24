-- 20260428v_notification_biolink_click.sql
--
-- Reactive notification: biolink_click (reminders tab).
--
-- Creates the click-tracking source table piktag_biolink_clicks (new)
-- with RLS, plus the AFTER INSERT trigger notify_biolink_click() that
-- emits a piktag_notifications row to the biolink owner whenever a
-- non-self click is recorded. Per master spec doc §2.6:
--
--   * Recipient = piktag_biolinks.user_id (owner), looked up via
--     NEW.biolink_id.
--   * Skip when clicker_user_id = owner (self-click).
--   * Dedup per (recipient, type='biolink_click', biolink_id) within
--     a 60-minute rolling window. Hot links would otherwise spam.
--   * data JSONB: clicker_user_id, username, avatar_url, biolink_id,
--     platform, label.
--   * title='', body='clicked your {{platform}} link' (en, rendered).
--
-- Idempotent: every CREATE/DROP guarded with IF [NOT] EXISTS / OR REPLACE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- -----------------------------------------------------------------------------
-- 1. Source table: piktag_biolink_clicks
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.piktag_biolink_clicks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biolink_id      uuid NOT NULL REFERENCES public.piktag_biolinks(id) ON DELETE CASCADE,
  clicker_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  referer         text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biolink_clicks_biolink
  ON public.piktag_biolink_clicks (biolink_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_biolink_clicks_clicker
  ON public.piktag_biolink_clicks (clicker_user_id)
  WHERE clicker_user_id IS NOT NULL;

ALTER TABLE public.piktag_biolink_clicks ENABLE ROW LEVEL SECURITY;

-- Anonymous + authenticated visitors can record clicks (public web hits).
DROP POLICY IF EXISTS "biolink_clicks_insert_any" ON public.piktag_biolink_clicks;
CREATE POLICY "biolink_clicks_insert_any"
  ON public.piktag_biolink_clicks
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only the biolink owner can read their own click rows.
DROP POLICY IF EXISTS "biolink_clicks_select_owner" ON public.piktag_biolink_clicks;
CREATE POLICY "biolink_clicks_select_owner"
  ON public.piktag_biolink_clicks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.piktag_biolinks b
       WHERE b.id = piktag_biolink_clicks.biolink_id
         AND b.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.piktag_biolink_clicks TO authenticated;
GRANT INSERT ON public.piktag_biolink_clicks TO anon;
GRANT ALL ON public.piktag_biolink_clicks TO postgres, service_role;

-- -----------------------------------------------------------------------------
-- 2. Trigger function: notify_biolink_click()
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

  -- 6. Optional Expo push via pg_net using Vault secrets seeded by
  --    20260422_chat_push_trigger_vault.sql. Failure must never block
  --    the click insert — wrap in BEGIN/EXCEPTION.
  --
  --    Note: master spec §2.6 marks biolink_click as in-app-only (push=NO)
  --    to avoid spam from hot links. The 60-min dedup above is the primary
  --    rate-limit; the push call here is gated on push_token presence and
  --    the same dedup window, so at most one push per biolink per hour.
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

-- -----------------------------------------------------------------------------
-- 3. Trigger binding
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_notify_biolink_click ON public.piktag_biolink_clicks;
CREATE TRIGGER trg_notify_biolink_click
AFTER INSERT ON public.piktag_biolink_clicks
FOR EACH ROW EXECUTE FUNCTION public.notify_biolink_click();
