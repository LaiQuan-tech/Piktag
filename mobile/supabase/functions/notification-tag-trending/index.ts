// Supabase Edge Function: notification-tag-trending
// Scheduled daily (midnight) via pg_cron.
//
// Flow:
//   1. Auth gate via CRON_SECRET (constant-time compare).
//   2. Calls SQL helper public.enqueue_tag_trending_notifications() which inserts
//      `tag_trending` rows into piktag_notifications (dedup-protected, see migration
//      20260428u_notification_tag_trending.sql, spec §2.5).
//   3. Queries newly-inserted rows from the last LOOKBACK_SECONDS window and fires
//      Expo push notifications for each (rank=1 only — the helper restricts to
//      the rank-1 trending tag per user already, but we double-guard here).
//   4. Returns { processed_count, errors }.
//
// Idempotency: the SQL helper uses dedup-SELECT-then-INSERT inside a 7-day window.
// Re-invoking the function within seconds inserts zero new rows, so re-running is safe.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TYPE = 'tag_trending';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Lookback window for "newly-inserted" rows after the SQL helper runs.
// Generous enough to absorb clock skew and helper runtime; small enough to avoid
// re-pushing yesterday's notifications on a manual re-run.
const LOOKBACK_SECONDS = 120;
const MAX_BODY_CHARS = 200;

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function truncate(s: string, max = MAX_BODY_CHARS): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth gate — constant-time compare of bearer token against CRON_SECRET.
  const expected = Deno.env.get('CRON_SECRET') ?? '';
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || !provided || !timingSafeEqual(expected, provided)) {
    return new Response('Forbidden', { status: 403 });
  }

  const errors: string[] = [];
  let processedCount = 0;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Snapshot the cutoff BEFORE invoking the helper so we capture only rows it inserts.
    const cutoffIso = new Date(Date.now() - 1000).toISOString();

    // 1. Run the SQL helper. It computes trending tags and inserts notifications
    //    (dedup-protected, rank=1 push gating handled in SQL).
    const { error: rpcError } = await supabase.rpc('enqueue_tag_trending_notifications');
    if (rpcError) {
      // Non-fatal: still attempt to push any rows that may have been inserted by an
      // earlier invocation within the lookback window.
      errors.push(`enqueue_rpc: ${rpcError.message}`);
    }

    // 2. Pull newly-inserted tag_trending rows from the lookback window.
    const sinceIso = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString();
    const lowerBound = sinceIso < cutoffIso ? sinceIso : cutoffIso;

    const { data: rows, error: selErr } = await supabase
      .from('piktag_notifications')
      .select('id, user_id, title, body, data, created_at')
      .eq('type', TYPE)
      .gt('created_at', lowerBound)
      .order('created_at', { ascending: true });

    if (selErr) {
      errors.push(`select_new_rows: ${selErr.message}`);
      return new Response(
        JSON.stringify({ processed_count: 0, errors }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const candidates = rows ?? [];
    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ processed_count: 0, errors }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Batch-fetch push tokens for the recipients.
    const recipientIds = Array.from(new Set(candidates.map((r) => r.user_id)));
    const { data: profiles, error: profErr } = await supabase
      .from('piktag_profiles')
      .select('id, push_token, language')
      .in('id', recipientIds);

    if (profErr) {
      errors.push(`select_profiles: ${profErr.message}`);
    }

    const tokenByUser = new Map<string, { push_token: string | null; language: string | null }>();
    for (const p of profiles ?? []) {
      tokenByUser.set(p.id, { push_token: p.push_token ?? null, language: p.language ?? null });
    }

    // 4. Fire pushes mirroring send-chat-push payload shape.
    for (const row of candidates) {
      try {
        const data = (row.data ?? {}) as Record<string, unknown>;
        // Defensive rank gate: only push for rank-1 trending tag per user.
        const rank = typeof data.rank === 'number' ? data.rank : Number(data.rank ?? 0);
        if (rank && rank !== 1) continue;

        const profile = tokenByUser.get(row.user_id);
        const token = profile?.push_token;
        if (!token) continue;

        const tagName = typeof data.tag_name === 'string' ? data.tag_name : '';
        const pushTitle = tagName ? `#${tagName}` : 'PikTag';
        const pushBody = truncate(row.body ?? `your tag is trending today`);

        const resp = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
          },
          body: JSON.stringify({
            to: token,
            title: pushTitle,
            body: pushBody,
            data: {
              type: TYPE,
              notification_id: row.id,
              tag_id: data.tag_id ?? null,
              tag_name: data.tag_name ?? null,
              user_id: row.user_id,
            },
            sound: 'default',
            priority: 'high',
            channelId: 'default',
          }),
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          errors.push(`expo_${resp.status}_${row.id}: ${truncate(txt, 80)}`);
          continue;
        }

        processedCount++;
      } catch (e) {
        errors.push(`push_${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(
      JSON.stringify({ processed_count: processedCount, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('notification-tag-trending error:', err);
    return new Response(
      JSON.stringify({
        processed_count: processedCount,
        errors: [...errors, err instanceof Error ? err.message : String(err)],
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
