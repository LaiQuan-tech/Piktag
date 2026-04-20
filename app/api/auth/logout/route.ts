import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/audit';
import { isAdminEmail } from '@/lib/admin-emails';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? null;

  if (email && isAdminEmail(email)) {
    await logAdminAction({
      adminEmail: email,
      action: 'logout',
      ipAddress:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent') ?? null,
    });
  }

  await supabase.auth.signOut();

  // 303 See Other → browser follows with GET to /login.
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
