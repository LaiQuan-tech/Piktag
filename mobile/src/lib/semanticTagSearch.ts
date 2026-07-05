// semanticTagSearch.ts — algo item #2 (2026-07-05).
//
// The FIRST zero-result recovery layer: query → embedding → pgvector kNN
// over concept embeddings → best-known tag names. Same `{ keywords }`
// contract as extract-search-intent (which stays as the SECOND layer),
// so SearchScreen treats both identically. Roughly an order of magnitude
// cheaper/faster than the chat-model extraction; a miss here simply
// falls through to the Gemini path.
//
// Mirrors extractSearchIntent's timeout-race shape (supabase-js invoke
// has no portable AbortSignal).

import { supabase } from './supabase';

export async function semanticTagSearch(
  query: string,
  timeoutMs = 2000,
): Promise<string[]> {
  const q = query.trim();
  if (!q || q.length > 200) return [];

  const invokeP = supabase.functions
    .invoke('semantic-tag-search', { body: { query: q } })
    .then(
      (r) => ({ ok: true as const, data: r.data, error: r.error }),
      (err) => ({ ok: false as const, error: err }),
    );

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<{ ok: false }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ ok: false }), timeoutMs);
  });

  try {
    const settled = await Promise.race([invokeP, timeoutP]);
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (!settled.ok) return [];
    const { data, error } = settled as { data: any; error: any };
    if (error || !data) return [];
    return Array.isArray(data.keywords)
      ? (data.keywords as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length < 50)
          .slice(0, 5)
      : [];
  } catch {
    return [];
  }
}
