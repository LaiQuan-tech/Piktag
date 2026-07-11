-- 20260711000000_personalization_toggle.sql
-- =============================================================================
-- Personalization opt-out flag (founder-approved 2026-07-11).
--
-- iOS compliance requires a real user choice before inferred signals (which
-- platforms a user publicly lists on their profile, behavioral data) feed
-- personalized recommendation ranking. This column is the single server-side
-- switch the recommendation cron — and every future personalized surface —
-- must respect. Default true (opt-out model), so existing behavior is
-- unchanged until a user explicitly turns it off in Settings.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; COMMENT is re-runnable.
-- =============================================================================

ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS personalized_recs boolean DEFAULT true;

COMMENT ON COLUMN public.piktag_profiles.personalized_recs IS
  'Personalized-recommendations opt-out. (a) false = this user does not participate in personalized recommendation COMPUTATION at the data-processing layer (they are skipped as recipients before any scoring), not merely excluded from notification delivery. (b) CONTRACT: any future inferred signal (biolink platforms, behavioral data) entering Ask matching or any other Recommended surface MUST read this column before using such signals for the user. (c) Phase 3 sponsored tags will introduce a PARALLEL column personalized_ads (name reserved here on purpose; intentionally NOT created yet).';
