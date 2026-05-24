// Supabase Edge Function: daily-birthday-check
//
// Birthday is the core of PikTag's CRM. This function runs daily and
// emits one notification per (viewer, friend) pair whose `birthday`
// (stored as MM/DD on either piktag_connections or piktag_profiles)
// matches today.
//
// Two birthday sources:
//   1. piktag_connections.birthday — the viewer's private CRM entry
//      they typed for this friend (e.g. learned at lunch). Highest
//      signal because the viewer cared enough to record it.
//   2. piktag_profiles.birthday — the friend's own self-declared birthday
//      from registration / Onboarding. Lower confidence (some people
//      lie about it) but covers everyone who hasn't been manually
//      tagged yet.
//
// We dedupe so a friend with both sources only fires once per viewer.
//
// Notification shape (matches NotificationsScreen filter for type='birthday'
// and the press handler's `data.connected_user_id` route):
//   type:  'birthday'
//   title: '{name} 今天生日'
//   data:  { connection_id, connected_user_id, source: 'connection' | 'profile' }
//
// Idempotency: upsert on (user_id, type, title) so re-running on the
// same day doesn't create duplicates.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth gate — same CRON_SECRET pattern as daily-followup-check.
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided) return new Response('Forbidden', { status: 403 });
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) return new Response('Forbidden', { status: 403 });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return new Response('Forbidden', { status: 403 });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Today as MM/DD — matches the format piktag_profiles.birthday and
    // piktag_connections.birthday are stored in (see Onboarding +
    // RegisterScreen + FriendDetail UI). Server timezone is UTC; for
    // PikTag's primary TW audience we shift to UTC+8 so the cron at
    // UTC 01:00 (local 09:00) sees "today" matching the user's clock.
    const now = new Date();
    const tw = new Date(now.getTime() + 8 * 3600 * 1000);
    const mm = String(tw.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(tw.getUTCDate()).padStart(2, '0');
    const todayMMDD = `${mm}/${dd}`;

    // Source 1: connections where the viewer recorded the friend's birthday.
    const { data: connRows } = await supabase
      .from('piktag_connections')
      .select(`
        id, user_id, connected_user_id, nickname, birthday,
        connected_user:piktag_profiles!connected_user_id(full_name, username)
      `)
      .eq('birthday', todayMMDD);

    // Source 2: profiles whose self-declared birthday matches.
    const { data: profileRows } = await supabase
      .from('piktag_profiles')
      .select('id, full_name, username, birthday')
      .eq('birthday', todayMMDD);

    type Hit = {
      viewerId: string;          // who we'll notify
      connectedUserId: string;   // birthday person
      connectionId: string | null;
      name: string;
      source: 'connection' | 'profile';
    };

    const hits: Hit[] = [];
    const seen = new Set<string>();   // dedupe key: viewerId:connectedUserId

    // Source 1 always wins on duplication — viewer's own record is more
    // trusted than the friend's self-declaration.
    for (const row of (connRows ?? []) as any[]) {
      const profile = row.connected_user;
      const name = row.nickname || profile?.full_name || profile?.username || '朋友';
      const key = `${row.user_id}:${row.connected_user_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        viewerId: row.user_id,
        connectedUserId: row.connected_user_id,
        connectionId: row.id,
        name,
        source: 'connection',
      });
    }

    // Source 2: for each profile-with-birthday-today, find every viewer
    // who has them as a connection and notify (skipping the dedup keys
    // we already filled from Source 1).
    if (profileRows && profileRows.length > 0) {
      const profileIds = profileRows.map((p: any) => p.id);
      const { data: backRefs } = await supabase
        .from('piktag_connections')
        .select('id, user_id, connected_user_id, nickname')
        .in('connected_user_id', profileIds);

      const profileById = new Map<string, any>();
      for (const p of profileRows as any[]) profileById.set(p.id, p);

      for (const row of (backRefs ?? []) as any[]) {
        const key = `${row.user_id}:${row.connected_user_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const profile = profileById.get(row.connected_user_id);
        const name =
          row.nickname || profile?.full_name || profile?.username || '朋友';
        hits.push({
          viewerId: row.user_id,
          connectedUserId: row.connected_user_id,
          connectionId: row.id,
          name,
          source: 'profile',
        });
      }
    }

    let totalCreated = 0;
    for (const hit of hits) {
      const title = `${hit.name} 今天生日`;
      const body = '送個祝福吧';

      await supabase
        .from('piktag_notifications')
        .upsert(
          {
            user_id: hit.viewerId,
            type: 'birthday',
            title,
            body,
            data: {
              connected_user_id: hit.connectedUserId,
              connection_id: hit.connectionId,
              source: hit.source,
            },
            is_read: false,
            created_at: now.toISOString(),
          },
          { onConflict: 'user_id,type,title' },
        )
        .then(({ error }) => {
          if (error) console.warn('upsert birthday notif failed:', error.message);
        });

      // Push notification (non-fatal on token / upstream failure)
      const { data: pushProfile } = await supabase
        .from('piktag_profiles')
        .select('push_token')
        .eq('id', hit.viewerId)
        .single();

      if (pushProfile?.push_token) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: pushProfile.push_token,
            title,
            body,
            data: {
              type: 'birthday',
              connected_user_id: hit.connectedUserId,
              connection_id: hit.connectionId,
            },
            sound: 'default',
          }),
        }).catch(() => {});
      }

      totalCreated++;
    }

    return new Response(
      JSON.stringify({
        message: 'Birthday check completed',
        date: todayMMDD,
        notifications_created: totalCreated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('daily-birthday-check error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
