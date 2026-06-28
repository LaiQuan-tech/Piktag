// Supabase Edge Function: clear-stale-badges
//
// Daily badge-fatigue relief (founder 2026-06-29): users who haven't opened the
// app for 3 days get their app-icon badge cleared via a SILENT push (badge:0),
// while their notifications stay in the feed. See migration
// 20260629000000_badge_3day_auto_clear.sql for the model.
//
// One-step: claim_stale_badge_targets() atomically marks the eligible users
// cleared (badge_baseline_at = now(), so the badge won't reappear on reopen)
// AND returns their push tokens. We then fire Expo silent pushes.
//
// Silent push = `_contentAvailable: true` + `badge: 0` + no title/body, so iOS
// updates the icon badge without showing a notification. Best-effort: iOS
// throttles background pushes, so this is not minute-precise (disclosed).
//
// Auth: same CRON_SECRET pattern as the other daily-* functions.
// Idempotent: the claim RPC won't re-pick a user already cleared since their
// last activity (badge_baseline_at >= last_active_at), so re-running is safe.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo accepts up to 100 messages per request.

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

  // Auth gate — CRON_SECRET (GitHub Actions) or the service role key.
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

    // Atomically claim inactive users with a stale badge + bump their baseline.
    const { data: targets, error } = await supabase.rpc('claim_stale_badge_targets', {
      p_limit: 500,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const messages = ((targets ?? []) as { id: string; push_token: string }[])
      .filter((t) => !!t.push_token)
      .map((t) => ({
        to: t.push_token,
        _contentAvailable: true, // silent / background → no alert, just set badge
        badge: 0,
        priority: 'normal',
      }));

    let sent = 0;
    const errors: string[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const chunk = messages.slice(i, i + BATCH);
      try {
        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        sent += chunk.length;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Stale badges cleared',
        users_claimed: targets?.length ?? 0,
        silent_pushes_sent: sent,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('clear-stale-badges error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
