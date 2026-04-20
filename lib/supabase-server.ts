/**
 * Server-side Supabase client that reads/writes the auth cookie
 * through Next.js cookies() API.
 *
 * Use for reading the current admin's session in Server Components,
 * Route Handlers, and middleware.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import 'server-only';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — ignore. Middleware handles refresh.
          }
        },
      },
    }
  );
}
