// Supabase Edge Function: weekly-reconnect-nudge
//
// Magic Moment #2 cron — once a week, pick the strongest
// "you and X share lots of tags but haven't messaged in 60+
// days" pair per user and send a gentle nudge:
//
//   "Eva 也標了 #攝影 #旅行 #台北 — 你們很久沒聊了"
//
// The find_reconnect_suggestions() RPC does the scoring on the
// DB side (tag overlap × inverse recency). This function just
// formats the title and inserts the notification.
//
// Idempotency: ref_id = friend_id with the existing
// idx_notif_user_type_refid unique index means "same friend
// can't double-prompt across runs". A different friend in a
// future week WILL fire — that's the desired behavior (the
// rotation surfaces a different forgotten person each time).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Suggestion = {
  user_id: string;
  friend_id: string;
  shared_tag_names: string[];
  days_since_message: number;
  friend_full_name: string | null;
  friend_username: string | null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
    const { data, error } = await supabase.rpc('find_reconnect_suggestions');
    if (error) {
      console.error('[reconnect-nudge] RPC error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const list = (data ?? []) as Suggestion[];
    let inserted = 0;

    for (const row of list) {
      const friendName = row.friend_full_name || row.friend_username || '一位朋友';
      // Cap to first 3 tags in the title — too many crowds the
      // one-line notification preview.
      const tagsForTitle = (row.shared_tag_names ?? []).slice(0, 3).map((t) => '#' + t).join(' ');
      const daysAgo = row.days_since_message;
      const recencyPhrase =
        daysAgo >= 365
          ? '一年沒聊了'
          : daysAgo >= 180
            ? '半年沒聊了'
            : daysAgo >= 60
              ? `${Math.round(daysAgo / 30)} 個月沒聊了`
              : '很久沒聊了';
      const title = `${friendName} 也標了 ${tagsForTitle} — 你們${recencyPhrase}`;

      const { error: insertErr } = await supabase
        .from('piktag_notifications')
        .upsert(
          {
            user_id: row.user_id,
            type: 'reconnect_suggest',
            title,
            ref_type: 'user',
            ref_id: row.friend_id,
            data: {
              friend_id: row.friend_id,
              shared_tag_names: row.shared_tag_names,
              days_since_message: row.days_since_message,
            },
          },
          { onConflict: 'user_id,type,ref_id', ignoreDuplicates: true },
        );
      if (!insertErr) inserted++;
      else console.warn('[reconnect-nudge] insert failed:', insertErr.message);
    }

    return new Response(
      JSON.stringify({ candidates: list.length, inserted }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[reconnect-nudge] unexpected:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
