# pikt.ag Domain Switch: piktag-landing -> lqtech-bio

Move the custom domain `pikt.ag` from the Vercel project `piktag-landing`
(currently serving an Expo web `dist/` bundle) to `lqtech-bio` (Next/static at
`web/` with bio/tag/invite APIs).

- Vercel CLI account: `lqtech2026`
- Team (scope): `lqtechs-projects`
- CLI version verified: `50.23.2`
- Note on syntax:
  - `vercel domains add <domain> <project>` -> attaches a domain already owned
    by the team to a specific project. This is the correct command for this
    switch (it will move the domain from the old project to the new one on
    re-add, since the team already owns `pikt.ag`).
  - `vercel alias set <deployment-url> <domain>` -> points an alias at a
    specific deployment URL, not a project. Only used here as a fallback /
    rollback to pin a known-good deployment.

---

## 0. Pre-flight checklist

Run these BEFORE touching the domain. Do not proceed until every box is ticked.

- [ ] `web/index.html` is the real landing page (not the "即將上線" placeholder).
  ```bash
  head -c 2000 /Users/aimand/.gemini/File/PikTag-mobile/../lqtech-bio/web/index.html
  # (or in whichever repo hosts lqtech-bio)
  grep -i "即將上線\|coming soon\|placeholder" web/index.html && echo "STILL PLACEHOLDER - STOP" || echo "OK"
  ```
- [ ] `web/public/delete-account.html` exists (Google Play requires it).
  ```bash
  test -f web/public/delete-account.html && echo OK || echo MISSING
  test -f web/public/privacy.html        && echo OK || echo MISSING
  test -f web/public/terms.html          && echo OK || echo MISSING
  ```
- [ ] `web/api/u/[username].js` works on the current preview domain.
  ```bash
  curl -sS -o /dev/null -w "%{http_code}\n" https://lqtech-bio.vercel.app/api/u/armand
  curl -sS https://lqtech-bio.vercel.app/armand | head -c 500
  # expect HTML "User not found" or a real profile, NOT a 404 from Vercel
  ```
- [ ] Production build of `lqtech-bio` succeeds.
  ```bash
  cd path/to/lqtech-bio            # repo root that contains web/
  vercel link --project lqtech-bio --scope lqtechs-projects --yes
  vercel pull --environment=production --scope lqtechs-projects --yes
  vercel build --prod
  vercel deploy --prebuilt --prod --scope lqtechs-projects
  # capture the returned deployment URL, e.g. lqtech-bio-abc123.vercel.app
  export LQ_DEPLOY=lqtech-bio-abc123.vercel.app
  curl -sS -o /dev/null -w "%{http_code}\n" https://$LQ_DEPLOY/
  curl -sS -o /dev/null -w "%{http_code}\n" https://$LQ_DEPLOY/delete-account
  curl -sS -o /dev/null -w "%{http_code}\n" https://$LQ_DEPLOY/armand
  ```
- [ ] Current `piktag-landing` deployment URL captured for rollback.
  ```bash
  vercel ls piktag-landing --scope lqtechs-projects | head -5
  # save the top-most READY production URL, e.g. piktag-landing-xyz789.vercel.app
  export PIKTAG_DEPLOY=piktag-landing-xyz789.vercel.app
  ```

---

## 1. Commands to execute (in order)

Run from the `lqtech-bio` repo root (the directory that contains `web/`).
Keep `$LQ_DEPLOY` and `$PIKTAG_DEPLOY` exported from pre-flight.

```bash
# 1. Confirm you are in the right account / scope
vercel whoami
# expect: lqtech2026
vercel teams ls
# make sure lqtechs-projects is the active team (or pass --scope every call)

# 2. Link local dir to lqtech-bio
cd path/to/lqtech-bio               # repo root (one above web/)
vercel link --project lqtech-bio --scope lqtechs-projects --yes

# 3. Inspect current domain ownership
vercel domains ls --scope lqtechs-projects
vercel domains inspect pikt.ag --scope lqtechs-projects
# note which project pikt.ag is attached to (should read piktag-landing)

# 4. Move pikt.ag to lqtech-bio
#    `vercel domains add` on an owned domain re-attaches it to the new project,
#    which automatically detaches it from piktag-landing.
vercel domains add pikt.ag lqtech-bio --scope lqtechs-projects

# 5. (Optional) Add the apex + www explicitly if you also serve www
#    vercel domains add www.pikt.ag lqtech-bio --scope lqtechs-projects

# 6. Promote the verified deployment so traffic flips immediately
#    (only needed if step 4 did not auto-alias to a production deployment)
vercel alias set "$LQ_DEPLOY" pikt.ag --scope lqtechs-projects

# 7. Re-verify ownership
vercel domains inspect pikt.ag --scope lqtechs-projects
# expect: "project: lqtech-bio"
```

