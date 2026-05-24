# PikTag — what's automatic vs. what you run by hand

Supabase project ref: `kbwfdskulxnhjckdvghj`

There are **three independent deployment channels**. Pushing to
`main` only handles ONE of them. The other two are manual and are
the #1 source of "the feature is in the repo but looks broken in
the app" bugs.

---

## 1. App code — AUTOMATIC

**What:** `mobile/src/**`, `mobile/app.json`, assets, anything that
ships in the JS/native bundle.

**How:** push to `main` → GitHub Actions builds & uploads:
- `iOS TestFlight Build` → TestFlight
- `Android Google Play Build` → Play internal

**Build number** = GitHub Actions `run_number` + 1
(see `ios-testflight.yml`, "Set iOS build number"). It is a
per-workflow counter, NOT a commit count. Failed runs still consume
a number. Builds run serially on slow macOS runners, so TestFlight
**lags the commit stream** — being green in the repo ≠ live on your
phone yet. To find the build for a specific commit: GitHub →
Actions → the run on that commit → `Run #N` → TestFlight build
`N+1`, then ~10–15 min Apple processing.

**Path filter:** `mobile/supabase/**` and `mobile/scripts/**` do
**not** trigger app builds (DB-only, never in the bundle). A mixed
commit that also touches `mobile/src/**` still builds.

---

## 2. DB migrations — MANUAL

**What:** `mobile/supabase/migrations/*.sql`

**How:** open the file, paste its contents into the **Supabase SQL
Editor**, Run. There is **no `supabase db push` in CI**. The
`supabase_migrations.schema_migrations` table does **NOT** reflect
reality on this project — never trust it.

All migrations here are written idempotent (`CREATE OR REPLACE`,
`IF NOT EXISTS`, `DROP ... IF EXISTS`, `ON CONFLICT DO NOTHING`),
so re-running an already-applied one is safe.

**After applying any migration batch, run the drift check:**
- `mobile/scripts/migration_drift_check.sql` — 255+ objects;
  `present=false` ⇒ that migration never (fully) applied.
- `mobile/scripts/fk_audit.sql` — every FK + its ON DELETE rule;
  `blocks_parent_delete=true` rows are potential "can't delete X"
  bugs (this is how the Vibe-delete bug was found).

⚠️ The drift check verifies **schema objects only, not seed DATA**.
Seed migrations (`20260328_seed_multilingual_aliases.sql` etc.)
that only `INSERT` rows are invisible to it — verify those by
querying counts (`SELECT count(*) FROM tag_aliases;` etc.).

Regenerate the drift-check SQL after adding migrations:
```
python3 mobile/scripts/gen_migration_drift_check.py
```

## 3. Edge functions — MANUAL

**What:** `mobile/supabase/functions/<name>/index.ts`

**How:**
```
npx supabase functions deploy <name> --project-ref kbwfdskulxnhjckdvghj
```
(`npx supabase` — the bare `supabase` binary may not be on PATH.)
Not auto-deployed. Editing the file + pushing does nothing until
you run this.

---

## Scheduled / recurring (already wired, FYI)

- **`auto-link-concepts`** — daily via `.github/workflows/daily-cron.yml`
  (UTC 19:00 / TW 03:00). Links new tags to semantic concepts
  (alias-first, then 0.85 embedding fallback).
- **Magic-moment + birthday/anniversary crons** — pg_cron inside
  the DB (`SELECT * FROM cron.job;` to inspect).

---

## "I changed X — what do I do?"

| Changed | Action |
|---|---|
| `mobile/src/**` (screens, components, i18n) | push → wait for the TestFlight/Play build |
| `mobile/supabase/migrations/*.sql` | push (for history) **+ run it in SQL Editor** + drift-check |
| `mobile/supabase/functions/**` | push (for history) **+ `npx supabase functions deploy <name>`** |
| Both app + DB in one commit | push (app builds) **+ still run the SQL / deploy fn by hand** |

The recurring failure mode: a DB change is committed and assumed
live because CI is green, but CI never touched the DB. If a
feature looks broken with no error in the app, **run the drift
check before debugging app code** — odds are a migration was never
applied.

---

## Post-launch backlog (don't forget)

Curate the semantic-tag seed from real user data once there's
volume — surface "these singleton concepts are probably synonyms"
candidates, hand-add aliases as a new seed migration, backfill,
verify. (Flagged as a separate task; the seed's breadth is the
real lever for cross-language tag matching at scale, not more
code.)
