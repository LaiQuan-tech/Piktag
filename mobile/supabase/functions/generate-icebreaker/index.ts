// Supabase Edge Function: generate-icebreaker
//
// The "conversation activation" engine. Given (sender_id,
// recipient_id, ask_id?), pulls all the shared context PikTag knows
// about the pair and asks Gemini Flash to write 3 short icebreaker
// messages the sender could send.
//
// North-Star tie-in (CLAUDE.md): "Tags let a user reactivate dormant
// connections by searching tags (活化舊有人脈)". Finding the person
// is half the loop; the OTHER half is the user actually saying
// something specific enough to elicit a reply. Without icebreakers,
// "Hi" → silence → dormant. With them, "Hey Jeff! Saw your tag
// #日式甜点 — I just posted an Ask…" → real conversation.
//
// Mirrors suggest-tags / scan-business-card conventions:
//   - GEMINI_API_KEY from env
//   - Same model fallback chain (2.5-flash → 2.0-flash → 1.5-flash)
//   - thinkingBudget=0 for the same reason as scan-business-card
//     (the task is templating, not reasoning)
//   - JSON-only response shape, defensive parsing for fence/prose
//
// Auth: Authorization header is a user JWT. Verified by Supabase
// edge runtime via the standard 'jwt verification' flag in
// supabase/config.toml (defaults to on); inside this function we
// trust auth.uid() == sender_id implicitly through the supabase
// client's RLS-aware queries.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// 2026-06-07: gemini-2.0-flash / 1.5-flash were RETIRED by Google (404).
// Only the live 2.5 models remain.
const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;

// Dormant threshold: a conversation with no message in the past 90
// days is treated as cold. The prompt branches on this — for cold
// pairs we ask Gemini to acknowledge the gap naturally (not
// guilt-trip), for active pairs we keep it straight-forward.
const DORMANT_DAYS = 90;

type Body = {
  recipient_id?: string;
  ask_id?: string | null;
  lang?: string; // sender's app language; defaults to English
};

