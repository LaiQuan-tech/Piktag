// delete-user edge function
//
// Why this exists:
// When a user taps "delete account" in the app, we MUST fully remove their
// row from auth.users in addition to wiping their app data. If we only
// deleted the profile/app rows, Apple sign-in would resurrect the account
// on the next sign-in: Apple hands us back the same stable `sub` claim,
// Supabase matches it to the still-present auth.users row, and the user
// is silently re-authenticated with an empty profile. Deleting auth.users
// forces a brand-new identity on re-sign-in.
//
// This function runs with the service role key so it can both call
// auth.admin.deleteUser and bypass RLS on the piktag_* tables. We still
// verify the caller's JWT first and only allow self-deletion.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type DeleteBody = {
  user_id?: string;
};

type TableCleanup = {
  table: string;
  column: string;
};

// Order matters only for piktag_profiles (last, since other FKs may point
// to it). The rest are independent. Defense-in-depth: we expect ON DELETE
// CASCADE to handle most of this, but we explicitly clear rows here so a
// missing/broken cascade never leaves orphaned data behind.
// Table / column names verified against mobile/supabase/migrations/.
const CLEANUPS: TableCleanup[] = [
  { table: 'piktag_user_tags', column: 'user_id' },
  { table: 'piktag_connections', column: 'user_id' },
  { table: 'piktag_connections', column: 'connected_user_id' },
  { table: 'piktag_pending_connections', column: 'host_user_id' },
  { table: 'piktag_pending_connections', column: 'scanner_user_id' },
  { table: 'piktag_close_friends', column: 'user_id' },
  { table: 'piktag_close_friends', column: 'close_friend_id' },
  { table: 'piktag_blocks', column: 'blocker_id' },
  { table: 'piktag_blocks', column: 'blocked_id' },
  { table: 'piktag_reports', column: 'reporter_id' },
  { table: 'piktag_reports', column: 'reported_id' },
  { table: 'piktag_scan_sessions', column: 'host_user_id' },
  { table: 'piktag_tag_presets', column: 'user_id' },
  { table: 'piktag_biolinks', column: 'user_id' },
  { table: 'piktag_api_usage_log', column: 'user_id' },
  { table: 'piktag_points_ledger', column: 'user_id' },
  { table: 'piktag_profiles', column: 'id' },
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(500, {
        error: 'Edge function misconfigured',
        detail: 'Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY',
      });
    }

    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse(401, {
        error: 'Unauthorized',
        detail: 'Missing or malformed Authorization header',
      });
    }

    let body: DeleteBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Bad Request', detail: 'Body must be valid JSON' });
    }

    const requestedUserId = (body.user_id ?? '').trim();
    if (!requestedUserId) {
      return jsonResponse(400, { error: 'Bad Request', detail: 'Missing user_id' });
    }

    // Verify the caller's JWT via a user-scoped client.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse(401, {
        error: 'Unauthorized',
        detail: userError?.message ?? 'Invalid JWT',
      });
    }

    const authenticatedUserId = userData.user.id;
    if (authenticatedUserId !== requestedUserId) {
      return jsonResponse(403, {
        error: 'Forbidden',
        detail: 'Can only delete own account',
      });
    }

    // Service-role client: bypasses RLS and can call auth.admin.*.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const userId = authenticatedUserId;
    const warnings: string[] = [];

    for (const { table, column } of CLEANUPS) {
      const { error } = await adminClient.from(table).delete().eq(column, userId);
      if (error) {
        const warning = `${table}.${column}: ${error.message}`;
        console.warn(`delete-user cleanup failed: ${warning}`);
        warnings.push(warning);
        // Never block on a single table failure — auth.users removal is
        // the critical step and must still run.
      }
    }

    // FINAL and FATAL step: remove the auth.users row. Without this the
    // account can be resurrected via Apple sign-in.
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error('delete-user auth.admin.deleteUser failed:', deleteAuthError);
      return jsonResponse(500, {
        error: 'Failed to delete auth user',
        detail: deleteAuthError.message,
      });
    }

    return jsonResponse(200, { ok: true, warnings });
  } catch (err) {
    console.error('delete-user edge function error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: message });
  }
});
