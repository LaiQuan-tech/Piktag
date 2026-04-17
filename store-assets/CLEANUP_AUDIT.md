# Dead Code Audit

Scope: `/Users/aimand/.gemini/File/PikTag-mobile/` root. Dates are the last commit that touched the file (`git log -1 --format=%cd`).

Key context discovered:
- Root `vercel.json` has `buildCommand: "echo 'Using pre-built dist'"` and `outputDirectory: dist`, so root deploys `dist/` (a pre-built Expo Web bundle). The root Next.js scaffolding (`next.config.ts`, `app/page.tsx`, etc.) is NEVER built or deployed.
- Root `App.tsx` + root `src/` ARE the sources used by whoever last ran `expo export` to regenerate `dist/` — commit message "fix: sync root src with mobile src for web deployment" (Apr 8 2026) confirms root src is a SYNC TARGET from `mobile/src/`. `mobile/src/` is canonical; root `src/` lags.
- Current landing page at `pikt.ag` is actually served from `web/` (separate Vercel project); `dist/` is linked to the `piktag-landing` Vercel project per `.vercel/project.json`, so it's still live until migration finishes.

---

## Safe to delete (high confidence)

- `/Users/aimand/.gemini/File/PikTag-mobile/app/page.tsx` — Next.js homepage, not built (buildCommand is a no-op). Last modified: Tue Mar 31 2026. Imports `framer-motion`, `@supabase/supabase-js` — pulls dead deps into `package.json`.
- `/Users/aimand/.gemini/File/PikTag-mobile/app/layout.tsx` — Next.js App Router layout. Last modified: Mon Feb 16 2026. Dead with `page.tsx`.
- `/Users/aimand/.gemini/File/PikTag-mobile/app/globals.css` — Next.js global CSS. Last modified: Tue Mar 31 2026. Dead.
- `/Users/aimand/.gemini/File/PikTag-mobile/app/favicon.ico` — served by Next.js App Router only; Expo uses `dist/favicon.ico`. Dead.
- `/Users/aimand/.gemini/File/PikTag-mobile/next.config.ts` — Last modified: Thu Mar 5 2026. Never invoked because build is stubbed.
- `/Users/aimand/.gemini/File/PikTag-mobile/next-env.d.ts` — Mon Feb 16 2026. Next.js type shim; unused.
- `/Users/aimand/.gemini/File/PikTag-mobile/postcss.config.mjs` — Tue Mar 3 2026. Next.js/Tailwind plumbing, unused.
- `/Users/aimand/.gemini/File/PikTag-mobile/eslint.config.mjs` — Mon Feb 16 2026. Next.js eslint config; root `package.json` lint script is never run since the Next.js app is abandoned.
- `/Users/aimand/.gemini/File/PikTag-mobile/package.json` + `package-lock.json` — root `package.json` is the Next.js one (name "piktag", deps: `next`, `framer-motion`, `@supabase/supabase-js`, etc.). Not used by Expo build (mobile has its own). Keeping ~232 KB lockfile for dead deps. Last modified: Mon Mar 31 2026.
- `/Users/aimand/.gemini/File/PikTag-mobile/lib/supabase.ts` — Mon Feb 16 2026. Next.js Supabase client; reads `NEXT_PUBLIC_*` env. Unused.
- `/Users/aimand/.gemini/File/PikTag-mobile/public/` (file.svg, globe.svg, next.svg, vercel.svg, window.svg) — Next.js scaffolding defaults. Tue Mar 3 2026. ~20 KB.
- `/Users/aimand/.gemini/File/PikTag-mobile/capture_final.py`, `capture_fix.py`, `capture_screenshots.py`, `capture_settings.py`, `capture_v3.py`, `create_ppt.py` — all Tue Mar 3 2026. One-shot Python scripts that generated `ppt-screenshots/`. Not referenced anywhere. ~80 KB.
- `/Users/aimand/.gemini/File/PikTag-mobile/ppt-screenshots/` — Tue Mar 3 2026. 920 KB of PNG outputs from the capture scripts above.
- `/Users/aimand/.gemini/File/PikTag-mobile/mobile/ppt-screenshots/` — exact byte-for-byte duplicate of root copy. 920 KB, Tue Mar 3 2026.
- `/Users/aimand/.gemini/File/PikTag-mobile/mobile/PikTag_功能介紹.pptx` — duplicate of root copy (untracked in git, same 820 KB). Tue Mar 3 2026.
- `/Users/aimand/.gemini/File/PikTag-mobile/mobile/build-1773760775716.apk` — 108 MB untracked APK build artifact from Mar 17 2026. `mobile/build/` dir is the newer location.
- `/Users/aimand/.gemini/File/PikTag-mobile/test-report-code-review.md`, `test-report-db.md`, `test-report-final.md` — all Tue Mar 3 2026 pre-v1 test reports. ~36 KB.
- `/Users/aimand/.gemini/File/PikTag-mobile/mobile/test-report-code-review.md`, `mobile/test-report-db.md`, `mobile/test-report-final.md` — duplicates of above (same 36 KB).

