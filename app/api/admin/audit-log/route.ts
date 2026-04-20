/**
 * GET /api/admin/audit-log
 *
 * List admin audit log entries. Supports filtering by admin email, action,
 * and target type, plus pagination.
 *
 * Query params:
 *   admin_email   optional — exact-match filter (lowercased)
 *   action        optional — exact-match filter
 *   target_type   optional — exact-match filter
 *   page          1-based page number (default 1)
 *   page_size     items per page (default 50, max 100)
 *
 * Response: PaginatedResponse<AdminAuditLogEntry>
 *
 * NOTE: reading this endpoint is intentionally NOT logged to admin_audit_log
 * to avoid meta-recursive noise (every time an admin opens the page it would
 * generate a new row that then shows in the next page load).
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import type { AdminAuditLogEntry, PaginatedResponse } from '@/lib/admin-types';

interface AuditLogRow {
  id: string;
  admin_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function GET(req: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const adminEmail = url.searchParams.get('admin_email')?.trim().toLowerCase() ?? '';
  const action = url.searchParams.get('action')?.trim() ?? '';
  const targetType = url.searchParams.get('target_type')?.trim() ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('page_size') ?? '50', 10) || 50),
  );

  const supabase = createAdminClient();

  let query = supabase
    .from('admin_audit_log')
    .select('id, admin_email, action, target_type, target_id, metadata, created_at', {
      count: 'exact',
    });

  if (adminEmail) {
    query = query.eq('admin_email', adminEmail);
  }
  if (action) {
    query = query.eq('action', action);
  }
  if (targetType) {
    query = query.eq('target_type', targetType);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items: AdminAuditLogEntry[] = ((data ?? []) as AuditLogRow[]).map((r) => ({
    id: r.id,
    admin_email: r.admin_email,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    metadata: r.metadata,
    created_at: r.created_at,
  }));

  const body: PaginatedResponse<AdminAuditLogEntry> = {
    items,
    total: count ?? items.length,
    page,
    page_size: pageSize,
  };
  return NextResponse.json(body);
}
