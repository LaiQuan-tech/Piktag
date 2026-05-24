# PostHog Funnels & Dashboards

> Recommended PostHog UI configurations for measuring PikTag's growth loops. Each funnel below is copy-pasteable into the PostHog **Insights → Funnels** builder.

## How to use this doc

1. Open PostHog → **Insights → New insight → Funnel**.
2. Match the **Steps**, **Filters**, **Conversion window**, and **Visualization** values from the table below.
3. Save with the suggested **Name** so dashboards stay consistent.
4. Add to the **PikTag Growth** dashboard (create one if it does not exist).

All funnels use **strict order** unless noted. Conversion windows are stated per funnel — keep them short for in-session loops, long for cross-device journeys.

---

## Funnel 1: Web → App Install

Measures how well share links convert browsers into signed-up app users. This is the top-of-funnel viral metric.

| Field | Value |
|-------|-------|
| **Name** | `Web → App Install` |
| **Step 1** | `share_link_viewed` (server event from share API) |
| **Step 2** | `download_clicked` (landing web event) |
| **Step 3** | `signup_complete` (mobile event) |
| **Conversion window** | 7 days |
| **Visualization** | Funnel steps (vertical bar) |
| **Breakdown** | `share_type` (values: `user`, `invite`, `tag`) |
| **Notes** | Step 1 → Step 2 measures landing page effectiveness. Step 2 → Step 3 measures install-to-signup conversion (deep links, store flow). |

---

## Funnel 2: Signup conversion

Measures how well the mobile onboarding flow converts app opens into accounts. Use this to detect onboarding regressions.

| Field | Value |
|-------|-------|
| **Name** | `Signup Conversion` |
| **Step 1** | `app_open` filtered to `$screen = "Onboarding"` |
| **Step 2** | `signup_complete` |
| **Conversion window** | 1 day |
| **Visualization** | Funnel steps |
| **Breakdown** | `method` on Step 2 (`apple` / `google` / `email`) |
| **Notes** | The `$screen` property comes from the `trackScreen()` auto-capture in `App.tsx`. If you do not have an explicit `app_open` event, substitute the PostHog session-start event or the first `$screen` event of a session. |

---

## Funnel 3: First-friend connection

Measures time-to-AHA — the first friend connection is the strongest predictor of retention.

| Field | Value |
|-------|-------|
| **Name** | `First Friend Connection` |
| **Step 1** | `signup_complete` |
| **Step 2** | `qr_scanned` |
| **Step 3** | `friend_added` |
| **Conversion window** | 1 day |
| **Visualization** | Funnel steps with **time-to-convert** chart enabled |
| **Breakdown** | `source` on Step 3 (`qr` / `search` / `contact` / `invite`) |
| **Notes** | If users add friends without scanning (`source = search` or `contact`), Step 2 is skipped — switch to **strict order: off** if you want a more permissive funnel. |

---

## Funnel 4: Ask engagement

Measures how many signed-up users actually post their first Ask (the core content-creation action).

| Field | Value |
|-------|-------|
| **Name** | `Ask Engagement` |
| **Step 1** | `signup_complete` |
| **Step 2** | `ask_posted` |
| **Conversion window** | 7 days |
| **Visualization** | Funnel steps |
| **Breakdown** | none (overall conversion rate is the headline number) |
| **Notes** | Track this weekly. A drop here typically signals a UX regression in the Ask composer or a missing prompt to post on first session. |

---

## Funnel 5: Invite viral loop

Measures the closed-loop K-factor: an existing user invites a friend, the friend lands, signs up, and connects back.

| Field | Value |
|-------|-------|
| **Name** | `Invite Viral Loop` |
| **Step 1** | `invite_shared` (mobile, by inviter) |
| **Step 2** | `share_link_viewed` filtered to `share_type = "invite"` (server) |
| **Step 3** | `signup_complete` (mobile, by invitee) |
| **Step 4** | `friend_added` filtered to `source = "invite"` (mobile, by either party) |
| **Conversion window** | 14 days |
| **Visualization** | Funnel steps |
| **Breakdown** | none |
| **Notes** | This funnel will only stitch end-to-end if `invite_shared` and `share_link_viewed` share a `code` property and PostHog can correlate them. Add `code` as a property on both events (already present on `invite_redeemed`). |

---

## Retention dashboard

Track Day-1, Day-7, Day-30 retention based on `app_open` to monitor product stickiness.

| Field | Value |
|-------|-------|
| **Insight type** | Retention |
| **Name** | `App Retention (D1/D7/D30)` |
| **Cohort event** | `signup_complete` (cohorting users by signup day) |
| **Returning event** | `app_open` (or first `$screen` event of session) |
| **Period** | Day |
| **Look-back** | 30 days |
| **Visualization** | Retention table + curve |
| **Notes** | Add this to the PikTag Growth dashboard alongside Funnel 2 and Funnel 4 — together they tell the full activation + retention story. |

---

## Share-link breakdown insight

A single trend chart showing how each share-link type performs.

| Field | Value |
|-------|-------|
| **Insight type** | Trends |
| **Name** | `Share-Link Views by Type` |
| **Event** | `share_link_viewed` |
| **Breakdown** | `share_type` (`user` / `invite` / `tag`) |
| **Visualization** | Stacked area chart, daily |
| **Period** | Last 30 days |
| **Notes** | Use this to identify which viral path is driving the most reach. Pair with Funnel 1 (broken down by `share_type`) to see which path also converts best. |

---

## Recommended dashboard layout

Create a dashboard called **PikTag Growth** with these tiles, top-to-bottom:

1. **Funnel 1: Web → App Install** (full width, headline metric)
2. **Funnel 2: Signup Conversion** (half) | **Funnel 4: Ask Engagement** (half)
3. **Funnel 3: First Friend Connection** (half) | **Funnel 5: Invite Viral Loop** (half)
4. **Share-Link Views by Type** (full width)
5. **App Retention D1/D7/D30** (full width)

Pin this dashboard to the PostHog homepage so it is the first thing the team sees on login.

## Alerting

Set PostHog **Subscriptions** on these signals (Insight → ⋯ → Subscribe):

- Funnel 2 conversion drops below 60% (week-over-week) — onboarding regression.
- Funnel 4 conversion drops below 30% (week-over-week) — engagement drop.
- `share_link_viewed` daily volume drops > 40% week-over-week — share API broken or being blocked.

Send subscriptions to the team Slack channel via PostHog's Slack integration.
