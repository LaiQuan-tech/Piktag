// Supabase Edge Function: notify-admin-signup
// Invoked by trg_notify_admin_signup (piktag_profiles AFTER INSERT) via
// pg_net with the vault service-role key. Sends the founder a
// new-registration email through Resend.
//
// Founder ask (2026-07-03): "有新使用者註冊後，會寄信到
// lqtech2026@gmail.com 通知我" — prompted by a wave of unexplained
// faker-named signups only discovered days later in the admin backend.
//
// Env: SUPABASE_SERVICE_ROLE_KEY (auth gate), CRON_SECRET (alt bearer),
// RESEND_API_KEY (auto-provisioned by the deploy workflow from the
// existing SMTP_PASS GitHub secret — the same Resend key the auth
// SMTP uses; pikt.ag domain is verified in Resend).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_EMAIL = 'lqtech2026@gmail.com';
const FROM = 'PikTag <noreply@pikt.ag>';

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

// Concept-linker health check, appended to the founder's real-time signup
// email. WHY here and not on the app push: the founder purged ops telemetry
// from the app notification feed / Expo push TWICE — 2026-06-06
// (20260605130000, which also DROPPED the original notify_linker_stall cron)
// and 2026-06-17 (20260617010000): "operational data belongs in the admin
// backend, NOT pushed to the founder's phone." Email to lqtech2026@gmail.com
// is the founder's sanctioned real-time ops channel (2026-07-03), so a
// linker-down alert rides HERE. Silent when healthy (no line appended).
// Fail-soft: any error returns null — an ops check must NEVER break the
// signup email.
async function linkerHealthWarning(): Promise<string | null> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return null;
    const supabase = createClient(url, key);

    // Coverage from the moat RPC (service_role-granted, cheap COUNTs).
    let coveragePct: number | null = null;
    const { data: cov } = await supabase.rpc('admin_concept_coverage');
    if (Array.isArray(cov) && cov.length > 0 && cov[0]) {
      const v = Number((cov[0] as { tag_coverage_pct?: unknown }).tag_coverage_pct);
      if (Number.isFinite(v)) coveragePct = v;
    }

    // Oldest-unlinked age from the health VIEW (kept read-only, granted to
    // service_role). Guarded separately so a coverage read still fires if
    // the view read fails.
    let oldestHours: number | null = null;
    try {
      const { data: health } = await supabase
        .from('tag_concept_link_health')
        .select('oldest_unlinked_at')
        .maybeSingle();
      const oldest = (health as { oldest_unlinked_at?: string | null } | null)?.oldest_unlinked_at;
      if (oldest) {
        const ageMs = Date.now() - new Date(oldest).getTime();
        if (Number.isFinite(ageMs) && ageMs > 0) oldestHours = ageMs / 3_600_000;
      }
    } catch {
      // view unreadable — fall back to coverage-only signal
    }

    const coverageBad = coveragePct !== null && coveragePct < 60;
    const staleBad = oldestHours !== null && oldestHours > 24;
    if (!coverageBad && !staleBad) return null;

    const parts: string[] = [];
    if (coveragePct !== null) {
      parts.push(`concept coverage ${coveragePct}%${coverageBad ? ' (below 60%)' : ''}`);
    }
    if (staleBad && oldestHours !== null) {
      parts.push(`oldest unlinked tag ${Math.floor(oldestHours)}h old`);
    }
    return `Linker health: ${parts.join(', ')} — embeddings may be down; check the concept linker / Gemini quota.`;
  } catch {
    return null; // never block the signup email over an ops check
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const expectedCron = Deno.env.get('CRON_SECRET') ?? '';
  const expectedServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const valid =
    !!provided &&
    (
      (expectedCron.length > 0 && timingSafeEqual(provided, expectedCron)) ||
      (expectedServiceKey.length > 0 && timingSafeEqual(provided, expectedServiceKey))
    );
  if (!valid) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      // Deploy workflow provisions this from SMTP_PASS; if it hasn't
      // run yet, log loudly but return 200 so pg_net doesn't retry-spam.
      console.error('notify-admin-signup: RESEND_API_KEY not set — email skipped');
      return new Response(JSON.stringify({ ok: false, skipped: 'no_resend_key' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: {
      user_id?: string;
      email?: string;
      created_at?: string;
      signups_last_hour?: number;
    } = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'invalid body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = body.user_id ?? '(unknown)';
    const email = body.email ?? '(no email)';
    const lastHour = typeof body.signups_last_hour === 'number' ? body.signups_last_hour : 1;
    // Render the timestamp in the founder's timezone.
    const when = new Date(body.created_at ?? Date.now()).toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour12: false,
    });
    const adminUrl = `https://admin.pikt.ag/users/${userId}`;
    const signupsUrl = 'https://admin.pikt.ag/signups';

    // Digest mode: the trigger only reaches here during a wave at the
    // 21st/50th/100th… signup, so this email says "possible bot wave"
    // rather than spamming one mail per bot. Normal volume renders the
    // per-signup email.
    // If the concept linker is down, surface it AT THE TOP of this email
    // (the founder's proven "I will see it" channel). Silent when healthy.
    const linkerWarn = await linkerHealthWarning();
    const warnHtml = linkerWarn
      ? `<p style="color:#b91c1c"><strong>${linkerWarn}</strong></p>\n`
      : '';
    const warnText = linkerWarn ? `${linkerWarn}\n\n` : '';

    const isFlood = lastHour > 20;
    const subject = isFlood
      ? `PikTag 疑似機器人潮：過去一小時 ${lastHour} 筆註冊`
      : `PikTag 新註冊：${email}`;
    const html = warnHtml + (isFlood
      ? [
          `<p><strong>過去一小時有 ${lastHour} 筆註冊</strong>，超過正常量，疑似機器人潮。</p>`,
          `<p>為避免灌爆信箱，我們不會每筆都寄——只在第 21、50、100… 筆提醒你一次。</p>`,
          `<p>最新一筆：${email}（${when} 台北）</p>`,
          `<p><a href="${signupsUrl}">去後台批次審查這批註冊</a></p>`,
        ].join('\n')
      : [
          `<p>有新使用者註冊 PikTag。</p>`,
          `<p><strong>Email：</strong>${email}<br/>`,
          `<strong>User ID：</strong>${userId}<br/>`,
          `<strong>時間：</strong>${when}（台北）</p>`,
          `<p><a href="${adminUrl}">在後台查看這位使用者</a></p>`,
        ].join('\n'));
    const text = warnText + (isFlood
      ? `過去一小時有 ${lastHour} 筆註冊，疑似機器人潮。\n最新一筆: ${email}（${when} 台北）\n批次審查: ${signupsUrl}`
      : `有新使用者註冊 PikTag。\nEmail: ${email}\nUser ID: ${userId}\n時間: ${when}（台北）\n後台: ${adminUrl}`);

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: FROM, to: [ADMIN_EMAIL], subject, html, text }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('notify-admin-signup: Resend error', resp.status, detail.slice(0, 300));
      return new Response(JSON.stringify({ ok: false, resend_status: resp.status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-admin-signup error:', err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
