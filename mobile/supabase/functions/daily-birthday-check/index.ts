// Daily Birthday Check — runs via cron, creates notifications for today's birthdays
// Deploy: supabase functions deploy daily-birthday-check
// Schedule: set up a cron job in Supabase Dashboard (Extensions > pg_cron)
//   SELECT cron.schedule('daily-birthday', '0 8 * * *', $$SELECT net.http_post(...)$$);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async () => {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const today = new Date();
  const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // Also match MM/DD format
  const mmddSlash = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;

  // Find all profiles with today's birthday
  const { data: birthdayProfiles } = await supabase
    .from('piktag_profiles')
    .select('id, full_name, username, birthday')
    .or(`birthday.like.%${mmdd},birthday.like.%${mmddSlash}`);

  if (!birthdayProfiles || birthdayProfiles.length === 0) {
    return new Response(JSON.stringify({ message: 'No birthdays today', count: 0 }));
  }

  const birthdayUserIds = birthdayProfiles.map(p => p.id);
  let notificationsCreated = 0;

  // For each birthday person, notify all their connections
  for (const bp of birthdayProfiles) {
    const name = bp.full_name || bp.username || 'Someone';

    // Find all users who have this person as a connection
    const { data: connections } = await supabase
      .from('piktag_connections')
      .select('user_id')
      .eq('connected_user_id', bp.id);

    if (!connections) continue;

    for (const conn of connections) {
      await supabase.from('piktag_notifications').insert({
        user_id: conn.user_id,
        type: 'birthday',
        title: `${name} 今天生日`,
        body: `別忘了祝 ${name} 生日快樂`,
        is_read: false,
      }).catch(() => {}); // ignore duplicates

      notificationsCreated++;
    }
  }

  return new Response(JSON.stringify({
    message: `Birthday notifications sent`,
    birthdays: birthdayProfiles.length,
    notifications: notificationsCreated,
  }));
});
