-- 20260530150000_sync_alias_concept_resolver_trigger.sql
--
-- WHY
-- ----
-- The `auto-link-concepts` edge function runs every 5 minutes via pg_cron
-- (20260523010000_auto_link_concepts_frequent_cron.sql) and is the only
-- writer that sets `piktag_tags.concept_id`. New tags created mid-cycle
-- sit with `concept_id IS NULL` for up to 5 minutes, during which they're
-- invisible to sibling-expansion in search_users / explore_users_for_tag /
-- match_ask_to_friends / the recommendation cron — every surface that
-- joins through concept_id silently drops them.
--
-- The cheap, deterministic 80% case (a new tag whose name is already a
-- curated alias — e.g. "PM", "SWE", "Real Estate", "專案管理", "ML" — see
-- 20260328010000_seed_multilingual_aliases.sql + the `_ko_id_th_tr` and
-- `_concept_alias_seeds` companion migrations) doesn't need an embedding
-- API call to resolve. `resolve_tag_alias(text)` is already an exact,
-- case-insensitive lookup against `tag_aliases.alias` returning the
-- concept_id (or NULL). Calling it inline on insert closes the 5-min
-- window for those tags.
--
-- WHAT
-- ----
-- A BEFORE INSERT FOR EACH ROW trigger on `piktag_tags` that calls
-- `resolve_tag_alias(NEW.name)` when `NEW.concept_id` is NULL and sets
-- NEW.concept_id to the result. The 20% truly novel names (no curated
-- alias, embedding-similarity required) keep concept_id NULL and the
-- 5-min linker cron resolves them as before. This is primitive #3 of
-- the v3 tag-auction pre-launch must-ship set (CLAUDE.md `## v3 vision`).
--
-- DEFENSIVE GUARANTEE
-- -------------------
--   * Caller-supplied `concept_id` wins: if the inserting code already
--     knows the concept (admin upsert, the linker re-inserting through
--     an upsert path, future seeded data), we do NOT override it.
--   * Empty / NULL name: pass through unchanged — the existing unique-
--     name constraint (20260425010000) and NOT NULL rule reject it.
--   * `resolve_tag_alias` raises: caught + concept_id left NULL — the
--     linker is the fallback, never block tag creation on a flaky
--     alias lookup. This trigger fires on EVERY tag insert; it MUST
--     NOT be in the failure path of friend-tagging, AI suggestion,
--     local-contact promotion, or scan-session tag creation.
--   * No side effects beyond mutating NEW: we don't INSERT into
--     `tag_aliases` (a HIT means the alias is already there — that's
--     how the lookup succeeded), don't notify, don't log to the
--     impression / learning tables (those are for renders + searches,
--     not creates).
--
-- WHAT STAYS THE SAME
-- -------------------
--   * `auto-link-concepts` step 3a still runs every 5 minutes and is
--     the canonical owner of the embedding-required (~20%) novel-name
--     path. Step 3a's no-op for alias-hits is fine — by the time the
--     cron walks `concept_id IS NULL` rows, the alias hits are gone.
--   * Concept GC (merging embedding-similar concepts >0.85) and the
--     eventual `piktag_tags.concept_id NOT NULL` constraint are
--     separate post-launch concerns (CLAUDE.md v3, top-5 #1).
--   * `notify_tag_added` (on `piktag_user_tags`) and
--     `promote_local_contact_tags` (on `piktag_local_contacts`) are on
--     different tables and unaffected. No existing trigger on
--     `piktag_tags` itself (verified live via pg_trigger pre-deploy).

CREATE OR REPLACE FUNCTION public.tg_piktag_tags_resolve_concept_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Caller knows the concept already. Respect it.
  IF NEW.concept_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Malformed name. Let the existing constraints reject the row;
  --    we have nothing to resolve against.
  IF NEW.name IS NULL OR length(btrim(NEW.name)) = 0 THEN
    RETURN NEW;
  END IF;

  -- 3. Cheap exact-case-insensitive alias → concept_id lookup. Either
  --    we get a hit (immediately resolved, sibling expansion live for
  --    this tag from the moment search_users sees it) or NULL (the
  --    5-min linker owns the embedding path).
  BEGIN
    SELECT public.resolve_tag_alias(NEW.name) INTO NEW.concept_id;
  EXCEPTION WHEN OTHERS THEN
    -- Tag creation must NEVER fail because of this trigger. The linker
    -- is the fallback for anything we can't resolve here.
    NEW.concept_id := NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_piktag_tags_resolve_concept_on_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_piktag_tags_resolve_concept_on_insert() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_piktag_tags_resolve_concept_on_insert ON public.piktag_tags;
CREATE TRIGGER trg_piktag_tags_resolve_concept_on_insert
BEFORE INSERT ON public.piktag_tags
FOR EACH ROW EXECUTE FUNCTION public.tg_piktag_tags_resolve_concept_on_insert();
