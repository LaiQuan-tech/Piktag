// Supabase Edge Function: notification-anniversary
// Scheduled (daily at 08:05 UTC via pg_cron) — fires `anniversary` notifications
// for connections whose met_at month/day matches today and years >= 1.
//
// Flow:
//   1. Auth gate (CRON_SECRET, constant-time compare).
//   2. Call SQL helper `enqueue_anniversary_notifications()` — this performs
//      dedup-SELECT-then-INSERT inside Postgres and inserts canonical rows.
//   3. Query `piktag_notifications` for type='anniversary' rows inserted in
//      the last LOOKBACK_SECONDS seconds (these are the rows just enqueued).
//   4. For each row, fire an Expo push (mirroring `send-chat-push` shape).
//   5. Return `{ processed_count, errors }`.
//
// Idempotent: re-running within the same second is safe — the SQL helper's
// dedup prevents duplicate inserts (anniversary year fires once for all time),
// and the push step skips rows that are missing a `push_token`. Push delivery
// errors are collected per-row but never block the response.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TYPE = 'anniversary';
// Window over which we sweep up newly-inserted rows. Keep generous (5 min) so
// clock skew between the cron tick and our query never drops a row.
const LOOKBACK_SECONDS = 300;
const MAX_BODY_CHARS = 200;

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function truncate(s: string, n: number): string {
  if (!s) return s;
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. Auth gate — accept either Authorization: Bearer <CRON_SECRET> (pg_cron)
  //    or Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (vault-decrypted,
  //    used by in-database SQL helpers). Constant-time compare for both.
  const expectedCron = Deno.env.get('CRON_SECRET') ?? '';
  const expectedServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const valid =
    !!provided &&
    (
      (expectedCron.length > 0 && timingSafeEqual(provided, expectedCron)) ||
      (expectedServiceKey.length > 0 && timingSafeEqual(provided, expectedServiceKey))
    );
  if (!valid) {
    return new Response('Forbidden', { status: 403 });
  }

  const errors: Array<{ stage: string; message: string; user_id?: string }> = [];
  let processed_count = 0;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 2. Capture cutoff BEFORE invoking the helper so we only push the rows
    //    this run inserted. Subtract LOOKBACK_SECONDS to absorb clock skew.
    const cutoffIso = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString();

    // 3. Call the SQL helper — it performs the dedup + insert atomically.
    const { error: rpcErr } = await supabase.rpc('enqueue_anniversary_notifications');
    if (rpcErr) {
      // Helper failure is fatal — without inserts there's nothing to push.
      throw new Error(`enqueue_anniversary_notifications RPC failed: ${rpcErr.message}`);
    }

    // 4. Pull back rows newly inserted in the lookback window. Joining
    //    push_token here avoids an N+1 fetch per recipient.
    const { data: rows, error: selErr } = await supabase
      .from('piktag_notifications')
      .select(`
        id, user_id, title, body, data, created_at,
        recipient:piktag_profiles!user_id(push_token)
      `)
      .eq('type', TYPE)
      .gt('created_at', cutoffIso)
      .order('created_at', { ascending: true });

    if (selErr) {
      throw new Error(`select newly-inserted ${TYPE} rows failed: ${selErr.message}`);
    }

    // 5. Fire one Expo push per row. Mirror the `send-chat-push` payload shape.
    for (const row of rows ?? []) {
      const recipient = (row as any).recipient;
      const pushToken: string | null = recipient?.push_token ?? null;
      if (!pushToken) continue; // No token — in-app notification still landed; skip push.

      const data = (row.data ?? {}) as Record<string, unknown>;
      const username = (data.username as string) ?? 'PikTag';
      const pushTitle = truncate(username, MAX_BODY_CHARS);
      const pushBody = truncate((row.body ?? '') as string, MAX_BODY_CHARS);

      // Routing keys — mobile NotificationsScreen reads these out of `data`.
      const pushData: Record<string, unknown> = {
        type: TYPE,
        notification_id: row.id,
        connection_id: data.connection_id ?? null,
        connected_user_id: data.connected_user_id ?? null,
        years: data.years ?? null,
        met_at: data.met_at ?? null,
      };

      try {
        const resp = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
          },
          body: JSON.stringify({
            to: pushToken,
            title: pushTitle,
            body: pushBody,
            data: pushData,
            sound: 'default',
            priority: 'high',
            channelId: 'default',
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          errors.push({
            stage: 'expo_push_http',
            user_id: row.user_id,
            message: `status=${resp.status} body=${truncate(text, 200)}`,
          });
          continue;
        }
        processed_count++;
      } catch (e) {
        errors.push({
          stage: 'expo_push_throw',
          user_id: row.user_id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({ processed_count, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error(`notification-${TYPE} error:`, err);
    return new Response(
      JSON.stringify({
        processed_count,
        errors: [
          ...errors,
          { stage: 'fatal', message: err instanceof Error ? err.message : String(err) },
        ],
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
