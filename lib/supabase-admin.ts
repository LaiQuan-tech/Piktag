/**
 * Server-only. Creates a Supabase client with the service-role key, which
 * bypasses RLS. Never import this from a client component or a Next.js
 * route component that might be streamed to the browser.
 *
 * Use this inside Route Handlers (app/api/admin/*) and Server Components
 * under (admin) for queries that need cross-user reads or admin writes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Get it from Supabase dashboard → Settings → API.'
    );
  }

  cached = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
