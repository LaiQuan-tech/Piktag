-- Add location_updated_at to piktag_profiles for friend map freshness filter
-- The column tracks when a user's latitude/longitude was last written.
-- FriendsMapModal uses this to hide stale friend locations (>24h old).

ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;

-- Backfill: any profile that already has a location gets its updated_at as a starting value
UPDATE public.piktag_profiles
SET location_updated_at = updated_at
WHERE location_updated_at IS NULL
  AND (latitude IS NOT NULL OR longitude IS NOT NULL);

-- Index for efficient freshness queries and cleanup jobs
CREATE INDEX IF NOT EXISTS idx_piktag_profiles_location_updated_at
  ON public.piktag_profiles (location_updated_at DESC);
