-- Admin audit log: every write action taken from the admin panel
-- (user delete/deactivate, report resolution, block-reported-user, etc.)
-- service-role only; browser cannot read or write.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email  text NOT NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  metadata     jsonb,
  ip_address   text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin
  ON admin_audit_log (admin_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_target
  ON admin_audit_log (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action_time
  ON admin_audit_log (action, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- No policies = only service-role key can read/write. anon/authenticated
-- clients see zero rows and get 401 on writes.

COMMENT ON TABLE admin_audit_log IS 'Every admin write action. service-role only. Never expose to browser.';
