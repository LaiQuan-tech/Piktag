# QA Checklist — `tag_added` Notification (reactive, social tab)

Migration: `20260428s_notification_tag_added.sql`
Trigger function: `public.notify_tag_added()` on `piktag_user_tags AFTER INSERT FOR EACH ROW`
Recipient: `NEW.user_id` (profile owner being tagged); Actor: `auth.uid()` of inserter.

---

## 1. Schema verification (source table per spec, columns, RLS)

- [ ] Confirm `piktag_user_tags` exists with columns: `id uuid PK`, `user_id uuid NOT NULL`, `tag_id uuid NOT NULL`, `position int`, `weight numeric`, `is_private boolean`, `is_pinned boolean`, `created_at timestamptz`, `UNIQUE (user_id, tag_id)`.
  ```sql
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='piktag_user_tags'
   ORDER BY ordinal_position;
  ```
- [ ] Confirm `piktag_tags` has `id uuid PK` and `name text UNIQUE` (used to resolve `tag_name` for body).
  ```sql
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='piktag_tags' AND column_name IN ('id','name');
  ```
- [ ] Confirm `piktag_profiles` has `id`, `username`, `full_name`, `avatar_url`, `push_token`.
- [ ] Confirm `piktag_notifications` exists with `user_id, type, title, body, data jsonb, is_read, created_at` per spec §1.2.
- [ ] Verify migration file is named exactly `20260428s_notification_tag_added.sql` (no collision with suffixes `q`, `r`, `t`).
- [ ] RLS — `piktag_user_tags`: inserts allowed for `authenticated` users (a user can tag themselves OR another user's profile depending on existing policy); SELECT scoped per current policy. Spec does NOT mandate adding new RLS in this migration.
  ```sql
  SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='piktag_user_tags';
  ```
- [ ] RLS — `piktag_notifications`: trigger inserts via `SECURITY DEFINER`, so policy must NOT block the function owner. Verify owner is `postgres` and recipient `auth.uid() = user_id` SELECT policy still in place.

---

## 2. Trigger function `notify_tag_added()` syntax + GRANTs + search_path

- [ ] Function declared `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`.
  ```sql
  SELECT proname, prosecdef, proconfig
    FROM pg_proc WHERE proname='notify_tag_added';
  -- expect prosecdef=t, proconfig contains 'search_path=public'
  ```
- [ ] Function captures actor via `current_setting('request.jwt.claim.sub', true)::uuid`. If NULL (service-role insert) → `RETURN NEW` without notifying.
- [ ] Skip when `v_actor = NEW.user_id` (self-tag).
- [ ] Resolves `tag_name` via `SELECT name FROM piktag_tags WHERE id = NEW.tag_id`.
- [ ] Body string rendered: `'tagged you as #' || v_tag_name`.
- [ ] `data` JSONB includes: `actor_user_id`, `username`, `avatar_url`, `tag_id`, `tag_name`, `user_tag_id`.
- [ ] GRANTs:
  ```sql
  REVOKE ALL ON FUNCTION public.notify_tag_added() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.notify_tag_added() TO postgres, service_role;
  -- Verify:
  SELECT grantee, privilege_type FROM information_schema.routine_privileges
   WHERE routine_name='notify_tag_added';
  ```
- [ ] Trigger correctly attached:
  ```sql
  SELECT tgname, tgrelid::regclass, tgenabled FROM pg_trigger
   WHERE tgname='trg_notify_tag_added';
  -- expect tgrelid='piktag_user_tags', tgenabled='O'
  ```
- [ ] `DROP TRIGGER IF EXISTS trg_notify_tag_added ON piktag_user_tags;` precedes `CREATE TRIGGER` (idempotent re-run).
- [ ] Inline push dispatch wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END;` — push failure must NOT roll back the notification insert.

---

## 3. Functional tests — happy paths + edges (exact SQL)

### Setup (shared by all tests)
```sql
-- Users: alice (profile owner), bob (tagger), carol (third party).
-- Assume alice_uid, bob_uid, carol_uid are real auth.users ids with piktag_profiles rows.
-- Tag #cool exists in piktag_tags as cool_tag_id.
INSERT INTO piktag_tags (id, name) VALUES (gen_random_uuid(), 'cool')
  ON CONFLICT (name) DO NOTHING;
```

### Happy 1: Bob tags Alice with #cool → notification fires for Alice
- [ ] Run as Bob (JWT set):
  ```sql
  SET LOCAL request.jwt.claim.sub = '<bob_uid>';
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<alice_uid>', '<cool_tag_id>');
  ```
- [ ] Verify:
  ```sql
  SELECT user_id, type, title, body, data
    FROM piktag_notifications
   WHERE user_id='<alice_uid>' AND type='tag_added'
   ORDER BY created_at DESC LIMIT 1;
  -- expect title='', body='tagged you as #cool',
  --        data->>'actor_user_id'=bob_uid, data->>'tag_id'=cool_tag_id,
  --        data->>'tag_name'='cool', data->>'username'=<bob username>.
  ```

### Happy 2: Carol tags Alice with a different tag #vibes → second distinct notification
- [ ] Insert `vibes` tag, then:
  ```sql
  SET LOCAL request.jwt.claim.sub = '<carol_uid>';
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<alice_uid>', '<vibes_tag_id>');
  ```
- [ ] Expect a NEW row distinct from Happy 1 (`data->>'tag_id'` differs).

### Happy 3: Bob tags Alice with #cool again 25h later → new notification (outside 24h dedup)
- [ ] Backdate Happy 1 row:
  ```sql
  UPDATE piktag_notifications SET created_at = now() - interval '25 hours'
   WHERE user_id='<alice_uid>' AND type='tag_added' AND data->>'tag_id'='<cool_tag_id>';
  ```
- [ ] Re-tag (after delete/re-insert of `piktag_user_tags` row, since UNIQUE constraint blocks re-insert):
  ```sql
  DELETE FROM piktag_user_tags WHERE user_id='<alice_uid>' AND tag_id='<cool_tag_id>';
  SET LOCAL request.jwt.claim.sub = '<bob_uid>';
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<alice_uid>', '<cool_tag_id>');
  ```
- [ ] Expect `count(*) = 2` for `(alice, tag_added, cool)` notifications.

### Edge 1 (CRITICAL): Self-tag must NOT notify
- [ ] Run as Alice tagging her own profile:
  ```sql
  SET LOCAL request.jwt.claim.sub = '<alice_uid>';
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<alice_uid>', '<cool_tag_id>');
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<alice_uid>' AND type='tag_added'
     AND data->>'actor_user_id'='<alice_uid>';
  -- expect 0
  ```

### Edge 2: Tag added by viewer to themselves (variant of Edge 1, alternate phrasing)
- [ ] Bob tags himself (`bob_uid` is both actor and `user_id`):
  ```sql
  SET LOCAL request.jwt.claim.sub = '<bob_uid>';
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<bob_uid>', '<vibes_tag_id>');
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<bob_uid>' AND type='tag_added';
  -- expect 0 (no row created for self-tag)
  ```

### Edge 3: Service-role insert (no JWT) → trigger short-circuits
- [ ] As `service_role`:
  ```sql
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<alice_uid>', '<vibes_tag_id>');
  -- request.jwt.claim.sub is unset → v_actor IS NULL → RETURN NEW, no notification.
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<alice_uid>' AND type='tag_added' AND data->>'tag_id'='<vibes_tag_id>'
     AND created_at > now() - interval '1 minute';
  -- expect 0
  ```

### Edge 4: Tag with NULL or missing `piktag_tags.name`
- [ ] If `tag_id` resolves to no row, body should still be safe (e.g., `tagged you as #unknown` or skip). Verify trigger does not throw.

---

## 4. Dedup test (24h window, key: `actor_user_id` + `tag_id`)

- [ ] Insert Happy 1 fresh, then attempt rapid duplicate:
  ```sql
  DELETE FROM piktag_notifications WHERE user_id='<alice_uid>' AND type='tag_added';
  DELETE FROM piktag_user_tags WHERE user_id='<alice_uid>' AND tag_id='<cool_tag_id>';

  SET LOCAL request.jwt.claim.sub='<bob_uid>';
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<alice_uid>','<cool_tag_id>');
  -- DELETE then re-INSERT within the same hour:
  DELETE FROM piktag_user_tags WHERE user_id='<alice_uid>' AND tag_id='<cool_tag_id>';
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<alice_uid>','<cool_tag_id>');

  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<alice_uid>' AND type='tag_added'
     AND data->>'actor_user_id'='<bob_uid>'
     AND data->>'tag_id'='<cool_tag_id>'
     AND created_at > now() - interval '24 hours';
  -- expect 1 (the second insert was deduped)
  ```
- [ ] Different `tag_id` from same actor within 24h → NOT deduped (verify count grows).
- [ ] Different `actor_user_id` for same `tag_id` within 24h → NOT deduped.
- [ ] Confirm dedup SQL in trigger uses BOTH keys ANDed:
  ```
  data->>'actor_user_id' = v_actor::text AND data->>'tag_id' = NEW.tag_id::text
  AND created_at > now() - interval '24 hours'
  ```

---

## 5. Push notification test

- [ ] Set Alice's `push_token`:
  ```sql
  UPDATE piktag_profiles SET push_token='ExponentPushToken[TEST_xxx]' WHERE id='<alice_uid>';
  ```
- [ ] Trigger Happy 1; verify push dispatched. Expected Expo payload:
  ```json
  { "to": "ExponentPushToken[TEST_xxx]",
    "title": "<bob_username>",
    "body":  "tagged you as #cool",
    "data":  { "type": "tag_added", "actor_user_id": "<bob_uid>", "tag_id": "<cool_tag_id>", "tag_name": "cool" },
    "sound": "default", "priority": "high" }
  ```
- [ ] If trigger uses `net.http_post` relay: inspect `net.http_request_queue` / `net._http_response` for the call; if inline `pg_net`, check return code 200 from Expo.
- [ ] Push token NULL → notification still inserted, push silently skipped (no error raised).
- [ ] Push endpoint 5xx → trigger does NOT roll back; `SELECT count(*) FROM piktag_notifications ...` still shows the row.
- [ ] Verify foreground app does NOT show OS banner (handled by mobile push handler).

---

## 6. Mobile UI test (social tab, tap → UserDetail of tagger)

- [ ] Open mobile app as Alice → Notifications screen → social tab. New `tag_added` row visible at top.
- [ ] Renders `data.username` (Bob) + avatar from `data.avatar_url` + body `tagged you as #cool`.
- [ ] Unread dot visible (`is_read=false`).
- [ ] Tap row → navigates to `UserDetail` of `data.actor_user_id` (Bob), NOT to a tag-detail screen.
  - Verify `NotificationsScreen.tsx` routing: `tag_added` reads `data.actor_user_id` for navigation target.
- [ ] After tap, row marked `is_read=true` (verify in DB).
- [ ] Realtime: while Notifications screen is open, insert a fresh `tag_added` from another session → row appears without manual refresh (subscribed via `postgres_changes` on `user_id`).
- [ ] Switch to reminders tab → `tag_added` row NOT shown there.
- [ ] i18n: switch device language to zh-TW → body renders `把你標記為 #cool` (i18n key `notifications.types.tag_added.body`).
- [ ] Long tag name (e.g. 50 chars) does not break layout; truncated with ellipsis if needed.

---

## 7. Performance test

- [ ] Bulk insert 1,000 `piktag_user_tags` rows from distinct actors to a single recipient; measure trigger overhead:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS)
  INSERT INTO piktag_user_tags (user_id, tag_id)
  SELECT '<alice_uid>', t.id FROM piktag_tags t LIMIT 1000;
  ```
  Target: <2 ms avg per row trigger overhead.
- [ ] Verify dedup SELECT uses an index. Required (or already-existing) index:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_notifications_user_type_created
    ON piktag_notifications (user_id, type, created_at DESC);
  EXPLAIN ANALYZE
  SELECT 1 FROM piktag_notifications
   WHERE user_id='<alice_uid>' AND type='tag_added'
     AND data->>'actor_user_id'='<bob_uid>'
     AND data->>'tag_id'='<cool_tag_id>'
     AND created_at > now() - interval '24 hours';
  -- expect Index Scan, not Seq Scan; <1ms with cold cache on 100k+ rows.
  ```
