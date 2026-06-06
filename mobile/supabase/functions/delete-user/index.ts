// delete-user edge function
//
// Deploy: cd mobile && supabase functions deploy delete-user
// Required secrets:
//   SUPABASE_SERVICE_ROLE_KEY (auto-provided)
//   ADMIN_EMAILS_RAW — comma-separated lowercase admin emails
//     Set with: supabase secrets set ADMIN_EMAILS_RAW="armand7951@gmail.com,other@gmail.com"
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
// verify the caller's JWT first.
//
// Two code paths:
//   1. Self-delete (mobile app): identity is ALWAYS derived from the JWT
//      via auth.getUser(). Any client-supplied body.user_id is ignored
//      (logged as a warning) — never trusted.
//   2. Admin-initiated (admin panel): requires the `x-admin-action: true`
//      header AND a constant-time match between the bearer token and
//      SUPABASE_SERVICE_ROLE_KEY. Only then may body.user_id target an
//      arbitrary user. (The legacy email-allowlist path is gone — it
//      relied on a JWT-authenticated user, but admin tooling that already
//      holds the service role doesn't need user-scoped auth.)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type DeleteBody = {
  // Accepted only on the admin-initiated branch. On the self-delete branch
  // it is IGNORED (and logged) — identity comes from the JWT.
  user_id?: string;
};

// Constant-time string compare. Avoids leaking length/prefix info via
// early-exit timing when validating the service-role bearer.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

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
  { table: 'piktag_messages', column: 'sender_id' },
  { table: 'piktag_conversations', column: 'participant_a' },
  { table: 'piktag_conversations', column: 'participant_b' },
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
      // An empty body is fine for self-delete; default to {}.
      body = {};
    }

    // Admin branch is gated by an explicit header AND a constant-time
    // compare of the bearer against the service-role key. We do NOT
    // accept any client-supplied "admin_action" body flag — headers and
    // a real secret are required.
    const adminHeader = req.headers.get('x-admin-action') ?? req.headers.get('X-Admin-Action');
    const adminAction = adminHeader === 'true';

    const bearer = authHeader.slice('bearer '.length).trim();

    let callerId: string;
    let callerEmail = '';

    if (adminAction) {
      // Service-role-bearing admin tool. Constant-time compare prevents
      // timing oracles on the secret.
      if (!timingSafeEqual(bearer, serviceRoleKey)) {
        return jsonResponse(403, {
          error: 'Forbidden',
          detail: 'Admin action requires service-role bearer',
        });
      }
      const requestedUserId = (body.user_id ?? '').trim();
      if (!requestedUserId) {
        return jsonResponse(400, {
          error: 'Bad Request',
          detail: 'Admin action requires user_id',
        });
      }
      callerId = requestedUserId;
    } else {
      // SELF-DELETE: identity is ALWAYS derived from the JWT.
      // Any client-supplied user_id is logged-and-ignored — never trusted.
      if (body.user_id !== undefined && body.user_id !== null && String(body.user_id).trim() !== '') {
        console.warn(
          'delete-user: ignoring client-supplied user_id on self-delete branch (identity is JWT-derived)',
        );
      }

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

      callerId = userData.user.id;
      callerEmail = (userData.user.email ?? '').toLowerCase();
    }

    const requestedUserId = callerId;

    // Service-role client: bypasses RLS and can call auth.admin.*.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const userId = requestedUserId;
    const warnings: string[] = [];

    // ── Resurrection guard (founder 2026-06-07) ──────────────────────────
    // This user's OWN data is cascade-removed by auth.admin.deleteUser
    // (every piktag_* table FKs auth.users ON DELETE CASCADE), so it's gone.
    // BUT *other* users' local-contact records of this user (owner = them,
    // matched to this user by email/phone) are THEIR rows — they don't
    // cascade. Left alone, the promoted_to_connection_id FK (ON DELETE SET
    // NULL) re-arms them the moment this user's connections are deleted, and
    // re-registering with the same email/phone re-promotes them — resurrecting
    // the social graph + others' tags ("刪除後資料又回來"). Per GDPR erasure +
    // founder's call, scrub this user's email/phone OUT of others' local
    // contacts so they can never auto-re-match; the card (name/note/tags)
    // survives as a now-manual entry. MUST run BEFORE the CLEANUPS loop
    // deletes the connections the link-based scrub relies on.
    try {
      // Resolve this user's email (works for BOTH self- and admin-delete).
      let targetEmail = callerEmail;
      if (!targetEmail) {
        const { data: tu } = await adminClient.auth.admin.getUserById(userId);
        targetEmail = (tu?.user?.email ?? '').toLowerCase();
      }
      // Connections others hold WITH this user — local contacts were promoted
      // to exactly these, so matching on them catches phone-keyed contacts
      // too (format-independent), not just email-keyed ones.
      const { data: conns } = await adminClient
        .from('piktag_connections')
        .select('id')
        .eq('connected_user_id', userId);
      const connIds = (conns ?? []).map((c: { id: string }) => c.id);

      const scrub = { email_lower: null, phone_normalized: null };
      if (connIds.length > 0) {
        const { error } = await adminClient
          .from('piktag_local_contacts')
          .update(scrub)
          .neq('owner_user_id', userId)
          .in('promoted_to_connection_id', connIds);
        if (error) warnings.push(`local_contacts scrub (by connection): ${error.message}`);
      }
      if (targetEmail) {
        const { error } = await adminClient
          .from('piktag_local_contacts')
          .update(scrub)
          .neq('owner_user_id', userId)
          .eq('email_lower', targetEmail);
        if (error) warnings.push(`local_contacts scrub (by email): ${error.message}`);
      }
    } catch (e) {
      // Never block the delete on the scrub — auth.users removal is critical.
      console.warn(
        'delete-user resurrection-guard scrub failed:',
        e instanceof Error ? e.message : String(e),
      );
    }

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

    // Audit log for admin-initiated deletions. Best-effort: a logging
    // failure must not undo the successful delete above.
    if (adminAction) {
      const { error: auditError } = await adminClient.from('admin_audit_log').insert({
        admin_email: callerEmail || 'service-role',
        action: 'delete_user',
        target_type: 'user',
        target_id: userId,
        metadata: { via: 'edge-function' },
      });
      if (auditError) {
        console.warn('delete-user admin_audit_log insert failed:', auditError.message);
        warnings.push(`admin_audit_log: ${auditError.message}`);
      }
    }

    return jsonResponse(200, { success: true, ok: true, warnings });
  } catch (err) {
    console.error('delete-user edge function error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: message });
  }
});
