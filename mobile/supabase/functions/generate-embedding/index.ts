// Supabase Edge Function: generate-embedding
// Generates text embeddings via Google Gemini gemini-embedding-001 (free tier)
// Set GEMINI_API_KEY in Supabase Dashboard → Edge Functions → Secrets

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let parsed: { text?: unknown };
    try {
      parsed = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body must be valid JSON' });
    }

    const text = parsed?.text;
    if (!text || typeof text !== 'string') {
      return jsonResponse(400, { error: 'Missing or invalid "text" field' });
    }

    if (text.length > 8000) {
      return jsonResponse(400, { error: 'input_too_long' });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return jsonResponse(500, { error: 'GEMINI_API_KEY not configured' });
    }

    // Call Google Gemini Embedding API
    let response: Response;
    try {
      response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            model: 'models/gemini-embedding-001',
            content: { parts: [{ text }] },
          }),
        }
      );
    } catch (fetchErr) {
      console.error('generate-embedding fetch threw:', fetchErr);
      return jsonResponse(503, { error: 'AI service unavailable' });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error('generate-embedding upstream error: HTTP', response.status, errorBody.slice(0, 500));
      return jsonResponse(503, { error: 'AI service unavailable' });
    }

    const result = await response.json();
    const embedding = result.embedding?.values;

    if (!embedding) {
      console.error('generate-embedding no embedding in response');
      return jsonResponse(503, { error: 'AI service unavailable' });
    }

    return jsonResponse(200, { embedding });
  } catch (err) {
    console.error('generate-embedding edge function error:', err);
    return jsonResponse(500, { error: 'Internal error' });
  }
});