- [ ] No N+1: `piktag_profiles` lookup for actor uses PK; `piktag_tags` lookup uses PK.
- [ ] Push HTTP call must not block trigger >100ms p95 (use `net.http_post` async queue, not synchronous `http` extension).
- [ ] Confirm trigger does not lock `piktag_user_tags` for concurrent writers (it's `AFTER INSERT FOR EACH ROW`, so per-row, no table lock).

---

## 8. Rollback plan

- [ ] Disable trigger first (least destructive, keeps data):
  ```sql
  ALTER TABLE piktag_user_tags DISABLE TRIGGER trg_notify_tag_added;
  ```
- [ ] Full rollback SQL (paste into a hotfix migration `20260428s_rollback_notification_tag_added.sql` if needed):
  ```sql
  DROP TRIGGER IF EXISTS trg_notify_tag_added ON piktag_user_tags;
  DROP FUNCTION IF EXISTS public.notify_tag_added();
  -- Optional: purge orphaned notifications inserted during the bad window.
  DELETE FROM piktag_notifications
   WHERE type='tag_added' AND created_at > '<deploy_timestamp>';
  ```
- [ ] No table drops needed — `piktag_user_tags` and `piktag_notifications` predate this migration.
- [ ] No i18n rollback required (extra keys are harmless).
- [ ] Mobile UI tolerates absence of `tag_added` rows (filter is type-based).
- [ ] Confirm `daily-followup-check` and other triggers (`notify_follow`, `notify_friend`, etc.) are unaffected by the rollback.
- [ ] Post-rollback verification:
  ```sql
  SELECT count(*) FROM pg_trigger WHERE tgname='trg_notify_tag_added';   -- expect 0
  SELECT count(*) FROM pg_proc    WHERE proname='notify_tag_added';      -- expect 0
  ```
- [ ] Document rollback in PR description and notify the 26 sibling agents so they don't depend on a removed function.
