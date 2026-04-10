-- Lightweight usage counter for billable third-party APIs.
--
-- Why: we use Google Maps Platform SKUs (Maps JavaScript, Places
-- Autocomplete, Places Nearby, Geocoding) and Gemini. Google's
-- Cloud Console only reports monthly totals, and only after the
-- billing cycle closes, so we have no visibility into how usage
-- trends day-to-day or which feature is responsible for a cost
-- spike. This table logs one row per billable call the client
-- makes, so we can run SELECTs in Supabase Studio at any time.
--
-- Privacy: we store only the api_type bucket, the caller's user_id
-- (nullable — not every call is authenticated), and a coarse
-- metadata JSON. No PII, no coordinates, no query strings. The
-- server-side Google calls via Edge Functions are not tracked here
-- because they're already visible in function logs.

CREATE TABLE IF NOT EXISTS piktag_api_usage_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  api_type text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- One BRIN index is enough for time-range queries because rows are
-- inserted in monotonically increasing created_at order. Much cheaper
-- to maintain than a btree on a high-write log table.
CREATE INDEX IF NOT EXISTS idx_api_usage_log_created_at
  ON piktag_api_usage_log USING brin (created_at);

CREATE INDEX IF NOT EXISTS idx_api_usage_log_api_type
  ON piktag_api_usage_log (api_type, created_at DESC);

-- Row level security: any signed-in user may INSERT a row that
-- matches their own user_id (or NULL for anonymous calls). Only
-- the service_role key can SELECT / DELETE — the raw log is for
-- admin inspection only and must never leak to client reads.
ALTER TABLE piktag_api_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can insert own usage" ON piktag_api_usage_log;
CREATE POLICY "anyone can insert own usage"
  ON piktag_api_usage_log
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    user_id IS NULL OR user_id = auth.uid()
  );

-- No SELECT / UPDATE / DELETE policies — that blocks all client
-- reads by default. Admin queries go through Supabase Studio / SQL
-- editor with the service_role key, which bypasses RLS.

-- Convenience view that summarises usage by day and api_type, so a
-- glance at SELECT * FROM piktag_api_usage_daily ORDER BY day DESC
-- LIMIT 30 gives us a quick 30-day cost-trend picture.
CREATE OR REPLACE VIEW piktag_api_usage_daily AS
SELECT
  date_trunc('day', created_at) AS day,
  api_type,
  count(*)                      AS call_count
FROM piktag_api_usage_log
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

-- Same breakdown by month, useful for month-over-month comparisons
-- and matching the Google Cloud Console billing cycles.
CREATE OR REPLACE VIEW piktag_api_usage_monthly AS
SELECT
  date_trunc('month', created_at) AS month,
  api_type,
  count(*)                        AS call_count
FROM piktag_api_usage_log
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
