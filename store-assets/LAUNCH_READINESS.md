# PikTag v1.0.0 Launch Readiness Report

Generated: 2026-04-17
Package: `ag.pikt.piktag` (verify in Play Console)
Owner: armand7951@gmail.com

## TL;DR

**NO-GO for production** — **SOFT-GO for Internal Testing track.**

The AAB itself is ready (80.8 MB, signed, builds cleanly, perf headroom is fine). The blockers are all off-device: **(1)** the privacy policy on `pikt.ag/privacy` does not match the Data Safety declaration (missing Sentry / PostHog / Device ID / Photos / Precise Location disclosures + identity providers), which is Google's #1 reason for policy rejection; **(2)** phone screenshots for the store listing do not yet exist at the right brand/resolution; **(3)** the `pikt.ag` domain still points at the old `piktag-landing` placeholder, so none of the URLs submitted to Play (`/privacy`, `/delete-account`, `/`) currently serve the correct content.

You can push an Internal Testing build today, but do not submit to Closed/Production review until all three are resolved.

## Critical path status

- [x] AAB built & signed (80.8 MB, CI run 24522583329)
- [x] Icon 512x512 generated (`store-assets/icon-512.png`)
- [x] Feature graphic 1024x500 generated
- [x] Store listing copy drafted (zh-TW + en, within char limits)
- [x] Release notes drafted (zh-TW + en)
- [x] Data Safety form submitted (per prior work)
- [x] Delete-account page exists in source (`web/public/delete-account.html`)
- [x] Privacy page exists in source (`web/public/privacy.html`)
- [x] Terms page exists in source (`web/public/terms.html`)
- [ ] **Phone screenshots captured on current purple brand** — missing
- [ ] **Privacy policy URL active at `pikt.ag/privacy` with Data-Safety-aligned content**
- [ ] **Delete-account URL active at `pikt.ag/delete-account`**
- [ ] **`pikt.ag` domain switched from `piktag-landing` → `lqtech-bio`**
- [ ] Play Console store listing form filled
- [ ] Screenshots + feature graphic uploaded to Play Console
- [ ] Internal Testing track deployment
- [ ] Post-launch monitoring dashboards bookmarked

## Blockers (must resolve before submit)

1. **Privacy policy ↔ Data Safety mismatch.** `web/public/privacy.html` does not disclose Sentry (crash logs), PostHog (analytics), Device IDs / push tokens, Photos (camera + library), or Precise Location — all of which are declared in Data Safety. Google Sign-In and Apple Sign-In are not listed as service providers. Delete-account URL is not linked. Children's-privacy section contradicts the declared 13+ audience. User rights (access/correct/export) are missing. Fix `privacy.html` before the domain switch so the live URL is compliant from day one. (Source: `PRIVACY_TERMS_AUDIT.md`)

2. **Phone screenshots missing at current brand / resolution.** The only screenshots in the repo (`mobile/ppt-screenshots/`) are 750x1624 and use the old yellow/gold PikTag branding, not the current purple brand. Play accepts them technically, but ship quality suffers and the listing will look stale. Need 2–8 fresh captures at 1080x2340 from login / home / friend detail / search / notifications / profile. (Source: `AUDIT.md`)

3. **Domain switch not yet executed.** `pikt.ag` currently serves the old Expo "即將上線" placeholder via the `piktag-landing` Vercel project. All Play Store submitted URLs (`/privacy`, `/delete-account`, `/`) therefore serve the wrong content. Switch must land on `lqtech-bio` per `DOMAIN_SWITCH.md`. Before the switch, also fix: `/i/:code` rewrite is missing from `vercel.json` (invite-code deep links will 404), and `web/.vercel/project.json` is still linked to `piktag-app` instead of `lqtech-bio`. (Source: `DOMAIN_SWITCH.md`, `WEB_ROUTING_AUDIT.md`)

4. **Landing-page store buttons are dead links (`href="#"`).** `web/index.html` hero + final CTA, and `web/download.html` App Store + Google Play buttons. On the day the Play listing goes live, the Google Play button on `/download` must resolve to `https://play.google.com/store/apps/details?id=ag.pikt.app`. (Source: `LANDING_AUDIT.md`, `DEEP_LINKING_AUDIT.md`)

5. **JSON-LD on profile pages is invalid for users with multi-line bios.** Real-world repro against `lqtech-bio.vercel.app/fullwish`: `JSON.parse` rejects the description field because of an unescaped literal `\n`. Not a runtime-render blocker but breaks Google Rich Results and every schema validator. ~5-min fix in the profile handler. (Source: `BIO_API_TEST.md`)

