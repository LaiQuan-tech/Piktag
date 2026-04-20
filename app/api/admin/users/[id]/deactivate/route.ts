/**
 * POST /api/admin/users/[id]/deactivate
 *
 * Toggles or sets piktag_profiles.is_active. Body is optional:
 *   { is_active?: boolean }
 * If `is_active` is omitted, the current value is flipped.
 *
 * Response: { id, is_active }
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
      const parsed = JSON.parse(raw) as { is_active?: unknown };
      if (typeof parsed.is_active === 'boolean') {
        explicitNext = parsed.is_active;
      } else if (parsed.is_active !== undefined) {
        return NextResponse.json(
          { error: 'is_active must be a boolean' },
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
    .select('is_active')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const next = explicitNext ?? !current.is_active;

  await logAdminAction({
    adminEmail: gate.adminEmail,
    action: next ? 'reactivate_user' : 'deactivate_user',
    targetType: 'user',
    targetId: id,
    metadata: { previous: current.is_active, next },
  });

  const { error: updErr } = await supabase
    .from('piktag_profiles')
    .update({ is_active: next })
    .eq('id', id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ id, is_active: next });
}
