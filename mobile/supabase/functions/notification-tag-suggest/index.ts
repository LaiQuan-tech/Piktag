// Supabase Edge Function: notification-tag-suggest
// Schedule: daily 09:00 UTC via pg_cron -> trigger_tag_suggest_nudge()
// (vault service-role + net.http_post). Every user gets at most one of
// these per 3 days (the SQL feed enforces the NOT EXISTS window).
//
// Feature (founder 2026-07-02): suggest tags the user could ADD to their
// own profile so it's more complete and more searchable. AI-generated
// with the suggest-tags person-mode brain; lock-screen copy follows the
// user's app language (piktag_profiles.app_language, 19-locale template
// map below); the notification names the actual tags.
//
// Flow per run:
//   1) Auth gate (Bearer CRON_SECRET or service-role key, constant-time).
//   2) RPC select_tag_nudge_due_users(limit) — one round-trip feed:
//      bio / full_name / app_language / push_token / existing_tags /
//      removed_tags (principle #6) / recent_suggested (30-day no-repeat).
//   3) Per user (bounded concurrency): Gemini person-mode prompt ->
//      filter existing ∪ removed ∪ recently-suggested -> top 3.
//      ZERO left -> skip the user entirely (silence beats noise).
//   4) INSERT piktag_ai_tag_suggestions (source='push_nudge', model
//      order preserved in position_in_list) — principle #5 calibration
//      starts accruing on day 1. The client marks accepted on add.
//   5) INSERT piktag_notifications (type='tag_suggest_nudge', non-empty
//      English fallback body per CLAUDE.md). The BEFORE INSERT category
//      gate (notif_memories) may cancel the row — a cancelled insert
//      returns no row, and we DON'T push in that case.
//   6) Expo push with the app_language-localized title/body.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY,
// CRON_SECRET (optional alternate bearer).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TYPE = 'tag_suggest_nudge';
const MAX_BODY_CHARS = 200; // Expo push body cap (matches send-chat-push)
// Wall-clock math (edge fn budget is 150s on the free tier): 50 users ×
// ~2s per Gemini call (thinkingBudget 0) at 4-way concurrency ≈ 25-40s.
// Daily runs at the 3-day cadence = ~150 users/cycle of capacity — fine
// pre-launch. SCALE TRIGGER: actives > ~150 → raise the limit on the
// paid tier's 400s budget or add a second staggered daily run.
const USER_BATCH_LIMIT = 50; // per run; the 3-day window self-staggers the rest
const CONCURRENCY = 4; // Gemini fan-out width
const TIME_BUDGET_MS = 100_000; // stop starting new users past this; leftovers run tomorrow
const MAX_TAGS = 3;

// Same live-model reality as suggest-tags (2026-06-07 probe): only the
// 2.5 family exists. Not latency-critical here, so quality-first chain.
const MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

