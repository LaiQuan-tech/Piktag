-- 20260715050000_shorten_scan_session_qr_urls.sql
--
-- Shorten existing event-QR share links (founder 2026-07-15: the links are
-- so long they "look like phishing"). The stored qr_code_data carried the
-- event tags/date/location as URL query params, e.g.
--   https://pikt.ag/jeff?sid=<uuid>&tags=%E9%80%A3%E7%B5%90%E4%BA%BA%E8%84%88%2C%E6%89%B6%E8%BC%AA%E7%A4%BE&lang=zh-TW
-- The %-encoded CJK in ?tags= is the scary part, and it is REDUNDANT: the
-- scan_session row already stores event_tags/event_date/event_location, and
-- the landing (landing/api/u/[username].js) reads them LIVE via
-- get_scan_session_public as the source of truth — the URL params were only
-- ever a fallback for a failed DB insert. Every row that has a stored
-- qr_code_data DID insert successfully (see AddTagScreen: the qr_code_data
-- UPDATE only runs when the session row was created, so sid is always a real
-- UUID the landing can resolve). So the params are safe to strip here; the
-- app-side generator (AddTagScreen) stops emitting them for NEW QRs in the
-- same change.
--
-- Strips &tags= / &date= / &loc= (each value is URL-encoded and contains no
-- raw '&', so [^&]* captures it exactly). Keeps sid (always first, right
-- after '?') and lang (short, readable, carries the sharer's language).
-- Idempotent: the WHERE clause matches only rows that still have a param,
-- so a re-run is a no-op.

UPDATE public.piktag_scan_sessions
SET qr_code_data = regexp_replace(qr_code_data, '&(tags|date|loc)=[^&]*', '', 'g')
WHERE qr_code_data IS NOT NULL
  AND qr_code_data ~ '&(tags|date|loc)=';
