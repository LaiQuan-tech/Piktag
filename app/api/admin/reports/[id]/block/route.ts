/**
 * POST /api/admin/reports/:id/block
 *
 * One-click defense: given a report id, (a) deactivate the reported user's
 * profile, (b) insert a row into piktag_blocks, and (c) mark the report as
 * 'reviewed'. All three steps are run sequentially and any errors collected
 * into a single response — supabase-js has no real transaction, so this is
 * best-effort with explicit error reporting per step.
 *
 * --- FK resolution for piktag_blocks.blocker_id ---
 * The schema in mobile/supabase/migrations/20260330_blocks_reports.sql
 * declares:
 *   blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
 *
 * A sentinel such as '00000000-0000-0000-0000-000000000000' would fail that
 * foreign key (there is no auth.users row with that id). Instead we use the
 * acting admin's own auth user id, which `requireAdmin()` already returns
 * as `userId`. The (blocker_id, blocked_id) UNIQUE constraint could trip if
 * the same admin has previously blocked the same target; that case is
 * tolerated (treated as success) so the operation stays idempotent.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import { logAdminAction } from '@/lib/audit';

interface StepError {
  step: 'deactivate_profile' | 'insert_block' | 'mark_report_reviewed';
  message: string;
  code?: string;
}

interface BlockResponse {
  success: boolean;
  deactivated_user: string;
  errors?: StepError[];
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;
  const { adminEmail, userId: adminUserId } = gate;

  const { id: reportId } = await ctx.params;
  if (!reportId) {
    return NextResponse.json({ error: 'Missing report id' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 1. Look up the report to get reported_id.
  const { data: reportRow, error: reportErr } = await supabase
    .from('piktag_reports')
    .select('id, reported_id')
    .eq('id', reportId)
    .single();

  if (reportErr || !reportRow) {
    const notFound = reportErr?.code === 'PGRST116' || !reportRow;
    return NextResponse.json(
      { error: notFound ? 'Report not found' : (reportErr?.message ?? 'Unknown error') },
      { status: notFound ? 404 : 500 }
    );
  }

  const reportedId = (reportRow as { id: string; reported_id: string }).reported_id;

  // 2. Audit log FIRST so the admin intent is recorded even if any of the
  //    subsequent writes fail.
  await logAdminAction({
    adminEmail,
    action: 'block_reported_user',
    targetType: 'user',
    targetId: reportedId,
    metadata: { report_id: reportId, reported_id: reportedId },
  });

  const errors: StepError[] = [];

  // 3a. Deactivate the reported user's profile.
  {
    const { error } = await supabase
      .from('piktag_profiles')
      .update({ is_active: false })
      .eq('id', reportedId);
    if (error) {
      errors.push({
        step: 'deactivate_profile',
        message: error.message,
        code: error.code,
      });
    }
  }

  // 3b. Insert the block. blocker_id is the admin's own auth.users.id (see
  //     FK note at the top of this file). UNIQUE(blocker_id, blocked_id)
  //     collisions are treated as success (idempotent block).
  {
    const { error } = await supabase.from('piktag_blocks').insert({
      blocker_id: adminUserId,
      blocked_id: reportedId,
    });
    if (error && error.code !== '23505') {
      errors.push({
        step: 'insert_block',
        message: error.message,
        code: error.code,
      });
    }
  }

  // 3c. Mark the report as reviewed.
  {
    const { error } = await supabase
      .from('piktag_reports')
      .update({ status: 'reviewed' })
      .eq('id', reportId);
    if (error) {
      errors.push({
        step: 'mark_report_reviewed',
        message: error.message,
        code: error.code,
      });
    }
  }

  const body: BlockResponse = {
    success: errors.length === 0,
    deactivated_user: reportedId,
    ...(errors.length > 0 ? { errors } : {}),
  };

  return NextResponse.json(body, { status: errors.length === 0 ? 200 : 207 });
}
