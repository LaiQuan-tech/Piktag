-- 20260611100000_fix_broken_line_biolinks.sql
--
-- Fix existing piktag_biolinks rows where platform='line' was saved
-- with the pre-2026-06-11 broken prefix `https://line.me/ti/p/<id>`
-- (no tilde). LINE rejects those with "無法加入好友。請確認網址是否正確"
-- because the `/ti/p/` endpoint without a `~` interprets the suffix as
-- a MID (internal hash), not a public LINE ID handle. The fix in
-- mobile/src/lib/platforms.ts now emits `https://line.me/ti/p/~<id>`;
-- this migration backfills existing rows.
--
-- Preserved as-is:
--   * Rows already in the correct `~<id>` form (idempotent).
--   * Rows whose suffix is a real MID (`u` + 32 lowercase hex chars) —
--     those are LINE's own canonical URLs and tilde-prefixing them
--     would break the link.

UPDATE piktag_biolinks
SET    url = 'https://line.me/ti/p/~' || substring(url FROM 22)
WHERE  platform = 'line'
  AND  url LIKE 'https://line.me/ti/p/%'
  AND  substring(url FROM 22) NOT LIKE '~%'
  AND  substring(url FROM 22) !~ '^u[0-9a-f]{32}$';
