-- 20260706030000_ask_web_replies.sql
--
-- Ask activation item 5 (founder-approved 2026-07-06): share an Ask
-- outside PikTag. Non-members answer on a landing page
-- (pikt.ag/a/<askId>) without signing up; the reply flows BACK into
-- the asker's app (notification + in-app list + one-tap save-as-
-- contact → the existing local-contact promotion loop). North Star
-- line 2 made concrete: outsiders help you, get captured as
-- contacts-with-context, later convert.
--
-- Anonymous writes go through a SECURITY DEFINER RPC with validation
-- (same trust model as the landing pending-connection RPC): honeypot
-- param, length caps, active/expiry check, per-ask reply cap.
-- Idempotent throughout.

-- ── 1. Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.piktag_ask_web_replies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id       uuid NOT NULL REFERENCES public.piktag_asks(id) ON DELETE CASCADE,
  -- Denormalized for the author-only RLS policy (and the deletion
  -- contract: CASCADE to auth.users).
  author_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  replier_name text NOT NULL,
  contact      text NOT NULL,
  message      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ask_web_replies_ask
  ON public.piktag_ask_web_replies (ask_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_web_replies_author
  ON public.piktag_ask_web_replies (author_id, created_at DESC);

ALTER TABLE public.piktag_ask_web_replies ENABLE ROW LEVEL SECURITY;

-- Replies carry PII (contact info a non-member typed for the asker's
-- eyes) — ONLY the ask author reads/deletes. No INSERT policy at all:
-- writes go exclusively through the DEFINER RPC below.
DROP POLICY IF EXISTS "ask_web_replies_select_author" ON public.piktag_ask_web_replies;
CREATE POLICY "ask_web_replies_select_author" ON public.piktag_ask_web_replies
  FOR SELECT USING (author_id = auth.uid());
DROP POLICY IF EXISTS "ask_web_replies_delete_author" ON public.piktag_ask_web_replies;
CREATE POLICY "ask_web_replies_delete_author" ON public.piktag_ask_web_replies
  FOR DELETE USING (author_id = auth.uid());

-- ── 2. Public read RPC for the landing page ─────────────────────
-- anon-callable; returns only what the share page renders. Inactive
-- (deleted) asks return nothing; expired asks DO return (page shows
-- an "ended" state) — the author shared the link deliberately.
CREATE OR REPLACE FUNCTION public.get_ask_public(p_ask_id uuid)
RETURNS TABLE(
  title text,
  body text,
  author_name text,
  author_username text,
  author_avatar_url text,
  tag_names text[],
  expires_at timestamptz,
  is_expired boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.title,
    a.body,
    COALESCE(p.full_name, p.username, 'PikTag user'),
    p.username,
    p.avatar_url,
    (SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
       FROM piktag_ask_tags at2 JOIN piktag_tags t ON t.id = at2.tag_id
      WHERE at2.ask_id = a.id),
    a.expires_at,
    a.expires_at <= now()
  FROM piktag_asks a
  LEFT JOIN piktag_profiles p ON p.id = a.author_id
  WHERE a.id = p_ask_id AND a.is_active = true;
$$;
REVOKE ALL ON FUNCTION public.get_ask_public(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ask_public(uuid) TO anon, authenticated;

-- ── 3. Anonymous reply RPC ──────────────────────────────────────
-- p_website is a honeypot: real users never see the field; bots fill
-- it → pretend success, write nothing.
CREATE OR REPLACE FUNCTION public.submit_ask_web_reply(
  p_ask_id  uuid,
  p_name    text,
  p_contact text,
  p_message text,
  p_website text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author uuid;
  v_reply  uuid;
  v_name   text := btrim(COALESCE(p_name, ''));
  v_contact text := btrim(COALESCE(p_contact, ''));
  v_message text := btrim(COALESCE(p_message, ''));
BEGIN
  IF p_website IS NOT NULL AND btrim(p_website) <> '' THEN
    RETURN true; -- honeypot tripped: lie politely
  END IF;

  IF v_name = '' OR length(v_name) > 50
     OR length(v_contact) < 3 OR length(v_contact) > 100
     OR v_message = '' OR length(v_message) > 500 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;

  SELECT a.author_id INTO v_author
  FROM piktag_asks a
  WHERE a.id = p_ask_id AND a.is_active = true AND a.expires_at > now();
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'ask not open' USING ERRCODE = 'P0002';
  END IF;

  IF (SELECT COUNT(*) FROM piktag_ask_web_replies w WHERE w.ask_id = p_ask_id) >= 50 THEN
    RAISE EXCEPTION 'reply cap reached' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO piktag_ask_web_replies (ask_id, author_id, replier_name, contact, message)
  VALUES (p_ask_id, v_author, v_name, v_contact, v_message)
  RETURNING id INTO v_reply;

  -- In-app notification. Non-empty EN body per the notification
  -- contract (i18n on the client is enhancement, not load-bearing).
  IF public.is_notification_category_enabled(v_author, 'ask_web_reply') THEN
    INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
    VALUES (
      v_author,
      'ask_web_reply',
      '',
      v_name || ' replied to your Ask from outside PikTag',
      jsonb_build_object(
        'ask_id', p_ask_id,
        'reply_id', v_reply,
        'replier_name', v_name,
        'source', 'ask_web_reply'
      ),
      false,
      now()
    );
  END IF;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_ask_web_reply(uuid, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_ask_web_reply(uuid, text, text, text, text) TO anon, authenticated;

-- ── 4. Category mapping: ask_web_reply → notif_social ───────────
-- Full recreate of is_notification_category_enabled (latest body =
-- 20260705000000) with ONE added WHEN. Fail-open behavior preserved.
CREATE OR REPLACE FUNCTION public.is_notification_category_enabled(
  p_user_id uuid,
  p_type    text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
  v_enabled  boolean;
BEGIN
  -- Map type → category column. Unknown types are allowed through
  -- (covers admin / system / future notification kinds that haven't
  -- been categorized yet — fail-open by design so a missing case
  -- never silently swallows a real notification).
  v_category := CASE p_type
    WHEN 'follow'              THEN 'notif_social'
    WHEN 'friend'              THEN 'notif_social'
    WHEN 'tag_added'           THEN 'notif_social'
    WHEN 'biolink_click'       THEN 'notif_social'
    WHEN 'invite_accepted'     THEN 'notif_social'
    WHEN 'vibe_shift'          THEN 'notif_social'
    WHEN 'ask_posted'          THEN 'notif_social'
    WHEN 'tag_trending'        THEN 'notif_social'
    WHEN 'contact_sync_nudge'  THEN 'notif_social'
    WHEN 'contact_joined'      THEN 'notif_social'
    WHEN 'ask_web_reply'       THEN 'notif_social'
    WHEN 'recommendation'      THEN 'notif_matches'
    WHEN 'tag_convergence'     THEN 'notif_matches'
    WHEN 'ask_bridge'          THEN 'notif_matches'
    WHEN 'reconnect_suggest'   THEN 'notif_matches'
    WHEN 'tag_combo'           THEN 'notif_matches'
    WHEN 'birthday'            THEN 'notif_memories'
    WHEN 'anniversary'         THEN 'notif_memories'
    WHEN 'on_this_day'         THEN 'notif_memories'
    WHEN 'ask_prompt'          THEN 'notif_memories'
    WHEN 'endorsement_request' THEN 'notif_memories'
    WHEN 'tag_suggest_nudge'   THEN 'notif_memories'
    ELSE NULL
  END;

  IF v_category IS NULL THEN
    RETURN true;
  END IF;

  -- Dynamic column read. COALESCE(..., true) so existing profile
  -- rows that pre-date this migration (column literally not yet
  -- populated for them) default to opted-in.
  EXECUTE format(
    'SELECT COALESCE(%I, true) FROM public.piktag_profiles WHERE id = $1',
    v_category
  ) INTO v_enabled USING p_user_id;

  RETURN COALESCE(v_enabled, true);
END;
$$;
