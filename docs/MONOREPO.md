# Monorepo Architecture

This repo is the union of two previously-separate codebases: the PikTag mobile app (Expo / React Native) and the `pikt.ag` landing page + share-link service. They were merged with `git subtree` so the histories are preserved. Everything is deployed from `main` — there is no staging branch.

If you only ever read one doc to understand the project shape, it is this one. The root `README.md` is older and partially out of date (it still references the pre-merge `web/` directory); prefer this file for layout and deployment questions.

## 1. Repository structure

The mobile app lives in `mobile/`. The marketing landing page lives in `landing/`. The share-link Vercel functions live in `api/` at the repo root (Vercel's filesystem routing requires this). Everything Vercel-related is wired together by a single `vercel.json` at the root. CI for the mobile app lives in `.github/workflows/`. Supabase migrations and Edge Functions live in `supabase/` (touched almost exclusively by the mobile side).

```
PikTag-mobile/
├── mobile/                  React Native (Expo SDK 54) app — Android + iOS via EAS
│   ├── app.json             Expo config — bundle id ag.pikt.app, applinks pikt.ag
│   ├── eas.json             EAS build/submit profiles
│   ├── src/screens/         All app screens
│   └── package.json         Mobile-only deps (do not hoist)
│
├── landing/                 Vite + React 19 SPA — pikt.ag/ landing page
│   ├── src/main.tsx         Router entry — register new <Route>s here
│   ├── src/pages/           Routed pages (Contact.tsx today)
│   ├── public/              Static assets served as-is by Vercel
│   │   ├── privacy.html     Hardcoded zh-TW legal HTML (NOT i18n'd)
│   │   ├── terms.html
│   │   ├── delete-account.html
│   │   ├── scan.html
│   │   ├── download.html
│   │   └── .well-known/
│   │       ├── apple-app-site-association   (no extension — required by Apple)
│   │       └── assetlinks.json
│   └── vite.config.ts       Dev server on :3000
│
├── api/                     Vercel serverless functions (Node)
│   ├── _config.js           Supabase creds + i18n strings + brand colors (shared)
│   ├── u/[username].js      pikt.ag/<username>     → profile share HTML w/ OG tags
│   ├── i/[code].js          pikt.ag/i/<code>       → invite landing
│   └── tag/[tagname].js     pikt.ag/tag/<tagname>  → tag discovery page
│
├── vercel.json              Single root config — buildCommand, rewrites, headers, ignoreCommand
├── supabase/                DB migrations + Edge Functions (mobile-touched)
└── .github/workflows/
    ├── android-google-play.yml   Mobile CI — AAB → Play Console (path-filtered)
    ├── ios-testflight.yml        Mobile CI — IPA → TestFlight (path-filtered)
    └── daily-cron.yml            Unrelated scheduled job
```

Anything at the repo root not listed above (`app/`, `src/`, root `package.json`, `next.config.ts`) is leftover Next.js scaffolding from an earlier iteration. Not deployed, not built. Ignore it.

## 2. Build pipelines

There are two independent pipelines, decoupled by path filtering. A single push to `main` can trigger zero, one, or both.

### Mobile — GitHub Actions

| Workflow | File | Trigger | Output |
|---|---|---|---|
| Android | `.github/workflows/android-google-play.yml` | `push` to `main` with `paths: mobile/**` | AAB → Google Play internal track (draft) |
| iOS | `.github/workflows/ios-testflight.yml` | `push` to `main` with `paths: mobile/**` | IPA → TestFlight |

Both workflows also accept `workflow_dispatch` for manual runs. Android signs locally with a base64-encoded keystore in GitHub secrets; iOS archives on `macos-15` and submits via fastlane. The Android `versionCode` is auto-bumped from `github.run_number + 1` so Play Console never rejects a duplicate.

### Landing + share API — Vercel

Vercel is wired to the GitHub repo and runs on every push, but the build is short-circuited unless something Vercel-relevant changed. The mechanism is the `ignoreCommand` in `vercel.json`:

```json
"ignoreCommand": "bash -c 'git diff --quiet HEAD^ HEAD -- landing/ api/ vercel.json'"
```

`git diff --quiet` exits 0 when there are no differences and non-zero when there are. Vercel treats a non-zero exit from `ignoreCommand` as "proceed with the build." So: build runs only when the diff against `HEAD^` shows changes inside `landing/`, `api/`, or `vercel.json`.

### "I changed file X — what runs?"

| Path you touched | Android workflow | iOS workflow | Vercel build |
|---|:-:|:-:|:-:|
| `mobile/**` | yes | yes | skipped |
| `landing/**` | no | no | yes |
| `api/**` | no | no | yes |
| `vercel.json` | no | no | yes |
| `supabase/**` | no | no | skipped |
| `docs/**`, root README, etc. | no | no | skipped |

If you change both `mobile/` and `landing/` in one commit, all three pipelines run in parallel.

## 3. Routing on pikt.ag (vercel.json rewrites)

Rewrites in `vercel.json` are evaluated **top-down**. The first match wins. Static files in `landing/public/` (the Vite build output that Vercel serves from `landing/dist/`) are matched **before** the rewrite table, so e.g. `/privacy.html` resolves to the static file directly without consulting rewrites.

Current order, with what each one serves:

```json
{ "source": "/i/:code",        "destination": "/api/i/:code" }
```
Invite landing — `pikt.ag/i/abc123` runs `api/i/[code].js`.

```json
{ "source": "/tag/:tagname",   "destination": "/api/tag/:tagname" }
```
Tag discovery — `pikt.ag/tag/coffee` runs `api/tag/[tagname].js`.

```json
{ "source": "/privacy",        "destination": "/privacy.html" }
{ "source": "/terms",          "destination": "/terms.html" }
{ "source": "/delete-account", "destination": "/delete-account.html" }
{ "source": "/scan",           "destination": "/scan.html" }
{ "source": "/download",       "destination": "/download.html" }
```
Pretty-URL aliases for the static legal/utility HTML pages in `landing/public/`. The bare `/privacy.html` URL would also work; the rewrite gives us extension-less URLs for anywhere we link them.

```json
{ "source": "/contact",        "destination": "/index.html" }
```
SPA fallback for the `/contact` route registered in `landing/src/main.tsx`. Without this, a hard refresh on `pikt.ag/contact` would 404 because no static file exists at that path.

```json
{ "source": "/:username",      "destination": "/api/u/:username" }
```
**Catch-all — must be last.** Anything that didn't match a more specific rewrite (and isn't a real static file) is treated as a username and routed to `api/u/[username].js`, which renders the share page or a 404. If you add a new top-level route (e.g. `/about`), add its rewrite **above** this line, otherwise the username function will swallow it.

