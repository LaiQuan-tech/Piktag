# PikTag Post-Launch Monitoring Checklist

Owner: armand7951@gmail.com
Last updated: 2026-04-17
Package: `ag.pikt.piktag` (verify in Play Console)

This checklist covers the rollout from Internal Testing → Closed Testing → Production on Google Play. Work top-to-bottom within each section; items are ordered by priority.

---

## Day 0 — Launch day

Critical path. Do these in order before promoting the release to the next track.

- [ ] **Sentry health probe** — Install the staging/internal build, trigger a test crash (e.g. hidden debug button or `throw new Error('sentry-smoketest-' + Date.now())`). Confirm the event appears in Sentry project `4511227846066176` within 60s with correct `release` and `environment` tags.
- [ ] **PostHog `app_opened` event** — Open the production build on a clean device. In PostHog Live Events, confirm `app_opened` fires with `$app_version`, `$device_id`, and `$os_version` populated. Verify the user shows up in Persons within 2 minutes.
- [ ] **Signup / login flow on real Android device** — Test on at least one physical device (not emulator). Run: (1) email signup → email verification → first login; (2) sign out → sign in; (3) invalid password → correct error surfaced. Screenshot each step for the launch log.
- [ ] **End-to-end QR scan across 2 devices** — Device A creates a tag, Device B scans it. Confirm the scanned payload matches what was encoded, the associated profile/data loads, and PostHog logs `qr_scanned` on Device B. Repeat with camera permission denied → confirm graceful fallback.
- [ ] **Delete-account flow** — Sign in on a throwaway account, trigger Delete Account in-app. Confirm: (1) Supabase edge function `delete-account` returns 200; (2) `auth.users` row is gone; (3) related rows in user-owned tables are removed or anonymized; (4) user is signed out locally and cannot sign back in with the same credentials.
- [ ] **https://pikt.ag loads < 2s** — Run `curl -w "%{time_total}\n" -o /dev/null -s https://pikt.ag` three times from a non-cached network. All three runs should be under 2.0s. Also check Vercel Analytics → Web Vitals for LCP < 2.5s on mobile.
- [ ] **https://pikt.ag/delete-account returns 200** — `curl -I https://pikt.ag/delete-account` returns `200 OK`. Page renders the Google-Play-required instructions (URL is linked from the store listing's Data Safety section).
- [ ] **Google Play listing visual QA** — On the live Play Store page (not Console preview): icon renders at all sizes, feature graphic crisp, all screenshots in correct order and locale, short + long description free of typos, category and contact email correct.
- [ ] **Release tagged in git + Sentry** — Tag the release commit (`git tag v1.0.0 && git push --tags`) and confirm Sentry's Releases page shows the same version with source maps uploaded.
- [ ] **Rollback plan staged** — Previous AAB (versionCode − 1) accessible in Play Console artifact library; halt-rollout steps documented in a pinned Slack/Notion note.

---

## Day 1–7 — First week

Daily 10-minute check-in. Log findings in a shared launch doc.

### Stability
- [ ] **Sentry crash-free users > 99%** — Check daily. Any individual issue with > 10 users affected gets triaged same day.
- [ ] **Android Vitals: ANR rate < 0.47%, crash rate < 1.09%** — Play Console → Quality → Android vitals. Crossing the "bad behavior" threshold risks organic reach.
- [ ] **Top 5 Sentry issues triaged** — Each issue either: fixed in next patch, assigned to a Jira/Linear ticket, or explicitly marked "wontfix" with a reason.

### Engagement
- [ ] **PostHog DAU / new signups tracking up-and-to-the-right** — Daily snapshot of DAU, new signups, and signup → first-scan conversion. Anything flat or declining 2 days in a row is a red flag.
- [ ] **FCM push delivery verified** — Send a test notification via Firebase Console to a known test device. Confirm delivery on foreground + background + killed-app states. Check FCM delivery success rate > 95% in the Firebase console.
- [ ] **Spam signup scan** — Query Supabase `auth.users` for signups with obviously invalid patterns (emails from burner domains, > 5 signups from same IP in 1h, names matching `/^[a-z]{10,}$/`). Block at Supabase Auth level if volume is non-trivial.

### Store
- [ ] **Respond to every 1-2 star review within 24h** — Play Console → Ratings & Reviews. Personal, non-templated responses. Ask for the exact device model + Android version; funnel repro steps into Sentry search.
- [ ] **Answer every 3+ star review with a question or issue within 48h.**
- [ ] **Watch install → open conversion** — Play Console install base vs PostHog `app_opened` unique users. Gap > 15% suggests an onboarding crash on first launch.

---

## Day 8–30 — First month

Weekly review cadence. Focus shifts from firefighting to optimization.

