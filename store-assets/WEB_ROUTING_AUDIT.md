# web/ Routing & Config Audit

Audited: 2026-04-17
Target Vercel project: `lqtech-bio` (team `lqtechs-projects`, will serve pikt.ag)
Source files: `/Users/aimand/.gemini/File/PikTag-mobile/web/`

Note: the local `web/.vercel/project.json` is currently linked to `piktag-app`, NOT
`lqtech-bio`. Before deploying this code to `lqtech-bio` you must re-link
(`vercel link --project lqtech-bio`) or deploy from CI with the correct project id.

---

## Missing rewrites

- **`/i/:code` → `/api/i/:code`** — file `web/api/i/[code].js` exists (invite-code
  landing page with piktag://invite deep-link) but there is NO rewrite rule, so
  `https://pikt.ag/i/ABC123` will 404 / fall through to the `/:username` catch-all
  and try to resolve `i` as a username. High priority.
- **No rewrite for `/` (root)** — root currently serves top-level `web/index.html`
  (the full landing page). `web/public/index.html` is an unreachable placeholder
  ("即將上線"). Not a bug, but note the duplication.

## Duplicate / unreachable files

Both top-level AND `public/` contain these HTML files:

| File | Top-level served as | `public/` copy reachable? |
|---|---|---|
| `download.html` | `/download` (via rewrite) | NO — `/public/download.html` path not whitelisted, and rewrite points to `/download.html` at root |
| `scan.html` | `/scan` (via rewrite) | NO — same as above |
| `privacy.html` | — | YES via `/privacy` rewrite |
| `terms.html` | — | YES via `/terms` rewrite |
| `delete-account.html` | — | YES via `/delete-account` rewrite |
| `index.html` | — | NO — shadowed by top-level `index.html` |

Action: delete `web/public/download.html` and `web/public/scan.html` (stale
duplicates of top-level files) OR update rewrites to point at the public/ versions
if those are the canonical ones. Right now nobody can tell which is authoritative.

## Missing config

- **`robots.txt`** — absent. Needed for search-engine control (at minimum a
  permissive one so Google can index profile pages).
- **`sitemap.xml`** — absent. Optional but recommended; profile pages are dynamic
  so at minimum list the static marketing pages (`/`, `/download`, `/privacy`,
  `/terms`, `/delete-account`, `/scan`).
- **Security headers** (none defined in `vercel.json`):
  - `Content-Security-Policy`
  - `X-Frame-Options: DENY` (or `SAMEORIGIN`)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  Google Play reviewers flag absent HSTS / CSP on privacy/delete-account pages
  as a soft issue.
- **`Cache-Control` headers** — `/api/i/[code].js` sets `public, max-age=0,
  s-maxage=60` itself. `/api/u/[username].js` and `/api/tag/[tagname].js` do NOT
  set any cache header (verified — no `Cache-Control` call in those handlers),
  which means Vercel's default = no CDN caching, every request re-hits Supabase.
  Recommend adding per-route headers in `vercel.json` or setting `res.setHeader`
  in each handler (e.g. `s-maxage=60, stale-while-revalidate=300` for profile
  pages).
- **404 handling** — `web/404.html` exists and Vercel auto-serves it for
  unmatched static routes. Google Play asset-links scanner should be happy; no
  action needed. BUT the `/:username` catch-all rewrite means a typo'd username
  goes through the API handler (which correctly returns its own branded 404 HTML
  via `notFoundPage(locale)`), so the static `404.html` is rarely hit.

## Env vars required for bio API

Inspecting `web/api/_config.js`:

| Var | Required? | Fallback in code? |
|---|---|---|
| `SUPABASE_URL` | runtime | YES — `https://kbwfdskulxnhjckdvghj.supabase.co` hardcoded |
| `SUPABASE_ANON_KEY` | runtime | YES — anon JWT hardcoded in source |

No other `process.env.*` references in `_config.js`, `api/u/[username].js`,
`api/tag/[tagname].js`, or `api/i/[code].js`.

### Present in `lqtech-bio` project env?

Verified via `vercel env ls` (linked `/tmp/lqtech-bio-check` to the project):

> **No Environment Variables found for lqtechs-projects/lqtech-bio**

Both `SUPABASE_URL` and `SUPABASE_ANON_KEY` are ABSENT. Because `_config.js`
has hardcoded fallbacks, the API will still function — but this means:

1. The anon key is committed to the repo (already the case — not new exposure,
   but worth noting).
2. Rotating the anon key would require a code deploy, not an env update.
3. If you ever want to point lqtech-bio at a non-prod Supabase, you'd need env
   vars set; currently impossible without a code change.

**Recommendation:** add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the
`lqtech-bio` env (Production + Preview + Development) mirroring the hardcoded
values, so ops parity is clean.

## Suggested vercel.json delta

```json
{
  "rewrites": [
    { "source": "/privacy", "destination": "/public/privacy.html" },
    { "source": "/terms", "destination": "/public/terms.html" },
    { "source": "/delete-account", "destination": "/public/delete-account.html" },
    { "source": "/download", "destination": "/download.html" },
    { "source": "/scan", "destination": "/scan.html" },
    { "source": "/tag/:tagname", "destination": "/api/tag/:tagname" },
    { "source": "/i/:code", "destination": "/api/i/:code" },
    { "source": "/:username", "destination": "/api/u/:username" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    },
    {
      "source": "/(privacy|terms|delete-account|download|scan)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=3600, s-maxage=86400" }
      ]
    },
    {
      "source": "/:username",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" }
      ]
    }
  ]
}
```

Notes on the delta:
- Added `/i/:code` rewrite (MUST — this is the invite-code landing page).
- Ordering: `/i/:code` is before `/:username` so it wins (Vercel evaluates in
  order).
- Headers block is additive and safe.
- CSP intentionally omitted — the profile/tag/invite HTML is generated inline in
  the API handlers with inline `<style>` and inline `<script>`, so a strict CSP
  would break them. Add CSP only after converting those to nonce-based or
  external styles (separate follow-up).

## Verdict

**SOFT-GO** for domain switch to pikt.ag.

The site will function on `lqtech-bio` as-is (hardcoded Supabase fallback means
API routes work even without env vars), BUT do these before flipping DNS:

1. **Add `/i/:code` rewrite** (otherwise invite-code deep links from the app
   are broken on web).
2. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `lqtech-bio` project env (ops
   hygiene, enables future rotation).
3. Re-link `web/.vercel/project.json` to `lqtech-bio` (currently `piktag-app`)
   so `vercel --prod` from `web/` deploys to the correct project.

Nice-to-haves (non-blocking): robots.txt, security headers block, Cache-Control
on `/api/u/*` and `/api/tag/*`, cleanup of duplicate `public/download.html` and
`public/scan.html`.
