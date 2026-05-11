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

    // Prompt is event-aware and grounding-aware. The two new
    // sections that matter for the CES-style scenario:
    //
    // 1. "If the date+place suggests a known event, include the
    //    event's standard hashtag" — this is what gets us
    //    #CES2026 when the user is at Las Vegas Convention Center
    //    in January 2026.
    //
    // 2. "Popular tags nearby" — pre-aggregated by the
    //    popular_tags_near_location RPC. The LLM is instructed to
    //    USE these (not make them up), so suggestions stay
    //    grounded in real PikTag user behavior in this area.
    //
    // Output stays a FLAT JSON array per the user's UI request
    // ("不要區分時間、地點、活動、當地熱門，都是推薦即可") — the LLM is
    // told what KINDS of tags to mix in, but the response surface
    // doesn't expose categories.
    const promptParts: string[] = [
      `You are suggesting hashtag tags for a PikTag user creating a QR group right now.`,
      `Return ONLY a JSON array of 6-10 short hashtag strings (without the # prefix), nothing else.`,
      `Keywords MUST be written in ${lang}. Only use English for internationally recognized terms (PM, IoT, AI, CES).`,
      ``,
      `Mix tags across these dimensions (do not separate them in the output, just include a good mix):`,
      `  • The CURRENT date / month / year (e.g. #Jan2026, #2026Q1) — but ONLY if a date is provided.`,
      `  • The user's CURRENT location — include the most recognizable level (city or landmark), and optionally the broader region or country if it disambiguates.`,
      `  • If the date AND place AND context suggest a well-known event (e.g. CES in Las Vegas in January, SXSW in Austin in March, GDC in San Francisco in March, COP/Olympics/etc), include the event's standard hashtag.`,
      `  • The user's own identity / topic interests, drawn from their bio and existing tags.`,
      `  • Tags that are currently popular among other PikTag users in this area (see "Popular nearby" below) — prefer these over generic guesses when relevant.`,
      ``,
      `Skip vague catch-alls (#fun, #good, #life). Prefer specific, scannable, copy-paste-able tags.`,
      `If a tag is already in the user's existing tags, do NOT repeat it.`,
      ``,
      `─── Context ───`,
      `Bio / identity: ${bio || '(none)'}`,
      `Situation / event description: ${name || '(none)'}`,
      `Location (primary): ${location || '(none)'}`,
      `Location (detailed, multi-level): ${locationDetail || '(same as primary)'}`,
      `Date (today): ${date || '(unknown)'}`,
      `Popular nearby (real recent tags from other PikTag users in this area): ${popularNearby || '(none)'}`,
      `Existing tags on this QR (do not repeat): ${existingTags || '(none)'}`,
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