### Stability
- [ ] **Crash-free users > 99.5%** — Stretch goal; below 99% triggers a patch release.
- [ ] **Top crash reports prioritized in the backlog** — Top 3 Sentry issues by `users affected` each get a ticket with reproduction steps, suspected root cause, and target fix version.
- [ ] **Sentry performance: cold start < 2s (p75), screen transitions < 400ms (p75)** — If regressed vs. pre-launch baseline, investigate before shipping new features.

### Retention
- [ ] **D1 retention > 40%, D7 > 20%, D30 > 10%** — PostHog Retention report on the `signup_completed` → `app_opened` cohort. Numbers well below these suggest onboarding or core-loop problems.
- [ ] **Funnel analysis: signup → first QR scan → second session** — Identify the biggest drop-off step and design one experiment to address it.

### Growth
- [ ] **Store conversion rate (listing visits → installs)** — Play Console → Store performance. Target > 25% for the primary acquisition country. Below that, A/B test the feature graphic or short description.
- [ ] **Search keyword performance** — Play Console → Acquisition reports → Organic search. Identify the top 3 keywords driving installs; consider ASO updates to the long description.

### Backend / cost
- [ ] **Supabase usage within plan limits** — DB size, auth MAUs, edge function invocations, egress. Project a 30-day trajectory; upgrade plan before hitting 80% of any limit.
- [ ] **FCM error rate < 1%** — Spike often means stale tokens; confirm token-refresh logic is firing on app upgrade.

---

## Red flags — immediate response (page the on-call)

Any of these triggers a Sev 2 or higher. Response target: acknowledge within 15 min, mitigate or roll back within 1h.

- **Sentry crash rate spikes > 2% in a 1h window.** Halt Play Console rollout percentage. Identify the offending release. Ship a patch or revert to previous AAB.
- **Sign-in failure rate > 5%** (PostHog `sign_in_failed` / `sign_in_attempted`). First check Supabase Auth status page, then Supabase logs for rate-limit or schema errors.
- **Supabase 5xx rate > 1%** over any 15-min window. Check Supabase status, then your edge function logs, then recent migrations.
- **Google Play policy violation notice** (email from Play team or Console banner). Do NOT push another release until resolved — it will be blocked. Read the notice in full, reply within 48h, escalate to Google Play support if the violation is unclear.
- **Credential stuffing / fake-login burst** — > 100 failed sign-ins from a single IP in 10min, or a sudden spike in `auth.users` with disposable-email domains. Enable Supabase Auth rate-limiting, consider adding a CAPTCHA, rotate any exposed API keys.
- **Sentry release health "crashed sessions" chart goes vertical.** Same response as crash rate spike.
- **PostHog stops receiving events for > 30 min.** Check PostHog status, then that the API key baked into the released AAB is still valid.
- **pikt.ag or delete-account URL returns non-200.** Play Store listing requires the delete URL to work — a broken link can cause your app to be flagged.

---

## Key dashboards / tools

Fill in exact URLs on launch day; bookmark all in a single browser folder named "PikTag Launch".

- **Sentry (crashes, perf, releases):** https://sentry.io/organizations/<ORG>/issues/?project=4511227846066176
  - DSN in app: `https://a6f25db2278dc71a2ea41314adc226c0@o4511225670402048.ingest.us.sentry.io/4511227846066176`
  - Org slug: _fill in_
- **PostHog (analytics, funnels, retention):** https://us.posthog.com/project/<PROJECT_ID>
  - Key dashboards to create day-0: "Launch overview", "Onboarding funnel", "Retention cohorts".
- **Supabase (DB, auth, edge functions, logs):** https://supabase.com/dashboard/project/<PROJECT_REF>
  - Auth logs, edge function logs for `delete-account`, DB query performance.
- **Google Play Console:** https://play.google.com/console/u/0/developers/<DEV_ID>/app/<APP_ID>/app-dashboard
  - Tabs to check daily: Android vitals, Ratings & reviews, Statistics, Release overview.
- **Firebase (FCM):** https://console.firebase.google.com/project/<PROJECT_ID>/notification
  - Delivery reports; ensure the service account key path matches the one in `reference_google_play_upload.md`.
- **Vercel (landing + delete-account page):** https://vercel.com/<TEAM>/pikt-ag
  - Web Vitals, deployment logs, edge function metrics.
- **UptimeRobot / Better Stack (recommended add-on):** monitor `https://pikt.ag` and `https://pikt.ag/delete-account` every 5 min; page on 2 consecutive failures.

---

## Launch log template

Keep a running doc (Notion/Google Doc) with one entry per day for the first 30 days:

```
YYYY-MM-DD
- Release: vX.Y.Z (versionCode N)
- Crash-free users (24h): NN.NN%
- DAU: N / New signups: N
- Top Sentry issue: <title> (N users)
- Reviews received: N (avg star: N.N)
- Actions taken today:
- Open questions:
```
