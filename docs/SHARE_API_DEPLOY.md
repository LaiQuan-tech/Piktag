# Share API — Deploy Notes

The `/api/u/[username]`, `/api/i/[code]`, and `/api/tag/[tagname]` routes
are Vercel serverless functions that render public share pages. They
read Supabase credentials from `api/_config.js`, which currently has
**hardcoded fallbacks** for deploy stability. The fallbacks should be
shadowed by Vercel env vars in production.

## Setting env vars in Vercel

1. Open the Vercel dashboard and select the PikTag project.
2. Go to **Settings → Environment Variables**.
3. Add the following, scoped to **Production** (and Preview, if you want
   preview deploys to hit the real Supabase project):

   | Name                | Value                                          |
   | ------------------- | ---------------------------------------------- |
   | `SUPABASE_URL`      | `https://kbwfdskulxnhjckdvghj.supabase.co`     |
   | `SUPABASE_ANON_KEY` | (anon key from Supabase → Settings → API)      |

4. Click **Save**, then trigger a redeploy (Deployments → ⋯ → Redeploy)
   so the new env vars take effect.

## Verifying after deploy

Pick a known-good username (e.g. an account you control) and curl the
share endpoint. A 200 with rendered HTML containing the username/avatar
means Supabase access is working:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://pikt.ag/<known-username>
# → 200

curl -s https://pikt.ag/<known-username> | grep -o '<title>.*</title>'
# → <title>...PikTag</title>
```

If you get a 404 page rendered for a username you know exists, the
Supabase client likely can't reach the project — check the env vars
and the Vercel function logs for the route.

## When to rotate the anon key

The anon key is RLS-gated, so a leak has limited blast radius — anyone
holding it can only do what an unauthenticated client can do (read
public profiles, etc.). Still, rotate if any of the following happen:

- The key is committed to a public repo or pasted into a public channel.
- You see unusual traffic patterns in Supabase logs attributed to the
  anon role.
- Someone outside the team gained access to the Vercel project at any
  point.

To rotate:

1. Supabase Dashboard → **Settings → API → Reset anon key**.
2. Update `SUPABASE_ANON_KEY` in Vercel (and EAS secrets for the mobile
   app — `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
3. Redeploy Vercel and ship a new mobile build.
4. Once both are out, remove the old fallback string from
   `api/_config.js` in a follow-up PR.

## Removing the fallback

Once env vars are confirmed working in production for at least one
deploy cycle, the fallback in `api/_config.js` can be replaced with a
hard requirement:

```js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[api/_config] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}
```

Do this in its own PR so any deploy gap is easy to revert.
