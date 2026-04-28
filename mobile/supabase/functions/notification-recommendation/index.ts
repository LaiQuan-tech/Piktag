// Supabase Edge Function: notification-recommendation
// Schedule: daily at 09:30 local via pg_cron HTTP POST.
// Generates "people you might know" recommendations (>=2 mutual tags, no existing connection, not blocked).
//
// Flow:
//   1) Auth gate (Bearer CRON_SECRET, constant-time compare).
//   2) Call SQL helper public.enqueue_recommendation_notifications() — handles candidate selection
//      and dedup-aware INSERT into piktag_notifications. (SQL helper authored by sibling agent.)
//   3) Read newly-inserted rows of type='recommendation' from the last LOOKBACK_SECONDS,
//      fan out Expo pushes (one per recipient — first/highest-scoring candidate per recipient
//      since the helper inserts them in score order; we group client-side just in case).
//   4) Return { processed_count, errors }.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TYPE = 'recommendation';
const MAX_BODY_CHARS = 200; // Expo push body cap (matches send-chat-push)

function truncateBody(s: string): string {
  if (s.length <= MAX_BODY_CHARS) return s;
  return s.slice(0, MAX_BODY_CHARS - 1) + '…';
}
// Window for picking up rows inserted by enqueue_recommendation_notifications() in this run.
// Must comfortably exceed the helper's worst-case runtime; idempotency is guaranteed by the
// helper's own dedup logic, so re-reading is safe.
const LOOKBACK_SECONDS = 300;

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

  // --- Auth gate: accept EITHER Bearer CRON_SECRET (pg_cron) OR Bearer
  // SUPABASE_SERVICE_ROLE_KEY (in-database SQL helpers using vault-decrypted
  // service role key). Constant-time compare for both. ---
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- 1. Run SQL helper (handles candidate selection + dedup + insert). Idempotent. ---
    const runStartedAt = new Date(Date.now() - 1000).toISOString(); // small skew guard
    const { error: rpcErr } = await supabase.rpc('enqueue_recommendation_notifications');
    if (rpcErr) {
      // If the helper itself failed, surface the error and bail — pushes would be meaningless.
      throw new Error(`enqueue_recommendation_notifications failed: ${rpcErr.message}`);
    }

    // --- 2. Read newly-inserted recommendation notifications from this run window. ---
    const since = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString();
    const lowerBound = since < runStartedAt ? since : runStartedAt;

    const { data: newRows, error: selErr } = await supabase
      .from('piktag_notifications')
      .select('id, user_id, title, body, data, created_at')
      .eq('type', TYPE)
      .gte('created_at', lowerBound)
      .order('created_at', { ascending: true });

    if (selErr) {
      throw new Error(`select recommendation rows failed: ${selErr.message}`);
    }

    const rows = newRows ?? [];

    // --- 3. Group by recipient — push at most once per user per run (first row wins). ---
    const seenRecipient = new Set<string>();
    const pushTargets: Array<{
      recipient_id: string;
      title: string;
      body: string;
      data: Record<string, unknown>;
    }> = [];

    for (const r of rows) {
      const recipient = r.user_id as string;
      if (!recipient || seenRecipient.has(recipient)) continue;
      seenRecipient.add(recipient);

      const data = (r.data ?? {}) as Record<string, unknown>;
      const username = (data.username as string | undefined) ?? 'PikTag';
      // Push title shows the recommended person's username (mirror social-tab convention).
      // data.username is already the candidate's username per spec card §2.4.
      pushTargets.push({
        recipient_id: recipient,
        title: username,
        body: (r.body as string) ?? '',
        data: {
          type: TYPE,
          notification_id: r.id,
          recommended_user_id: data.recommended_user_id,
          mutual_tag_count: data.mutual_tag_count,
          mutual_tag_ids: data.mutual_tag_ids,
          username: data.username,
          avatar_url: data.avatar_url,
        },
      });
    }

    if (pushTargets.length === 0) {
      return new Response(
        JSON.stringify({ processed_count: 0, errors }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // --- 4. Resolve push tokens for all recipients in one query. ---
    const recipientIds = pushTargets.map((t) => t.recipient_id);
    const { data: profiles, error: profErr } = await supabase
      .from('piktag_profiles')
      .select('id, push_token')
      .in('id', recipientIds);

    if (profErr) {
      // Non-fatal — record and continue without pushes.
      errors.push(`push_token lookup failed: ${profErr.message}`);
    }

    const tokenByUser = new Map<string, string>();
    for (const p of profiles ?? []) {
      if ((p as { push_token?: string | null }).push_token) {
        tokenByUser.set((p as { id: string }).id, (p as { push_token: string }).push_token);
      }
    }

    // --- 5. Fire Expo pushes (mirror send-chat-push payload shape). ---
    for (const t of pushTargets) {
      const token = tokenByUser.get(t.recipient_id);
      if (!token) {
        // No push token — in-app notification was still created by the SQL helper.
        processed_count++;
        continue;
      }
      try {
        const resp = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: token,
            title: t.title,
            body: truncateBody(t.body),
            data: t.data,
            sound: 'default',
            priority: 'high',
          }),
        });
        if (!resp.ok) {
          errors.push(`expo push ${resp.status} for user ${t.recipient_id}`);
        }
        processed_count++;
      } catch (e) {
        errors.push(`expo push threw for user ${t.recipient_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(
      JSON.stringify({ processed_count, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('notification-recommendation error:', err);
    return new Response(
      JSON.stringify({
        processed_count,
        errors: [...errors, err instanceof Error ? err.message : String(err)],
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
