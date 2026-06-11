-- 20260612020000_official_avatar.sql
--
-- Avatar for the official @piktag account. The image (brand-gradient
-- background + white double-hash logo at 62%, so the circular avatar
-- crop never clips the mark — founder 2026-06-12) was uploaded to
-- storage as avatars/official.png; this just points the profile at it.
UPDATE public.piktag_profiles
SET avatar_url = 'https://kbwfdskulxnhjckdvghj.supabase.co/storage/v1/object/public/avatars/official.png?v=1'
WHERE id = '00000000-0000-4000-a000-000000000001';
