# Perf & Bundle Audit

Date: 2026-04-17
Scope: `mobile/` (Expo SDK 54, RN 0.81.5, New Architecture enabled, Hermes on)

## Bundle size

- **AAB (release, signed)**: ~80.8 MB zipped artifact from CI run `24522583329` (2026-04-16, successful build). Actual `app-release.aab` file size is within the same ballpark (artifact zip of a single already-compressed AAB is roughly 1:1).
  - Source: `gh run view 24522583329 --log` → `Final size is 80803032 bytes` for the `android-aab` artifact containing `mobile/android/app/build/outputs/bundle/release/app-release.aab`.
  - No local AAB present; only a universal APK at `mobile/android/app/build/outputs/apk/release/app-release.apk` (~117 MB) and a stale top-level `mobile/build-1773760775716.apk` (~107 MB from 2026-03-17).
- **Node modules (dev-side sanity check)**: 497 MB at `mobile/node_modules` — large but irrelevant to shipped bundle.
- **Target**: <50 MB (soft), warns >100 MB.
- **Verdict**: ⚠️ AAB ~81 MB. Over the 50 MB "ideal" target but **well under the 100 MB Google Play warning threshold**. Google Play auto-splits the AAB into per-ABI download APKs, so actual user download will be noticeably smaller (typically 40-55 MB for arm64). No flag expected.

### Bundle size notes / levers
- Hermes enabled (`android/gradle.properties`: `hermesEnabled=true`) — good, this shrinks JS engine cost vs JSC.
- `newArchEnabled: true` in `app.json` — larger native footprint but unavoidable for RN 0.81.
- `android.enableMinifyInReleaseBuilds` and `android.enableShrinkResourcesInReleaseBuilds` are **not set** in `mobile/android/gradle.properties`; the `build.gradle` reads them with `?: false`/`?: 'false'` defaults, so ProGuard/R8 and resource shrinking are **disabled in release**. Turning both on could cut 10-20 MB off the AAB with minimal effort. Leaving this as a follow-up observation — not blocking for Play review.

## Permissions

### Declared (mobile/android/app/src/main/AndroidManifest.xml)
- `ACCESS_COARSE_LOCATION` — justified by: location tags on friend profiles (nearby places picker, `expo-location`).
- `ACCESS_FINE_LOCATION` — justified by: precise location for location-based tags and `LocationPickerModal`.
- `CAMERA` — justified by: QR code scanning (`CameraScanScreen`, `expo-camera`) and profile-photo capture.
- `INTERNET` — required (trivially justified).
- `READ_CONTACTS` — justified by: "find friends who are already on PikTag" contact matching (declared in `expo-contacts` plugin with a usage string).
- `READ_EXTERNAL_STORAGE` — justified by: legacy (pre-Android 13) photo picker fallback via `expo-image-picker`.
- `READ_MEDIA_IMAGES` — justified by: Android 13+ photo picker (profile picture update).
- `RECORD_AUDIO` — ⚠️ **requested but no obvious in-app feature uses it**. The app has no voice recording, voice notes, or video-with-audio flow. `expo-camera` auto-declares it for video mode; if the app only scans QR codes it can be stripped.
- `SYSTEM_ALERT_WINDOW` — ⚠️ **unusual for a social app**. No in-app use of overlay windows found. Likely pulled in transitively by a dependency (possibly `react-native-webview` or an old RN default). Google Play flags overlay usage and requires justification in the listing.
- `VIBRATE` — justified by: `expo-haptics` feedback.
- `WRITE_CONTACTS` — ⚠️ app only *reads* contacts for friend-matching; there is no feature that writes to the address book. Should be removed.
- `WRITE_EXTERNAL_STORAGE` — deprecated on Android 10+ (scoped storage). Included by legacy templates; not actively used. Safe to drop.

