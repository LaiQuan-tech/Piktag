// Supabase Edge Function: daily-followup-check
// Generates follow-up reminders for new connections
// Schedule: daily at 9am via pg_cron
//
// Reminder intervals:
// - 3 days after meeting: "跟 XXX 打個招呼吧"
// - 7 days after meeting: "已經一週了，跟 XXX 聊聊近況"
// - 30 days after meeting: "認識 XXX 一個月了，保持聯繫"

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REMINDER_INTERVALS = [
  { days: 3, titleKey: 'followup_3d', title: '跟 {name} 打個招呼吧', body: '認識 3 天了，趁還有印象聊聊' },
  { days: 7, titleKey: 'followup_7d', title: '已經一週了，跟 {name} 聊聊近況', body: '保持聯繫讓關係不會冷掉' },
  { days: 30, titleKey: 'followup_30d', title: '認識 {name} 一個月了', body: '一個月了，保持聯繫吧' },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    let totalCreated = 0;

    for (const interval of REMINDER_INTERVALS) {
      // Find connections created exactly N days ago (within a 24-hour window)
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() - interval.days);
      const dayStart = new Date(targetDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setHours(23, 59, 59, 999);

      const { data: connections, error } = await supabase
        .from('piktag_connections')
        .select(`
          id, user_id, connected_user_id, nickname,
          connected_user:piktag_profiles!connected_user_id(full_name, username)
        `)
        .gte('created_at', dayStart.toISOString())
        .lte('created_at', dayEnd.toISOString());

      if (error || !connections) continue;

      for (const conn of connections) {
        const profile = (conn as any).connected_user;
        const name = conn.nickname || profile?.full_name || profile?.username || '朋友';

        const title = interval.title.replace('{name}', name);
        const body = interval.body;

        // Upsert notification (idempotent: won't duplicate if already sent)
        await supabase.from('piktag_notifications').upsert({
          user_id: conn.user_id,
          type: 'reminder',
          title,
          body,
          data: {
            reminder_type: 'follow_up',
            interval_days: interval.days,
            connection_id: conn.id,
            connected_user_id: conn.connected_user_id,
          },
          is_read: false,
          created_at: now.toISOString(),
        }, { onConflict: 'user_id,type,title' }).catch(() => {});

        totalCreated++;
      }
    }

    return new Response(
      JSON.stringify({ message: 'Follow-up check completed', reminders_created: totalCreated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('daily-followup-check error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
