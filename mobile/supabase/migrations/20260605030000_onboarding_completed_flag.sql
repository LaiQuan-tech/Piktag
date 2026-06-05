-- 20260605030000_onboarding_completed_flag.sql
--
-- Explicit per-account "did this account finish the gated onboarding
-- wizard" signal, set TRUE only at the wizard's true completion point
-- (OnboardingScreen.handleComplete, after name/username/bio/headline/
-- tags/links are all written).
--
-- Why (founder real-device test, 2026-06-05): the client gate was
-- previously inferred from profile completeness (username + full_name
-- present). But the wizard upserts username+full_name at the END OF
-- STEP 1 — so a user who bailed AFTER step 1 (before tags/links) read
-- as "complete" and skipped the rest, defeating the gate's purpose.
-- An explicit flag, written only at the very end, closes that hole:
-- a step-1 bailer has username+full_name but onboarding_completed=false,
-- so the gate correctly re-prompts them.
--
-- AppNavigator.decideOnboarding() now reads THIS column instead of the
-- username/full_name heuristic.

ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.piktag_profiles.onboarding_completed IS
  'TRUE once the account has walked the full gated onboarding wizard (set only by OnboardingScreen.handleComplete). The client onboarding gate reads this. Default false.';

-- One-time backfill: existing accounts that already have a set-up
-- profile (username + full_name, e.g. legacy/pre-wizard accounts or the
-- founder''s own test accounts) are treated as already-onboarded so the
-- new mandatory wizard does NOT retroactively force them through it.
-- Brand-new / empty accounts (null or blank username/full_name) stay
-- false and will see the wizard. This mirrors the heuristic the client
-- gate used before this column existed, applied once here.
UPDATE public.piktag_profiles
   SET onboarding_completed = true
 WHERE onboarding_completed = false
   AND username  IS NOT NULL AND btrim(username)  <> ''
   AND full_name IS NOT NULL AND btrim(full_name) <> '';
