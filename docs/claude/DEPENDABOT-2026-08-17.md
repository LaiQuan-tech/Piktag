# Dependabot triage — 2026-08-17

Scope: investigation only. No files were edited, no commands applied, no commits.
Source of truth: `gh api /repos/LaiQuan-tech/Piktag/dependabot/alerts --paginate`, plus lockfile
reverse-dependency tracing and reading the actually-installed package source.

## Headline correction: 9 open alerts, not 13

The API reports **9 open alerts, all high, and nothing open at any other severity.**
Historical totals: 15 high ever created, of which 6 are already in `fixed` state
(`ws` x2, `fast-uri`, `react-router` x2, `postcss` — last one fixed 2026-08-07).
There is no point in time at which the open-high count was 13, so the "13" figure is
either stale or came from a view that groups alerts differently. Work from 9.

The 9 open alerts are only **4 distinct advisories across 3 distinct packages** —
the count is inflated because one advisory can fire once per manifest, and two
different CVEs can hit the same installed copy.

## The table

| # | Package | Ver | Ecosystem | Manifest | Sev | GHSA / CVE | Vulnerable range | Patched | Classification | Actually reachable? |
|---|---|---|---|---|---|---|---|---|---|---|
| 172 | nanoid | 3.3.17 | npm | `mobile/package-lock.json` | high | GHSA-2v37-7h3g-55p8 / CVE-2026-67213 | `< 3.3.18` | **3.3.18** | **SHIPS TO USERS** | Yes — bundled. `@react-navigation/routers`, `/core`, `/native` all `import { nanoid } from 'nanoid/non-secure'` |
| 173 | nanoid | 3.3.17 | npm | `package-lock.json` (Next.js admin) | high | GHSA-2v37-7h3g-55p8 / CVE-2026-67213 | `< 3.3.18` | **3.3.18** | BUILD-TIME ONLY | No — transitive via `postcss` only (`postcss <- next`, `postcss <- @tailwindcss/postcss`) |
| 171 | nanoid | 3.3.17 | npm | `landing/package-lock.json` | high | GHSA-2v37-7h3g-55p8 / CVE-2026-67213 | `< 3.3.18` | **3.3.18** | BUILD-TIME ONLY | No — single path `postcss <- vite` |
| 170 | image-size | 1.2.1 | npm | `mobile/package-lock.json` | high | GHSA-5p2g-fcmc-qvqq / CVE-2025-71329 | `<= 2.0.2` | **none exists** | BUILD-TIME ONLY | No — transitive via `metro` (`metro <- @expo/metro <- expo`, `metro <- @react-native/community-cli-plugin <- react-native`) |
| 169 | image-size | 1.2.1 | npm | `mobile/package-lock.json` | high | GHSA-w3rx-r6r6-pgpr / CVE-2025-71330 | `<= 2.0.2` | **none exists** | BUILD-TIME ONLY | No — same `metro` paths as #170 |
| 166 | brace-expansion | 2.1.0 | npm | `package-lock.json` | high | GHSA-rgw5-rvv9-x895 / CVE-2026-69152 | `>= 2.0.0, < 2.1.4` | **2.1.4** | BUILD-TIME ONLY (lint) | No — `minimatch <- @typescript-eslint/typescript-estree <- eslint-config-next` |
| 149 | brace-expansion | 2.1.0 | npm | `package-lock.json` | high | GHSA-mh99-v99m-4gvg / CVE-2026-14257 | `>= 2.0.0, < 2.1.3` | **2.1.3** | BUILD-TIME ONLY (lint) | No — same copy as #166 |
| 165 | brace-expansion | 1.1.14 | npm | `package-lock.json` | high | GHSA-rgw5-rvv9-x895 / CVE-2026-69152 | `< 1.1.18` | **1.1.18** | BUILD-TIME ONLY (lint) | No — `minimatch <- eslint`, `<- eslint-plugin-import/-react/-jsx-a11y` |
| 164 | brace-expansion | 1.1.14 | npm | `package-lock.json` | high | GHSA-mh99-v99m-4gvg / CVE-2026-14257 | `< 1.1.17` | **1.1.17** | BUILD-TIME ONLY (lint) | No — same copy as #165 |

Summaries, verbatim from the advisories:

- **nanoid** — custom generators can loop indefinitely when size is zero. Infinite loop in
  `customAlphabet` / `customRandom` when configured with size 0; hangs the calling thread.