## Probably safe (verify first)

- `/Users/aimand/.gemini/File/PikTag-mobile/App.tsx` (root) — Last modified: Wed Apr 8 2026 (same "sync root src" commit). USED if you still rebuild `dist/` from root via `expo export`. If web is migrating to `web/index.html` entirely, this becomes dead. Verify: `grep -r "piktag-landing" .vercel` then decide if root `dist/` is still redeployed.
- `/Users/aimand/.gemini/File/PikTag-mobile/src/` (root) — 1.1 MB, Apr 8–15 2026. Same story — only alive if root `dist/` is still being rebuilt. Verify: check the `piktag-landing` Vercel project in dashboard; if it's been replaced by the `web/` project, delete.
- `/Users/aimand/.gemini/File/PikTag-mobile/index.ts` (root) — Expo entry. Tue Mar 3 2026. Dies with root `App.tsx`/`src/` if web migration completes.
- `/Users/aimand/.gemini/File/PikTag-mobile/metro.config.js` (root) — dies with root Expo sources.
- `/Users/aimand/.gemini/File/PikTag-mobile/app.json` (root) — dies with root Expo sources (mobile has its own).
- `/Users/aimand/.gemini/File/PikTag-mobile/assets/` (root) — Expo assets for root build; dies with root sources.
- `/Users/aimand/.gemini/File/PikTag-mobile/dist/` (root) — 4.1 MB pre-built Expo Web. Still referenced by `.vercel/project.json` (`piktag-landing`). Verify: `vercel inspect` or dashboard to confirm that project is deprecated before deleting.
- `/Users/aimand/.gemini/File/PikTag-mobile/PikTag_功能介紹.pptx` (root, 804 KB) — planning deck, Tue Mar 3 2026. Verify with stakeholders before removing.
- `/Users/aimand/.gemini/File/PikTag-mobile/PikTag_開發規格書_v1.0.html` (16 KB) — spec doc, Sat Apr 5 2026. Verify it's superseded by another doc.
- `/Users/aimand/.gemini/File/PikTag-mobile/test-plan.md` (4 KB) — Mar 20 2026. Verify whether testing process still references it.
- `/Users/aimand/.gemini/File/PikTag-mobile/supabase_schema.sql` — Sun Feb 15 2026. Verify it's superseded by `supabase/migrations/`.
- `/Users/aimand/.gemini/File/PikTag-mobile/DEVLOG.md` — Wed Apr 1 2026. Keep if still updated; otherwise stale.
- `/Users/aimand/.gemini/File/PikTag-mobile/.expo/` (root) — Expo cache for root project. Safe once root sources are removed. Suggested: `rm -rf .expo` (local only, not tracked).
- `/Users/aimand/.gemini/File/PikTag-mobile/supabase/` (root) vs `mobile/supabase/` — verify which is authoritative before removing the stale one. Root last touched Tue Mar 3 2026; mobile has more recent entries.
- `/Users/aimand/.gemini/File/PikTag-mobile/mobile/credentials.json` and `mobile/piktag-release.keystore` — keystore is sensitive; KEEP locally but verify not committed (`git ls-files` returns empty — good, already gitignored).

