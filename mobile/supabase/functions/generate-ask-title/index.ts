import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL_FALLBACK_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const;

type GenerateTitleBody = {
  body: string;
  tags?: string[];
  lang?: string;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractTitle(text: string): string | null {
  if (!text) return null;
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();

  const obj = s.match(/\{[\s\S]*\}/);
  if (obj) s = obj[0];

  try {
    const parsed = JSON.parse(s);
    if (typeof parsed.title === 'string' && parsed.title.trim().length > 0) {
      return parsed.title.trim().slice(0, 60);
    }
    return null;
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

    let body: GenerateTitleBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body must be valid JSON' });
    }

    const askBody = (body.body ?? '').trim().slice(0, 200);
    const tags = (body.tags ?? []).slice(0, 10).map((t: string) => String(t).slice(0, 50));
    const lang = (body.lang ?? 'the same language as the content').trim().slice(0, 50);

    if (!askBody) {
      return jsonResponse(400, {
        error: 'Need a non-empty body field',
      });
    }

    const prompt =
      `Generate a short title (maximum 60 characters) that captures the essence ` +
      `of the following request. The title MUST be in ${lang}. ` +
      `Return ONLY a JSON object like {"title": "..."}, nothing else.\n\n` +
      `Request: ${askBody}` +
      (tags.length > 0 ? `\nTags: ${tags.join(', ')}` : '');

    let lastError = '';
    let rawSnippet = '';

    for (const model of MODEL_FALLBACK_CHAIN) {
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          }
        );

        if (!upstream.ok) {
          const bodyText = await upstream.text().catch(() => '');
          lastError = `${model}: HTTP ${upstream.status} ${bodyText.slice(0, 200)}`;
          if (/API_KEY|api key/i.test(bodyText)) break;
          continue;
        }

        const result = await upstream.json();
        const text: string = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        rawSnippet = text.slice(0, 300);

        const title = extractTitle(text);
        if (title) {
          return jsonResponse(200, { title });
        }
        lastError = `${model}: response did not contain a usable title`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = `${model}: fetch threw (${msg})`;
      }
    }

    return jsonResponse(502, {
      error: lastError || 'All Gemini models failed',
      detail: rawSnippet || undefined,
    });
  } catch (err) {
    console.error('generate-ask-title edge function error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: message });
  }
});
