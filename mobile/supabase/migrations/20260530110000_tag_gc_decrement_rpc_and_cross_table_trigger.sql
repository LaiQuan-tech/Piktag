-- 20260530110000_tag_gc_decrement_rpc_and_cross_table_trigger.sql
--
-- Root cause this migration closes:
--
--   1. The client (ManageTagsScreen, EditProfileScreen) calls
--      `supabase.rpc('decrement_tag_usage', { tag_id })` on every
--      self-untag. Grep of `mobile/supabase/migrations/**` shows the
--      RPC was NEVER defined — every call has been silently failing.
--      Net effect: `piktag_tags.usage_count` only ever goes UP from
--      `increment_tag_usage` / `batch_tag_increment`, never down,
--      so the value drifts permanently above reality.
--
--   2. The orphan-cleanup trigger
--      `tg_user_tags_maintain_usage()` (shipped in
--      20260508140000_orphan_tag_cleanup.sql) only inspects
--      `piktag_user_tags`. If a tag has 0 self-claims but is still
--      referenced by `piktag_connection_tags` (friend endorsement)
--      or `piktag_ask_tags` (Ask-attached tag), the trigger deletes
--      the master `piktag_tags` row out from under those FKs. Cross-
--      table blind. Tag-quality principle #1 requires all four
--      sources be first-class.
--
-- What this migration changes:
--   (a) Defines `decrement_tag_usage(p_tag_id uuid)` — recounts the
--       real distinct-user count in piktag_user_tags and writes it
--       to piktag_tags.usage_count. No-op-safe (stale tag_id won't
--       error). Trigger still owns deletion.
--   (b) Rewrites `tg_user_tags_maintain_usage()` to delete the
--       master row ONLY when all three reference tables
--       (piktag_user_tags + piktag_connection_tags + piktag_ask_tags)
--       are empty for that tag_id. Otherwise updates usage_count
--       to the live piktag_user_tags distinct-user count.
--   (c) One-shot backfill: re-sync every existing piktag_tags row
--       to its real count, then delete master rows now provably
--       abandoned by all three reference tables.
--
-- What this migration does NOT change:
--   - No FK CASCADE additions on piktag_connection_tags /
--     piktag_ask_tags → piktag_tags. Separate concern; current
--     ON DELETE CASCADE (where defined) already handles the master-
--     row deletion path that the new trigger gates.
--   - No change to the `usage_count > 0` search filter — defense-
--     in-depth from 20260508140000 stays.
--   - AI-suggestion negative signals in `piktag_tag_removals`
--     remain advisory only; principle #6 enforcement (block re-
--     suggestion of removed tags in `suggest-tags` edge fn) is
--     deferred to a follow-up — flagged here so a future session
--     doesn't assume this migration covered it.

