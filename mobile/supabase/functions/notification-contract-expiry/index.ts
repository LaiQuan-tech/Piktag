// Supabase Edge Function: notification-contract-expiry
// Scheduled daily at 08:10 via pg_cron HTTP POST.
// Calls SQL helper enqueue_contract_expiry_notifications() to insert notification rows,
// then queries the just-inserted piktag_notifications rows of type='contract_expiry'
// from the last LOOKBACK_SECONDS and dispatches Expo push for each.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.
// Idempotent: SQL helper de-dupes per (user_id, connection_id, days_until); the push
// loop only fires for rows created in the lookback window so re-invocations within
// that window may re-push, but new inserts will not happen.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TYPE = 'contract_expiry';
const LOOKBACK_SECONDS = 300; // window for picking up rows just inserted by the SQL helper
const MAX_BODY_CHARS = 200; // Expo push body cap (matches send-chat-push)

function truncateBody(s: string): string {
  if (s.length <= MAX_BODY_CHARS) return s;
  return s.slice(0, MAX_BODY_CHARS - 1) + '…';
}

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth gate: accept either CRON_SECRET (pg_cron HTTP POST) or
  // SUPABASE_SERVICE_ROLE_KEY (vault-decrypted, presented by in-database SQL
  // helpers that call this function via pg_net). Constant-time compare for both.
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

  const errors: string[] = [];
  let processed_count = 0;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 1. Capture the lookback cutoff BEFORE invoking the helper. If the helper
    //    runs slowly we don't want pre-existing rows from a prior run to fall
    //    into our SELECT window and get re-pushed. (See peer functions.)
    const since = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString();

    // 2. Run the SQL-side enqueue helper. This handles candidate selection,
    //    dedup-SELECT-then-INSERT, and writes the per-row JSONB payload.
    const { error: rpcErr } = await supabase.rpc('enqueue_contract_expiry_notifications');
    if (rpcErr) {
      errors.push(`rpc_failed: ${rpcErr.message}`);
      // Bail. Return 500 if the helper itself failed.
      return new Response(
        JSON.stringify({ processed_count, errors }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Fetch the rows the helper just inserted.
    const { data: rows, error: selErr } = await supabase
      .from('piktag_notifications')
      .select('id, user_id, title, body, data, created_at')
      .eq('type', TYPE)
      .gt('created_at', since)
      .order('created_at', { ascending: true });

    if (selErr) {
      errors.push(`select_failed: ${selErr.message}`);
      return new Response(
        JSON.stringify({ processed_count, errors }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Fire Expo push for each. Mirrors the send-chat-push payload shape.
    for (const row of rows ?? []) {
      try {
        const recipientId = (row as { user_id: string }).user_id;
        const data = ((row as { data: Record<string, unknown> | null }).data) ?? {};
        const body = (row as { body: string | null }).body ?? '';

        // Lookup recipient push token.
        const { data: profile, error: profErr } = await supabase
          .from('piktag_profiles')
          .select('push_token')
          .eq('id', recipientId)
          .maybeSingle();
        if (profErr) {
          errors.push(`profile_lookup_failed:${recipientId}:${profErr.message}`);
          continue;
        }
        const pushToken = (profile as { push_token: string | null } | null)?.push_token;
        if (!pushToken) continue; // nothing to send; row already inserted

        const username = (data as Record<string, unknown>).username as string | undefined;
        const connectionId = (data as Record<string, unknown>).connection_id as string | undefined;
        const connectedUserId = (data as Record<string, unknown>).connected_user_id as string | undefined;
        const daysUntil = (data as Record<string, unknown>).days_until as number | undefined;

        const pushTitle = username && username.length > 0 ? username : 'PikTag';

        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-encoding': 'gzip, deflate',
          },
          body: JSON.stringify({
            to: pushToken,
            title: pushTitle,
            body: truncateBody(body),
            data: {
              type: TYPE,
              notification_id: (row as { id: string }).id,
              connection_id: connectionId,
              connected_user_id: connectedUserId,
              days_until: daysUntil,
            },
            sound: 'default',
            priority: 'high',
          }),
        }).catch((e: unknown) => {
          errors.push(`push_fetch_failed:${recipientId}:${(e as Error)?.message ?? String(e)}`);
          return null;
        });

        if (res && !res.ok) {
          const txt = await res.text().catch(() => '');
          errors.push(`push_non_ok:${recipientId}:${res.status}:${txt.slice(0, 120)}`);
          continue;
        }

        processed_count++;
      } catch (rowErr) {
        errors.push(`row_error:${(rowErr as Error)?.message ?? String(rowErr)}`);
      }
    }

    return new Response(
      JSON.stringify({ processed_count, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('notification-contract-expiry error:', err);
    errors.push(`fatal:${err instanceof Error ? err.message : String(err)}`);
    return new Response(
      JSON.stringify({ processed_count, errors }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
