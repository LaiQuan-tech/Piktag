// Supabase Edge Function: weekly-ask-prompt
//
// P1 "大膽推" Ask flow — surface the Ask system to dormant users
// once a week. Without active Asks the whole AskStoryRow rail +
// bridge-detection feature is silent; this fights that with a
// gentle weekly nudge: "今天想要什麼？"
//
// Target audience (filtered on the DB side):
//   • User has ≥ 2 friends (no point prompting solo accounts)
//   • User does NOT have an active Ask right now
//   • User hasn't been prompted in the last 6 days (dedup)
//
// Notification shape:
//   type:  'ask_prompt'
//   title: '今天想要什麼？發一個 Ask 讓朋友看到'
//   ref:   (no ref_id — the unique index only enforces uniqueness
//         when ref_id IS NOT NULL, so we can rely on the 6-day
//         look-back filter for dedup instead of the index)
//
// Cron schedule (set up in Supabase Dashboard): once a week,
// Saturday morning. Saturdays empirically have the highest
// "what should I do today" mental availability.

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

  // Same CRON_SECRET auth pattern as the other daily-* functions.
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
    const { data: targets, error } = await supabase.rpc('find_ask_prompt_targets');
    if (error) {
      console.error('[weekly-ask-prompt] RPC error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const list = (targets ?? []) as Array<{ user_id: string }>;
    let inserted = 0;

    // Drip one notification per target — no ref_id (it's not tied
    // to a specific Ask / Tag / Vibe; the prompt itself is the
    // payload). Dedup relies on the RPC's "not prompted in last
    // 6 days" filter, not on a unique index.
    for (const row of list) {
      const { error: insertErr } = await supabase
        .from('piktag_notifications')
        .insert({
          user_id: row.user_id,
          type: 'ask_prompt',
          title: '今天想要什麼？發一個 Ask 讓朋友看到',
          data: { source: 'weekly-prompt' },
        });
      if (!insertErr) inserted++;
      else console.warn('[weekly-ask-prompt] insert failed:', insertErr.message);
    }

    return new Response(
      JSON.stringify({ candidates: list.length, inserted }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[weekly-ask-prompt] unexpected:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
