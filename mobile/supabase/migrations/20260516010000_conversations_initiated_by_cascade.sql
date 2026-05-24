-- 20260516010000_conversations_initiated_by_cascade.sql
--
-- Defensive hardening (not a live bug fix).
--
-- The fk_audit (scripts/fk_audit.sql) flagged
--   piktag_conversations.initiated_by → auth.users  ON DELETE NO ACTION
-- as the lone NO-ACTION FK sitting under a user-facing delete path
-- (the "delete account" flow in SettingsScreen). Its sibling FKs on
-- the SAME table are not NO ACTION:
--   participant_a          → auth.users  CASCADE
--   participant_b          → auth.users  CASCADE
--   last_message_sender_id → auth.users  SET NULL
--
-- Today this is harmless: account deletion goes through the
-- `delete-user` edge function, which MANUALLY deletes
-- piktag_conversations by participant_a/participant_b BEFORE
-- calling auth.admin.deleteUser(). The initiator is always a
-- participant, so every conversation with initiated_by = X is
-- already gone by the time the NO ACTION constraint is checked —
-- it never fires.
--
-- But that safety is incidental, not structural: it depends on the
-- edge function's manual delete order. A future refactor, a new
-- delete path, or a direct DB delete would resurrect the exact
-- "can't delete" failure class we just fixed for Vibes
-- (20260516000000). Aligning initiated_by with its participant
-- siblings removes the latent inconsistency.
--
-- CASCADE (not SET NULL): the initiator is by definition a
-- conversation participant, so semantically initiated_by is just
-- another participant reference — it should die with the
-- conversation exactly like participant_a/participant_b, not
-- linger as a null. CASCADE here is also a no-op in practice
-- (the row is already cascade-deleted via participant_a/b); this
-- only changes behaviour in the corruption edge case where
-- initiated_by points at a non-participant.
--
-- Idempotent: discovers the FK name at runtime, drops it,
-- recreates with ON DELETE CASCADE. Safe to re-run.

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class     rel  ON rel.oid  = con.conrelid
  JOIN pg_class     fref ON fref.oid = con.confrelid
  JOIN pg_attribute att  ON att.attrelid = con.conrelid
                        AND att.attnum   = ANY (con.conkey)
  WHERE con.contype = 'f'
    AND rel.relname  = 'piktag_conversations'
    AND att.attname  = 'initiated_by'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.piktag_conversations DROP CONSTRAINT %I',
      v_conname
    );
  END IF;
END $$;

ALTER TABLE public.piktag_conversations
  ADD CONSTRAINT piktag_conversations_initiated_by_fkey
  FOREIGN KEY (initiated_by)
  REFERENCES auth.users (id)
  ON DELETE CASCADE;
