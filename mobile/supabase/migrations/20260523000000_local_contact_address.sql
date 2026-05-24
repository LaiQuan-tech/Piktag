-- 20260523000000_local_contact_address.sql
--
-- Add `address` column to piktag_local_contacts. Mirrors the
-- pattern of `headline`/`phone_normalized`/`email_lower`: a
-- nullable text field the editor writes; populated either by
-- the card-scan flow (scan-business-card edge fn extracts it
-- alongside name/phone/email/job_title) or by manual entry.
--
-- No existing rows assumed to have addresses (the column didn't
-- exist before); column defaults to NULL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.piktag_local_contacts
  ADD COLUMN IF NOT EXISTS address text;
