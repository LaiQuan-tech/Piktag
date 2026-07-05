/**
 * POST /api/admin/users/[id]/test-account
 *
 * Toggles or sets piktag_profiles.is_test_account — the reversible flag
 * that excludes closed-test / QA tester accounts from the "real data"
 * metrics (dashboard, analytics, activation funnel, magic moments, signup
 * review). Mirrors the deactivate route so the founder can un-mark a false
 * positive with one click. Body is optional:
 *   { is_test_account?: boolean }
 * If omitted, the current value is flipped.
 *
 * Response: { id, is_test_account }
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import { logAdminAction } from '@/lib/audit';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;

  // Body is optional. Be tolerant of empty / non-JSON bodies.
  let explicitNext: boolean | undefined;
  try {
    const raw = await req.text();
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as { is_test_account?: unknown };
      if (typeof parsed.is_test_account === 'boolean') {
        explicitNext = parsed.is_test_account;
      } else if (parsed.is_test_account !== undefined) {
        return NextResponse.json(
          { error: 'is_test_account must be a boolean' },
          { status: 400 }
        );
      }
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: current, error: fetchErr } = await supabase
    .from('piktag_profiles')
    .select('is_test_account')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const next = explicitNext ?? !current.is_test_account;

  await logAdminAction({
    adminEmail: gate.adminEmail,
    action: next ? 'mark_test_account' : 'unmark_test_account',
    targetType: 'user',
    targetId: id,
    metadata: { previous: current.is_test_account, next },
  });

  const { error: updErr } = await supabase
    .from('piktag_profiles')
    .update({ is_test_account: next })
    .eq('id', id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ id, is_test_account: next });
}
