import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL_FALLBACK_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const;

type SuggestBody = {
  bio?: string;
  name?: string;
  location?: string;
  existingTags?: string;
  lang?: string;
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
    const prompt = promptParts.join('\n');

    let lastError = '';
    let rawSnippet = '';

    for (const model of MODEL_FALLBACK_CHAIN) {
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
          return jsonResponse(200, { suggestions });
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
