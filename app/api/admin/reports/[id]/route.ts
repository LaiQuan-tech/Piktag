/**
 * PATCH /api/admin/reports/:id
 *
 * Update the status of a report to either 'reviewed' or 'dismissed'.
 *
 * Request body: { status: 'reviewed' | 'dismissed' }
 *
 * Flow:
 *   1. Gate on requireAdmin().
 *   2. Validate the status value.
 *   3. logAdminAction FIRST (so audit survives even if the write fails).
 *   4. UPDATE piktag_reports and return the updated row.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import { logAdminAction, type AdminAction } from '@/lib/audit';
import type { AdminReport, ReportStatus } from '@/lib/admin-types';

type AllowedNewStatus = Extract<ReportStatus, 'reviewed' | 'dismissed'>;

const ALLOWED: ReadonlyArray<AllowedNewStatus> = ['reviewed', 'dismissed'];

interface PatchBody {
  status?: unknown;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;
  const { adminEmail } = gate;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing report id' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const newStatus = body.status;
  if (
    typeof newStatus !== 'string' ||
    !ALLOWED.includes(newStatus as AllowedNewStatus)
  ) {
    return NextResponse.json(
      { error: "status must be 'reviewed' or 'dismissed'" },
      { status: 400 }
    );
  }
  const status = newStatus as AllowedNewStatus;

  const action: AdminAction =
    status === 'reviewed' ? 'resolve_report' : 'dismiss_report';

  // Log BEFORE performing the write so the attempt is auditable regardless
  // of whether the update below succeeds.
  await logAdminAction({
    adminEmail,
    action,
    targetType: 'report',
    targetId: id,
    metadata: { new_status: status },
  });

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('piktag_reports')
    .update({ status })
    .eq('id', id)
    .select('id, reporter_id, reported_id, reason, description, status, created_at')
    .single();

  if (error) {
    // PGRST116 = no row matched .single()
    const notFound = error.code === 'PGRST116';
    return NextResponse.json(
      { error: notFound ? 'Report not found' : error.message },
      { status: notFound ? 404 : 500 }
    );
  }

  const row = data as {
    id: string;
    reporter_id: string;
    reported_id: string;
    reason: string;
    description: string | null;
    status: ReportStatus;
    created_at: string;
  };

  // Resolve usernames so the shape matches AdminReport (piktag_profiles.id =
  // auth.users.id, so we can look up by id directly).
  const { data: profiles } = await supabase
    .from('piktag_profiles')
    .select('id, username')
    .in('id', [row.reporter_id, row.reported_id]);

  const usernameById = new Map<string, string | null>();
  for (const p of (profiles ?? []) as Array<{ id: string; username: string | null }>) {
    usernameById.set(p.id, p.username);
  }

  const updated: AdminReport = {
    id: row.id,
    reporter_id: row.reporter_id,
    reporter_username: usernameById.get(row.reporter_id) ?? null,
    reported_id: row.reported_id,
    reported_username: usernameById.get(row.reported_id) ?? null,
    reason: row.reason,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
  };

  return NextResponse.json(updated);
}
