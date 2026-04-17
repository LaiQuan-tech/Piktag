# Deep Linking & Download Page Audit

Audit date: 2026-04-17
Scope: custom URL scheme (piktag://), Universal Links / App Links, and the /download page.

## Custom URL scheme (piktag://)

- iOS registered: YES
  - File: `mobile/ios/PikTag/Info.plist`
  - `CFBundleURLTypes > CFBundleURLSchemes` at lines 25–33
  - Registered schemes: `piktag` (line 30), `ag.pikt.app` (line 31)
- Android registered: YES
  - File: `mobile/android/app/src/main/AndroidManifest.xml`
  - `<intent-filter>` lines 31–37 on `.MainActivity`
  - Schemes: `piktag` (line 35), `exp+piktag` (line 36)
  - Has `android.intent.action.VIEW` + `BROWSABLE` + `DEFAULT` categories
  - NOTE: no `autoVerify="true"` and no `android:host` attribute on the data element, so this is a pure custom-scheme filter (fine for `piktag://username`)

The custom scheme invoked by both the bio page `handleFollow()` (web/api/u/[username].js line 277) and the `/download` page `openApp()` (web/download.html line 139) is correctly registered on both platforms.

## Universal Links / App Links

- apple-app-site-association: MISSING
  - No file at `web/.well-known/apple-app-site-association`
  - No `/.well-known/` directory under `web/`
  - No matching rewrite in `web/vercel.json`
  - iOS entitlements file exists (`mobile/ios/PikTag/PikTag.entitlements`) but associated-domains was not verified
- .well-known/assetlinks.json: MISSING
  - No file at `web/.well-known/assetlinks.json`
  - `AndroidManifest.xml` has no `<data android:scheme="https" android:host="pikt.ag"/>` intent-filter with `android:autoVerify="true"`

Result: `https://pikt.ag/:username` links will always open in the browser; they cannot jump straight into the app. Only the in-page "Follow" button (custom `piktag://` scheme) can launch the app, which requires the user to be already on the bio page in a browser.

## Download page (pikt.ag/download)

File: `web/download.html`, served via rewrite `/download -> /download.html` (`web/vercel.json` line 6).

- Apple App Store button: PRESENT (visually), href BROKEN
  - `<a href="#" class="btn btn-appstore" id="btn-appstore">` (line 102)
  - href is `#` — no App Store URL wired up. No JS updates it either.
- Google Play button: PRESENT (visually), href BROKEN
  - `<a href="#" class="btn btn-googleplay" id="btn-googleplay">` (line 106)
  - Should be `https://play.google.com/store/apps/details?id=ag.pikt.app`
  - href is `#` — no Play Store URL wired up. No JS updates it either.
- "Open App" deep-link button: PRESENT and CORRECT
  - `openApp()` (lines 137–141) builds `piktag://<username>?sid=<sid>` and navigates — matches registered schemes.
- OG preview tags: MISSING
  - No `<meta property="og:*">`, no `<meta name="twitter:*">`, no `<meta name="description">` on `/download`. Only `<title>下載 #piktag</title>` (line 6).
  - Social previews of `pikt.ag/download` will fall back to the raw URL/title with no image or description.

## Additional observations

- `web/api/u/[username].js` `handleFollow()` (lines 272–284) correctly attempts `piktag://<username>?sid=<sid>` and falls back to `pikt.ag/download?...` after 600ms if the page stays visible — standard custom-scheme fallback pattern.
- Banner on the profile page (line 253) points to `/download?username=...` — so the download page’s `openApp()` button path is reachable and parameters flow through.
- `apple-touch-icon` is referenced (line 169) but only for favicon purposes, unrelated to Universal Links.

## Verdict for launch

NEEDS FIXES (blocker + polish).

Blocker (must fix before handing the URL to real users):
1. `web/download.html` App Store button `href="#"` — replace with the live App Store URL (or hide the button until iOS build ships).
2. `web/download.html` Google Play button `href="#"` — replace with `https://play.google.com/store/apps/details?id=ag.pikt.app`.

Strongly recommended (polish, not strictly launch-blocking because the custom `piktag://` scheme already works):
3. Add `web/.well-known/apple-app-site-association` + iOS `associated-domains` entitlement so `https://pikt.ag/:username` opens the app directly on iOS.
4. Add `web/.well-known/assetlinks.json` + Android `<intent-filter>` with `android:scheme="https"`, `android:host="pikt.ag"`, `android:autoVerify="true"` so `https://pikt.ag/:username` opens the app directly on Android.
5. Add OG / Twitter / description meta tags to `web/download.html` so shared links render a proper preview.
