-- 20260604000000_admin_profile_columns.sql
--
-- BUG: every admin who opens 用戶管理 sees "載入失敗：HTTP 500" — the
-- Vercel admin panel (piktag-admin.vercel.app) crashes immediately on
-- the user table because /api/admin/users SELECTs two columns the
-- piktag_profiles schema never grew:
--
--   • is_active boolean — soft-deactivation flag. Admin can flip it
--     via POST /api/admin/users/[id]/deactivate, and
--     /api/admin/reports/[id]/block sets it to false when an admin
--     confirms a content report.
--   • p_points integer — user point balance, shown in the user table's
--     P-POINTS column. Read-only on the admin side for now (no write
--     paths land before v3 monetization opens).
--
-- The admin codebase (commits 78f59609 + 67df6aec) shipped UI, filters,
-- and write handlers around both columns; the schema half never
-- followed. PostgREST returns 42703 the moment the SELECT runs,
-- /api/admin/users returns 500, and the panel surfaces the generic
-- HTTP 500. Affected code paths (route.ts / page.tsx pairs):
--
--   • app/api/admin/users/route.ts          — list (SELECT + filter)
--   • app/api/admin/users/[id]/route.ts     — detail (SELECT)
--   • app/api/admin/users/[id]/deactivate/route.ts
--                                           — flip is_active
--   • app/api/admin/reports/[id]/block/route.ts
--                                           — set is_active = false on
--                                             reported user
--   • app/(admin)/users/page.tsx            — renders P-POINTS column
--                                             + 已驗證/未啟用 filter pills
--   • app/(admin)/users/[id]/page.tsx       — detail view + Active toggle
--
-- Adding both with sensible defaults backfills every existing profile
-- in one shot:
--   - is_active defaults TRUE — every existing user is active; only
--     explicit admin actions ever flip it.
--   - p_points defaults 0 — no points have accrued yet; v3 monetization
--     opens write paths later.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) so re-runs are no-ops. CI
-- auto-applies via .github/workflows/supabase-deploy.yml.

ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS p_points integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.piktag_profiles.is_active IS
  'Soft-deactivation flag flipped only by admin actions ' ||
  '(/api/admin/users/[id]/deactivate, /api/admin/reports/[id]/block). ' ||
  'TRUE = normal user; FALSE = banned / disabled. App-side filtering ' ||
  'against this column is a follow-up (search_users etc. currently ' ||
  'ignore it — fine pre-launch with zero deactivated accounts).';

COMMENT ON COLUMN public.piktag_profiles.p_points IS
  'User-facing point balance. Read-only on the admin panel today; v3 ' ||
  'monetization opens write paths later. Defaults 0 so the column is ' ||
  'always renderable in admin UI.';
