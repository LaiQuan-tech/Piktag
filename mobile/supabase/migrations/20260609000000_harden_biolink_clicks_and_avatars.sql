-- 20260609000000_harden_biolink_clicks_and_avatars.sql
-- =============================================================================
-- Two remaining Security Advisor warnings (founder 2026-06-09), both verified
-- safe against the live client code before changing.
--
-- #3 rls_policy_always_true on piktag_biolink_clicks ("biolink_clicks_insert_any"
--    INSERT WITH CHECK true). Anyone could insert a click row attributed to ANY
--    user (fake/spam clicks). Both client insert sites (FriendDetailScreen,
--    ScanResultScreen) only run when logged in and set
--    `clicker_user_id = user.id`; SocialStatsScreen only SELECTs. So tighten the
--    WITH CHECK to "self or anonymous": a click may be attributed to NULL (anon
--    web hit) or to the caller themselves — never to someone else. No insert
--    site breaks.
--
-- #4 public_bucket_allows_listing on the `avatars` bucket (2 broad SELECT
--    policies → clients can list every avatar file). The app reads avatars only
--    via the PUBLIC object URL (/storage/v1/object/public/avatars/...), which
--    bypasses RLS on a public bucket; nothing uses .list()/.download(). So the
--    broad SELECT policies aren't needed for display — drop them, listing is
--    blocked, avatars still render. (avatars_public_read was created in the
--    dashboard, not a migration; DROP IF EXISTS covers both.)
--
-- Idempotent.
-- =============================================================================

-- #3 — biolink_clicks INSERT: self or anonymous only (no impersonating others).
DROP POLICY IF EXISTS "biolink_clicks_insert_any" ON public.piktag_biolink_clicks;
DROP POLICY IF EXISTS "biolink_clicks_insert_self_or_anon" ON public.piktag_biolink_clicks;
CREATE POLICY "biolink_clicks_insert_self_or_anon"
  ON public.piktag_biolink_clicks
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (clicker_user_id IS NULL OR clicker_user_id = auth.uid());

-- #4 — drop the broad SELECT policies that allow listing the public avatars
-- bucket. Public-URL reads (the only way the app reads avatars) are unaffected.
DROP POLICY IF EXISTS "avatars_public_select" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
