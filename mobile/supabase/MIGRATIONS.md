# Supabase Migration Workflow

**Project**: PikTag (`kbwfdskulxnhjckdvghj`)
**Last full sync**: 2026-05-26 — every migration tracked by CLI matches what's on the remote DB.

---

## TL;DR — adding a new migration

```bash
cd mobile

# 1. Create the file. Name MUST be: YYYYMMDDHHMMSS_short_name.sql
#    (14-digit timestamp + underscore + descriptive name)
touch supabase/migrations/$(date -u +%Y%m%d%H%M%S)_my_change.sql

# 2. Write idempotent SQL inside (ADD COLUMN IF NOT EXISTS,
#    CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
#    POLICY, etc.). See any of our 2026-05-2x migrations for examples.

# 3. Push to remote
npx supabase db push

# 4. Done. Future devs / CI / your-future-self use the same command.
```

No more SQL Editor copy-paste. No more "did this run?" anxiety.

---

## What gets pushed

`db push` compares local files against the `supabase_migrations.schema_migrations` table on remote, and applies anything NOT yet tracked. Idempotent because:

- Our migrations all guard with `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `CREATE OR REPLACE`. Re-running is safe.
- The CLI records each successful apply in the tracking table, so a second `db push` becomes a no-op.

---

## Historical wart (CLEANED 2026-05-26)

There used to be 36 files whose names confused the CLI:

- **16 dup-prefix orphans** — e.g. three files all starting with
  `20260328_…`, but the CLI's `version text PRIMARY KEY` can only track
  one per prefix. The siblings were invisible to CLI tracking.
- **11 letter-suffix files** — e.g. `20260428b_*.sql` — rejected by
  the CLI's filename validator entirely.
- **9 8-digit primary files** — after the rename, the CLI's
  longest-prefix matcher started pulling them away from their own
  tracking rows, leaving the 8-digit remote rows phantom.

All renamed to unique 14-digit timestamps. Tracking table backfilled
via `migration repair`. End state: every migration in
`supabase/migrations/` has a matching applied row in
`supabase_migrations.schema_migrations`. `supabase db push --dry-run`
returns "Remote database is up to date."

Going forward, name every new migration `YYYYMMDDHHMMSS_short_name.sql`
and never reuse a prefix.

---

## Recovery commands

### My new migration didn't apply

```bash
# Check what the CLI thinks is the diff:
npx supabase migration list

# Look for your timestamp — if Remote column is blank, it wasn't applied.
# Force push:
npx supabase db push

# If you're SURE it actually IS applied (you manually ran it via SQL
# Editor), tell the CLI to just record it:
npx supabase migration repair --status applied <timestamp>
```

### I applied something manually via SQL Editor before this CLI workflow existed

```bash
npx supabase migration repair --status applied <timestamp>
```

`<timestamp>` is the 14-digit prefix of your file (e.g. `20260526030000`). No need to specify the rest of the filename.

### Schema drift suspicion (DB has something migrations don't)

```bash
# Generate a diff between local migration history and remote DB:
npx supabase db diff --linked --schema public > /tmp/drift.sql
# Review /tmp/drift.sql. If non-empty, capture the delta into a new
# migration so the tree of truth catches up.
```

---

## Edge functions (still manual)

```bash
cd mobile
npx supabase functions deploy <function-name>
# Or all:
for f in supabase/functions/*/; do
  name=$(basename "$f")
  npx supabase functions deploy "$name"
done
```

Phase 2 plan: GitHub Actions on push-to-main, auto-deploy any function whose files changed. Not yet set up.

---

## CI automation (not yet set up)

When ready (post-launch + reliability proven), this all wraps into a single GitHub Actions step:

```yaml
- name: Apply DB migrations
  run: |
    cd mobile
    npx supabase db push
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD:  ${{ secrets.SUPABASE_DB_PASSWORD }}
```

Track this as task #36 sibling or a fresh "infra hardening" item when the time comes.
