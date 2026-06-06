import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Principle #6: never re-suggest a tag the user has explicitly removed.
// We fetch the caller's own removed-tag names (via get_my_removed_tag_names,
// scoped to auth.uid()) and DETERMINISTICALLY filter the model's output — an
// LLM "don't suggest X" instruction is unreliable. NEVER throws: any failure
// returns an empty set so suggestions are never blocked by this guard.
async function getRemovedTagNames(req: Request): Promise<Set<string>> {
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!authHeader || !url || !anon) return new Set();
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data, error } = await sb.rpc('get_my_removed_tag_names');
    if (error || !Array.isArray(data)) return new Set();
    return new Set((data as string[]).map((s) => s.toLowerCase()));
  } catch {
    return new Set();
  }
}

const MODEL_FALLBACK_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const;
// `fast` callers (card-scan contact tagging — founder 2026-06-07: the
// result page felt a beat slow) lead with flash-lite, far quicker than
// 2.5-flash and plenty for "suggest a few tags from a bio". Same
// fallbacks so a flash-lite hiccup still degrades gracefully.
const FAST_MODEL_CHAIN = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const;

type SuggestBody = {
  bio?: string;
  name?: string;
  location?: string;
  existingTags?: string;
  lang?: string;
  // `true` = latency-optimized path (card-scan contact tagging): flash-lite
  // model, a lean person-focused prompt, fewer + capped tokens. Other
  // callers (event-QR mix, EditProfile, ManageTags, Ask) omit it.
  fast?: boolean;
  // Optional richer context for the QR-group creation flow (task 3
  // follow-up). All optional and backward-compatible — old callers
  // (EditProfile auto-suggest, ManageTags AI fire) just don't pass
  // these and the function behaves the same as before.
  date?: string;            // YYYY-MM-DD only, no time-of-day
  locationDetail?: string;  // multi-level: "Las Vegas, Nevada, USA"
  popularNearby?: string;   // comma-separated tags trending near user
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
      return jsonResponse(500, {
        error: 'GEMINI_API_KEY not configured on the Edge Function',
      });
    }

    let body: SuggestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body must be valid JSON' });
    }

    const MAX_INPUT = 500;
    const bio = (body.bio ?? '').trim().slice(0, MAX_INPUT);
    const name = (body.name ?? '').trim().slice(0, MAX_INPUT);
    const location = (body.location ?? '').trim().slice(0, MAX_INPUT);
    const existingTags = (body.existingTags ?? '').trim().slice(0, MAX_INPUT);
    const lang = (body.lang ?? 'the same language as the content').trim().slice(0, 50);
    const date = (body.date ?? '').trim().slice(0, 32);
    const locationDetail = (body.locationDetail ?? '').trim().slice(0, MAX_INPUT);
    const popularNearby = (body.popularNearby ?? '').trim().slice(0, MAX_INPUT);

    if (!bio && !name && !location && !existingTags && !date && !locationDetail) {
      return jsonResponse(400, {
        error: 'Need at least one signal: bio / name / location / locationDetail / date / existingTags',
      });
    }

    // Prompt design — mixed-type suggestions for event-group QR creation.
    //
    // KEY CONSTRAINT (per product spec): output is a FLAT JSON array.
    // The model is told to MIX time / location / event / identity
    // tags but NOT to separate them in the response. UI just shows
    // one chip strip.
    //
    // Why this is REQUIRED-style rather than "feel free to mix":
    // earlier softer wording made the model lean entirely on the
    // user's identity tags (e.g. their PM / 產品經理 bio) and
    // ignore the date+location, which defeats the whole point of
    // this surface — the user is making a QR FOR a specific event,
    // not republishing their profile tags.
    const promptParts: string[] = [
      `You suggest hashtag tags for a PikTag user creating an event group right now.`,
      `Return ONLY a JSON array of 6-10 short hashtag strings (without the # prefix), nothing else.`,
      `Keywords MUST be written in ${lang}. Only use English for internationally recognized terms (PM, IoT, AI, CES).`,
      ``,
      `══ REQUIRED MIX (a good response includes at least one of each category, mixed into a single flat array) ══`,
      ``,
      `1. AT LEAST ONE date / month / year tag IF a date is provided.`,
      `   For "2026-05-12" output something like: 2026/05/12, May2026, 2026Q2.`,
      `   Skip this category ONLY if no date is provided.`,
      ``,
      `2. AT LEAST ONE location tag IF any location signal is provided.`,
      `   Use the most recognizable level — usually city or landmark name.`,
      `   For "Las Vegas Convention Center, Las Vegas, Nevada, USA" output e.g. LasVegas, Nevada (don't include all 4 levels — pick the most useful 1-2).`,
      `   For "大安區, 台北市, 臺灣" output e.g. 大安區, 台北.`,
      ``,
      `3. AT LEAST ONE event/situation tag derived from the user's description.`,
      `   If description says "想像扶輪社例會活動" → output 扶輪社, 例會.`,
      `   If description says "CES" + location Las Vegas + date in January → output CES2026.`,
      `   If description says "週末聚餐" → output 聚餐, 週末.`,
      ``,
      `4. (Optional) Tags from the user's identity (bio + existing identity tags) ONLY if they're directly relevant to this event description. Skip if not relevant.`,
      ``,
      `5. (Strongly preferred when present) Tags from "Popular nearby" — those are real tags other PikTag users at this location have used recently. Surface them verbatim rather than inventing synonyms.`,
      ``,
      `══ HARD RULES ══`,
      `• Output is a single JSON array. Do NOT group, label, or wrap in categories.`,
      `• Tag names are short (1-3 words / kanji clusters), specific, scannable.`,
      `• No vague catch-alls (#fun, #good, #life, #event).`,
      `• Do NOT repeat tags already in "Existing tags on this group".`,
      `• When you have BOTH a date AND a location signal: include AT LEAST 1 date tag AND AT LEAST 1 location tag. Non-negotiable.`,
      ``,
      `─── Context ───`,
      `User identity / bio: ${bio || '(none)'}`,
      `User's description of the event: ${name || '(none)'}`,
      `Location (primary, often a landmark): ${location || '(none)'}`,
      `Location (detailed levels, comma-separated): ${locationDetail || location || '(none)'}`,
      `Today's date: ${date || '(unknown)'}`,
      `Popular nearby (real tags from other PikTag users in this area): ${popularNearby || '(none)'}`,
      `Existing tags on this group (do NOT repeat): ${existingTags || '(none)'}`,
    ];

    // FAST path (card-scan contact tagging): a lean, PERSON-focused prompt.
    // The event-mix above doesn't fit here (that caller passes only bio +
    // name, no date/location), and a shorter prompt asking for fewer tags
    // means the model emits fewer tokens and returns sooner — and the tags
    // are person-appropriate, not forced date/location ones.
    const fast = body.fast === true;
    const personPromptParts: string[] = [
      `Suggest hashtag tags describing this PERSON, for a private contact note.`,
      `Return ONLY a JSON array of 3-5 short hashtag strings (without the # prefix), nothing else.`,
      `Keywords MUST be written in ${lang}. Only use English for internationally recognized terms (PM, AI, CEO, UX, IoT).`,
      `Base them on the person's role / field / company / interests from the card. Short (1-3 words / kanji clusters), specific, scannable. No vague catch-alls (#nice, #person, #friend).`,
      `Do NOT repeat tags already noted: ${existingTags || '(none)'}`,
      ``,
      `─── Context ───`,
      `Name / title: ${name || '(none)'}`,
      `Bio / card text: ${bio || '(none)'}`,
    ];
    const prompt = (fast ? personPromptParts : promptParts).join('\n');

    let lastError = '';
    let rawSnippet = '';

    // Kick off the removed-tags lookup IN PARALLEL with the Gemini call so
    // the principle-#6 filter adds no latency on the happy path (the query
    // always resolves well before the model does).
    const removedPromise = getRemovedTagNames(req);

    const chain = fast ? FAST_MODEL_CHAIN : MODEL_FALLBACK_CHAIN;
    for (const model of chain) {
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              // Cap output ONLY on the fast path (flash-lite, no "thinking"
              // tokens): 256 is ample for 3-5 short tags and trims latency.
              // The normal path leads with gemini-2.5-flash, whose
              // maxOutputTokens budget is shared with thinking tokens — a
              // tight cap there could truncate the think+respond and break
              // the event-QR JSON, so it stays UNcapped (prior behavior).
              ...(fast ? { generationConfig: { maxOutputTokens: 256 } } : {}),
            }),
          }
        );

        if (!upstream.ok) {
          const bodyText = await upstream.text().catch(() => '');
          console.error(`suggest-tags upstream error [${model}]: HTTP ${upstream.status}`, bodyText.slice(0, 500));
          lastError = `${model}: HTTP ${upstream.status}`;
          if (/API_KEY|api key/i.test(bodyText)) break;
          continue;
        }

        const result = await upstream.json();
        const text: string = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        rawSnippet = text.slice(0, 300);

        const suggestions = extractStringArray(text);
        if (suggestions && suggestions.length > 0) {
          // Principle #6: drop anything the user has explicitly removed.
          const removed = await removedPromise;
          const filtered =
            removed.size > 0
              ? suggestions.filter((s) => !removed.has(s.toLowerCase()))
              : suggestions;
          return jsonResponse(200, { suggestions: filtered });
        }
        lastError = `${model}: response did not contain a usable JSON array`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`suggest-tags fetch threw [${model}]:`, msg);
        lastError = `${model}: fetch threw`;
      }
    }

    console.error('suggest-tags all models failed:', lastError, 'snippet:', rawSnippet);
    return jsonResponse(503, { error: 'AI service unavailable' });
  } catch (err) {
    console.error('suggest-tags edge function error:', err);
    return jsonResponse(500, { error: 'Internal error' });
  }
});
