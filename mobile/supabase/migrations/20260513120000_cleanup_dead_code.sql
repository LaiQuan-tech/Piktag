-- 20260513120000_cleanup_dead_code.sql
--
-- One-shot cleanup of DB objects whose mobile/web consumers have
-- all been removed across the past few weeks of UI surgery. None
-- of these are referenced by any current screen or RPC; they
-- exist only as legacy data + dead RPC bodies.
--
-- What goes away and why:
--
-- 1. piktag_points_ledger table + piktag_profiles.p_points and
--    p_points_lifetime columns:
--    The points-based referral system was retired in favor of
--    "Tribe size" (anonymous transitive descendant count). All
--    client code that read these (PointsHistoryScreen, the
--    InviteScreen p_points card, the i18n `points` namespace) is
--    gone; redeem_invite_code was replaced in
--    20260513040000_tribe_lineage.sql to skip the points award
--    entirely. The columns + table have been zero-write zero-read
--    for several days now; safe to drop.
--
-- 2. find_connections_by_tag(text) RPC:
--    Was the backend for the P2 "Cross-Vibe search bar" on the
--    Vibes tab. The UI was removed after user feedback ("活動
--    標籤頁不需要再有搜尋欄"); the RPC has been orphan since.
--    Search-by-tag intent will get a new home later when the
--    network is denser; we'll rebuild fresh rather than carry
--    the old shape.
--
-- 3. get_viewer_event_tags(uuid) RPC:
--    Powered the now-removed "活動標籤" picker section on
--    UserDetailScreen's hidden-tag editor. That section conflated
--    "tags from THIS scan" with "tags from your past scan
--    vocabulary"; resolved by keeping only the per-Vibe "這次
--    Vibe 帶的標籤" section (paramTags-driven). The viewer-
--    vocabulary RPC has no consumer left.
--
-- All drops use IF EXISTS so re-running the migration on a DB
-- where any of these were already removed is a no-op.

-- ── 1. Points system ───────────────────────────────────────
DROP TABLE IF EXISTS public.piktag_points_ledger CASCADE;

ALTER TABLE public.piktag_profiles
  DROP COLUMN IF EXISTS p_points,
  DROP COLUMN IF EXISTS p_points_lifetime;

-- ── 2. P2 cross-Vibe search RPC ────────────────────────────
DROP FUNCTION IF EXISTS public.find_connections_by_tag(text);

-- ── 3. Past-event-vocabulary RPC ───────────────────────────
DROP FUNCTION IF EXISTS public.get_viewer_event_tags(uuid);
