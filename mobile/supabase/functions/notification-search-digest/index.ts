// Supabase Edge Function: notification-search-digest
//
// Scheduled weekly (Monday 01:00 UTC ≈ 09:00 Taipei) via pg_cron.
//
// What it does:
//   1. Auth gate via CRON_SECRET (constant-time compare).
//   2. Count "recovery fired but search still empty" rows in the past
//      7 days from piktag_search_telemetry — i.e. queries where
//      Gemini extracted keywords but no tag/profile matched them.
//      These are the actionable signal: each is a candidate for a
//      new tag_aliases seed entry or a missing tag.
//   3. If count > 0, for every admin user (joined via the existing
//      public.admins email allowlist):
//        a. Insert an in-app notification row (piktag_notifications).
//        b. Fire an Expo push if a push_token is on file.
//
// Notification body lists the top recurring extracted keywords so
// the admin can see at-a-glance which terms keep failing —
// "今週缺 tag: 攝影師、Yoga、Pilates" beats "you have 7 failures".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const LOOKBACK_DAYS = 7;
const TYPE = 'search_digest';
const TOP_KEYWORDS_IN_BODY = 5;
const MAX_BODY_CHARS = 180;

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

function truncate(s: string, max = MAX_BODY_CHARS): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Auth gate ──
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || !provided || !timingSafeEqual(expected, provided)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── 1a. Rolling 7-day health metrics ──
    // Three numbers tell the founder if search is getting better or
    // worse without having to open SQL Editor:
    //   • totalSearches  — volume
    //   • recoveryPct    — % of searches that fell back to LLM
    //                      (lower is better: more direct hits)
    //   • emptyPct       — % of searches that ended up showing nothing
    //                      (lower is better: more useful)
    // Plus 7-day-prior comparison so a regression jumps out.
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();
    const sincePrev = new Date(Date.now() - 2 * LOOKBACK_DAYS * 86400 * 1000).toISOString();

    async function bucketMetrics(fromISO: string, toISO: string) {
      const { count: total } = await supabase
        .from('piktag_search_telemetry')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', fromISO)
        .lt('created_at', toISO);
      const { count: recovered } = await supabase
        .from('piktag_search_telemetry')
        .select('*', { count: 'exact', head: true })
        .eq('recovery_triggered', true)
        .gte('created_at', fromISO)
        .lt('created_at', toISO);
      const { count: empty } = await supabase
        .from('piktag_search_telemetry')
        .select('*', { count: 'exact', head: true })
        .eq('final_tag_count', 0)
        .eq('final_profile_count', 0)
        .eq('final_tag_user_count', 0)
        .gte('created_at', fromISO)
        .lt('created_at', toISO);
      const t = total ?? 0;
      return {
        total: t,
        recoveryPct: t > 0 ? Math.round(((recovered ?? 0) * 100) / t) : 0,
        emptyPct: t > 0 ? Math.round(((empty ?? 0) * 100) / t) : 0,
      };
    }

    const nowISO = new Date().toISOString();
    const [current, prior] = await Promise.all([
      bucketMetrics(since, nowISO),
      bucketMetrics(sincePrev, since),
    ]);

    // ── 1b. Pull the past-week failure window (actionable signal) ──
    const { data: failures, count, error: failuresErr } = await supabase
      .from('piktag_search_telemetry')
      .select('query, extracted_keywords, locale, created_at', { count: 'exact' })
      .eq('recovery_triggered', true)
      .eq('final_tag_count', 0)
      .eq('final_profile_count', 0)
      .eq('final_tag_user_count', 0)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);

    if (failuresErr) {
      console.error('failure query error:', failuresErr.message);
      return new Response(
        JSON.stringify({ error: failuresErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const totalCount = count ?? 0;
    // Skip only if BOTH there's no search traffic AND no failures —
    // an active week with zero failures is itself good news worth
    // pushing ("recoveryPct dropped from 12% to 5% — keep going").
    if (totalCount === 0 && current.total === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'no traffic', lookback_days: LOOKBACK_DAYS }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── 2. Aggregate the top recurring extracted keywords ──
    // The actionable signal isn't "X failures" — it's "these
    // keywords keep coming back unmatched". Count + rank.
    const counts = new Map<string, number>();
    for (const f of (failures || []) as Array<{ extracted_keywords?: string[] | null }>) {
      for (const kw of f.extracted_keywords || []) {
        if (typeof kw === 'string' && kw.trim()) {
          const k = kw.trim();
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      }
    }
    const topKeywords = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_KEYWORDS_IN_BODY)
      .map(([kw]) => kw);

    // ── 3. Compose notification text ──
    //
    // Three-line body:
    //   1. health line  — "搜尋 N · LLM救援 X% · 空手 Y%"
    //   2. trend line   — change vs prior 7 days (↓ = improving)
    //   3. action line  — top failing keywords (the actionable bit)
    const title = '📊 PikTag 搜尋週報';

    const arrow = (cur: number, prev: number) => {
      if (prev === 0 && cur === 0) return '→';
      if (prev === 0) return cur > 0 ? '↑' : '→';
      const delta = cur - prev;
      if (Math.abs(delta) < 1) return '→';
      return delta < 0 ? '↓' : '↑';
    };

    const healthLine =
      `搜尋 ${current.total}｜LLM救援 ${current.recoveryPct}%｜空手 ${current.emptyPct}%`;
    const trendLine =
      prior.total > 0
        ? `vs 上週：救援${arrow(current.recoveryPct, prior.recoveryPct)}${prior.recoveryPct}% · 空手${arrow(current.emptyPct, prior.emptyPct)}${prior.emptyPct}%`
        : '';

    const keywordsSegment =
      topKeywords.length > 0
        ? `缺 tag：${topKeywords.join('、')}`
        : '';
    const body = truncate(
      [healthLine, trendLine, keywordsSegment].filter(Boolean).join(' · '),
    );

    // ── 4. Find admin recipients ──
    // public.admins is the existing email-allowlist (see is_admin()
    // helper in 20260429180000_pm_tables_rls.sql). Service role can
    // read auth.users — RLS doesn't apply.
    const { data: adminRows, error: adminsErr } = await supabase
      .rpc('get_admin_notification_recipients');
    if (adminsErr || !adminRows || adminRows.length === 0) {
      console.warn('no admin recipients:', adminsErr?.message);
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'no admin recipients',
          total_count: totalCount,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── 5. Insert notification rows + fire pushes ──
    // The `data` payload rides in both the in-app notification row
    // (piktag_notifications.data jsonb) and the Expo push (push.data).
    // Includes the rolling-stats numbers so the mobile app could
    // later render a richer detail view if needed.
    const data = {
      total_count: totalCount,
      lookback_days: LOOKBACK_DAYS,
      top_keywords: topKeywords,
      stats: {
        current,
        prior,
      },
    };

    // 5-pre. Pre-flight idempotency check — find which admins ALREADY
    // received a search_digest in the past 6 days, so cron retries /
    // accidental double-fires don't double-push the same admin.
    // Window is 6 days (< the 7-day weekly cadence) so the next legit
    // weekly run isn't blocked by its predecessor.
    const idempotencyWindow = new Date(Date.now() - 6 * 86400 * 1000).toISOString();
    const adminIds = (adminRows as Array<{ user_id: string }>)
      .map((a) => a.user_id)
      .filter(Boolean);
    const { data: alreadySentRows } = await supabase
      .from('piktag_notifications')
      .select('user_id')
      .eq('type', TYPE)
      .gte('created_at', idempotencyWindow)
      .in('user_id', adminIds);
    const alreadySent = new Set(
      ((alreadySentRows as Array<{ user_id: string }>) || []).map((r) => r.user_id),
    );

    let inserted = 0;
    let pushed = 0;
    let skipped = 0;
    for (const admin of adminRows as Array<{ user_id: string; push_token: string | null }>) {
      if (!admin.user_id) continue;

      // Skip admins who already got this week's digest.
      if (alreadySent.has(admin.user_id)) {
        skipped++;
        continue;
      }

      // 5a. In-app notification row.
      const { error: insertErr } = await supabase
        .from('piktag_notifications')
        .insert({
          user_id: admin.user_id,
          type: TYPE,
          title,
          body,
          data,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      if (insertErr) {
        console.error('notification insert failed for', admin.user_id, insertErr.message);
        continue;
      }
      inserted++;

      // 5b. Best-effort Expo push.
      if (!admin.push_token) continue;
      try {
        const pushRes = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            to: admin.push_token,
            title,
            body,
            sound: 'default',
            data: { type: TYPE, ...data },
          }),
        });
        if (pushRes.ok) pushed++;
        else console.warn('Expo push HTTP', pushRes.status, await pushRes.text().catch(() => ''));
      } catch (pushErr) {
        console.warn('Expo push threw:', pushErr);
      }
    }

    return new Response(
      JSON.stringify({
        total_count: totalCount,
        top_keywords: topKeywords,
        admins_notified: inserted,
        pushes_sent: pushed,
        admins_skipped_already_sent: skipped,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('notification-search-digest error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
