-- 20260611120000_official_account.sql
--
-- PikTag official account (@piktag) + auto-friend on wizard completion.
-- Founder 2026-06-12: replace the Friends-page cold-start cards with a
-- real first friend — every user auto-friends the official account, so
-- (1) the friends list is never empty, (2) no stiff teaching cards,
-- (3) the profile itself demos what a good PikTag profile looks like.
--
-- Phase 1 (this file): is_official column + helper, seeded account
-- (profile / 6 tags / 3 biolinks), auto-friend trigger, backfill.
-- Phase 2 (follow-up migration): exclude is_official accounts from every
-- ranking/matching surface (search, FoF, ask-match, recommendation cron,
-- convergence, reconnect, tag pages, mutual counts) — the graph must not
-- be polluted by a synthetic friend everyone shares.
--
-- Notification note: notify_friend fires once per user when both
-- connection rows land ("你和 PikTag 成為好友") — deliberate, it demos
-- the notifications tab. Follows are one-way (user→official) so
-- notify_mutual_follow never fires.

-- ── 1. is_official flag + helper ─────────────────────────────────────
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_official_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_official FROM public.piktag_profiles WHERE id = p_user_id),
    false
  );
$$;

-- ── 2. Seed the auth user (fixed UUID; never logs in) ───────────────
-- Text token columns set to '' (GoTrue chokes on NULL there). The
-- on_auth_user_created trigger creates the profile row, which we then
-- overwrite below.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-a000-000000000001',
  'authenticated', 'authenticated', 'official@pikt.ag',
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}',
  now(), now(), '', '', '', ''
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE id = '00000000-0000-4000-a000-000000000001'
);

-- ── 3. Profile content (upsert — trigger may or may not have run) ───
INSERT INTO public.piktag_profiles (id, username, full_name, onboarding_completed, is_official)
VALUES ('00000000-0000-4000-a000-000000000001', 'piktag', 'PikTag', true, true)
ON CONFLICT (id) DO NOTHING;

UPDATE public.piktag_profiles SET
  username = 'piktag',
  full_name = 'PikTag',
  headline = 'PikTag 官方帳號',
  bio = '這裡是 PikTag 官方。介紹自己最快的方式：幾個標籤＋一句話。有問題或想法，直接傳訊息給我們。',
  is_official = true,
  onboarding_completed = true
WHERE id = '00000000-0000-4000-a000-000000000001';

-- ── 4. Six self-tags (get-or-create vs lower(name) unique) ──────────
DO $$
DECLARE
  v_official constant uuid := '00000000-0000-4000-a000-000000000001';
  v_names text[] := ARRAY['startup','marketing','design','photography','coffee','travel'];
  v_name text;
  v_tag_id uuid;
  v_pos int := 0;
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT id INTO v_tag_id FROM public.piktag_tags
     WHERE lower(name) = lower(v_name) LIMIT 1;
    IF v_tag_id IS NULL THEN
      INSERT INTO public.piktag_tags (name) VALUES (v_name) RETURNING id INTO v_tag_id;
    END IF;
    INSERT INTO public.piktag_user_tags (user_id, tag_id, position, is_private)
    SELECT v_official, v_tag_id, v_pos, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.piktag_user_tags
       WHERE user_id = v_official AND tag_id = v_tag_id
    );
    v_pos := v_pos + 1;
  END LOOP;
END $$;

-- ── 5. Three biolinks (website / IG / LinkedIn) ──────────────────────
INSERT INTO public.piktag_biolinks (user_id, platform, url, position, is_active)
SELECT '00000000-0000-4000-a000-000000000001', x.platform, x.url, x.pos, true
FROM (VALUES
  ('website',   'https://pikt.ag',                       0),
  ('instagram', 'https://instagram.com/pikt.ag',         1),
  ('linkedin',  'https://linkedin.com/company/piktag',   2)
) AS x(platform, url, pos)
WHERE NOT EXISTS (
  SELECT 1 FROM public.piktag_biolinks b
   WHERE b.user_id = '00000000-0000-4000-a000-000000000001'
     AND b.platform = x.platform
);

-- ── 6. Auto-friend on wizard completion ─────────────────────────────
-- Connections BOTH directions (notify_friend's handshake check needs
-- both; FriendDetail expects the viewer-side row). Follow ONE direction
-- (user→official): ConnectionsScreen renders connections ∩ follows from
-- the viewer's side, and one-way keeps notify_mutual_follow silent.
CREATE OR REPLACE FUNCTION public.add_official_friend()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_official constant uuid := '00000000-0000-4000-a000-000000000001';
BEGIN
  IF NEW.id = v_official OR COALESCE(NEW.is_official, false) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.piktag_connections (user_id, connected_user_id, met_at, is_reviewed)
  VALUES (NEW.id, v_official, now(), true)
  ON CONFLICT (user_id, connected_user_id) DO NOTHING;
  INSERT INTO public.piktag_connections (user_id, connected_user_id, met_at, is_reviewed)
  VALUES (v_official, NEW.id, now(), true)
  ON CONFLICT (user_id, connected_user_id) DO NOTHING;
  INSERT INTO public.piktag_follows (follower_id, following_id)
  VALUES (NEW.id, v_official)
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_add_official_friend ON public.piktag_profiles;
CREATE TRIGGER trg_add_official_friend
  AFTER UPDATE OF onboarding_completed ON public.piktag_profiles
  FOR EACH ROW
  WHEN (NEW.onboarding_completed IS TRUE
        AND COALESCE(OLD.onboarding_completed, false) = false)
  EXECUTE FUNCTION public.add_official_friend();

-- ── 7. Backfill every existing account (testers) ────────────────────
INSERT INTO public.piktag_connections (user_id, connected_user_id, met_at, is_reviewed)
SELECT p.id, '00000000-0000-4000-a000-000000000001', now(), true
FROM public.piktag_profiles p
WHERE p.id <> '00000000-0000-4000-a000-000000000001'
ON CONFLICT (user_id, connected_user_id) DO NOTHING;

INSERT INTO public.piktag_connections (user_id, connected_user_id, met_at, is_reviewed)
SELECT '00000000-0000-4000-a000-000000000001', p.id, now(), true
FROM public.piktag_profiles p
WHERE p.id <> '00000000-0000-4000-a000-000000000001'
ON CONFLICT (user_id, connected_user_id) DO NOTHING;

INSERT INTO public.piktag_follows (follower_id, following_id)
SELECT p.id, '00000000-0000-4000-a000-000000000001'
FROM public.piktag_profiles p
WHERE p.id <> '00000000-0000-4000-a000-000000000001'
ON CONFLICT (follower_id, following_id) DO NOTHING;
