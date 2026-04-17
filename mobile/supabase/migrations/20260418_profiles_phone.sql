-- 20260418_profiles_phone.sql
--
-- ContactSyncScreen matches contacts against piktag_profiles.phone,
-- but that column was never added. Result: phone-based matching always
-- returns 'no rows' silently, so 全部匯入 only ever matches contacts
-- via the fragile email-prefix heuristic.
--
-- Fix: add `phone` (nullable, unique-ish) + backfill from auth.users.phone.

ALTER TABLE piktag_profiles ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_piktag_profiles_phone ON piktag_profiles(phone)
  WHERE phone IS NOT NULL;

-- Backfill phone from auth.users (Supabase stores SMS-verified phone there)
UPDATE piktag_profiles p
SET phone = au.phone
FROM auth.users au
WHERE p.id = au.id
  AND p.phone IS NULL
  AND au.phone IS NOT NULL
  AND au.phone <> '';