If step 4 errors with "domain already assigned to another project", run:
```bash
vercel domains rm pikt.ag --scope lqtechs-projects --yes
vercel domains add pikt.ag lqtech-bio --scope lqtechs-projects
vercel alias set "$LQ_DEPLOY" pikt.ag --scope lqtechs-projects
```
(Removing and re-adding keeps team ownership but clears the stale project link.)

---

## 2. Verification commands

Run from any machine. Wait ~30-60 s after step 6 for DNS/alias propagation.

```bash
# Cache-bust with a timestamp query string to avoid CDN/edge caching.
T=$(date +%s)

# 2.1 Landing page (new lqtech-bio web/index.html)
curl -sS "https://pikt.ag/?t=$T" | head -c 1200
# expect: HTML of the new landing page. Must NOT contain "即將上線" or the
# old Expo bundle's "<div id=\"root\">" placeholder from piktag-landing.

# 2.2 Bio profile rewrite (web/api/u/[username].js)
curl -sS "https://pikt.ag/armand?t=$T" | head -c 500
# expect: rendered "User not found" page (or a real profile), served by the
# lqtech-bio API. A raw 404 means the rewrite did not wire up.

# 2.3 Google Play data-deletion page
curl -sS -o /dev/null -w "delete-account: %{http_code}\n" "https://pikt.ag/delete-account?t=$T"
curl -sS "https://pikt.ag/delete-account?t=$T" | grep -i "delete" | head -3
# expect: 200 and content from web/public/delete-account.html

# 2.4 Privacy page
curl -sS -o /dev/null -w "privacy: %{http_code}\n" "https://pikt.ag/privacy?t=$T"
curl -sS "https://pikt.ag/privacy?t=$T" | grep -i "privacy" | head -3
# expect: 200 and content from web/public/privacy.html

# 2.5 Terms page (bonus)
curl -sS -o /dev/null -w "terms: %{http_code}\n" "https://pikt.ag/terms?t=$T"

# 2.6 TLS / headers sanity
curl -sSI "https://pikt.ag/?t=$T" | grep -iE "server|x-vercel|strict-transport"
# expect: server: Vercel, x-vercel-id present.

# 2.7 CLI-side confirmation
vercel domains inspect pikt.ag --scope lqtechs-projects
vercel alias ls --scope lqtechs-projects | grep pikt.ag
```

All four curl checks must succeed before the switch is considered done.

---

## 3. Rollback (if broken)

Goal: put `pikt.ag` back on `piktag-landing` with minimal downtime.

```bash
# 3.1 Fastest path: re-alias to the last good piktag-landing deployment
#     (works even if the project attachment is messed up)
vercel alias set "$PIKTAG_DEPLOY" pikt.ag --scope lqtechs-projects

# 3.2 Re-attach the domain to piktag-landing for long-term ownership
vercel domains add pikt.ag piktag-landing --scope lqtechs-projects

# 3.3 If step 3.2 complains the domain is still on lqtech-bio
vercel domains rm pikt.ag --scope lqtechs-projects --yes
vercel domains add pikt.ag piktag-landing --scope lqtechs-projects
vercel alias set "$PIKTAG_DEPLOY" pikt.ag --scope lqtechs-projects

# 3.4 Verify rollback
curl -sS "https://pikt.ag/?t=$(date +%s)" | head -c 500
vercel domains inspect pikt.ag --scope lqtechs-projects
# expect: project reads piktag-landing again
```

If `$PIKTAG_DEPLOY` was not captured in pre-flight, recover it with:
```bash
vercel ls piktag-landing --scope lqtechs-projects
# pick the most recent READY production deployment and re-run 3.1
```

---

## 4. Post-switch TODOs

- [ ] Grep the mobile app + repos for hardcoded `piktag-landing.vercel.app`
      and replace with `pikt.ag`:
  ```bash
  rg -n "piktag-landing\.vercel\.app" /Users/aimand/.gemini/File
  rg -n "piktag-landing\.vercel\.app" /Users/aimand/.gemini/File/PikTag-mobile
  ```
- [ ] Update deep links / `app.json` / Android `intent-filter` hosts and
      iOS Associated Domains if any reference the old bare vercel URL.
- [ ] Update Google Play Console "Data deletion URL" to
      `https://pikt.ag/delete-account` (and Privacy URL to
      `https://pikt.ag/privacy`) if they currently point at the old host.
- [ ] Update any email templates, marketing pages, QR codes, or printed
      materials still pointing at `piktag-landing.vercel.app`.
- [ ] After 1-2 weeks of stable traffic on `lqtech-bio`:
  - [ ] Archive or delete the `piktag-landing` Vercel project
        (`vercel project rm piktag-landing --scope lqtechs-projects`).
  - [ ] Archive or delete the `piktag` Vercel project if it is also stale.
  - [ ] Remove the stale `dist/` build + `echo` buildCommand hack from the
        old repo to avoid accidental re-deploys.
- [ ] Confirm `pikt.ag` SSL cert auto-renews on lqtech-bio
      (`vercel domains inspect pikt.ag` -> cert expiry > 60 days out).
