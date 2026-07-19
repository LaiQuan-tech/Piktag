-- 20260712030000_local_contacts_source.sql
--
-- Motivation: card scan, manual add, and contact-book import all write
-- into the same piktag_local_contacts table, and the row carried no
-- provenance — so the admin dashboard could not tell how many local
-- contacts came specifically from the card-scan flow. This adds a
-- `source` column that each client write path stamps (card_scan /
-- manual / import) so that "掃名片增加的聯絡人數" becomes an exact count
-- instead of an estimate.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). No CHECK constraint by
-- design — a contact write must never be blocked by an unexpected
-- source value (fail-open).

ALTER TABLE public.piktag_local_contacts
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.piktag_local_contacts.source IS
  'How this local contact was created: card_scan / manual / import. NULL = created before this column existed (source unknown). No CHECK constraint by design — fail-open so an unexpected value never blocks a contact write.';
