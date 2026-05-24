# Analytics Setup Runbook

> Operator guide for configuring PostHog, GA4, and Meta Pixel for the PikTag landing site and share-link API on Vercel.

## Overview

PikTag emits analytics from three surfaces:

| Surface | SDK | Where it runs | What it tracks |
|---------|-----|---------------|----------------|
| **Mobile app** | `posthog-react-native` | iOS / Android device | App opens, signup, friend adds, messages, asks |
| **Landing web client** | `posthog-js`, `gtag.js`, `fbq` | Browser (built by Vite) | Page views, autocapture clicks, download CTA |
| **Share-link API** | `posthog-node` | Vercel serverless functions | `share_link_viewed` (server-side) |

The mobile app uses a hardcoded write-only PostHog key (see `mobile/src/lib/analytics.ts`) and is **not** configured via env vars. Everything else flows through Vercel.

## Required environment variables

All env vars are configured in the **Vercel dashboard** for the `landing` project (Project → Settings → Environment Variables).

### Build-time (landing client bundle)

These are injected into the client-side JS bundle by Vite at build time. The `VITE_` prefix is required — Vite only exposes vars that start with it.

| Variable | Required | Value | Where to find it |
|----------|----------|-------|------------------|
| `VITE_PUBLIC_POSTHOG_KEY` | Yes | `phc_CagxzXtHwJ6xXYQ2pdDGmmbh5kRiyQ7ikjFjJnSrr7Hr` | Same key the mobile app uses (PostHog project settings → Project API Key). Hardcode the default; override only if splitting projects. |
| `VITE_GA_MEASUREMENT_ID` | Yes | `G-XXXXXXXXXX` | GA4 Admin → Data Streams → Web stream → Measurement ID |
| `VITE_META_PIXEL_ID` | Yes | 15-digit numeric ID | Meta Events Manager → Data Sources → your pixel → Pixel ID |

### Runtime (share-link serverless API)

These are read at request time by the Vercel functions in `landing/api/u/`, `landing/api/i/`, and `landing/api/tag/`. No `VITE_` prefix — they stay server-side.

| Variable | Required | Value | Notes |
|----------|----------|-------|-------|
| `POSTHOG_API_KEY` | Yes | Same `phc_...` key as mobile | Server fires `share_link_viewed` events. Same project, so the funnel can join client + server events. |
| `META_PIXEL_ID` | Optional | Same 15-digit ID | Used for server-rendered `<script>` injection on share pages so crawlers and no-JS clients still register a pixel hit. |
| `GA_MEASUREMENT_ID` | Optional | Same `G-...` ID | Same purpose as above for GA4. |

## Step-by-step: setting env vars in Vercel

1. Open the Vercel dashboard, select the **landing** project.
2. Go to **Settings → Environment Variables**.
3. Click **Add New**.
4. **Key**: enter the variable name from the tables above (exact case).
5. **Value**: paste the value.
6. **Environments**: tick the boxes for the environments where this variable should apply.
   - For PostHog/GA/Meta keys: tick **Production**, **Preview**, and **Development** so funnels work in feature branches too. If you want preview branches isolated from production analytics, create a separate PostHog project and use a different key for Preview.
   - For secrets you do not want leaking into preview deployments: tick **Production** only.
7. Click **Save**.
8. Trigger a redeploy: the **next** deployment picks up the new env vars. Existing deployments keep the old values baked in (this is by design for build-time vars).

## Verifying the setup

After deploying:

1. **PostHog client** — open the landing site in a browser, then check PostHog → Activity. You should see a `$pageview` event from your IP within 30 seconds.
2. **PostHog server** — visit a share link (e.g. `https://piktag.app/u/some-username`). PostHog should show a `share_link_viewed` event with `share_type: "user"` and a server-side `$lib` value.
3. **GA4** — open GA4 → Reports → Realtime. Visit the landing page; you should see 1 active user.
4. **Meta Pixel** — install the Meta Pixel Helper Chrome extension, load the landing page, and confirm a `PageView` fires.

If any of the four checks fail, see the **Troubleshooting** section below.

## Rollback

The SDKs are designed to no-op when keys are missing. To disable a specific provider in production:

1. Vercel dashboard → Settings → Environment Variables.
2. **Delete** the variable (or clear its value).
3. Redeploy.

The client code reads each key with a fallback to `undefined`, and the SDKs detect missing keys and skip initialization. No code change needed.

To roll back a single problematic event (rather than disable the whole provider), filter it out in the PostHog **Ingestion → Filtered events** UI — instant, no redeploy.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `$pageview` events not arriving | `VITE_PUBLIC_POSTHOG_KEY` missing in the build environment | Check Vercel **Deployments → [latest] → Building** logs. The key must be set **before** the build runs, not after. Redeploy after adding. |
| `share_link_viewed` missing | `POSTHOG_API_KEY` not set on the Production environment | Vercel → Functions logs → search for `posthog`. A missing key prints a console warning at request time. |
| GA4 realtime shows nothing | Wrong stream ID, or the GA4 stream is filtered to a different domain | Confirm the Measurement ID matches the **Web** stream, not an App stream, and the stream URL pattern includes your deployment domain. |
| Meta Pixel Helper says "no events" | Pixel blocked by ad blocker, or wrong ID | Test in an incognito window with extensions disabled. Confirm the 15-digit ID matches Events Manager. |
| Events arriving in PostHog but `distinct_id` looks anonymous after signup | Identity not bridged client → server | Pass the user's `distinct_id` as a query param on the share link, or call `posthog.identify()` from the mobile app right after signup. |

## Notes for future operators

- **Never commit env values to git.** The `.env.example` file lists keys only; populate them in Vercel.
- **Mobile app keys are hardcoded by design.** PostHog write keys are public (same model as Sentry DSN). Do not move them to env vars unless you also build a remote-config delivery path.
- **Keep one PostHog project for production.** Splitting mobile and web into separate projects breaks every cross-surface funnel (especially Funnel 1: Web → App Install).
- **Preview deploys leak.** If `Preview` environment uses the production PostHog key, every PR preview pollutes production data. Use a separate Preview key, or filter on `$current_url` in PostHog dashboards.
