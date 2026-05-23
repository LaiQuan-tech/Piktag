// extractSearchIntent.ts
//
// Client wrapper for the `extract-search-intent` edge function. Invoked
// from SearchScreen's zero-results recovery path: when the normal
// substring search (+ stopword stripping) yields nothing, this asks
// Gemini (via the edge function) to extract the content nouns from the
// user's natural-language query.
//
// In-memory per-session LRU cache so repeated zero-result queries
// don't pay LLM cost twice. Cap at 50 entries to bound memory.

import { supabase } from './supabase';

const CACHE_LIMIT = 50;
const cache = new Map<string, string[]>();

function rememberCached(key: string, value: string[]) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function readCached(key: string): string[] | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Touch for LRU.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Extract semantic search keywords from a natural-language query.
 * Returns up to 5 content nouns in the original language; returns []
 * on timeout / network error / empty extraction.
 *
 * Pure-recovery feature — callers should ONLY invoke this after a
 * normal search has produced zero results. Latency budget: ~3s.
 */
export async function extractSearchIntent(
  query: string,
  timeoutMs = 3000,
): Promise<string[]> {
  const q = query.trim();
  if (!q || q.length > 500) return [];

  const cacheKey = q.toLowerCase();
  const hit = readCached(cacheKey);
  if (hit !== undefined) return hit;

  // supabase-js .functions.invoke() doesn't take an AbortSignal across
  // all versions, so race it against a timeout sentinel.
  const invokeP = supabase.functions
    .invoke('extract-search-intent', { body: { query: q } })
    .then(
      (r) => ({ ok: true as const, data: r.data, error: r.error }),
      (err) => ({ ok: false as const, error: err }),
    );
  const timeoutP = new Promise<{ ok: false; error: { timeout: true } }>((resolve) =>
    setTimeout(() => resolve({ ok: false, error: { timeout: true } }), timeoutMs),
  );

  try {
    const settled = await Promise.race([invokeP, timeoutP]);
    if (!settled.ok) return [];
    const { data, error } = settled;
    if (error || !data) return [];
    const keywords = Array.isArray((data as any).keywords)
      ? ((data as any).keywords as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length < 50)
          .slice(0, 6)
      : [];
    rememberCached(cacheKey, keywords);
    return keywords;
  } catch {
    return [];
  }
}
