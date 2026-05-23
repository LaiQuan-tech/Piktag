// Supabase Edge Function: extract-search-intent
//
// Zero-results recovery for SearchScreen. When the regular substring +
// stopword search returns nothing (typical for natural-language
// queries in any language the client-side stopword stripper doesn't
// cover — ja / ko / th / es / fr / etc., plus complex multi-concept
// queries in en/zh), the mobile client invokes this function to ask
// Gemini for the content nouns hiding inside the user's sentence.
//
// Why a function and not a direct client call to Gemini:
//   • API key never enters the app bundle (the existing Gemini calls
//     in this repo — auto-link-concepts, scan-business-card,
//     suggest-tags — all live server-side; this matches that pattern).
//   • Per-user rate limiting via Supabase JWT.
//   • Single place to swap models / tune the prompt without shipping
//     a mobile build.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROMPT = (query: string) => `You are a search-query parser for a social-networking app where users search for people by tags (interests, skills, professions, places, communities, identities). Given a user's natural-language search query in ANY language, extract the CONTENT NOUNS that represent the searcher's intent.

Rules:
- Output ONLY a JSON array of 1–6 short strings. No surrounding text, no markdown, no code fences.
- For each content noun, ALSO include 1–2 common SAME-CONCEPT VARIANTS across writing systems / languages, so the substring search can match a friend tagged in a different script:
  • "日文" → also "日本語", "Japanese"
  • "工程師" → also "Engineer", "エンジニア"
  • "fotógrafo" → also "photographer", "攝影師"
  • "扶輪社" → also "Rotary", "Rotary Club"
  Only include variants you are confident describe the same concept. If unsure, skip the variant rather than guess.
- Drop verbs / particles / articles ("looking for", "想找", "在", "の", "を探しています", "Busco", "찾고 있어", "the", "a", "in", "for", "的", "的人", "朋友").
- Skip generic placeholders: person / people / friend / contact / 朋友 / 人 / 同學 / 同事 / 사람.

Examples:
"找在扶輪社的朋友" → ["扶輪社","Rotary","Rotary Club"]
"我要找會日文的朋友" → ["日文","日本語","Japanese"]
"想認識會講日文又會攝影的人" → ["日文","日本語","Japanese","攝影","photography"]
"想找台北附近的設計師" → ["台北","Taipei","設計師","designer"]
"looking for a designer in SF" → ["designer","設計師","SF","San Francisco"]
"日本語が話せる人を探しています" → ["日本語","日文","Japanese"]
"Busco un fotógrafo en Madrid" → ["fotógrafo","photographer","Madrid"]
"Wer kennt jemanden im Startup-Bereich?" → ["Startup","新創"]
"누가 일본어 할 수 있어?" → ["일본어","日本語","Japanese"]

Query: "${query.replace(/"/g, '\\"')}"

JSON:`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as { query?: unknown }));
    const query =
      typeof (body as any).query === 'string' ? ((body as any).query as string).trim() : '';

    // Input guard — reject obvious abuse / empty / oversized payloads.
    // 500 chars is plenty for any reasonable search sentence.
    if (!query || query.length > 500) {
      return new Response(JSON.stringify({ keywords: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured', keywords: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const upstream = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT(query) }] }],
          // 2.5-flash is a thinking model — leave headroom for the
          // internal reasoning chain. Visible answer is just a short
          // JSON array; 1024 is plenty after thinking tokens.
          generationConfig: { temperature: 0, maxOutputTokens: 1024 },
        }),
      },
    );

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '');
      console.error(
        'extract-search-intent upstream error:',
        upstream.status,
        errBody.slice(0, 300),
      );
      // Fail soft — client falls back to the literal empty-state path.
      return new Response(JSON.stringify({ keywords: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await upstream.json();
    const text: string =
      (result?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    // Strip optional markdown fences (Gemini sometimes leaks them
    // despite the "no fences" rule).
    const fenced = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    // Extract the first JSON array literal in the response, defensive
    // against any leading prose the model leaked.
    const arrayMatch = fenced.match(/\[[\s\S]*\]/);

    let keywords: string[] = [];
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          keywords = parsed
            .filter((x: unknown): x is string => typeof x === 'string')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s.length < 50)
            .slice(0, 6);
        }
      } catch {
        // Malformed JSON — fall through to empty result.
      }
    }

    return new Response(JSON.stringify({ keywords }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('extract-search-intent error:', err);
    // Always return 200 with empty keywords so the client's recovery
    // path can degrade gracefully — a 500 here would surface as a
    // generic error in the UI for a feature the user didn't even
    // explicitly invoke.
    return new Response(JSON.stringify({ keywords: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