## Keep (clarification)

- `/Users/aimand/.gemini/File/PikTag-mobile/web/delete-account.html` — Required by Google Play data-deletion policy. Keep (per user note).
- `/Users/aimand/.gemini/File/PikTag-mobile/dist/delete-account.html` — The ACTUAL live copy served by the current `piktag-landing` Vercel project (commit "fix(web): put delete-account.html in dist/" Apr 17). Keep until domain+project switch is finalized, then re-evaluate along with the rest of `dist/`.
- `/Users/aimand/.gemini/File/PikTag-mobile/mobile/src/` — canonical mobile source tree. Keep.
- `/Users/aimand/.gemini/File/PikTag-mobile/mobile/App.tsx`, `mobile/index.ts`, `mobile/app.json`, `mobile/metro.config.js`, `mobile/package.json`, `mobile/eas.json` — active mobile app. Keep.
- `/Users/aimand/.gemini/File/PikTag-mobile/web/` — active landing/download/scan pages. Keep.
- `/Users/aimand/.gemini/File/PikTag-mobile/store-assets/` — active Play Store release artifacts. Keep.

## Files that DUPLICATE between root and mobile/

Canonical source is `mobile/`; root copies are sync-mirrors for legacy web build.

- `src/App.tsx` (root Apr 8) vs `mobile/App.tsx` (Apr 17) — `mobile/App.tsx` newer. Root is stale.
- `src/screens/*.tsx` (root, 18 files, last Apr 8–15) vs `mobile/src/screens/*.tsx` (20 files, through Apr 17) — `mobile/src/screens` has 2 additional screens (`PointsHistoryScreen.tsx`, `RedeemInviteScreen.tsx`) and 17 of 18 shared files `diff`. `mobile/src/screens` is canonical.
- `src/components/*.tsx` (11 files) vs `mobile/src/components/*.tsx` (12 files) — `mobile` has extra `HiddenTagEditor.tsx`; 5 others differ. `mobile/src/components` is canonical.
- `src/i18n/`, `src/context/`, `src/lib/`, `src/navigation/`, `src/constants/`, `src/hooks/`, `src/stubs/`, `src/types/` — all root mirrors of `mobile/src/*`. Canonical is `mobile/src/*`.
- `PikTag_功能介紹.pptx` (root, 820 KB) and `mobile/PikTag_功能介紹.pptx` (820 KB) — byte-identical. Keep one (root).
- `ppt-screenshots/` (root, 920 KB, 13 files) and `mobile/ppt-screenshots/` (920 KB, 13 files) — byte-identical copies. Delete both after verifying.
- `test-report-*.md` (root, 3 files) and `mobile/test-report-*.md` (3 files) — identical sizes/dates. Delete both.

---

## Rough reclaim sizes

| Group | Size |
|---|---|
| Abandoned Next.js scaffolding (`app/`, `next.config.ts`, `public/`, `lib/`, `package.json`, `package-lock.json`, `next-env.d.ts`, `postcss.config.mjs`, `eslint.config.mjs`) | ~300 KB source + untracked `node_modules` if any |
| `capture_*.py`, `create_ppt.py` | ~80 KB |
| `ppt-screenshots/` × 2 | 1.8 MB |
| `PikTag_功能介紹.pptx` dup | 820 KB |
| `test-report-*.md` × 2 | ~72 KB |
| `mobile/build-1773760775716.apk` | 108 MB |
| Legacy root Expo web (`src/`, `App.tsx`, `assets/`, `dist/`, `app.json`, `metro.config.js`, `index.ts`) — if web migration complete | ~6.5 MB |

Total high-confidence + APK: ~111 MB. With legacy web layer: ~118 MB.
