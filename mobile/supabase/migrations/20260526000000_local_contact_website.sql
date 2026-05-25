-- 20260526000000_local_contact_website.sql
--
-- Add `website` column to piktag_local_contacts. Mirrors the
-- `address` column added in 20260523000000.
--
-- WHY: the scan-business-card edge function already extracts a
-- `website` value from the card (alongside name / phone / email /
-- job_title / company / address), but until now the contact schema
-- had no place to store it — the value was silently dropped after
-- every scan. Adding the column closes that gap.
--
-- Field name is the neutral "website" rather than "company_website"
-- because business cards carry all sorts of URLs (founder portfolio,
-- consultant Calendly, freelancer Linktree, …) and forcing
-- "company-only" semantics would mislead users without companies
-- into leaving the field empty.
--
-- Existing rows default to NULL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.piktag_local_contacts
  ADD COLUMN IF NOT EXISTS website text;
