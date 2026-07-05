// Supabase Edge Function: semantic-tag-search
//
// Algo item #2 (2026-07-05): the FIRST zero-result recovery step — an
// order of magnitude cheaper and faster than the Gemini chat-extraction
// path (extract-search-intent), which stays as the SECOND step.
//
// Flow: query text → gemini-embedding-001 (3072-dim) → pgvector kNN over
// tag_concepts.embedding (match_concepts_by_embedding RPC, service-role
// only) → the top concepts' best-known tag names, returned in the same
// `{ keywords: string[] }` shape extract-search-intent uses so the client
// treats both recovery layers identically.
//
// Auth: platform verify_jwt stays ON (default — the caller is a signed-in
// user via supabase.functions.invoke, same as extract-search-intent).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

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
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return jsonResponse(500, { error: 'GEMINI_API_KEY not configured' });
    }

    let body: { query?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body must be valid JSON' });
    }
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query || query.length > 200) {
      return jsonResponse(400, { error: 'query required (<=200 chars)' });
    }

    // 1. Embed the query (RETRIEVAL_QUERY task type — asymmetric search).
    const embedRes = await fetch(`${EMBED_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: query }] },
        taskType: 'RETRIEVAL_QUERY',
      }),
    });
    if (!embedRes.ok) {
      return jsonResponse(502, { error: `embed failed: ${embedRes.status}` });
    }
    const embedJson = await embedRes.json();
    const vec: number[] | undefined = embedJson?.embedding?.values;
    if (!Array.isArray(vec) || vec.length === 0) {
      return jsonResponse(502, { error: 'embed returned no vector' });
    }

    // 2. kNN over concept embeddings (service client — the RPC is
    //    service_role-only by design).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await supabase.rpc('match_concepts_by_embedding', {
      p_embedding: JSON.stringify(vec),
      p_limit: 5,
    });
    if (error) {
      return jsonResponse(500, { error: error.message });
    }

    // 3. Distinct tag names, similarity-ordered (RPC already orders).
    //    Loose floor at 0.5 — below that the neighbours are noise.
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const row of (data ?? []) as { tag_name: string; similarity: number }[]) {
      if (typeof row.tag_name !== 'string') continue;
      if (typeof row.similarity === 'number' && row.similarity < 0.5) continue;
      const name = row.tag_name.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      keywords.push(name);
    }

    return jsonResponse(200, { keywords });
  } catch (err) {
    console.error('semantic-tag-search error:', err);
    return jsonResponse(500, { error: (err as Error).message });
  }
});
