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
// MUST include gemini-2.5-flash as a fallback: verified 2026-06-07 that
// flash-lite / 2.0-flash / 1.5-flash were all failing for this project's
// key (everything that "works" silently falls through to 2.5-flash). The
// fast chain originally lacked 2.5-flash, so when the faster models failed
// it had no working fallback → 503 on every card scan. Keep the fast models
// first (speed when they work), 2.5-flash before 1.5-flash as the safety net.
const FAST_MODEL_CHAIN = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'] as const;

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
  // pg_cron keep-warm ping — short-circuits before any Gemini work, just
  // keeps the Deno isolate hot (no model cost).
  warmup?: boolean;
  // TEMP: per-model availability probe (remove after diagnosis).
  diag?: boolean;
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
    // Empty array → null so the loop retries the next model. The card-scan
    // path must yield at least one tag (founder 2026-06-07), so an empty
    // response is "try harder", not a clean result.
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

    // pg_cron keep-warm ping (founder 2026-06-07): short-circuit BEFORE any
    // Gemini work — just keeps the Deno isolate hot so a real card-scan tag
    // request doesn't pay a cold start. ~zero cost (no model call).
    if (body.warmup) {
      return jsonResponse(200, { ok: true, warm: true });
    }

    // TEMP diagnostic (founder 2026-06-07): which Gemini models does this
    // project's key actually serve? Probes each candidate and returns the
    // HTTP status + a short error snippet. REMOVE after diagnosis.
    if (body.diag === true) {
      const candidates = [
        'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash',
        'gemini-1.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest',
        'gemini-2.0-flash-001', 'gemini-2.5-flash-preview-05-20',
      ];
      const results: unknown[] = [];
      for (const m of candidates) {
        try {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
              body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with: ok' }] }] }),
            },
          );
          const txt = await r.text().catch(() => '');
          results.push({ model: m, status: r.status, ok: r.ok, snippet: txt.slice(0, 140) });
        } catch (e) {
          results.push({ model: m, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return jsonResponse(200, { diag: results });
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

    const fast = body.fast === true;

    // PERSON/PROFILE prompt vs the EVENT-mix prompt above.
    // Selection is driven by the PRESENCE OF EVENT SIGNALS, NOT the `fast`
    // flag — founder 2026-06-07 bug: card scans returned ZERO tags because
    // (older) callers without `fast` fell through to the event-mix prompt,
    // which hunts for date/location/event tags a person card simply doesn't
    // have, so the model produced nothing. Any input WITHOUT event signals
    // (card scan, EditProfile, ManageTags) is person/bio tagging and MUST
    // use the person prompt, which mandates at least one tag. Only AddTag's
    // event-QR flow passes date/location/popularNearby → event prompt.
    const hasEventSignals = !!(date || location || locationDetail || popularNearby);
    // Card scan (fast) wants a few precise tags; profile curation (non-fast)
    // wants a richer set to pick from — but BOTH must never be empty.
    const personCount = fast ? '1 to 3' : '3 to 8';
    const personPromptParts: string[] = [
      `Suggest hashtag tags that describe this person from their title, role, field, company, or interests.`,
      `Return ONLY a JSON array of ${personCount} short hashtag strings (without the # prefix), nothing else.`,
      `ALWAYS return at least ONE tag — NEVER an empty array. Prefer the strongest, specific tags; don't pad with weak filler, but always provide your best tag(s) even for a sparse input.`,
      `Keywords MUST be written in ${lang}. Only use English for internationally recognized terms (PM, AI, CEO, UX, IoT).`,
      `Short (1-3 words / kanji clusters), specific, scannable. No vague catch-alls (#nice, #person, #friend).`,
      `Do NOT repeat tags already noted: ${existingTags || '(none)'}`,
      ``,
      `─── Context ───`,
      // Feed BOTH the name and the title/bio so even a sparse card (e.g. no
      // clean headline extracted) still has something to work from.
      `Name: ${name || '(none)'}`,
      `Title / company / bio / card text: ${bio || '(none)'}`,
    ];
    const prompt = (hasEventSignals ? promptParts : personPromptParts).join('\n');

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
              // NO maxOutputTokens cap. A 256 cap on the fast path returned
              // 503 on EVERY model (verified 2026-06-07 via direct calls:
              // fast=true → 503, fast=false → 200 with good tags). Likely a
              // truncated/empty completion → unparseable JSON → all models
              // exhausted. The win from capping was marginal anyway; drop it.
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
        // Require at least one tag (founder 2026-06-07: card scan must yield
        // 1-3, never 0). An empty/unparseable response falls through to the
        // next model in the chain rather than returning nothing.
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
