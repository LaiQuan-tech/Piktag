/**
 * Write an admin audit log row. Call this BEFORE performing the action so
 * the log is present even if the action itself fails.
 *
 * Server-only. Uses service-role client.
 */
import 'server-only';
import { createAdminClient } from './supabase-admin';

export type AdminAction =
  | 'view_user'
  | 'deactivate_user'
  | 'reactivate_user'
  | 'delete_user'
  | 'resolve_report'
  | 'dismiss_report'
  | 'block_reported_user'
  | 'login'
  | 'logout';

export async function logAdminAction(params: {
  adminEmail: string;
  action: AdminAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_email: params.adminEmail.toLowerCase(),
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    metadata: params.metadata ?? null,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
  });
  if (error) {
    // Don't throw — admin work shouldn't be blocked by audit failure.
    console.error('[audit] failed to log admin action', params.action, error);
  }
}
