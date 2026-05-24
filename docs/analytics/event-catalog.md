# Event Catalog

> Complete inventory of every analytics event PikTag fires across mobile, landing web, and the share-link API. Use this as the source of truth when adding new funnels or debugging missing data.

## Conventions

- **Source** identifies the surface that emits the event. `mobile` = React Native app, `landing` = Vite web client, `share-api` = Vercel serverless functions in `landing/api/`.
- **Trigger** describes the user action or code path that fires the event. If a property has a `$` prefix it is a PostHog auto-property.
- **Used in funnel** references funnel numbers from [`posthog-funnels.md`](./posthog-funnels.md).
- All events go to the same PostHog project, so server and client events can be joined on `distinct_id` (when identity is bridged) or `code` / `share_type` (for anonymous viral attribution).

---

## Mobile events

Defined in [`mobile/src/lib/analytics.ts`](../../mobile/src/lib/analytics.ts). All disabled in `__DEV__`.

| Event name | Trigger | Properties | Used in funnel |
|------------|---------|------------|----------------|
| `hidden_tag_added` | User adds a hidden tag to a friend on the friend detail screen. | `tag_type: "time" \| "location" \| "frequent" \| "text"` | — |
| `friend_detail_viewed` | User opens a friend's detail page from the connections list or a notification. | (none) | — |
| `tag_filter_applied` | User taps a tag chip on `ConnectionsScreen` to filter the friend list. | `tag_name: string` (e.g. `"work"`, `"college"`) | — |
| `invite_shared` | User taps the share button on the invite QR / link sheet. | (none) | 5 |
| `invite_redeemed` | A new user enters or scans a valid invite code. | `code: string` (e.g. `"ABCD1234"`) | — |
| `signup_complete` | New account is created via Apple, Google, or email. | `method: "apple" \| "google" \| "email"` | 1, 2, 3, 4, 5 |
| `login_complete` | Existing account signs in. | `method: "apple" \| "google" \| "email"` | — |
| `qr_scanned` | Camera decodes a QR code (any type, including invalid). | `type: "invite" \| "profile" \| "unknown"` | 3 |
| `friend_added` | A bidirectional friend connection is successfully created. | `source: "qr" \| "search" \| "contact" \| "invite"` | 1 (cross-surface), 3, 5 |
| `message_sent` | User sends a chat message in a 1:1 or group thread. | (none) | — |
| `ask_posted` | User publishes an Ask. | (none) | 4 |
| `$screen` | Auto-fired by `trackScreen()` from `NavigationContainer`'s state listener on every route change. | `$screen_name: string`, optional route params | 2 (Onboarding screen filter) |

### Mobile auto-events

PostHog React Native also captures these automatically once initialized:

| Event | Trigger | Notes |
|-------|---------|-------|
| `$identify` | When `posthog.identify()` is called (typically right after `signup_complete` / `login_complete`). | Bridges anonymous device ID to user ID. |
| `$opt_in` / `$opt_out` | User toggles the analytics setting in Settings. | Driven by `setAnalyticsOptIn()`. |
| `Application Opened` / `Application Backgrounded` | App lifecycle. Used as the `app_open` proxy in retention insights. | Available without code changes. |

---

## Landing web events

Will be added by agent 1 in [`landing/src/lib/analytics.ts`](../../landing/src/lib/analytics.ts). Fire from the browser via `posthog-js`.

| Event name | Trigger | Properties | Used in funnel |
|------------|---------|------------|----------------|
| `$pageview` | Auto-captured on initial load **and** manually re-fired on every client-side route change (SPA navigation). | `$current_url`, `$referrer`, `$pathname`, `utm_*` | — |
| `$autocapture` | PostHog autocapture: every click, form submit, and input change on the landing site. | `$event_type` (`click` / `submit` / `change`), `$elements` (element tree), `$el_text` | — |
| `download_clicked` | User clicks the "Download on the App Store" or "Get it on Google Play" CTA. | `store: "ios" \| "android"`, `placement: "hero" \| "footer" \| "share-page"` | 1 |

In addition, the landing client mirrors key events to **GA4** (via `gtag('event', ...)`) and **Meta Pixel** (via `fbq('track', ...)`):

| Event | GA4 name | Meta Pixel name |
|-------|----------|-----------------|
| `$pageview` | `page_view` (auto) | `PageView` (auto) |
| `download_clicked` | `download_clicked` (custom) | `Lead` |

---

## Share-API server events

Will be added by agent 2. Fired from Vercel serverless functions in `landing/api/u/[username].js`, `landing/api/i/[code].js`, and `landing/api/tag/[tagname].js` using `posthog-node`.

| Event name | Trigger | Properties | Used in funnel |
|------------|---------|------------|----------------|
| `share_link_viewed` | Any HTTP request to a share-link route (excluding bot user agents). | `share_type: "user" \| "invite" \| "tag"`, `slug: string` (the username, code, or tagname), `referrer: string \| null`, `user_agent: string`, `country: string` (from Vercel `request.geo`), `code: string` (only when `share_type = "invite"`, joins to `invite_shared`) | 1, 5 |

### Server event notes

- The server sets `distinct_id` to a deterministic anonymous ID derived from the request (e.g. hash of IP + user-agent) when no `?did=...` query param is present. The mobile app should append `?did=<posthog_distinct_id>` when generating share links so server views attribute correctly.
- Bot detection is handled inside the API handler — known crawlers (Googlebot, Slackbot link unfurlers, Twitterbot) are skipped to avoid skewing funnel volume.
- The server uses `posthog.capture({ ... })` from `posthog-node` and **must** await the flush in serverless (via `await posthog.shutdown()`) or events get dropped on cold-finish.

---

## Quick reference: which events feed which funnel

| Funnel | Events |
|--------|--------|
| 1 — Web → App Install | `share_link_viewed` (server) → `download_clicked` (web) → `signup_complete` (mobile) |
| 2 — Signup Conversion | `app_open` / `$screen=Onboarding` (mobile) → `signup_complete` (mobile) |
| 3 — First Friend Connection | `signup_complete` → `qr_scanned` → `friend_added` (all mobile) |
| 4 — Ask Engagement | `signup_complete` → `ask_posted` (both mobile) |
| 5 — Invite Viral Loop | `invite_shared` (mobile) → `share_link_viewed` `share_type=invite` (server) → `signup_complete` (mobile) → `friend_added` `source=invite` (mobile) |

---

## Adding a new event

1. Define a typed helper in the appropriate `analytics.ts` (mobile, landing, or server).
2. Call it from the user-action site — never fire raw `posthog.capture()` strings inline.
3. Add a row to this catalog under the correct **Source** section.
4. If the event participates in a funnel, update [`posthog-funnels.md`](./posthog-funnels.md) and the **which events feed which funnel** table above.
5. Verify the event arrives in PostHog → **Live events** before merging.

## Properties to keep stable

These property keys are referenced by saved funnels and dashboards. Renaming them silently breaks every chart that filters on them. If you must rename, do the migration in PostHog first (Insights → bulk edit) before the code change ships.

- `share_type` (server) — values `user` / `invite` / `tag`
- `method` (signup/login) — values `apple` / `google` / `email`
- `source` (friend_added) — values `qr` / `search` / `contact` / `invite`
- `type` (qr_scanned) — values `invite` / `profile` / `unknown`
- `code` (invite_shared, invite_redeemed, share_link_viewed when type=invite)