## 4. Local development

Mobile and landing are independent npm projects with their own `package.json` and `node_modules`. There is no workspace tool (Yarn workspaces, pnpm, Turborepo) — install in each subdirectory.

### Mobile (Expo SDK 54)

```bash
cd mobile
npm install
npx expo start
```

Then scan the QR with Expo Go (or a dev client). Set up `mobile/.env` from `.env.example` first — the `EXPO_PUBLIC_*` Supabase and Google Places keys are required for the app to start.

### Landing (Vite)

```bash
cd landing
npm ci
npm run dev
```

Vite dev server boots on `http://localhost:3000` (configured in `landing/package.json`'s `dev` script). Hot reload works for everything in `landing/src/`.

### API functions

The `api/` functions cannot run under Vite — they're Vercel serverless handlers. Most contributors will not need to run them locally; just push and let preview deploys do the work. If you do need local execution:

```bash
npm i -g vercel
cd /Users/aimand/.gemini/File/PikTag-mobile  # repo root
vercel dev
```

This serves `/api/*` and the landing site together on a single port, honoring `vercel.json` rewrites.

### Mobile + landing simultaneously

Run each in its own terminal. Nothing is shared — they don't even talk to each other (the share links go through the deployed Vercel deployment, not localhost).

## 5. Deployment

| Target | How it deploys | Trigger |
|---|---|---|
| **Mobile (Android)** | GitHub Actions builds an AAB and uploads to Play Console internal track in `draft` status. A human clicks "Review release → Start rollout." | Push to `main` touching `mobile/**` |
| **Mobile (iOS)** | GitHub Actions archives on macOS, signs with App Store Connect API key, submits to TestFlight. | Push to `main` touching `mobile/**` |
| **Landing + share API** | Vercel project `lqtech-bio` (Root Directory = repo root). Build command and output dir are inherited from `vercel.json` (`cd landing && npm ci && npm run build` → `landing/dist`). | Push to `main` where `git diff` shows changes in `landing/`, `api/`, or `vercel.json` |

There are no staging environments. Vercel preview deploys are created automatically for any non-`main` branch push, but they are not named or wired into anything — useful as ad-hoc previews only.

## 6. Common workflows (cookbook)

### Add a new page to the landing site

1. Create `landing/src/pages/Foo.tsx`.
2. Register it in `landing/src/main.tsx` with `<Route path="/foo" element={<Foo />} />`.
3. Add a rewrite to `vercel.json` so direct visits and refreshes work:
   ```json
   { "source": "/foo", "destination": "/index.html" }
   ```
   Place it **above** the `/:username` catch-all.
4. Push. Vercel will detect the `landing/` and `vercel.json` changes and redeploy.

### Change the share-link HTML at `pikt.ag/<username>`

Edit `api/u/[username].js`. There is no build step — Vercel redeploys the function on the next push that satisfies `ignoreCommand`. To preview the rendered output before pushing, use `vercel dev` or push to a non-`main` branch and use the auto-generated preview URL.

### Update the privacy policy

Edit `landing/public/privacy.html` directly. **Do not** create a React version — earlier React-rendered legal pages were intentionally removed during the monorepo merge to keep the canonical URL stable (the App Store listing points at `pikt.ag/privacy`). Same rule applies to `terms.html` and `delete-account.html`.

### Add a new mobile screen

Add the file under `mobile/src/screens/`. Wire the navigator and run `npx expo start` to test. Vercel will see no changes in `landing/`/`api/`/`vercel.json` and skip; Android + iOS workflows will both run on the next `main` push.

### Verify share links still work after a change

```bash
curl -sL https://pikt.ag/armand7951 | head -40
```

You should see HTML with OG tags and the user's display name embedded. If you see the landing page HTML instead, the `/:username` rewrite is broken (likely re-ordered above a more specific rule).

## 7. Gotchas

- **Hardcoded Supabase creds in `api/_config.js`.** The Supabase URL and anon key are committed as fallbacks (`process.env.SUPABASE_URL || '<literal>'`). They should be moved to Vercel env vars, but until that's done, do not rotate the anon key without also editing the file. Tracked as a separate cleanup task.
- **`landing/public/.well-known/apple-app-site-association` has no file extension.** Apple's universal links spec requires the bare filename. The `vercel.json` `headers` block forces `Content-Type: application/json` for that exact path. If you ever rename the file, universal links break silently (the app keeps opening, but the OS stops trusting the `applinks:pikt.ag` association).
- **Static legal HTML is zh-TW only.** `privacy.html`, `terms.html`, and `delete-account.html` are not internationalized — the React landing app is. Mismatch is known; out of scope for this doc.
- **Universal link prefix is baked into the app.** `mobile/App.tsx`'s `linking.prefixes` includes `https://pikt.ag` and `https://www.pikt.ag`. If you reshape the share-link URL pattern (e.g. move `/:username` under `/u/:username`), update both the mobile `linking` config and the `vercel.json` rewrite, and ship a new mobile build before changing the rewrite. Otherwise installed apps will fail to open the link and fall back to the website.
- **Root `README.md` is partially stale.** It describes a `web/` directory that no longer exists post-merge. Use this file for current layout; the root README still has useful environment-variable tables.

## See also

- `README.md` — high-level project description and env-var reference (note: layout section is outdated).
- `mobile/eas.json` — EAS build/submit profiles.
- `mobile/app.json` — Expo config, bundle id, universal-link prefixes.
- `vercel.json` — single source of truth for landing routing and security headers.
- `.github/workflows/android-google-play.yml`, `.github/workflows/ios-testflight.yml` — full mobile CI definitions.
