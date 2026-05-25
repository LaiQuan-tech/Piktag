// Supabase Edge Function: notify-admin-growth
//
// Real-time growth-pulse pushes to PikTag admins. Two events handled
// (single endpoint for deploy + auth simplicity):
//
//   1. event=signup        — fired by DB trigger after each new
//                            piktag_profiles row. Push body:
//                              "🎉 PikTag 新註冊"
//                              "{name} 加入了"
//
//   2. event=magic_moment  — fired by DB trigger when a user creates
//                            their FIRST outgoing piktag_connections
//                            row (their 0→1 friend add — the
//                            product-market-fit signal). Push body:
//                              "✨ 第一個好友"
//                              "{name} 加了 {friend_name}"
//
// Auth: shared CRON_SECRET (the DB trigger sends Bearer <secret>).
// Same secret + same admin push pipeline as notification-search-
// digest — minimal new surface.
//
// Failure: every step is fail-soft. Missing a single growth push is
// fine; we'd rather log + continue than 500 the trigger.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

type Event =
  | {
      event: 'signup';
      user_id: string;
      name: string | null;
      username: string | null;
    }
  | {
      event: 'magic_moment';
      user_id: string;
      name: string | null;
      username: string | null;
      friend_name: string | null;
      friend_username: string | null;
    };

function composeBody(payload: Event): { title: string; body: string; type: string } {
  if (payload.event === 'signup') {
    const who = payload.name?.trim() || (payload.username ? `@${payload.username}` : '新用戶');
    return {
      type: 'admin_growth_signup',
      title: '🎉 PikTag 新註冊',
      body: `${who} 加入了`,
    };
  }
  // magic_moment
  const me = payload.name?.trim() || (payload.username ? `@${payload.username}` : '用戶');
  const friend =
    payload.friend_name?.trim() ||
    (payload.friend_username ? `@${payload.friend_username}` : '朋友');
  return {
    type: 'admin_growth_magic_moment',
    title: '✨ 第一個好友',
    body: `${me} 加了 ${friend}`,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Auth ──────────────────────────────────────────────────────
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || !provided || !timingSafeEqual(expected, provided)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const payload = (await req.json().catch(() => null)) as Event | null;
    if (!payload || (payload.event !== 'signup' && payload.event !== 'magic_moment')) {
      return new Response(
        JSON.stringify({ error: 'bad request', detail: 'missing or invalid event' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!payload.user_id) {
      return new Response(
        JSON.stringify({ error: 'bad request', detail: 'missing user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: adminRows, error: adminsErr } = await supabase.rpc(
      'get_admin_notification_recipients',
    );
    if (adminsErr || !adminRows || adminRows.length === 0) {
      console.warn('notify-admin-growth: no admin recipients', adminsErr?.message);
      return new Response(JSON.stringify({ skipped: 'no admins' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { title, body, type } = composeBody(payload);
    const data = { type, ...payload };

    let inserted = 0;
    let pushed = 0;
    for (const admin of adminRows as Array<{ user_id: string; push_token: string | null }>) {
      if (!admin.user_id) continue;

      // In-app notification row (so the admin sees a badge even
      // when push fails / device is offline).
      const { error: insertErr } = await supabase
        .from('piktag_notifications')
        .insert({
          user_id: admin.user_id,
          type,
          title,
          body,
          data,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      if (!insertErr) inserted++;

      // Expo push (best-effort).
      if (!admin.push_token) continue;
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            to: admin.push_token,
            title,
            body,
            sound: 'default',
            data,
          }),
        });
        if (res.ok) pushed++;
      } catch (pushErr) {
        console.warn('expo push threw:', pushErr);
      }
    }

    return new Response(
      JSON.stringify({ event: payload.event, admins_notified: inserted, pushes_sent: pushed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('notify-admin-growth error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
