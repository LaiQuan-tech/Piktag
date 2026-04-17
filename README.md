# PikTag

## What is PikTag

PikTag (`#piktag`) is a social CRM mobile app — a personal network layer where you tag the people you meet, remember context, and share a public bio page at `pikt.ag/:username`. The primary product is a React Native + Expo app shipping to the App Store and Google Play. Supporting it is a small static + serverless web property that renders the public profile pages and hosts marketing/legal surfaces.

## Repo structure

```
PikTag-mobile/
├── mobile/                 # PRIMARY — the Expo/React Native app
│   ├── App.tsx
│   ├── src/                # screens, components, lib, i18n, navigation
│   ├── assets/             # icon, splash, adaptive icon
│   ├── app.json            # Expo config (bundle id: ag.pikt.app)
│   ├── eas.json            # EAS build + submit profiles
│   ├── android/ ios/       # native projects (regenerated via prebuild)
│   └── .env.example        # required EXPO_PUBLIC_* vars
│
├── web/                    # USED — Vercel-deployed static + API routes
│   ├── index.html          # pikt.ag landing page
│   ├── download.html scan.html 404.html
│   ├── public/             # privacy.html, terms.html, delete-account.html
│   ├── api/                # serverless functions (Vercel)
│   │   ├── u/[username].js   # renders pikt.ag/:username bio page
│   │   ├── tag/[tagname].js  # renders pikt.ag/tag/:tagname
│   │   ├── i/[code].js       # invite / deep-link handler
│   │   └── _config.js        # shared Supabase creds + i18n + brand colors
│   └── vercel.json
│
├── .github/workflows/
│   ├── ios-testflight.yml        # USED — iOS -> TestFlight
│   ├── android-google-play.yml   # USED — Android AAB -> Play internal
│   └── daily-cron.yml
│
├── dist/                   # DEAD — stale Expo web bundle, not deployed
├── app/  src/              # DEAD — old Next.js boilerplate, not deployed
├── package.json            # DEAD — Next.js deps; root project is not built
├── vercel.json             # DEAD — root Vercel config; real one is web/
├── supabase/               # edge functions + SQL (Supabase project)
├── store-assets/           # screenshots + listing copy for stores
└── PikTag_開發規格書_v1.0.html   # original product spec (Chinese)
```

Anything under `app/`, `src/` (root), `index.ts` (root), `next.config.ts`, `postcss.config.mjs`, and the root `package.json` is Next.js scaffolding from an earlier iteration and is not deployed. Treat `mobile/` and `web/` as the two real projects.

## Setup (mobile)

Requires Node 22, the EAS CLI (`npm i -g eas-cli`), and Xcode / Android Studio for native builds.

```
cd mobile
cp .env.example .env      # fill in Supabase + Google keys
npm ci
npm start                 # expo start — scan QR with Expo Go or dev client
```

Platform-specific run:

```
npm run ios               # expo run:ios  (needs Xcode)
npm run android           # expo run:android (needs Android SDK)
```

EAS build profiles live in [mobile/eas.json](mobile/eas.json). The Expo config is [mobile/app.json](mobile/app.json).

## Setup (web)

The web project is static HTML + Vercel serverless functions. There is no bundler or framework — files are served as-is.

```
cd web
npx vercel dev            # serves /api/* and static files locally
```

Routing rules live in [web/vercel.json](web/vercel.json). Shared Supabase/i18n/brand config for the API routes is in [web/api/_config.js](web/api/_config.js).

## Deploy

| Target | Path | Trigger | Where it lands |
|---|---|---|---|
| iOS app | `mobile/` | Push to `main` touching `mobile/**` | TestFlight (via EAS submit in [ios-testflight.yml](.github/workflows/ios-testflight.yml)) |
| Android app | `mobile/` | Push to `main` touching `mobile/**` | Google Play internal track (draft status) via [android-google-play.yml](.github/workflows/android-google-play.yml) |
| pikt.ag (web) | `web/` | Vercel project | Currently deployed under the `piktag-landing` Vercel project; will be cut over to `lqtech-bio` after the switch |

Both mobile workflows can also be run manually via `workflow_dispatch`. iOS builds are archived on `macos-15` runners; Android builds run on `ubuntu-latest` and use Gradle directly (not EAS Build) with a base64-encoded keystore from secrets.

## Environment variables

### mobile/ (Expo)

All `EXPO_PUBLIC_*` vars are inlined into the JS bundle at build time. Rotate them via the GCP / Supabase console, not by patching shipped binaries.

| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (RLS-protected) |
| `EXPO_PUBLIC_GEMINI_API_KEY` | Gemini — AI tag suggestions in ManageTagsScreen; must be bundle-ID restricted to `ag.pikt.app` |
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | Google Places — LocationPickerModal / FriendsMapModal; must be bundle-ID restricted to `ag.pikt.app` |

Put these in `mobile/.env` locally. For CI they live in GitHub Actions secrets (see the `env:` block at the top of each workflow). For EAS cloud builds use `eas secret:create`.

### GitHub Actions (mobile CI only)

| Secret | Used by |
|---|---|
| `EXPO_PUBLIC_*` (the four above) | Both iOS and Android workflows |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Source-map upload (optional; build tolerates absence) |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Android signing |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Android Play Store upload |
| Apple auth secrets (fastlane / API key) | iOS TestFlight submit — see [ios-testflight.yml](.github/workflows/ios-testflight.yml) |

### web/ (Vercel)

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL used by `/api/u/:username`, `/api/tag/:tagname`, `/api/i/:code` |
| `SUPABASE_ANON_KEY` | Supabase anon key for the same |

Configure these in the Vercel project settings. Fallbacks exist in [web/api/_config.js](web/api/_config.js) but should be treated as dev-only.

## Brand

- **Primary purple:** `#aa00ff` (piktag500)
- **Accent purple:** `#8c52ff` (accent400)
- **Deep purple:** `#360066` (accent600)
- **Soft bg:** `#faf5ff`
- **Brand gradient:** `linear-gradient(90deg, #ff5757 0%, #8c52ff 100%)` — coral → purple
- **Font:** Inter (via `@expo-google-fonts/inter`); system fallback on web
- **Wordmark:** `#piktag` (hash prefix is part of the name)
- **Logo assets:**
  - App icon / adaptive icon: [mobile/assets/icon.png](mobile/assets/icon.png), [mobile/assets/adaptive-icon.png](mobile/assets/adaptive-icon.png)
  - Splash: [mobile/assets/splash-icon.png](mobile/assets/splash-icon.png)
  - Web logo: [web/logo.png](web/logo.png), [web/logo-icon.png](web/logo-icon.png)

Full palette and type scale: [mobile/src/constants/theme.ts](mobile/src/constants/theme.ts).