- **image-size (both)** — DoS via infinite loop in the JXL/HEIF (#170) and ICNS (#169) parsers when
  a crafted image supplies a zero-valued size/length field; the offset never advances and the
  Node event loop is permanently blocked.
- **brace-expansion GHSA-mh99-v99m-4gvg** — DoS via unbounded expansion length; a ~7.5 KB input
  crashes Node with an uncatchable OOM.
- **brace-expansion GHSA-rgw5-rvv9-x895** — the `maxLength` mitigation for the above is incomplete;
  intermediate arrays are still unbounded, ~25 KB input still OOMs.

## Classification counts

- **SHIPS TO USERS: 1** (alert 172 — mobile `nanoid`)
- **BUILD-TIME ONLY: 8** (alerts 173, 171, 170, 169, 166, 165, 164, 149)
- **TEST ONLY: 0**

No direct import of `nanoid`, `image-size`, `brace-expansion`, `minimatch`, or `postcss` exists
anywhere in PikTag's own source, in any of the three workspaces. Every one of these 9 alerts is a
transitive dependency. The mobile app generates its own IDs with `expo-crypto`
(`Crypto.randomUUID()` in `mobile/src/hooks/useChatThread.ts`,
`mobile/src/screens/SearchScreen.tsx`, `mobile/src/components/ask/AskStoryRow.tsx`) and reads image
dimensions from `expo-image-manipulator` and the camera's own reported `photo.width/height`
(`mobile/src/lib/scanCard.ts`, `mobile/src/screens/CardCameraScreen.tsx`) — not from these packages.

### The one that ships is not actually exploitable

Alert 172 is the only entry that reaches an end user's device, and it still cannot be triggered,
on two independent grounds:

1. React Navigation only ever calls bare `nanoid()` with no arguments (default size 21) — for
   example `key: \`stack-${nanoid()}\`` in `StackRouter.js`. It never calls `customAlphabet` or
   `customRandom`, which are the vulnerable functions. Nothing in the mobile app's shipped
   dependency set calls them either.
2. The `nanoid/non-secure` entry point is the only one React Navigation imports, and in the
   *installed* 3.3.17 it already carries the fix: `while (i-- > 0)` at
   `mobile/node_modules/nanoid/non-secure/index.cjs:8` and `:18`. The vulnerable
   `while (i--)` lives at `mobile/node_modules/nanoid/index.cjs:38`, inside `customRandom` in the
   main entry — which is never loaded by the app bundle.

So the real user-facing risk from this entire alert list is effectively zero. Fix it anyway,
because it is a free patch bump, but do not treat it as an incident.

## Do these three first

Ordered by real risk to users and by effort-to-noise ratio, not by CVSS.

### 1. `nanoid` in mobile — the only thing that ships

```
cd mobile && npm audit fix
```

Or equivalently and more narrowly: `cd mobile && npm update nanoid`.
3.3.17 -> 3.3.18, a patch bump. All three declared ranges (`^3.3.11` from the three
`@react-navigation` packages, `^3.3.16` from `postcss`) already admit 3.3.18, so this resolves with
zero semver friction and touches nothing else. Safe to apply blind.

### 2. `nanoid` in landing and root — same one-line fix, closes 2 more alerts

```
cd landing && npm audit fix
npm audit fix          # repo root
```

Both are `postcss <- vite` / `postcss <- next` build-time only. Same 3.3.17 -> 3.3.18 patch bump.
Safe to apply blind. Doing these at the same time as #1 takes the open count from 9 to 6.

### 3. `brace-expansion` in root — dev-only, but it is 4 of the 9 alerts

```
npm audit fix          # repo root
```

Handled by the same root command as #2. Upgrades the two copies to 1.1.18 and 2.1.4; `minimatch`
declares `^1.1.7` and `^2.0.2`, so both patched versions are in range. These only run under ESLint
(`npm run lint`, and `next build`'s built-in lint pass) — no user ever executes this code. It is
worth doing purely because the repo is public and 4 of the 9 visible high alerts vanish for free.

After 1-3, the open count drops from **9 to 2**, and the 2 remaining are the unfixable `image-size` pair.

## Do NOT do this

**Never run `npm audit fix --force` in `mobile/`.** Verified by dry run:

```
npm warn audit Updating expo to 53.0.27, which is a SemVer major change.
npm warn audit Updating react-native to 0.72.17, which is a SemVer major change.
```

It would downgrade Expo 54.0.36 -> 53.0.27 and React Native 0.81.5 -> 0.72.17 on a launched app,
against 37+ peer-dependency conflicts (reanimated 4.1.7 requires `react-native 0.78 - 0.82`).
That is a guaranteed break, and it would not even fix anything.

**The `image-size` alerts (169, 170) cannot be fixed and should be accepted or dismissed.**
The advisories say `<= 2.0.2` and the latest published version *is* 2.0.2 — there is no patched
release in existence, which is why the API returns `first_patched_version: null` for both. Metro is
the only consumer, so triggering it requires feeding a crafted JXL/HEIF/ICNS file into your own
developer machine's bundler. Recommended action: dismiss both in the Dependabot UI as
"no patch available" / low real risk, and revisit when upstream ships a fix. Do not attempt a
workaround that pins Metro.

## Would `npm audit fix` (without `--force`) resolve it, per workspace

| Workspace | Plain `npm audit fix` outcome | Needs `--force`? |
|---|---|---|
| `landing/` | Resolves everything. `1 high` -> 0. | No |
| repo root | Resolves everything npm reports: nanoid, both `brace-expansion` copies, and `js-yaml`. `3 high` -> 0. | No |
| `mobile/` | Resolves `nanoid` only. npm's own message: "To address issues that do not require attention, run: `npm audit fix`". The `metro` / `image-size` chain is left alone, correctly. | The rest would need `--force`, which must not be run — see above |

## Note: npm audit sees more than Dependabot has alerted on

Not part of the 9, but surfaced while verifying. Worth a separate look, not urgent:

- **Repo root, `js-yaml` 4.2.0 (dev)** — two high advisories, GHSA-52cp-r559-cp3m and
  GHSA-5p4m-2wfm-xmqj, quadratic CPU consumption. Dev-only, and plain `npm audit fix` clears it.
  Dependabot has not raised an alert for this yet.
- **Repo root, `brace-expansion`** — npm also reports GHSA-3jxr-9vmj-r5cp against the same copies;
  the same `npm audit fix` covers it.
- **`mobile/`, 14 high total from npm** — the extra count over Dependabot's 3 is the
  `metro` / `metro-config` / `metro-transform-worker` / `@react-native/metro-config` /
  `react-native-worklets` chain, all of it inheriting the unfixable `image-size` problem. Same
  conclusion: build-time only, no upstream patch, leave it.

There is no `.github/dependabot.yml` in the repo, so alerting runs on GitHub defaults with no
manifest scoping or ignore rules configured. Adding one would be the clean way to record the
`image-size` acceptance decision in-repo rather than only in the UI.