type Suggestions = { suggestions: string[] };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractStringArray(text: string): string[] {
  if (!text) return [];
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();
  const arr = s.match(/\[[\s\S]*\]/);
  if (arr) s = arr[0];
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v) => typeof v === 'string')
      .map((v) => (v as string).trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return jsonResponse(500, { error: 'GEMINI_API_KEY not configured' });
    }
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Use the caller's JWT so auth.uid() resolves naturally inside RLS
    // queries (we only need the sender's identity from it).
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return jsonResponse(401, { error: 'Missing Authorization' });
    }

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body must be valid JSON' });
    }
    const recipientId = (body.recipient_id ?? '').trim();
    const askId = body.ask_id ? String(body.ask_id).trim() || null : null;
    const lang = (body.lang ?? 'English').trim().slice(0, 50);

    if (!recipientId) {
      return jsonResponse(400, { error: 'Missing recipient_id' });
    }

    // Identify sender from the JWT.
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonResponse(401, { error: 'Invalid token' });
    }
    const senderId = userData.user.id;
    if (senderId === recipientId) {
      return jsonResponse(400, { error: 'Cannot icebreak with yourself' });
    }

    // From here on we read with service role — we need cross-user
    // tag and met-context data the calling user might not see by RLS
    // (the public bits, but we won't leak private notes).
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Sender + recipient profiles (parallel).
    const [senderRes, recipientRes] = await Promise.all([
      svc
        .from('piktag_profiles')
        .select('username, full_name, headline, bio')
        .eq('id', senderId)
        .maybeSingle(),
      svc
        .from('piktag_profiles')
        .select('username, full_name, headline, bio')
        .eq('id', recipientId)
        .maybeSingle(),
    ]);
    const sender = senderRes.data ?? {};
    const recipient = recipientRes.data ?? {};

    // 2. Public tags for both (top 10 each by position) — these
    // drive most of the "specific context" angle in the prompt.
    const [senderTagsRes, recipientTagsRes] = await Promise.all([
      svc
        .from('piktag_user_tags')
        .select('tag_id, piktag_tags!inner(name)')
        .eq('user_id', senderId)
        .eq('is_private', false)
        .order('position', { ascending: true })
        .limit(10),
      svc
        .from('piktag_user_tags')
        .select('tag_id, piktag_tags!inner(name)')
        .eq('user_id', recipientId)
        .eq('is_private', false)
        .order('position', { ascending: true })
        .limit(10),
    ]);
    const senderTags = (senderTagsRes.data ?? [])
      .map((r: any) => r?.piktag_tags?.name)
      .filter(Boolean) as string[];
    const recipientTags = (recipientTagsRes.data ?? [])
      .map((r: any) => r?.piktag_tags?.name)
      .filter(Boolean) as string[];
    const sharedTags = senderTags.filter((t) => recipientTags.includes(t));

    // 3. Met-context: the most recent scan_session that produced a
    // connection between the two users. The event_tags + date give
    // the prompt something concrete to anchor on.
    const { data: connRow } = await svc
      .from('piktag_connections')
      .select('scan_session_id, met_at, met_location')
      .or(
        `and(user_id.eq.${senderId},connected_user_id.eq.${recipientId}),and(user_id.eq.${recipientId},connected_user_id.eq.${senderId})`,
      )
      .not('scan_session_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    let metContext = '';
    if (connRow?.scan_session_id) {
      const { data: sess } = await svc
        .from('piktag_scan_sessions')
        .select('event_tags, event_date, event_location')
        .eq('id', connRow.scan_session_id)
        .maybeSingle();
      const pieces: string[] = [];
      if (sess?.event_tags?.length) pieces.push(sess.event_tags.slice(0, 3).join(', '));
      if (sess?.event_location) pieces.push(sess.event_location);
      if (sess?.event_date) pieces.push(sess.event_date);
      metContext = pieces.join(' · ');
    } else if (connRow?.met_location) {
      metContext = connRow.met_location;
    }

    // 4. Dormant status — look up the conversation between the two,
    // if it exists, and check last_message_at.
    const { data: conv } = await svc
      .from('piktag_conversations')
      .select('last_message_at')
      .or(
        `and(participant_a.eq.${senderId},participant_b.eq.${recipientId}),and(participant_a.eq.${recipientId},participant_b.eq.${senderId})`,
      )
      .maybeSingle();
    let dormantDays = -1;
    if (conv?.last_message_at) {
      const last = new Date(conv.last_message_at).getTime();
      dormantDays = Math.round((Date.now() - last) / (1000 * 60 * 60 * 24));
    }
    const isDormant = dormantDays >= DORMANT_DAYS;
    const isNewConversation = !conv?.last_message_at;

    // 5. Optional Ask context — when the chat is being opened from
    // the Ask match flow, the Ask body+tags are the strongest single
    // anchor for the message.
    let askContext = '';
    if (askId) {
      const [{ data: askRow }, { data: askTagsRows }] = await Promise.all([
        svc.from('piktag_asks').select('title, body').eq('id', askId).maybeSingle(),
        svc
          .from('piktag_ask_tags')
          .select('tag_id, piktag_tags!inner(name)')
          .eq('ask_id', askId)
          .limit(5),
      ]);
      const askTags = (askTagsRows ?? [])
        .map((r: any) => r?.piktag_tags?.name)
        .filter(Boolean) as string[];
      if (askRow?.body) {
        askContext = `Sender just posted an Ask: "${askRow.body}"`;
        if (askTags.length) askContext += ` tagged ${askTags.join(', ')}`;
      }
    }

    const senderFirstName = ((sender as any)?.full_name ?? '').trim().split(/\s+/)[0] || (sender as any)?.username || '';
    const recipientFirstName = ((recipient as any)?.full_name ?? '').trim().split(/\s+/)[0] || (recipient as any)?.username || '';

    // ── Build the prompt ─────────────────────────────────────────
    const promptLines = [
      `You are writing 3 short icebreaker messages that ${senderFirstName} could send to ${recipientFirstName}.`,
      ``,
      `CONTEXT:`,
      `- Sender: ${senderFirstName}${(sender as any)?.headline ? ` — ${(sender as any).headline}` : ''}`,
      senderTags.length ? `- Sender's tags: ${senderTags.join(', ')}` : '',
      `- Recipient: ${recipientFirstName}${(recipient as any)?.headline ? ` — ${(recipient as any).headline}` : ''}`,
      recipientTags.length ? `- Recipient's tags: ${recipientTags.join(', ')}` : '',
      sharedTags.length ? `- Shared tags: ${sharedTags.join(', ')}` : '',
      metContext ? `- How / where they met: ${metContext}` : '',
      isDormant
        ? `- Status: DORMANT — they haven't chatted in ${dormantDays} days. Acknowledge the gap naturally in ONE of the 3 options (no guilt-tripping — frame as casual "long time, just thought of you" energy).`
        : isNewConversation
          ? `- Status: NEW CONVERSATION — they're connected but haven't messaged before.`
          : `- Status: ACTIVE — they've chatted recently.`,
      askContext,
      ``,
      `TASK:`,
      `Write 3 short icebreaker messages from ${senderFirstName}'s perspective.`,
      ``,
      `Rules:`,
      `- Each is 1-2 sentences max. NO emojis. NO "Hey [Name]," boilerplate that adds nothing.`,
      `- Sound like a REAL PERSON writing to someone they actually know. NOT like an AI assistant offering to help.`,
      `- Each option must reference a DIFFERENT specific anchor from the context above (shared tag, met-place, recipient's expertise, or the Ask if present). Generic openers are forbidden.`,
      `- Write in ${lang}.`,
      askContext
        ? `- Since there IS an Ask, at least ONE of the 3 options must connect to that Ask directly (e.g. "I just posted something looking for X — you came to mind first").`
        : ``,
      `- The recipient should feel "this person knows me / remembers me", not "this person sent a templated outreach".`,
      ``,
      `Return ONLY a JSON array of exactly 3 strings, no prose, no markdown.`,
    ]
      .filter(Boolean)
      .join('\n');

    let lastError = '';
    let rawSnippet = '';
    for (const model of MODEL_FALLBACK_CHAIN) {
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptLines }] }],
              generationConfig: {
                temperature: 0.8, // higher than extraction — we want variety
                maxOutputTokens: 400,
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          },
        );
        if (!upstream.ok) {
          const bodyText = await upstream.text().catch(() => '');
          console.error(
            `generate-icebreaker upstream [${model}]: HTTP ${upstream.status}`,
            bodyText.slice(0, 500),
          );
          lastError = `${model}: HTTP ${upstream.status}`;
          if (/API_KEY|api key/i.test(bodyText)) break;
          continue;
        }
        const result = await upstream.json();
        const text: string = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        rawSnippet = text.slice(0, 300);
        const suggestions = extractStringArray(text);
        if (suggestions.length >= 1) {
          const body: Suggestions = { suggestions: suggestions.slice(0, 3) };
          return jsonResponse(200, body);
        }
        lastError = `${model}: parsed empty array`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`generate-icebreaker fetch threw [${model}]:`, msg);
        lastError = `${model}: fetch threw`;
      }
    }

    console.error('generate-icebreaker all models failed:', lastError, 'snippet:', rawSnippet);
    // 200 with empty array — client renders nothing and lets the
    // user just type from scratch. Better than a hard error blocking
    // the chat entirely.
    return jsonResponse(200, { suggestions: [], note: 'no_extraction' });
  } catch (err) {
    console.error('generate-icebreaker error:', err);
    return jsonResponse(500, { error: 'Internal error' });
  }
});
