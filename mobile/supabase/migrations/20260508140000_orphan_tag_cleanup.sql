-- Auto-maintain piktag_tags.usage_count + delete orphan tags.
--
-- Background: when users remove a tag from themselves (or get deleted, which
-- cascade-deletes their user_tags rows), the parent piktag_tags row is left
-- behind with a stale usage_count. This pollutes search/discovery surfaces
-- with "0 位擁有" entries and lets old typos linger forever.
--
-- This trigger fires AFTER INSERT/DELETE on piktag_user_tags and:
--   1. Recomputes the live distinct-user count for the affected tag
--   2. If 0 users, drops the tag row entirely
--   3. Otherwise, syncs usage_count to the live value (only if changed)
--
-- Cost: one indexed COUNT + at most one UPDATE/DELETE per user_tags mutation.
-- Tag mutations are not a hot path, so trigger overhead is negligible even at
-- 7-figure user scale. INSERT path also benefits — usage_count stays accurate
-- without relying on application code.
--
-- Pairs with: search_screen_init RPC filtering `WHERE usage_count > 0`
-- (defense-in-depth so transient inconsistency never surfaces in UI).

CREATE OR REPLACE FUNCTION public.tg_user_tags_maintain_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tag_id uuid;
  v_count  int;
BEGIN
  -- DELETE → OLD.tag_id; INSERT → NEW.tag_id
  v_tag_id := COALESCE(NEW.tag_id, OLD.tag_id);

  SELECT COUNT(DISTINCT user_id)
    INTO v_count
    FROM public.piktag_user_tags
   WHERE tag_id = v_tag_id;

  IF v_count = 0 THEN
    DELETE FROM public.piktag_tags WHERE id = v_tag_id;
  ELSE
    UPDATE public.piktag_tags
       SET usage_count = v_count
     WHERE id = v_tag_id
       AND usage_count IS DISTINCT FROM v_count;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_tags_maintain_usage ON public.piktag_user_tags;

CREATE TRIGGER user_tags_maintain_usage
AFTER INSERT OR DELETE ON public.piktag_user_tags
FOR EACH ROW
EXECUTE FUNCTION public.tg_user_tags_maintain_usage();
