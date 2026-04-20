/**
 * Next.js middleware: refresh Supabase session cookies + enforce admin gate.
 *
 * - All routes under (admin) (i.e. not /login, not /forbidden) require a
 *   session belonging to an email in ADMIN_EMAILS.
 * - Unauthenticated → redirect to /login.
 * - Authenticated but not admin → redirect to /forbidden (then sign out).
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from './lib/admin-emails';

const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/forbidden',
  '/robots.txt',
  '/favicon.ico',
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/api/public/')) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/_vercel')) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return res;

  // Initialize Supabase client bound to this request's cookies so session
  // refresh writes cookies back into the response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          list.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (!isAdminEmail(user.email)) {
    const url = req.nextUrl.clone();
    url.pathname = '/forbidden';
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // Skip static assets; run on every page + api request otherwise.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)'],
};
