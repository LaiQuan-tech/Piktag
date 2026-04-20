/**
 * Browser-side Supabase client. Safe to import in Client Components.
 * Uses anon key only; all admin writes go through /api/admin/* routes.
 */
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