-- =============================================================================
-- (a) decrement_tag_usage RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.decrement_tag_usage(p_tag_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- No-op-safe: NULL / unknown tag_id just falls through.
  IF p_tag_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT user_id)
    INTO v_count
    FROM public.piktag_user_tags
   WHERE tag_id = p_tag_id;

  -- Re-align usage_count with reality. Even if the row is now
  -- orphan-eligible the trigger (fired by the caller's DELETE)
  -- owns the actual deletion — we only refresh the count here.
  UPDATE public.piktag_tags
     SET usage_count = COALESCE(v_count, 0)
   WHERE id = p_tag_id
     AND usage_count IS DISTINCT FROM COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_tag_usage(uuid) TO authenticated;

-- =============================================================================
-- (a2) increment_tag_usage RPC — symmetric companion
-- =============================================================================
--
-- Same diagnosis as decrement: ManageTagsScreen + EditProfileScreen call
-- supabase.rpc('increment_tag_usage', { tag_id }) on every self-add but
-- the RPC was never defined. Visible footprint: 11 undercounted master
-- tags in prod (audit 2026-05-30) where the row exists but usage_count
-- lags the real distinct-user count. The trigger eventually heals this
-- on the next mutation, but a missing increment RPC means popularity
-- is invisible to popular-tags ranking + search-init until then.
--
-- Same shape as decrement: SECURITY DEFINER, no-op-safe, recounts from
-- piktag_user_tags ground truth (cheap with the small dataset).

CREATE OR REPLACE FUNCTION public.increment_tag_usage(p_tag_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_tag_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT user_id)
    INTO v_count
    FROM public.piktag_user_tags
   WHERE tag_id = p_tag_id;

  UPDATE public.piktag_tags
     SET usage_count = COALESCE(v_count, 0)
   WHERE id = p_tag_id
     AND usage_count IS DISTINCT FROM COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_tag_usage(uuid) TO authenticated;

-- =============================================================================
-- (b) Cross-table-aware tg_user_tags_maintain_usage trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_user_tags_maintain_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_id          uuid;
  v_user_count      int;
  v_connection_refs int;
  v_ask_refs        int;
BEGIN
  -- DELETE → OLD.tag_id; INSERT → NEW.tag_id
  v_tag_id := COALESCE(NEW.tag_id, OLD.tag_id);

  IF v_tag_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(DISTINCT user_id)
    INTO v_user_count
    FROM public.piktag_user_tags
   WHERE tag_id = v_tag_id;

  SELECT COUNT(*)
    INTO v_connection_refs
    FROM public.piktag_connection_tags
   WHERE tag_id = v_tag_id;

  SELECT COUNT(*)
    INTO v_ask_refs
    FROM public.piktag_ask_tags
   WHERE tag_id = v_tag_id;

  IF v_user_count = 0 AND v_connection_refs = 0 AND v_ask_refs = 0 THEN
    -- Truly abandoned across all reference tables: drop the master row.
    DELETE FROM public.piktag_tags WHERE id = v_tag_id;
  ELSE
    -- At least one reference table still holds it. Re-sync usage_count
    -- to the live piktag_user_tags distinct-user count (which may be
    -- zero — that's intentional; friend/ask references keep the master
    -- row alive but should not inflate the self-claim metric).
    UPDATE public.piktag_tags
       SET usage_count = v_user_count
     WHERE id = v_tag_id
       AND usage_count IS DISTINCT FROM v_user_count;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_tags_maintain_usage ON public.piktag_user_tags;

CREATE TRIGGER user_tags_maintain_usage
AFTER INSERT OR DELETE ON public.piktag_user_tags
FOR EACH ROW
EXECUTE FUNCTION public.tg_user_tags_maintain_usage();

-- =============================================================================
-- (c) One-shot backfill: re-align usage_count, then sweep orphans
-- =============================================================================

-- Pass 1: re-sync usage_count for every existing piktag_tags row to
-- the live distinct-user count in piktag_user_tags. Rows with no
-- user_tags rows reset to 0 (they may still be alive via connection /
-- ask references, in which case the next DELETE pass leaves them be).
--
-- Correlated subquery in the FROM clause: cheap on the small tags
-- dataset and avoids alias collisions (an earlier CTE + LEFT JOIN
-- attempt collided `r` between the CTE and the outer subquery).

UPDATE public.piktag_tags t
   SET usage_count = sub.rc
  FROM (
    SELECT pt.id AS tag_id,
           COALESCE(
             (SELECT COUNT(DISTINCT user_id)
                FROM public.piktag_user_tags
               WHERE tag_id = pt.id),
             0) AS rc
      FROM public.piktag_tags pt
  ) sub
 WHERE t.id = sub.tag_id
   AND t.usage_count IS DISTINCT FROM sub.rc;

-- Pass 2: delete master rows now provably abandoned by ALL THREE
-- reference tables. Idempotent — re-running finds nothing left.

DELETE FROM public.piktag_tags t
 WHERE NOT EXISTS (
         SELECT 1 FROM public.piktag_user_tags ut WHERE ut.tag_id = t.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM public.piktag_connection_tags ct WHERE ct.tag_id = t.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM public.piktag_ask_tags at_ WHERE at_.tag_id = t.id
       );
