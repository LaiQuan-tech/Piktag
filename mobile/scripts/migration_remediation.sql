-- ============================================================
-- PikTag migration remediation — generated 2026-05-16
--
-- The drift-check (scripts/migration_drift_check.sql) found 17
-- missing objects. After cross-referencing each against (a) later
-- migrations that intentionally superseded/dropped them and (b)
-- live app code, only the sections below are GENUINELY missing
-- AND still needed. The other 11 false rows are intentional
-- (security-hardening supersedes, the retired p_points system,
-- the dropped contract_expiry feature, removed get_viewer_event_tags
-- RPC) — do NOT "restore" those.
--
-- Every statement here is idempotent (DROP ... IF EXISTS /
-- CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS), so re-running on a DB that already has some of
-- these is safe and is a no-op for the already-present parts.
--
-- Run order = chronological by source migration timestamp.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- [1] from 20260427_security_rls_blocks_reports.sql
--     Missing: piktag_reports."reports_select"
--     Impact:  users can't read back their own filed reports.
--              Low (reports are write-mostly) but a correctness gap.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reports_select" ON piktag_reports;
CREATE POLICY "reports_select" ON piktag_reports
  FOR SELECT USING (reporter_id = auth.uid());


-- ─────────────────────────────────────────────────────────────
-- [2] from 20260508130000_qr_groups.sql
--     Missing: piktag_scan_sessions."Host can read own scan sessions"
--     Impact:  cosmetic — the plural-named "Hosts can read own
--              scan sessions" (from 20260428l) already grants the
--              same SELECT, so reads work. Restored for migration-
--              history consistency. The recency index is also
--              re-asserted (IF NOT EXISTS → no-op if present).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Host can read own scan sessions" ON public.piktag_scan_sessions;
CREATE POLICY "Host can read own scan sessions" ON public.piktag_scan_sessions
  FOR SELECT
  USING (auth.uid() = host_user_id);

