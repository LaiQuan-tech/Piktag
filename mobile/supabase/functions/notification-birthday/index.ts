// notification-birthday edge function
//
// Schedule: daily at 08:00 (UTC) via pg_cron HTTP POST.
// The cron schedule lives in 20260428w_notification_birthday.sql, which
// also defines the SQL helper `enqueue_birthday_notifications()`. This
// function calls that helper (which is the source of truth for who
// receives a birthday notification today and the dedup window), then
// queries `piktag_notifications` for rows of type='birthday' inserted
// in the last N seconds and fires an Expo push for each.
//
// Idempotency:
//  - The SQL helper itself is idempotent (its INSERT is guarded by a
//    300-day dedup-SELECT against `piktag_notifications`, per spec
//    §2.7).
//  - The push step only acts on rows the helper *just* inserted, by
//    filtering on created_at >= now() - LOOKBACK_SECONDS. Re-running
//    this function within the same scheduled window will see the same
//    rows but Expo treats duplicate sends as best-effort and the
//    in-app row is already deduped server-side, so worst case is one
//    duplicate push per day per recipient under retry pressure.
//  - All side effects (push) are wrapped in try/catch and never
//    bubble up — push failure must not block subsequent rows.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TYPE = 'birthday';
// Window we look back to find rows the SQL helper just inserted. Wide
// enough to absorb a slow cron firing or a manual replay; narrow
// enough that we don't push for yesterday's batch on a retry.
const LOOKBACK_SECONDS = 300;
const MAX_BODY_CHARS = 200;

type NotificationRow = {
  id: string;
  user_id: string;
  title: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
};

type ProfileRow = {
  id: string;
  push_token: string | null;
  full_name: string | null;
  username: string | null;
};

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

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

  // Auth gate: accept either `Authorization: Bearer <CRON_SECRET>` (from
  // pg_cron HTTP POST) or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  // (from in-database SQL helpers that present the vault-decrypted service
  // role key). Constant-time compare for both.
  const expectedCron = Deno.env.get('CRON_SECRET') ?? '';
  const expectedServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
  const provided = authHeader.replace(/^Bearer\s+/i, '');
  const valid =
    !!provided &&
    (
      (expectedCron.length > 0 && timingSafeEqual(provided, expectedCron)) ||
      (expectedServiceKey.length > 0 && timingSafeEqual(provided, expectedServiceKey))
    );
  if (!valid) {
    return jsonResponse(403, { ok: false, error: 'Forbidden' });
  }

  const errors: string[] = [];
  let processed_count = 0;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, {
        ok: false,
        error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Capture the cutoff *before* invoking the helper so any row the
    //    helper inserts is guaranteed to satisfy created_at >= cutoff
    //    (Postgres `now()` is set to the start of the helper's
    //    transaction, which is >= our cutoff).
    const cutoffIso = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString();

    // 2. Call the SQL helper. It is SECURITY DEFINER, idempotent, and
    //    handles its own dedup window.
    const { error: rpcError } = await supabase.rpc('enqueue_birthday_notifications');
    if (rpcError) {
      console.error('notification-birthday rpc failed:', rpcError);
      return jsonResponse(500, {
        ok: false,
        error: `enqueue_birthday_notifications failed: ${rpcError.message}`,
      });
    }

    // 3. Fetch newly-inserted birthday rows so we can fire pushes.
    const { data: rows, error: selectError } = await supabase
      .from('piktag_notifications')
      .select('id, user_id, title, body, data')
      .eq('type', TYPE)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .returns<NotificationRow[]>();

    if (selectError) {
      console.error('notification-birthday select failed:', selectError);
      return jsonResponse(500, {
        ok: false,
        error: `notification select failed: ${selectError.message}`,
      });
    }

    const notifications = rows ?? [];
    if (notifications.length === 0) {
      return jsonResponse(200, { processed_count: 0, errors });
    }

    // 4. Resolve recipient push tokens in one round-trip.
    const recipientIds = Array.from(new Set(notifications.map((n) => n.user_id)));
    const { data: profileRows, error: profilesError } = await supabase
      .from('piktag_profiles')
      .select('id, push_token, full_name, username')
      .in('id', recipientIds)
      .returns<ProfileRow[]>();

    if (profilesError) {
      console.error('notification-birthday profile lookup failed:', profilesError);
      // Don't bail — we already enqueued the in-app rows; just skip pushes.
      errors.push(`profile lookup failed: ${profilesError.message}`);
      return jsonResponse(200, { processed_count: 0, errors });
    }

    const tokenById = new Map<string, string>();
    for (const p of profileRows ?? []) {
      const tok = p.push_token?.trim();
      if (tok) tokenById.set(p.id, tok);
    }

    // 5. Fire Expo pushes — payload mirrors send-chat-push shape.
    for (const n of notifications) {
      const pushToken = tokenById.get(n.user_id);
      if (!pushToken) {
        // No token = silent in-app only. Still counts as processed.
        processed_count++;
        continue;
      }

      const data = (n.data ?? {}) as Record<string, unknown>;
      const username =
        typeof data.username === 'string' && data.username.trim().length > 0
          ? data.username.trim().slice(0, 100)
          : 'PikTag';
      const rawBody = (n.body ?? '').trim();
      const truncatedBody =
        rawBody.length > MAX_BODY_CHARS
          ? `${rawBody.slice(0, MAX_BODY_CHARS - 1)}…`
          : rawBody;

      const expoPayload = {
        to: pushToken,
        title: username,
        body: truncatedBody,
        data: {
          type: TYPE,
          notificationId: n.id,
          connected_user_id: data.connected_user_id ?? null,
          connection_id: data.connection_id ?? null,
        },
        sound: 'default',
        badge: undefined,
        priority: 'high',
      };

      try {
        const upstream = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
          },
          body: JSON.stringify(expoPayload),
        });
        if (!upstream.ok) {
          const text = await upstream.text().catch(() => '');
          const snippet = text.slice(0, 200);
          console.error(
            `notification-birthday Expo HTTP ${upstream.status} for ${n.id}:`,
            snippet,
          );
          errors.push(`expo_${upstream.status}_for_${n.id}`);
        }
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`notification-birthday Expo fetch threw for ${n.id}:`, msg);
        errors.push(`expo_fetch_failed_for_${n.id}`);
      }

      processed_count++;
    }

    return jsonResponse(200, { processed_count, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('notification-birthday error:', message);
    return jsonResponse(500, { ok: false, error: message, processed_count, errors });
  }
});
