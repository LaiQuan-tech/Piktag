-- 20260702170000_tag_suggest_nudge.sql
--
-- Every-3-days AI tag-suggestion push (founder, 2026-07-02): suggest tags
-- the user could ADD to their own profile so it's more complete and more
-- searchable by the people they want to be found by. Feeds the North Star
-- directly — more high-quality self-tags = a bigger matchable surface for
-- search / Ask / recommendations.
--
-- Founder-locked decisions:
--   * UNIVERSAL cadence — every user, every 3 days (no health gating; the
--     "zero good suggestions -> skip" rule is the noise valve).
--   * Lock-screen push copy FOLLOWS THE USER'S APP LANGUAGE (new
--     piktag_profiles.app_language, synced by the client; the edge fn
--     holds the 19-locale template map).
--   * Suggestions are AI-generated (suggest-tags person-mode brain).
--   * Copy names the actual tags ("#PM #hiking #coffee — add them so the
--     right people can find you"). Statement form, no emoji.
--
-- This migration ships the DB half:
--   1. (no new column) — push localization reads the EXISTING
--      piktag_profiles.language column. Settings has always synced it on
--      explicit change (handleLanguageChange); the client now ALSO syncs
--      it from live i18n at auth-ready, closing the historical gap where
--      never-opened-Settings users sat on the Studio DEFAULT 'en'.
--   2. piktag_ai_tag_suggestions.source CHECK gains 'push_nudge'
--   3. is_notification_category_enabled(): tag_suggest_nudge -> notif_memories
--   4. select_tag_nudge_due_users(p_limit): one-RPC feed for the edge fn
--   5. trigger_tag_suggest_nudge(): vault + net.http_post wrapper
--   6. pg_cron daily 16:00 UTC — a free slot (birthday 08:00,
--      anniversary 08:05, contract 08:10, recommendation 09:30,
--      contact-sync 17:30, linker 18:00, endorsement 19:00) that lands
--      9am PT / noon ET: a natural "polish your profile" morning moment
--      for the NA-first market.
--
-- The edge function `notification-tag-suggest` (same push) does the AI +
-- insert + Expo push half. Client 4-point checklist lands in the same
-- commit (KNOWN_NOTIFICATION_TYPES / memories tab / i18n x19 / router).
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / constraint swap guarded.

-- ── 2. piktag_ai_tag_suggestions.source += 'push_nudge' ────────────
-- The original inline CHECK (20260529040000) renders as
-- `source = ANY (ARRAY[...])` in pg_get_constraintdef. Drop whatever
-- check constrains `source` (name-agnostic — the auto-generated name is
-- piktag_ai_tag_suggestions_source_check but don't bet on it), then
-- re-add with the new value. Guarded loop = idempotent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.piktag_ai_tag_suggestions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%source = ANY%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.piktag_ai_tag_suggestions DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.piktag_ai_tag_suggestions
  ADD CONSTRAINT piktag_ai_tag_suggestions_source_check CHECK (source IN (
    'suggest_tags_rpc',   -- AddTagScreen's suggest-tags edge fn
    'card_scan',          -- card-scan flow AI tag extraction
    'bio_extract',        -- profile-bio derived suggestions
    'connection_context', -- post-connect "you might also tag"
    'push_nudge'          -- every-3-days profile tag-suggestion push
  ));

-- ── 3. Category mapping: tag_suggest_nudge -> notif_memories ──────
-- Verbatim reproduction of the CURRENT function — which lives in
-- 20260605020000_contact_sync_nudge.sql (NOT the original 20260530000000;
-- the contact-sync migration already CREATE OR REPLACEd it to add its
-- own type — reproducing the older version here would silently drop
-- contact_sync_nudge's social mapping) — plus ONE new WHEN.
-- (memories = "time-based reminders + system prompts that aren't
-- directly social" — same bucket as ask_prompt / endorsement_request.)
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

REVOKE ALL ON FUNCTION public.is_notification_category_enabled(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_notification_category_enabled(uuid, text)
  TO authenticated, service_role;

-- ── 4. Due-user feed for the edge function ─────────────────────────
-- One RPC returns everything the edge fn needs per user, so the fn does
-- exactly one DB round-trip before the Gemini fan-out and the selection
-- logic stays SQL-testable.
--   * every non-official, onboarded user
--   * 3-day pacing via NOT EXISTS on this notification type
--   * existing_tags: ALL the user's tags incl. private (never suggest a
--     tag they already carry anywhere)
--   * removed_tags: principle #6 — self_unstag + ai_dismissed only
--     (friend_withdraw deliberately excluded, same as
--     get_my_removed_tag_names; that RPC itself is auth.uid()-scoped so
--     the server path re-implements the filter here)
--   * recent_suggested: don't re-pitch a tag pushed in the last 30 days
--     (otherwise the same 3 tags arrive every 3 days = spam)
CREATE OR REPLACE FUNCTION public.select_tag_nudge_due_users(p_limit int DEFAULT 50)
RETURNS TABLE (
  user_id          uuid,
  bio              text,
  full_name        text,
  headline         text,
  language         text,
  push_token       text,
  existing_tags    text[],
  removed_tags     text[],
  recent_suggested text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.bio,
    p.full_name,
    p.headline,
    COALESCE(p.language, 'en'),
    p.push_token,
    COALESCE((
      SELECT array_agg(DISTINCT t.name)
      FROM piktag_user_tags ut
      JOIN piktag_tags t ON t.id = ut.tag_id
      WHERE ut.user_id = p.id
    ), '{}'::text[]),
    COALESCE((
      SELECT array_agg(DISTINCT t2.name)
      FROM piktag_tag_removals r
      JOIN piktag_tags t2 ON t2.id = r.tag_id
      WHERE r.user_id = p.id
        AND r.source IN ('self_unstag', 'ai_dismissed')
    ), '{}'::text[]),
    COALESCE((
      SELECT array_agg(DISTINCT s.tag_name)
      FROM piktag_ai_tag_suggestions s
      WHERE s.user_id = p.id
        AND s.source = 'push_nudge'
        AND s.created_at > now() - interval '30 days'
    ), '{}'::text[])
  FROM piktag_profiles p
  WHERE p.is_official = false
    AND p.onboarding_completed = true
    -- New-user grace: day-one users are still in the cold-start card
    -- flow; let the product breathe before the first nudge.
    AND p.created_at < now() - interval '2 days'
    -- SPEND GUARD: an opted-out user's INSERT is silently cancelled by
    -- the category gate, so they never accrue a pacing row — without
    -- this pre-filter they'd be selected (and Gemini-billed) EVERY day
    -- forever. Mirror the gate's memories mapping here.
    AND COALESCE(p.notif_memories, true) = true
    -- Tag-cap guard: EditProfile hides the AI chip row at 10 tags, so
    -- a nudge for a capped user lands on chips whose tap can't add.
    AND (
      SELECT COUNT(*) FROM piktag_user_tags ut2 WHERE ut2.user_id = p.id
    ) < 10
    -- Quality floor (NOT profile-health gating): the person prompt with
    -- only a name manufactures junk. Require at least a bio or one
    -- public tag so the model has something real to work from.
    AND (
      COALESCE(btrim(p.bio), '') <> ''
      OR EXISTS (
        SELECT 1 FROM piktag_user_tags ut3
        WHERE ut3.user_id = p.id AND ut3.is_private = false
      )
    )
    -- Pacing: every 3 days per user.
    AND NOT EXISTS (
      SELECT 1 FROM piktag_notifications n
      WHERE n.user_id = p.id
        AND n.type = 'tag_suggest_nudge'
        AND n.created_at > now() - interval '3 days'
    )
  -- Fair rotation: least-recently-nudged first (never-nudged before
  -- everyone), so users whose suggestions all filtered out (they leave
  -- no pacing row) can't permanently starve the back of the queue.
  ORDER BY (
    SELECT max(n2.created_at) FROM piktag_notifications n2
    WHERE n2.user_id = p.id AND n2.type = 'tag_suggest_nudge'
  ) ASC NULLS FIRST, p.created_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.select_tag_nudge_due_users(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_tag_nudge_due_users(int)
  TO postgres, service_role;

-- ── 5. Cron wrapper: vault secrets + HTTP POST to the edge fn ──────
-- Unlike the recommendation flow (SQL inserts, edge fn only pushes), the
-- generation here NEEDS Gemini, so everything lives in the edge fn and
-- the cron just pokes it. Same vault names as 20260422 chat-push vault.
CREATE OR REPLACE FUNCTION public.trigger_tag_suggest_nudge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_key text;
  v_base_url text;
BEGIN
  SELECT decrypted_secret INTO v_auth_key
    FROM vault.decrypted_secrets WHERE name = 'piktag_service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'piktag_supabase_url' LIMIT 1;

  IF v_auth_key IS NULL OR v_base_url IS NULL THEN
    RAISE WARNING 'trigger_tag_suggest_nudge: vault secrets missing — run skipped';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_base_url || '/functions/v1/notification-tag-suggest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_auth_key
    ),
    body    := jsonb_build_object('mode', 'run')
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trigger_tag_suggest_nudge failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_tag_suggest_nudge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_tag_suggest_nudge()
  TO postgres, service_role;

-- ── 6. Schedule: daily 09:00 UTC ───────────────────────────────────
-- Daily run + the per-user 3-day NOT EXISTS = "every 3 days per user",
-- self-staggering, and any user missed by a run's LIMIT is picked up
-- the next day.
DO $cron$
BEGIN
  PERFORM cron.unschedule('tag-suggest-nudge-daily');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job" — fine on first install.
  NULL;
END
$cron$;

SELECT cron.schedule(
  'tag-suggest-nudge-daily',
  '0 16 * * *',
  $cmd$ SELECT public.trigger_tag_suggest_nudge(); $cmd$
);