CREATE INDEX IF NOT EXISTS idx_scan_sessions_host_recent
  ON public.piktag_scan_sessions (host_user_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────
-- [3] from 20260508140000_popular_tags_near_location.sql
--     Missing: public.popular_tags_near_location(text, integer)
--     Impact:  REAL. AddTagScreen.tsx calls this RPC to ground AI
--              tag suggestions in "what others tagged near here".
--              Missing → the call silently returns nothing, AI
--              suggestions lose location grounding.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.popular_tags_near_location(
  p_location text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  name text,
  usage_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_token text;
  v_min_len constant integer := 3;  -- "NY", "LA" too short to be unique
BEGIN
  IF p_location IS NULL OR trim(p_location) = '' THEN
    RETURN;
  END IF;

  SELECT word INTO v_token
  FROM unnest(string_to_array(p_location, ' ')) AS word
  WHERE length(word) >= v_min_len
  ORDER BY length(word) DESC
  LIMIT 1;

  IF v_token IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH unnested AS (
    SELECT unnest(s.event_tags) AS tag
    FROM piktag_scan_sessions s
    WHERE s.event_location ILIKE '%' || v_token || '%'
      AND s.event_tags IS NOT NULL
      AND array_length(s.event_tags, 1) > 0
      AND s.created_at > now() - interval '90 days'
  )
  SELECT
    trim(both '#' FROM trim(tag)) AS name,
    count(*)::bigint AS usage_count
  FROM unnested
  WHERE tag IS NOT NULL AND trim(tag) <> ''
  GROUP BY 1
  ORDER BY usage_count DESC, name ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.popular_tags_near_location(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popular_tags_near_location(text, integer) TO authenticated, anon;


-- ─────────────────────────────────────────────────────────────
-- [4] from 20260513020000_find_connections_by_tag.sql
--     Missing: public.find_connections_by_tag(text)
--     Impact:  low — no current client .rpc() call (only a stale
--              "stays deployed" comment in QrGroupListScreen).
--              Restored so the deployed surface matches the
--              codebase's stated expectation and any future
--              re-wiring works without another drift hunt.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_connections_by_tag(p_tag_query text)
RETURNS TABLE (
  connection_id uuid,
  connected_user_id uuid,
  username text,
  full_name text,
  avatar_url text,
  met_at timestamptz,
  vibe_id uuid,
  vibe_name text,
  matched_tag text,
  match_score integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH
    query_norm AS (
      SELECT lower(trim(both '#' from trim(coalesce(p_tag_query, '')))) AS q
    ),
    matches AS (
      SELECT
        c.id AS connection_id,
        c.connected_user_id,
        c.met_at,
        c.scan_session_id,
        t.name AS matched_tag,
        CASE
          WHEN lower(t.name) = (SELECT q FROM query_norm) THEN 3
          WHEN lower(t.name) LIKE (SELECT q || '%' FROM query_norm) THEN 2
          ELSE 1
        END AS match_score
      FROM piktag_connections c
      JOIN piktag_user_tags ut ON ut.user_id = c.connected_user_id
      JOIN piktag_tags t ON t.id = ut.tag_id
      CROSS JOIN query_norm qn
      WHERE c.user_id = auth.uid()
        AND length(qn.q) >= 1
        AND lower(t.name) LIKE '%' || qn.q || '%'
    )
  SELECT DISTINCT ON (m.connection_id)
    m.connection_id,
    m.connected_user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    m.met_at,
    s.id AS vibe_id,
    s.name AS vibe_name,
    m.matched_tag,
    m.match_score
  FROM matches m
  JOIN piktag_profiles p ON p.id = m.connected_user_id
  LEFT JOIN piktag_scan_sessions s
    ON s.id::text = m.scan_session_id::text
  ORDER BY m.connection_id, m.match_score DESC, m.met_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.find_connections_by_tag(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_connections_by_tag(text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- [5] from 20260513030000_notification_vibe_shift.sql
--     Missing: piktag_profiles.vibe_shift_notifications_enabled,
--              notify_vibe_shift(), trg_notify_vibe_shift
--     Impact:  REAL. The entire P3 "Vibe Shift" notification
--              feature is non-functional in prod. SettingsScreen
--              reads/writes the opt-out column (it has a graceful
--              guard so the toggle doesn't crash), but the trigger
--              never fires so no vibe_shift notifications are ever
--              created. This restores the whole feature.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS vibe_shift_notifications_enabled boolean DEFAULT true;

CREATE OR REPLACE FUNCTION public.notify_vibe_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id        uuid := NEW.user_id;
  v_actor_username  text;
  v_actor_full_name text;
  v_actor_avatar    text;
  v_tag_name        text;
  rec               record;
BEGIN
  SELECT t.name INTO v_tag_name
  FROM piktag_tags t
  WHERE t.id = NEW.tag_id;

  IF v_tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT username, full_name, avatar_url
    INTO v_actor_username, v_actor_full_name, v_actor_avatar
  FROM piktag_profiles
  WHERE id = v_actor_id;

  FOR rec IN
    SELECT DISTINCT c.user_id AS recipient_id
    FROM piktag_connections c
    JOIN piktag_profiles p ON p.id = c.user_id
    WHERE c.connected_user_id = v_actor_id
      AND c.user_id <> v_actor_id
      AND COALESCE(p.vibe_shift_notifications_enabled, true)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM piktag_notifications
      WHERE user_id = rec.recipient_id
        AND type = 'vibe_shift'
        AND data->>'actor_user_id' = v_actor_id::text
        AND lower(data->>'tag_name') = lower(v_tag_name)
        AND created_at > now() - interval '7 days'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO piktag_notifications (
      user_id, type, title, body, data, is_read
    ) VALUES (
      rec.recipient_id,
      'vibe_shift',
      '',
      '',
      jsonb_build_object(
        'actor_user_id',    v_actor_id,
        'actor_username',   v_actor_username,
        'actor_full_name',  v_actor_full_name,
        'actor_avatar_url', v_actor_avatar,
        'tag_name',         v_tag_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_vibe_shift failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_vibe_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_vibe_shift() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notify_vibe_shift ON public.piktag_user_tags;
CREATE TRIGGER trg_notify_vibe_shift
  AFTER INSERT ON public.piktag_user_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_vibe_shift();


-- ============================================================
-- Done. Re-run scripts/migration_drift_check.sql afterwards;
-- these 5 sections' objects should now all report present=true.
-- The 11 intentional false rows will (correctly) still be false.
-- ============================================================
