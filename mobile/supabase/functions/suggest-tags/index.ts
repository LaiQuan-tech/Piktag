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
      .slice(0, 8);
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

    if (!bio && !name && !location && !existingTags) {
      return jsonResponse(400, {
        error: 'Need at least one of bio / name / location / existingTags',
      });
    }

    const prompt =
      `Based on this person's profile, suggest 5-8 short hashtag keywords ` +
      `(without #). Keywords MUST be in ${lang}. Only use English for ` +
      `internationally recognized terms (e.g. PM, IoT, AI). Return ONLY ` +
      `a JSON array of strings, nothing else.\n\n` +
      `Bio: ${bio}\nName: ${name}\nLocation: ${location}\n` +
      `Existing tags: ${existingTags}`;

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
