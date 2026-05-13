// Supabase Edge Function: weekly-tag-combo-digest
//
// Magic Moment #4 — once a week, pick the most over-represented
// tag PAIR in each user's 1st-degree network and surface it:
//
//   "你朋友圈裡有 5 個人是 #台北 + #攝影 — 點開看是誰"
//
// Pairs (not triples or singles) chosen as the unit because:
//   • Single tags are too generic ("#台北" = everyone in Taipei).
//   • Triples are too rare at small network sizes (≤ 50 friends).
//   • Pairs hit the "specific kind of person" sweet spot.
//
// find_tag_combinations() does all the heavy lifting on the DB
// side; this function just formats the notification title and
// upserts. Dedup via ref_id = synthetic "tag_a|tag_b" key so the
// same pair can't notify twice in a row, but a DIFFERENT pair
// next week WILL fire.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Combo = {
  user_id: string;
  tag_a_name: string;
  tag_b_name: string;
  match_count: number;
  sample_friend_names: string[] | null;
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
    const { data, error } = await supabase.rpc('find_tag_combinations');
    if (error) {
      console.error('[tag-combo-digest] RPC error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const list = (data ?? []) as Combo[];
    let inserted = 0;

    for (const row of list) {
      const sample = (row.sample_friend_names ?? []).slice(0, 3);
      // Title shape varies by sample size for readability:
      //   no names → "你朋友圈有 N 個人是 #A + #B"
      //   names    → "Alice、Bob 都標了 #A + #B（N 人）"
      const tagPart = `#${row.tag_a_name} + #${row.tag_b_name}`;
      const title =
        sample.length > 0
          ? `${sample.join('、')} 都標了 ${tagPart}（${row.match_count} 人）`
          : `你朋友圈有 ${row.match_count} 個人是 ${tagPart}`;

      // Synthetic ref_id keys this notification by the pair —
      // alphabetical order so (A,B) and (B,A) dedupe to one row.
      const [first, second] = [row.tag_a_name, row.tag_b_name].sort();
      const refKey = `combo:${first}|${second}`;

      const { error: insertErr } = await supabase
        .from('piktag_notifications')
        .upsert(
          {
            user_id: row.user_id,
            type: 'tag_combo',
            title,
            ref_type: 'tag_pair',
            ref_id: refKey,
            data: {
              tag_names: [row.tag_a_name, row.tag_b_name],
              match_count: row.match_count,
              sample_friend_names: sample,
            },
          },
          { onConflict: 'user_id,type,ref_id', ignoreDuplicates: true },
        );
      if (!insertErr) inserted++;
      else console.warn('[tag-combo-digest] insert failed:', insertErr.message);
    }

    return new Response(
      JSON.stringify({ candidates: list.length, inserted }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[tag-combo-digest] unexpected:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
