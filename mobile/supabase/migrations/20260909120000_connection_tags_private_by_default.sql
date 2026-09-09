-- piktag_connection_tags.is_private — fail safe, and tell us what the
-- old code path actually did.
--
-- WHY THIS EXISTS
--
-- On this table is_private is not a cosmetic flag, it is the difference
-- between two completely different statements:
--
--   is_private = true   the viewer's PRIVATE label on a connection.
--                       Event tags, hidden tags, batch tags. Nobody but
--                       the viewer ever sees it.
--   is_private = false  a PUBLIC endorsement — "I say this person is
--                       #設計師". It is read by get_user_detail's
--                       endorsement list, and it is counted by
--                       endorser_count in search_users / explore_users
--                       (20260529070000), which feeds ranking.
--
-- Until 2026-09-09 ConnectionsScreen had its own batch-tag modal that
-- wrote `{connection_id, tag_id}` and omitted is_private entirely, while
-- every other writer states it explicitly. If this column's default is
-- false, then every batch tag applied from the friends list was filed as
-- a public endorsement: the user typed a private label for their own
-- memory (客戶, 面試, 台北設計聚) and the app published it as a vouch,
-- and those rows have been inflating endorser_count in search ever since.
-- If the default is true, nothing happened and this migration is a no-op
-- that documents the column.
--
-- The table predates this migrations folder (created in the dashboard),
-- so the default is not recorded anywhere in this repo, and the session
-- that wrote this has no DB credentials to look. Hence the two halves
-- below: pin the default so the question can never be asked again, and
-- RAISE NOTICE the facts into the deploy log so the answer is on the
-- record.
--
-- WHAT THIS DOES NOT DO: it does not touch a single row. A public
-- connection tag cannot be told apart from a genuine endorsement by
-- looking at it — ScanResultScreen legitimately writes public connection
-- tags that are not the target's own tags, so "the tag isn't on their
-- profile" does not identify the bad rows. The repair, if the numbers
-- below say one is needed, is a separate decision with the founder and a
-- separate migration.

-- ── 1. Fail safe ─────────────────────────────────────────────────────
-- Private is the safe default: a label that should have been public and
-- is private leaks nothing and is one tap to redo. A label that should
-- have been private and is public is a statement the user never made.
-- Safe to run whichever way the default currently points — every writer
-- in the app and in the 9 server-side INSERTs states is_private
-- explicitly, so nothing changes behaviour today; this only catches the
-- NEXT path that forgets.
ALTER TABLE public.piktag_connection_tags
  ALTER COLUMN is_private SET DEFAULT true;

COMMENT ON COLUMN public.piktag_connection_tags.is_private IS
  'true = the viewer''s private label on this connection (event/hidden/batch tags). '
  'false = a PUBLIC endorsement of that person, counted by endorser_count in '
  'search_users/explore_users ranking. Defaults to true (fail safe) since 2026-09-09 — '
  'always state it explicitly rather than relying on the default.';

-- ── 2. Put the diagnosis in the deploy log ───────────────────────────
-- Counts only, no user content. Read this in the Supabase Deploy run for
-- this commit.
DO $$
DECLARE
  v_default text;
  v_public  bigint;
  v_private bigint;
  v_null    bigint;
  v_burst   bigint;
BEGIN
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'piktag_connection_tags'
    AND column_name = 'is_private';

  SELECT
    count(*) FILTER (WHERE is_private IS FALSE),
    count(*) FILTER (WHERE is_private IS TRUE),
    count(*) FILTER (WHERE is_private IS NULL)
  INTO v_public, v_private, v_null
  FROM public.piktag_connection_tags;

  -- Signature of a BATCH write rather than a hand-made endorsement: the
  -- same viewer, the same tag, on 2+ different connections, all created
  -- inside the same second. togglePickTag is one tap per person and
  -- cannot produce that; the old batch modal produced exactly it. This
  -- is a bound on the damage, not a hit list — ScanResultScreen also
  -- writes several public tags per scan, though for ONE connection at a
  -- time, which is why the 2+ connections condition is there.
  SELECT coalesce(sum(n), 0) INTO v_burst
  FROM (
    SELECT count(*) AS n
    FROM public.piktag_connection_tags ct
    JOIN public.piktag_connections c ON c.id = ct.connection_id
    WHERE ct.is_private IS FALSE
    GROUP BY c.user_id, ct.tag_id, date_trunc('second', ct.created_at)
    HAVING count(DISTINCT ct.connection_id) >= 2
  ) s;

  RAISE NOTICE '[connection_tags audit] is_private default was: %', coalesce(v_default, '(none)');
  RAISE NOTICE '[connection_tags audit] rows: public(false)=% private(true)=% null=%', v_public, v_private, v_null;
  RAISE NOTICE '[connection_tags audit] public rows matching the batch-write signature: %', v_burst;
  RAISE NOTICE '[connection_tags audit] if default was false AND the last number is > 0, those are private labels published as endorsements — see 60-TRIGGERS #28.';
EXCEPTION WHEN OTHERS THEN
  -- The audit is a diagnostic, never a gate. This session could not probe
  -- the live schema, so a column it assumes (created_at) might not be
  -- there; if so, say what broke and let the DEFAULT fix above stand.
  -- A failed migration blocks every later one, which is a far worse
  -- outcome than an unanswered question.
  RAISE NOTICE '[connection_tags audit] audit skipped: % (%). The DEFAULT change above still applied.', SQLERRM, SQLSTATE;
END $$;
