# PikTag

## What is PikTag

PikTag (`#piktag`) is a social CRM mobile app — a personal network layer where you tag the people you meet, remember context, and share a public bio page at `pikt.ag/:username`. The primary product is a React Native + Expo app shipping to the App Store and Google Play. Alongside it are two web surfaces: the public site at `pikt.ag`, which renders profile pages and hosts marketing/legal content, and an internal ops dashboard at `admin.pikt.ag`.

## Repo structure

**There are three deployed projects in this repo, and the repo root is one of them.** Everything at the top level that looks like Next.js scaffolding — `app/`, `components/`, `lib/`, `public/`, `next.config.ts`, `postcss.config.mjs`, the root `package.json` — is the live piktag-admin dashboard serving `admin.pikt.ag`. It is not boilerplate and its dependencies are real production dependencies.

```
Piktag/
├── mobile/                 # the Expo/React Native app (App Store + Play)
│   ├── App.tsx
│   ├── src/                # screens, components, lib, i18n, navigation
│   ├── assets/             # icon, splash, adaptive icon
│   ├── app.json            # Expo config (bundle id: ag.pikt.app)
│   ├── eas.json            # EAS build + submit profiles
│   ├── supabase/           # THE migrations + edge functions (see note below)
│   └── .env.example        # required EXPO_PUBLIC_* vars
│
├── landing/                # pikt.ag — Vite SPA + Vercel serverless functions
│   ├── index.html
│   ├── src/                # Vite app (ResetPassword, legal pages, ...)
│   ├── public/             # static assets, logo.png, favicon
│   ├── api/                # serverless functions (Vercel)
│   │   ├── u/[username].js   # renders pikt.ag/:username bio page
│   │   ├── tag/[tagname].js  # renders pikt.ag/tag/:tagname
│   │   ├── a/[askId].js      # renders a public Ask
│   │   └── _config.js        # shared Supabase creds + i18n + brand colors
│   └── scripts/            # pre/postbuild steps — do NOT .vercelignore these
│
├── app/  components/  lib/ # piktag-admin — Next.js app for admin.pikt.ag
│   └── app/api/admin/*     # route handlers, service-role Supabase client
│
├── .github/workflows/
│   ├── ios-testflight.yml        # iOS -> TestFlight
│   ├── android-google-play.yml   # Android AAB -> Play internal
│   ├── deploy-landing.yml        # landing/ -> Vercel production
│   ├── supabase-deploy.yml       # migrations + edge functions -> Supabase
│   ├── supabase-auth-config.yml  # auth settings as code (never `config push`)
│   ├── i18n-parity.yml           # guards the 19-locale invariant
│   └── daily-cron.yml
│
├── docs/claude/            # working memory + routing docs for agents
├── supabase/               # NOT deployed — the live SQL lives in mobile/supabase/
├── store-assets/           # screenshots + listing copy for stores
└── PikTag_開發規格書_v1.0.html   # original product spec (Chinese)
```

Two traps worth stating outright, because both have cost real time:

- **Migrations only count under `mobile/supabase/migrations/`.** The root
  `supabase/` directory is not deployed by anything. A migration written
  there looks fine in review and silently never runs.
- **The root project is live.** A dependency advisory against the root
  `package.json` is an advisory against a public, internet-facing app, not
  against dead scaffolding.

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

## Setup (landing)

`landing/` is a Vite SPA plus Vercel serverless functions under `landing/api/`.

```
cd landing
cp .env.example .env      # VITE_SUPABASE_* and analytics keys
npm ci
npm run dev               # vite on :3000
npm run lint              # tsc --noEmit
```

Shared Supabase/i18n/brand config for the API routes is in [landing/api/_config.js](landing/api/_config.js). The build has both a `prebuild` and a `postbuild` step in `landing/scripts/` — if a deploy fails right after the build succeeds, check that those scripts were not excluded by `.vercelignore` (its patterns match at any depth, so an unanchored name silently swallows `landing/scripts/`).

## Setup (admin)

