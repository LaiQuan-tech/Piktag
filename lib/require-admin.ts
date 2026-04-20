/**
 * Route Handler helper: enforce that the caller is an admin.
 * Call at the top of every /api/admin/* handler.
 *
 * Returns the admin's email on success, or a Response to return directly
 * on failure (401 / 403). Example:
 *
 *   const gate = await requireAdmin();
 *   if (gate instanceof Response) return gate;
 *   const adminEmail = gate.adminEmail;
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from './supabase-server';
import { isAdminEmail } from './admin-emails';

export async function requireAdmin(): Promise<
  | { adminEmail: string; userId: string }
  | Response
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { adminEmail: user.email!, userId: user.id };
}