// ── 19-locale lock-screen templates ─────────────────────────────────
// Keyed by piktag_profiles.app_language (client i18n.language verbatim).
// Statement form, no emoji, tags interpolated into {tags}. Unknown or
// NULL language -> 'en'. Keep these in step with the client's
// notifications.types.tag_suggest_nudge i18n block (same wording).
const PUSH_COPY: Record<string, { title: string; body: (tags: string) => string }> = {
  'en':    { title: 'Tag ideas picked for you',        body: (t) => `${t} — add them so the right people can find you` },
  'zh-TW': { title: '為你挑了幾個標籤',                 body: (t) => `${t} — 補上，讓對的人找到你` },
  'zh-CN': { title: '为你挑了几个标签',                 body: (t) => `${t} — 补上，让对的人找到你` },
  'ja':    { title: 'あなたに合うタグを選びました',       body: (t) => `${t} — 追加すると、見つけてほしい人に見つかります` },
  'ko':    { title: '어울리는 태그를 골랐어요',           body: (t) => `${t} — 추가하면 꼭 맞는 사람이 당신을 찾습니다` },
  'de':    { title: 'Tag-Ideen für dich',              body: (t) => `${t} — füge sie hinzu, damit die richtigen Leute dich finden` },
  'fr':    { title: 'Des tags choisis pour vous',      body: (t) => `${t} — ajoutez-les pour que les bonnes personnes vous trouvent` },
  'es':    { title: 'Tags elegidos para ti',           body: (t) => `${t} — añádelos para que las personas adecuadas te encuentren` },
  'pt':    { title: 'Tags escolhidas para você',       body: (t) => `${t} — adicione para as pessoas certas te encontrarem` },
  'it':    { title: 'Tag scelti per te',               body: (t) => `${t} — aggiungili così le persone giuste ti trovano` },
  'ru':    { title: 'Теги, подобранные для вас',       body: (t) => `${t} — добавьте их, чтобы вас нашли нужные люди` },
  'tr':    { title: 'Sana özel etiket önerileri',      body: (t) => `${t} — ekle, doğru kişiler seni bulsun` },
  'id':    { title: 'Ide tag untukmu',                 body: (t) => `${t} — tambahkan agar orang yang tepat menemukanmu` },
  'vi':    { title: 'Tag gợi ý cho bạn',               body: (t) => `${t} — thêm vào để đúng người tìm thấy bạn` },
  'th':    { title: 'แท็กที่เลือกมาเพื่อคุณ',              body: (t) => `${t} — เพิ่มเลย ให้คนที่ใช่ค้นพบคุณ` },
  'ar':    { title: 'وسوم مقترحة لك',                  body: (t) => `${t} — أضفها ليجدك الأشخاص المناسبون` },
  'hi':    { title: 'आपके लिए चुने गए टैग',              body: (t) => `${t} — जोड़ें, ताकि सही लोग आपको खोज सकें` },
  'bn':    { title: 'আপনার জন্য বাছাই করা ট্যাগ',         body: (t) => `${t} — যোগ করুন, যাতে সঠিক মানুষ আপনাকে খুঁজে পায়` },
  'ur':    { title: 'آپ کے لیے منتخب ٹیگز',             body: (t) => `${t} — شامل کریں تاکہ صحیح لوگ آپ کو ڈھونڈ سکیں` },
};

// app_language code -> the language NAME the person-mode prompt expects
// ("Keywords MUST be written in ${lang}").
const LANG_NAME: Record<string, string> = {
  'en': 'English', 'zh-TW': 'Traditional Chinese (Taiwan)', 'zh-CN': 'Simplified Chinese',
  'ja': 'Japanese', 'ko': 'Korean', 'de': 'German', 'fr': 'French', 'es': 'Spanish',
  'pt': 'Portuguese', 'it': 'Italian', 'ru': 'Russian', 'tr': 'Turkish',
  'id': 'Indonesian', 'vi': 'Vietnamese', 'th': 'Thai', 'ar': 'Arabic',
  'hi': 'Hindi', 'bn': 'Bengali', 'ur': 'Urdu',
};

type DueUser = {
  user_id: string;
  bio: string | null;
  full_name: string | null;
  headline: string | null;
  // piktag_profiles.language — Settings syncs it on explicit change and
  // (since this feature) the client re-syncs from live i18n at boot.
  language: string;
  push_token: string | null;
  existing_tags: string[];
  removed_tags: string[];
  recent_suggested: string[];
};

function truncateBody(s: string): string {
  if (s.length <= MAX_BODY_CHARS) return s;
  return s.slice(0, MAX_BODY_CHARS - 1) + '…';
}

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