The admin dashboard is the Next.js project at the repo root. See the [管理後台](#管理後台-admin-panel) section below for its environment variables and data flow.

```
npm ci
npm run dev               # http://localhost:3000 -> redirects to /login
npm run build             # what Vercel runs
```

## Deploy

| Target | Path | Trigger | Where it lands |
|---|---|---|---|
| iOS app | `mobile/` | Push to `main` touching `mobile/**` | TestFlight (via EAS submit in [ios-testflight.yml](.github/workflows/ios-testflight.yml)) |
| Android app | `mobile/` | Push to `main` touching `mobile/**` | Google Play internal track (draft status) via [android-google-play.yml](.github/workflows/android-google-play.yml) |
| pikt.ag | `landing/` | Push to `main` touching `landing/**` | Vercel production via [deploy-landing.yml](.github/workflows/deploy-landing.yml) |
| admin.pikt.ag | repo root | Vercel Git integration | Vercel `piktag-app` project, root directory `.`, `next build`, with Vercel Authentication on as a second layer |
| Database + edge functions | `mobile/supabase/` | Push to `main` touching `mobile/supabase/**` | Supabase via [supabase-deploy.yml](.github/workflows/supabase-deploy.yml) — migrations apply themselves, nobody runs SQL by hand |
| Supabase auth config | `mobile/supabase/auth/` | Push to `main` touching those files | Management API PATCH via [supabase-auth-config.yml](.github/workflows/supabase-auth-config.yml). Never run `supabase config push` — it is declarative and would wipe the dashboard-only Apple/Google OAuth providers |

All of these can also be run manually via `workflow_dispatch`, which means production can be redeployed from the GitHub web UI on a phone. iOS builds are archived on `macos-15` runners; Android builds run on `ubuntu-latest` and use Gradle directly (not EAS Build) with a base64-encoded keystore from secrets.

Note that a TestFlight or Play build is triggered by the **push**, not by the commit — batch mobile pushes, since daily upload counts are capped.

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

### landing/ (Vercel)

The serverless functions under `landing/api/` read these:

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL used by `/api/u/:username`, `/api/tag/:tagname`, `/api/a/:askId` |
| `SUPABASE_ANON_KEY` | Supabase anon key for the same |

The Vite client build reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the analytics keys listed in [landing/.env.example](landing/.env.example).

Configure these in the Vercel project settings. Fallbacks exist in [landing/api/_config.js](landing/api/_config.js) but should be treated as dev-only.

These API routes call Supabase with the **anon** key, so any RPC they depend on has to keep its `anon` EXECUTE grant. Revoking a function's grant because the mobile app no longer calls it has already broken this surface once — grep `landing/api/` before tightening any grant.

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
  - Web logo: [landing/public/logo.png](landing/public/logo.png), [landing/public/logo-icon.png](landing/public/logo-icon.png)

Full palette and type scale: [mobile/src/constants/theme.ts](mobile/src/constants/theme.ts).

---

## 管理後台 (Admin Panel)

位於 `admin.pikt.ag`（或本機 `http://localhost:3000`）。

### 用途
- 查看全部用戶資料、profile、連接、標籤、biolinks、points
- 停用 / 啟用 / 刪除帳號
- 處理舉報、一鍵封鎖被檢舉人
- 每日 signup / active users / QR 掃描量等內部指標
- 操作審計紀錄（admin_audit_log 表）

### 環境變數
- `NEXT_PUBLIC_SUPABASE_URL` — 公開
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — 公開
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**
- `ADMIN_EMAILS` — 逗號分隔的管理員 email 白名單

四個變數都要手動放進 `.env.local`（此 repo 沒有 `.env.local.example`，上面那張表就是完整清單）。

### 本機啟動
```bash
npm ci
npm run dev                        # http://localhost:3000 → redirect to /login
```

### 部署
Vercel `piktag-app` 專案 → root `.` → build `next build` → 綁 `admin.pikt.ag`。Env vars 從 Vercel dashboard 設定。Deployment Protection 啟用 "Vercel Authentication" 作為第二層。

**這是對外的 live 服務**,不是本機工具 —— root `package.json` 上的依賴警告都算數。

### 資料庫 migration
Migration 由 [supabase-deploy.yml](.github/workflows/supabase-deploy.yml) 在 push 到 `main` 時自動套用,**不要手跑 `supabase db push`**。新 migration 一律放 `mobile/supabase/migrations/`,14 位時間戳、冪等。

### 資料流
Browser → Next.js Server Components + Route Handlers（`/api/admin/*`）→ service-role Supabase client → DB。`SUPABASE_SERVICE_ROLE_KEY` 永不出現於 client。