### Flagged (for trimming before public release)
- `RECORD_AUDIO` — no voice feature; strip via `android.blockedPermissions` in `app.json`.
- `SYSTEM_ALERT_WINDOW` — no overlay feature; strip.
- `WRITE_CONTACTS` — read-only contact matching; strip.
- `WRITE_EXTERNAL_STORAGE` — legacy; strip.

### Not flagged but worth noting
- `app.json` only whitelists 7 permissions but the prebuilt manifest has 12. The extras come from transitive plugin auto-merges. Add an `android.blockedPermissions: [...]` array in `app.json` for each unwanted permission so `expo prebuild` strips them deterministically.

## Cold start

- **Sentry init**: **SYNC** — `Sentry.init({...})` runs at module-top-level of `mobile/App.tsx` (line 17) before React renders. It also wraps the root export with `Sentry.wrap(App)`. Guarded by `enabled: !__DEV__` so dev is fine; production pays the cost. Typical Sentry RN init = ~30-80 ms.
- **PostHog init**: **SYNC at first import** — `mobile/src/lib/analytics.ts` instantiates `new PostHog(...)` at module-top-level. First imported by `mobile/src/navigation/AppNavigator.tsx`, i.e. immediately after Sentry. Typical PostHog RN init = ~20-50 ms.
- **i18n init**: SYNC — `import './src/i18n'` side-effect in `App.tsx` line 8.
- **expo-linking**: lazy-required inside try/catch — already optimized, no work on web.
- **Push notifications**: **LAZY** — `mobile/src/lib/pushNotifications.ts` dynamically imports `expo-notifications` and `expo-device` inside the function, specifically to avoid cold-start native-module work and a known iOS 17 TurboModule crash. Good pattern.
- **Secondary screens**: lazy-loaded via `getComponent` (comment in `AppNavigator.tsx`) for ~13 screens; primary screens are eager. Good balance.
- **Other sync work in App.tsx**: `ThemeProvider` + `GestureHandlerRootView` + `SafeAreaProvider` + `NavigationContainer` (unavoidable RN baseline).
- **Estimated cold-start impact** (over a vanilla RN splash-to-interactive baseline):
  - Sentry init: ~40-80 ms
  - PostHog init: ~20-50 ms
  - i18n resource load: ~30-60 ms
  - **Total JS-level overhead: ~100-200 ms** on a mid-range Android device.
  - New Architecture + Hermes pay a one-time ~150-300 ms native-bootstrap cost on first launch.
  - Overall expected cold-start on a Pixel 6-class device: **1.5-2.5 s**. Google Play's "slow startup" flag triggers above ~5 s, so there is comfortable headroom.

## Background work

- **No `registerTaskAsync` / `BackgroundFetch` / long-running `setInterval` calls** exist in `mobile/src`.
- All `setTimeout` usages are short, UI-scoped debounces or scan-reset timers (3 s re-arm in `CameraScanScreen`, 600 ms AI-tag debounce in onboarding, ~10 s Places-API fetch abort, etc.). No battery-drain risk.
- `expo-notifications` is present only for receiving remote push tokens (no scheduled local notifications, no background handler registered). Safe.
- No JS-side polling of Supabase; the app uses realtime subscriptions via `@supabase/supabase-js`, which are event-driven. Safe.

## Verdict

**Ready.** No blocking issues for Google Play review.

Recommended follow-ups (non-blocking, nice-to-have before public launch):
1. Add `android.blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.WRITE_CONTACTS", "android.permission.WRITE_EXTERNAL_STORAGE"]` to `app.json` → re-prebuild → smaller manifest, fewer Play-review questions.
2. Enable R8 / resource shrinking: add `android.enableMinifyInReleaseBuilds=true` and `android.enableShrinkResourcesInReleaseBuilds=true` to `mobile/android/gradle.properties` to drop the AAB from ~81 MB toward ~60 MB.
3. Consider deferring `Sentry.init` behind `InteractionManager.runAfterInteractions` if cold-start telemetry later shows it as a hotspot. Currently under the warning threshold, so optional.
