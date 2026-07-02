-- 20260702160000_drop_legacy_zh_notification_triggers.sql
--
-- Founder-reported (2026-07-02, English-UI smoke test): every follow
-- produced TWO bell rows — the current i18n one ("haha started
-- following you", data carries actor_user_id/username, tap routes) AND
-- a hardcoded-Chinese duplicate ("新的追蹤者 / X 開始追蹤你", data
-- carries ONLY follower_id). The zh row (a) duplicates the event,
-- (b) renders Chinese in a non-Chinese UI (no data.username, so the
-- client can't i18n-render and falls back to the DB body), and (c)
-- dead-ends on tap (notificationRouter probes actor_user_id/
-- connected_user_id/... but follower_id was never a probed key).
--
-- Archaeology: these rows come from DASHBOARD-ERA trigger functions
-- that predate the migrations system entirely — no CREATE exists in
-- any migration (notify_mutual_follow only appears once, being
-- search_path-hardened by 20260429190000). When the current
-- notification triggers landed (20260428120001 trg_notify_follow and
-- friends) nobody dropped the prehistoric ones, so both have fired on
-- every event since. Three legacy families are live:
--
--   type            title         30d rows   visible?
--   follow          新的追蹤者     57         yes — the duplicate row
--   mutual_follow   成為好友       10         NO (in no bell tab; type
--                                             not in filterNotifications)
--   shared_tag      共同標籤       26         NO (same)
--
-- The invisible two are pure garbage; the follow one is the founder's
-- triple symptom. The current system already covers every one of
-- these moments (trg_notify_follow → 'follow', the notify_friend
-- handshake → 'friend', tag_convergence → the "friends share this
-- tag" moment), and a repo-wide grep found ZERO consumers of the
-- mutual_follow / shared_tag types. Safe to drop outright.
--
-- We drop by FUNCTION SOURCE fingerprint (the hardcoded zh literals)
-- rather than by name because the dashboard-era trigger/function
-- names were never recorded anywhere in the repo. No current function
-- contains these literals — current triggers write English SQL
-- fallbacks ("started following you", "you are now friends") and the
-- zh strings only ever appear in migration COMMENTS (not in prosrc).
--
-- Idempotent: re-running finds nothing to drop and the DELETEs match
-- zero rows.

DO $$
DECLARE
  r record;
BEGIN
  -- 1. Drop every trigger whose function body carries a legacy zh
  --    notification literal.
  FOR r IN
    SELECT DISTINCT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND (
        p.prosrc LIKE '%新的追蹤者%'
        OR p.prosrc LIKE '%開始追蹤你%'
        OR p.prosrc LIKE '%成為好友%'
        OR p.prosrc LIKE '%共同標籤%'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tgname, r.relname);
    RAISE NOTICE 'dropped legacy zh notification trigger % on %', r.tgname, r.relname;
  END LOOP;

  -- 2. Drop the now-orphaned trigger functions (same fingerprint).
  --    Guard on "no remaining trigger references" so a fingerprint
  --    false-positive could never break a live trigger.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      AND (
        p.prosrc LIKE '%新的追蹤者%'
        OR p.prosrc LIKE '%開始追蹤你%'
        OR p.prosrc LIKE '%成為好友%'
        OR p.prosrc LIKE '%共同標籤%'
      )
      AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid)
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    RAISE NOTICE 'dropped legacy zh notification function %', r.sig;
  END LOOP;
END $$;

-- 3. Purge the rows those triggers left behind.
--    * legacy follow duplicates: exact-duplicate of a same-instant
--      current-style 'follow' row, so nothing is lost;
--    * mutual_follow / shared_tag: types no bell tab can display;
--    * search_digest: the retired weekly-digest push (feature removed,
--      rows invisible) — cleaned while we're here.
DELETE FROM public.piktag_notifications
WHERE type = 'follow' AND title = '新的追蹤者';

DELETE FROM public.piktag_notifications
WHERE type IN ('mutual_follow', 'shared_tag', 'search_digest');
