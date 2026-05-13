// Supabase Edge Function: daily-on-this-day
//
// P0 of the "daily return mechanic" plan — turn PikTag from an
// event-only app into a memory app. Runs once a day, scans every
// host's Vibes for anniversaries that fall on TODAY (same MM-DD,
// any prior year OR any prior month boundary), and emits a
// notification per match.
//
// Anniversary windows we surface (in priority order — only one
// notification per Vibe per day even if multiple windows match):
//
//   • Exact 1, 2, 3+ years ago today  → "X 年前的今天"
//   • Exact 6 months ago today        → "半年前的今天"
//   • Exact 1, 3 months ago today     → "X 個月前的今天"
//   • Last 30 days, anchored monthly  → "1 個月前的今天" coverage
//
// We deliberately skip days-ago granularity (no "13 days ago today" —
// too noisy). The point is rare, special, "oh that was a year ago"
// emotional moments, not a constant stream.
//
// Notification shape (matches NotificationsScreen filter + press
// handler — opens the Vibe detail page):
//   type:  'on_this_day'
//   title: 'X 年前的今天'  /  'X 個月前的今天'  /  '半年前的今天'
//   data:  { scan_session_id, vibe_name, member_count, years_ago, months_ago }
//
// Idempotency: ON CONFLICT (user_id, type, ref_id) where
// ref_id = scan_session_id — same Vibe can't double-fire on a
// single day; AND can re-fire on a DIFFERENT day if a new
// anniversary window matches (e.g. 6-months and then 1-year).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Anniversary = {
  scan_session_id: string;
  host_user_id: string;
  vibe_name: string | null;
  member_count: number;
  years_ago: number;
  months_ago: number; // 0 if years_ago > 0
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Same CRON_SECRET auth pattern as the other daily edge functions.
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided) return new Response('Forbidden', { status: 403 });
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) return new Response('Forbidden', { status: 403 });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return new Response('Forbidden', { status: 403 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // The RPC does the heavy lifting on the DB side — much cheaper
    // than pulling every Vibe row over the network and computing
    // anniversaries in TS. Returns rows already filtered to "today
    // is an anniversary day for this Vibe".
    const { data: anniversaries, error } = await supabase.rpc(
      'find_on_this_day_anniversaries',
    );
    if (error) {
      console.error('[on-this-day] RPC error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const list = (anniversaries ?? []) as Anniversary[];
    let inserted = 0;

    for (const row of list) {
      const yearsLabel =
        row.years_ago === 1
          ? '一年前的今天'
          : row.years_ago > 1
            ? `${row.years_ago} 年前的今天`
            : null;
      const monthsLabel =
        row.months_ago === 6
          ? '半年前的今天'
          : row.months_ago > 0
            ? `${row.months_ago} 個月前的今天`
            : null;
      const title = yearsLabel || monthsLabel || '回到那一天';

      // Best-effort upsert. ON CONFLICT happens at (user_id, type,
      // ref_id) thanks to the unique index added in the companion
      // migration — same Vibe can't re-fire on a single day even
      // if the cron retries.
      const { error: insertErr } = await supabase
        .from('piktag_notifications')
        .upsert(
          {
            user_id: row.host_user_id,
            type: 'on_this_day',
            title,
            ref_type: 'scan_session',
            ref_id: row.scan_session_id,
            data: {
              scan_session_id: row.scan_session_id,
              vibe_name: row.vibe_name,
              member_count: row.member_count,
              years_ago: row.years_ago,
              months_ago: row.months_ago,
            },
          },
          {
            onConflict: 'user_id,type,ref_id',
            ignoreDuplicates: true,
          },
        );
      if (!insertErr) inserted++;
      else console.warn('[on-this-day] insert failed:', insertErr.message);
    }

    return new Response(
      JSON.stringify({ candidates: list.length, inserted }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('[on-this-day] unexpected error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
