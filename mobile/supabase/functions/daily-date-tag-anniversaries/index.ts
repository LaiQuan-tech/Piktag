// Supabase Edge Function: daily-date-tag-anniversaries
//
// Fires `anniversary`-type notifications (already filtered into the
// reminders tab + already routed by handleNotificationPress) for any
// hidden tag whose name is a `YYYY/MM/DD` date matching today.
//
// Two-step pattern, mirrors daily-birthday-check / notification-anniversary:
//   1. Call SQL helper enqueue_date_tag_anniversaries() — does the
//      query + dedup-aware insert inside Postgres.
//   2. Sweep up notifications type='anniversary' inserted in the last
//      LOOKBACK seconds and fire Expo pushes for each.
//
// Auth: same CRON_SECRET pattern as the other daily-* functions.
// Idempotent: SQL helper de-dupes per (user, type, title) within a
// 6-hour window, so re-running on the same day is safe.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TYPE = 'anniversary';
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

  // Auth gate — accept either CRON_SECRET (GitHub Actions) or the
  // service role key (in-DB pg_net callers, future-proof).
  const expectedCron = Deno.env.get('CRON_SECRET') ?? '';
  const expectedServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const valid =
    (expectedCron && timingSafeEqual(provided, expectedCron)) ||
    (expectedServiceKey && timingSafeEqual(provided, expectedServiceKey));
  if (!valid) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Insert today's anniversary rows (no-op if dedup hits).
    const { error: rpcErr } = await supabase.rpc('enqueue_date_tag_anniversaries');
    if (rpcErr) {
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Sweep just-inserted rows for push delivery. We filter by
    //    data.source='date_tag' so we don't double-push notifications
    //    that the existing notification-anniversary function may have
    //    inserted in the same window (those have data.met_at set).
    const sinceIso = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString();
    const { data: rows, error: selErr } = await supabase
      .from('piktag_notifications')
      .select('user_id, title, body, data')
      .eq('type', TYPE)
      .gte('created_at', sinceIso)
      .filter('data->>source', 'eq', 'date_tag');

    if (selErr) {
      return new Response(JSON.stringify({ error: selErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let pushed = 0;
    const errors: string[] = [];
    for (const row of (rows ?? []) as any[]) {
      try {
        const { data: profile } = await supabase
          .from('piktag_profiles')
          .select('push_token')
          .eq('id', row.user_id)
          .single();

        const token = (profile as any)?.push_token;
        if (!token) continue;

        const body = truncate(row.body ?? '', MAX_BODY_CHARS);
        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: token,
            title: row.title,
            body,
            data: {
              type: TYPE,
              connected_user_id: row.data?.connected_user_id,
              connection_id: row.data?.connection_id,
              tag_id: row.data?.tag_id,
              source: 'date_tag',
            },
            sound: 'default',
          }),
        });
        pushed++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Date-tag anniversaries dispatched',
        notifications_inserted: rows?.length ?? 0,
        pushes_sent: pushed,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('daily-date-tag-anniversaries error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