// Copied from suggest-tags/index.ts (extractStringArray) — the fenced /
// bare-array tolerant JSON parser for Gemini's reply. Kept byte-compatible
// so both functions parse identically.
function extractStringArray(text: string): string[] | null {
  if (!text) return null;
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();

  const arr = s.match(/\[[\s\S]*\]/);
  if (arr) s = arr[0];

  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return null;
    const strings = parsed
      .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.replace(/^#/, '').trim())
      .slice(0, 10);
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}

// Tag language: content-detection first (the SAME heuristic every
// existing caller uses — EditProfileScreen.tsx:1485; tags should read in
// the language the profile is WRITTEN in, for calibration comparability),
// falling back to the user's UI language name when the content has no
// CJK signal (EditProfile falls back to "the same language as the
// content", but here we actually KNOW the UI language — use it).
function detectLangName(content: string, uiLanguage: string): string {
  if (/[一-鿿]/.test(content)) return '繁體中文';
  if (/[぀-ヿ]/.test(content)) return '日本語';
  if (/[가-힯]/.test(content)) return '한국어';
  if (/[฀-๿]/.test(content)) return 'ภาษาไทย';
  return LANG_NAME[uiLanguage] ?? 'English';
}

// Person-mode prompt per suggest-tags conventions (the non-fast '3 to 8'
// variant so the post-filter still has enough left to fill 3 picks).
// Deliberately a COPY, not an HTTP call into suggest-tags: that function
// is JWT-user-scoped and burns the per-user AI quota; this path runs as
// the system. Card-scan's latency-critical path is untouched. Also feeds
// removed/recently-suggested names into the "do NOT repeat" line as soft
// prevention — the deterministic post-filter stays the guarantee.
function buildPrompt(u: DueUser, langName: string): string {
  const doNotRepeat = [...u.existing_tags, ...u.removed_tags, ...u.recent_suggested].join(', ');
  return [
    `Suggest hashtag tags that describe this person from their title, role, field, company, or interests.`,
    `Return ONLY a JSON array of 3 to 8 short hashtag strings (without the # prefix), nothing else.`,
    `ALWAYS return at least ONE tag — NEVER an empty array. Prefer the strongest, specific tags; don't pad with weak filler, but always provide your best tag(s) even for a sparse input.`,
    `Keywords MUST be written in ${langName}. Only use English for internationally recognized terms (PM, AI, CEO, UX, IoT).`,
    `Short (1-3 words / kanji clusters), specific, scannable. No vague catch-alls (#nice, #person, #friend).`,
    `Do NOT repeat tags already noted: ${doNotRepeat || '(none)'}`,
    ``,
    `─── Context ───`,
    `Name: ${u.full_name || '(none)'}`,
    `Title / company / bio / card text: ${[u.headline, u.bio].filter(Boolean).join('\n') || '(none)'}`,
  ].join('\n');
}

async function geminiSuggest(apiKey: string, prompt: string): Promise<string[] | null> {
  for (const model of MODEL_CHAIN) {
    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // 2.5-family thinks by default; a batch job cares about
            // wall-clock and spend, not per-call pondering (CLAUDE.md
            // Gemini rule). Deliberate deviation from suggest-tags'
            // interactive person path.
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
          }),
        },
      );
      if (!upstream.ok) {
        const bodyText = await upstream.text().catch(() => '');
        console.error(`notification-tag-suggest upstream [${model}]: HTTP ${upstream.status}`, bodyText.slice(0, 300));
        if (/API_KEY|api key/i.test(bodyText)) return null; // config error — retrying models won't help
        continue;
      }
      const result = await upstream.json();
      const text: string = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const suggestions = extractStringArray(text);
      if (suggestions && suggestions.length > 0) return suggestions;
    } catch (e) {
      console.error(`notification-tag-suggest fetch threw [${model}]:`, e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- Auth gate: Bearer CRON_SECRET (GH Actions style) OR service-role
  // key (pg_cron vault wrapper). Constant-time compare, same as
  // notification-recommendation. ---
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

  const errors: string[] = [];
  let notified = 0;
  let skipped_no_suggestions = 0;
  let skipped_gate = 0;

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // --- 1. Due users (3-day pacing + all filter feeds in one RPC). ---
    // Test hook: POST {"user_ids": ["<uuid>", ...]} (cron/service-role
    // authed only — the gate above) targets specific users regardless of
    // pacing, for curl smoke tests. Normal runs POST {"mode":"run"}.
    let requestedIds: string[] | null = null;
    try {
      const reqBody = await req.json();
      if (Array.isArray(reqBody?.user_ids) && reqBody.user_ids.length > 0) {
        requestedIds = reqBody.user_ids.filter((v: unknown) => typeof v === 'string').slice(0, 10);
      }
    } catch {
      /* empty/invalid body = normal run */
    }

    const { data: dueUsers, error: rpcErr } = await supabase
      .rpc('select_tag_nudge_due_users', { p_limit: requestedIds ? 500 : USER_BATCH_LIMIT });
    if (rpcErr) {
      throw new Error(`select_tag_nudge_due_users failed: ${rpcErr.message}`);
    }
    let users = (dueUsers ?? []) as DueUser[];
    if (requestedIds) {
      const wanted = new Set(requestedIds);
      users = users.filter((u) => wanted.has(u.user_id));
    }
    if (users.length === 0) {
      return new Response(JSON.stringify({ notified: 0, skipped_no_suggestions, errors }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const startedAt = Date.now();

    // --- 2-6. Per-user pipeline with bounded concurrency. ---
    const queue = [...users];
    const worker = async () => {
      while (queue.length > 0) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) return; // leftovers run tomorrow
        const u = queue.shift();
        if (!u) return;
        try {
          const langName = detectLangName(
            [u.bio, u.full_name, u.headline].filter(Boolean).join('\n'),
            u.language,
          );
          const raw = await geminiSuggest(apiKey, buildPrompt(u, langName));
          if (!raw) {
            skipped_no_suggestions++;
            continue;
          }

          // Filter: already-carried ∪ explicitly-removed ∪ pushed-in-30d.
          const blocked = new Set(
            [...u.existing_tags, ...u.removed_tags, ...u.recent_suggested]
              .map((t) => t.toLowerCase()),
          );
          const picks = raw
            .filter((t) => !blocked.has(t.toLowerCase()))
            .slice(0, MAX_TAGS);
          if (picks.length === 0) {
            // Nothing NEW to offer — silence beats noise. No row, no push;
            // the 3-day window will retry with fresh context next cycle.
            skipped_no_suggestions++;
            continue;
          }

          // --- Calibration log first (principle #5): shown-in-push rows.
          const { data: sugRows, error: sugErr } = await supabase
            .from('piktag_ai_tag_suggestions')
            .insert(picks.map((tag, i) => ({
              user_id: u.user_id,
              tag_name: tag,
              source: 'push_nudge',
              position_in_list: i,
              context: { surface: 'push_nudge' },
            })))
            .select('id');
          if (sugErr) {
            errors.push(`suggestion log failed for ${u.user_id}: ${sugErr.message}`);
            continue; // without ids the accept loop can't close — skip this user
          }
          const suggestionIds = (sugRows ?? []).map((r) => (r as { id: string }).id);

          // --- Bell-row insert. English fallback body per CLAUDE.md (the
          // client renders the localized template from data.tag_names).
          // The BEFORE INSERT category gate may cancel — zero rows back
          // means the user opted out of notif_memories: no push either.
          const tagsPreview = picks.map((t) => `#${t}`).join(' ');
          const { data: notifRows, error: notifErr } = await supabase
            .from('piktag_notifications')
            .insert({
              user_id: u.user_id,
              type: TYPE,
              title: '',
              body: `New tag ideas: ${tagsPreview} — add them so the right people can find you.`,
              data: {
                tag_names: picks,
                suggestion_ids: suggestionIds,
                cta: 'edit_profile',
              },
              is_read: false,
            })
            .select('id');
          if (notifErr) {
            errors.push(`notification insert failed for ${u.user_id}: ${notifErr.message}`);
            continue;
          }
          const notifId = (notifRows ?? [])[0]?.id as string | undefined;
          if (!notifId) {
            skipped_gate++; // category gate cancelled the row — respect it
            continue;
          }

          // --- Localized lock-screen push (app_language, fallback en). ---
          if (u.push_token && u.push_token.trim().length > 0) {
            const copy = PUSH_COPY[u.language] ?? PUSH_COPY['en'];
            const resp = await fetch(EXPO_PUSH_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: u.push_token,
                title: copy.title,
                body: truncateBody(copy.body(tagsPreview)),
                data: { type: TYPE, notification_id: notifId, tag_names: picks, suggestion_ids: suggestionIds },
                sound: 'default',
                priority: 'high',
              }),
            });
            if (!resp.ok) {
              errors.push(`expo push ${resp.status} for user ${u.user_id}`);
            }
          }
          // No token → the bell row still landed; nothing else to do.
          notified++;
        } catch (e) {
          errors.push(`user ${u.user_id} pipeline threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, users.length) }, () => worker()));

    return new Response(
      JSON.stringify({ notified, skipped_no_suggestions, skipped_gate, due: users.length, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('notification-tag-suggest error:', err);
    return new Response(
      JSON.stringify({ notified, errors: [...errors, err instanceof Error ? err.message : String(err)] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
