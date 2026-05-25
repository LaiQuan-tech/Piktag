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

## Known wart: 16 "orphan" legacy files

There are 16 files with duplicate 8-digit timestamp prefixes (e.g. `20260328_seed_multilingual_aliases.sql` AND `20260328_tag_concepts.sql` — same `20260328` prefix). The CLI's tracking table uses `version text PRIMARY KEY`, so only ONE file per timestamp can be tracked. The other siblings are invisible to CLI tracking forever — they're applied to the DB, just unrecorded.

**What this means for `db push`**: every run will see those 16 files and want to "insert them" with `--include-all`. It'll fail with PK collision because the prefix is already tracked.

**Workaround until cleanup**: just don't use `--include-all`. Plain `npx supabase db push` works correctly because:
- It excludes files whose timestamp is OLDER than the latest tracked remote
- The 16 orphans are all from March–May, well before the current latest
- New migrations (June onwards or later May 2026) get pushed fine

**Permanent fix (future cleanup task)**: rename the 16 to unique 14-digit timestamps and `migration repair --status applied <new-ts>` each. ~15 min work but disrupts git history. Defer until someone has a quiet morning.

For reference, the 16 files:

```
20260328_seed_multilingual_aliases.sql
20260328_tag_concepts.sql
20260330_biolinks_display_mode.sql
20260330_blocks_reports.sql
20260401_connections_is_reviewed.sql
20260401_share_location.sql
20260412_profile_location_updated_at.sql
20260413_p_points_system.sql
20260417_tag_presets_rls.sql
20260421_chat_push_trigger.sql
20260425_tag_name_unique.sql
20260425_user_detail_rpc.sql
20260427_security_rls_blocks_reports.sql
20260428_explore_users_rpc.sql
20260429_drop_contract_expiry.sql
20260508140000_popular_tags_near_location.sql
```

Plus 11 files with letter-suffix timestamps (e.g. `20260428b_*.sql`) that the CLI rejects entirely (filename pattern mismatch). Same status: applied to DB, invisible to CLI. Future cleanup.

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
