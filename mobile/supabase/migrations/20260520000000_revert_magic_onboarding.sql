-- 20260520000000_revert_magic_onboarding.sql
--
-- REVERT 絕招一 / "Magic Onboarding" (web anonymous name-capture).
--
-- Why removed (founder decision, verified against real behaviour):
--   • claim_pending_scan deduped on (host_user_id, scan_session_id)
--     but one QR == one sid scanned by MANY people → the 2nd
--     scanner's name OVERWROTE the 1st on the same pending row
--     (confirmed data-loss bug in the primary use case).
--   • Even bug-free it contradicted the product thesis: a name with
--     NO tagging opportunity is the "dead contact" PikTag exists to
--     abolish — you remember people by TAGS, not names. The member's
--     real tag-rich action is 新增聯絡人 (local contact + AI tags),
--     not a bare name on a rail.
--
-- This drops ONLY the three Magic-Onboarding additions:
--   • claim_pending_scan(text,text)         [P1 write path]
--   • get_pending_scans()                   [P3 member-side read]
--   • piktag_pending_connections.scanner_name column  [P1 storage]
--
-- DELIBERATELY UNTOUCHED (separate, PRE-EXISTING rail — not 絕招一):
--   • piktag_pending_connections table (host/sid/status rows still
--     inserted on /u/<username> page-load),
--   • resolve_pending_connections (sid-keyed resolve-on-signup).
--   Whether that older anonymous-pending rail still earns its keep
--   is a separate decision; not in scope here.
--
-- Idempotent: DROP ... IF EXISTS + DROP COLUMN IF EXISTS. Safe to
-- run more than once; safe if the objects were never created.

DROP FUNCTION IF EXISTS public.claim_pending_scan(text, text);

DROP FUNCTION IF EXISTS public.get_pending_scans();

ALTER TABLE public.piktag_pending_connections
  DROP COLUMN IF EXISTS scanner_name;