## Nice-to-have (post-launch improvements)

- Re-capture screenshots at 1080x2340 instead of using ppt-screenshots fallback.
- Enable R8 / resource shrinking in `mobile/android/gradle.properties` to drop AAB from ~81 MB to ~60 MB. (Source: `PERF_AUDIT.md`)
- Strip 4 over-declared Android permissions via `android.blockedPermissions` in `app.json`: `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `WRITE_CONTACTS`, `WRITE_EXTERNAL_STORAGE`. (Source: `PERF_AUDIT.md`)
- Ship apple-app-site-association + assetlinks.json so `https://pikt.ag/:username` opens the app directly instead of falling through the `piktag://` custom-scheme bounce. (Source: `DEEP_LINKING_AUDIT.md`)
- Branded 404 for `/i/<bad-code>` (currently Vercel default). (Source: `BIO_API_TEST.md`)
- Add `robots.txt`, `sitemap.xml`, security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), and CDN cache headers on `/api/u/*` and `/api/tag/*`. (Source: `WEB_ROUTING_AUDIT.md`)
- Add `SUPABASE_URL` + `SUPABASE_ANON_KEY` to the `lqtech-bio` Vercel env (currently relying on hardcoded fallbacks — works but ops hygiene suffers). (Source: `WEB_ROUTING_AUDIT.md`)
- Landing page a11y: focus rings, reduced-motion guard, skip-to-content, `<main>` landmark, lazy logo loading, preload Poppins. (Source: `LANDING_AUDIT.md`)
- Terms of Service additions (not Play-blocking): DMCA takedown, dispute-resolution venue, UGC license scope, limitation-of-liability cap. (Source: `PRIVACY_TERMS_AUDIT.md`)
- Repo cleanup: ~111 MB reclaimable from dead Next.js scaffolding, duplicate ppt-screenshots, stale APK, abandoned root `src/` mirror. (Source: `CLEANUP_AUDIT.md`)

## Domain switch (Option 1) — separate workstream

Status: **ready to execute, not yet started.**

Plan documented in `DOMAIN_SWITCH.md`. Summary:
1. Pre-flight: verify `web/index.html` is real (not placeholder), delete-account/privacy/terms pages exist, production build of `lqtech-bio` succeeds, capture rollback deployment URL for `piktag-landing`.
2. Execute: `vercel domains add pikt.ag lqtech-bio --scope lqtechs-projects` (with `vercel alias set` fallback).
3. Verify via curl: `/`, `/:username`, `/delete-account`, `/privacy` all return 200 with correct content.
4. Rollback path is pinned via `vercel alias set $PIKTAG_DEPLOY pikt.ag` if anything breaks.

Pre-switch fixes required first (to avoid a broken production cutover):
- Add `/i/:code` rewrite to `web/vercel.json`.
- Re-link `web/.vercel/project.json` to `lqtech-bio` (currently `piktag-app`).
- Fix privacy policy content (blocker #1 above).
- Patch JSON-LD escaping (blocker #5 above, optional but recommended).

## Recommended next 3 actions

1. **Rewrite `web/public/privacy.html` to match the Data Safety declaration.** This is the longest-lead, highest-risk item and must land before the domain switches or reviewers will see non-compliant content at `pikt.ag/privacy`. Add a "Third-party service providers" section (Sentry, PostHog, Supabase, Google Sign-In, Apple Sign-In), disclose Crash Logs / Diagnostic Data / Device IDs / Photos / Precise Location, link `https://pikt.ag/delete-account`, add user rights (access/correct/export), and reconcile the Children's section with the 13+ audience.

2. **Capture fresh screenshots on a physical Android device or Pixel 6 emulator.** Six screens at 1080x2340: login, home/connection list, friend detail (CRM tab), search, notifications, profile/social stats. Save to `store-assets/screenshots/` and upload to Play Console.

3. **Execute the domain switch.** Follow `DOMAIN_SWITCH.md` exactly, only after #1 lands. Add the `/i/:code` rewrite to `vercel.json` and re-link `web/.vercel/project.json` as part of the pre-flight. Verify all 4 curl checks pass before considering the switch done.

Once those three are green, update the Play Console listing with the generated assets, upload the AAB to the Internal Testing track, and work the Day-0 checklist in `POST_LAUNCH_CHECKLIST.md`.
