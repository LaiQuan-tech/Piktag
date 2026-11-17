// Supabase Edge Function: hf-shadow
//
// SHADOW ONLY — embedding v2 (BAAI/bge-m3) + reranker (BAAI/bge-reranker-v2-m3)
// data collection. Spec: mobile/docs/plans/2026-11-18-embedding-v2-shadow-design.md
// No live decision (search_users, linker thresholds/judge, stopwords) reads
// anything this function writes. Swapping models needs founder sign-off.
//
// POST { action: 'backfill' | 'shadow' | 'pairs', limit?: number }
//   backfill  fill tag_concepts.embedding_v2 (oldest first) with bge-m3 vectors
//             of the SAME text the Gemini embedding uses (canonical_name).
//   shadow    score unevaluated concept_judge_shadow rows (written by
//             auto-link-concepts after each gray-zone judge call) with the
//             reranker + bge-m3 cosine.
//   pairs     known synonym / related-not-synonym pairs → Gemini vs bge-m3
//             cosine side by side. No DB writes.
//
// Auth: CRON_SECRET bearer only (same constant-time gate as
// linker-health-alert). Called daily by .github/workflows/daily-cron.yml.
// No HF_TOKEN secret → 200 {skipped} (whole experiment is a no-op).
// Logs are tagged `[hf-shadow]`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMBED_MODEL = 'BAAI/bge-m3';
const RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';
const EMBED_URL = `https://router.huggingface.co/hf-inference/models/${EMBED_MODEL}/pipeline/feature-extraction`;
const RERANK_URL = `https://router.huggingface.co/hf-inference/models/${RERANK_MODEL}`;
const EMBED_DIM = 1024;
const EMBED_BATCH = 32;
const HF_TIMEOUT_MS = 30_000;
// Edge workers have a ~150s wall clock; no outbound call may run past this
// (each call's timeout is clipped to it — see callTimeout).
const SOFT_BUDGET_MS = 100_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isNumArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'number');
}

// L2-normalize; a zero-norm vector is garbage, not an embedding → null.
function l2normalize(v: number[]): number[] | null {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  return v.map((x) => x / n);
}

function cosine(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return null;
  return Math.round((dot / Math.sqrt(na * nb)) * 10000) / 10000;
}

// ── Time budget ─────────────────────────────────────────────────────────
// Every outbound call gets timeout = min(its cap, time left before the
// run's deadline). If less than MIN_CALL_MS is left the call is not made
// and the caller gets a `budget` result (work is left for the next run,
// NOT counted as a failure). Keeps the run under the ~150s edge wall clock
// and the workflow's 170s curl --max-time.
const MIN_CALL_MS = 5_000;

function callTimeout(deadline: number, capMs: number): number | null {
  const remaining = deadline - Date.now();
  if (remaining < MIN_CALL_MS) return null;
  return Math.min(capMs, remaining);
}

type Res<T> = { ok: true; value: T } | { ok: false; budget: boolean; error: string };
const BUDGET: { ok: false; budget: true; error: string } = { ok: false, budget: true, error: 'time budget exhausted' };
const fail = (error: string): { ok: false; budget: false; error: string } => ({ ok: false, budget: false, error });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// One embedding from a single response element. Expected: number[1024]
// (bge-m3 is CLS-pooled, so the pipeline returns one sentence vector per
// input). Any other shape (e.g. token-level number[][]) is a failure — we
// do NOT invent a pooling the model wasn't trained with.
function toSentenceVector(el: unknown): number[] | null {
  if (isNumArray(el) && el.length === EMBED_DIM) return l2normalize(el);
  return null;
}

/**
 * bge-m3 embeddings for `texts`, L2-normalized. On success the value is an
 * array aligned with `texts` (null per item that could not be parsed).
 */
async function hfEmbed(texts: string[], token: string, deadline: number): Promise<Res<(number[] | null)[]>> {
  const timeout = callTimeout(deadline, HF_TIMEOUT_MS);
  if (timeout === null) return BUDGET;
  try {
    const res = await fetchWithTimeout(EMBED_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: texts }),
    }, timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[hf-shadow] embed HTTP ${res.status}`, body.slice(0, 300));
      return fail(`embed HTTP ${res.status}`);
    }
    const data = await res.json();
    let items: unknown[];
    if (texts.length === 1 && isNumArray(data)) items = [data]; // flat single vector
    else if (Array.isArray(data) && data.length === texts.length) items = data;
    else {
      const got = Array.isArray(data) ? `len ${data.length}` : typeof data;
      console.error(`[hf-shadow] embed: unexpected shape (${got}, expected ${texts.length})`);
      return fail(`embed shape ${got}`);
    }
    return { ok: true, value: items.map(toSentenceVector) };
  } catch (e) {
    console.error(`[hf-shadow] embed: ${errMsg(e)}`);
    return fail(`embed ${errMsg(e)}`);
  }
}

// Score out of one text-classification element. Expected {label, score} or
// [{label, score}, ...] (single-label head → one entry). Keep raw too.
function extractScore(el: unknown): number | null {
  if (typeof el === 'number') return el;
  if (Array.isArray(el)) {
    if (el.length === 0) return null;
    return extractScore(el[0]);
  }
  if (el && typeof el === 'object' && typeof (el as { score?: unknown }).score === 'number') {
    return (el as { score: number }).score;
  }
  return null;
}

async function rerankCall(
  pairs: { text: string; text_pair: string }[],
  token: string,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetchWithTimeout(RERANK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: pairs.length === 1 ? pairs[0] : pairs }),
  }, timeoutMs);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`rerank HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}

type Scored = { score: number | null; raw: unknown };

/**
 * Reranker scores for (query, doc) pairs. Tries one batched call; if the
 * response isn't one element per pair, falls back to one call per pair —
 * but only if every remaining call still fits the budget (else `budget`,
 * the row stays queued untouched).
 */
async function hfRerank(query: string, docs: string[], token: string, deadline: number): Promise<Res<Scored[]>> {
  const pairs = docs.map((d) => ({ text: query, text_pair: d }));
  try {
    if (pairs.length > 1) {
      const t = callTimeout(deadline, HF_TIMEOUT_MS);
      if (t === null) return BUDGET;
      const data = await rerankCall(pairs, token, t);
      if (Array.isArray(data) && data.length === pairs.length) {
        return { ok: true, value: data.map((el) => ({ score: extractScore(el), raw: el })) };
      }
      console.warn(
        `[hf-shadow] rerank batch shape mismatch (got ${Array.isArray(data) ? data.length : typeof data}, want ${pairs.length}); per-pair fallback`,
      );
    }
    // Per-pair fallback: don't start it unless all N calls fit at MIN_CALL_MS each.
    if (deadline - Date.now() < pairs.length * MIN_CALL_MS) return BUDGET;
    const out: Scored[] = [];
    for (const p of pairs) {
      const t = callTimeout(deadline, HF_TIMEOUT_MS);
      if (t === null) return BUDGET;
      const data = await rerankCall([p], token, t);
      out.push({ score: extractScore(data), raw: data });
    }
    return { ok: true, value: out };
  } catch (e) {
    console.error(`[hf-shadow] rerank: ${errMsg(e)}`);
    return fail(errMsg(e));
  }
}

// Same request shape as auto-link-concepts generateEmbedding. null = failed
// or out of budget.
async function geminiEmbed(text: string, apiKey: string, deadline: number): Promise<number[] | null> {
  const timeout = callTimeout(deadline, 8000);
  if (timeout === null) return null;
  try {
    const res = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] },
        }),
      },
      timeout,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[hf-shadow] gemini embed HTTP ${res.status}`, body.slice(0, 300));
      return null;
    }
    const data = await res.json();
    return isNumArray(data?.embedding?.values) ? data.embedding.values : null;
  } catch (e) {
    console.error(`[hf-shadow] gemini embed: ${errMsg(e)}`);
    return null;
  }
}

const SYNONYM_PAIRS: [string, string][] = [
  ['扶輪社', 'Rotary Club'],
  ['水晶', 'crystal'],
  ['攝影', 'photography'],
  ['写真', 'photography'],
  ['咖啡', 'coffee'],
  ['工程師', 'Engineer'],
  ['エンジニア', '工程師'],
  ['貓派', 'Cat person'],
  ['瑜伽', 'yoga'],
  ['登山', 'hiking'],
  ['創業家', 'entrepreneur'],
];
const RELATED_PAIRS: [string, string][] = [
  ['攝影', '相機'],
  ['coffee', 'tea'],
  ['設計師', '設計'],
  ['攝影', '攝影師'],
  ['軟體工程師', '工程師'],
  ['水晶', 'healing'],
];

// No generated DB types in this repo's edge fns; untyped client like the others.
// deno-lint-ignore no-explicit-any
type Supa = SupabaseClient<any, any, any>;

async function actionBackfill(supabase: Supa, token: string, limit: number, deadline: number) {
  const { data: rows, error } = await supabase
    .from('tag_concepts')
    .select('id, canonical_name')
    .is('embedding_v2', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`select tag_concepts: ${error.message}`);

  const todo = (rows ?? []) as { id: string; canonical_name: string }[];
  let embedded = 0, failed = 0, stoppedEarly = false;

  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH);
    const r = await hfEmbed(batch.map((row) => row.canonical_name), token, deadline);
    if (!r.ok) {
      if (r.budget) {
        stoppedEarly = true;
        break;
      }
      failed += batch.length;
      continue;
    }
    for (let j = 0; j < batch.length; j++) {
      const v = r.value[j];
      if (!v) {
        failed++;
        continue;
      }
      const { error: upErr } = await supabase
        .from('tag_concepts')
        .update({ embedding_v2: JSON.stringify(v), embedding_v2_model: EMBED_MODEL })
        .eq('id', batch[j].id);
      if (upErr) {
        failed++;
        console.error(`[hf-shadow] backfill update ${batch[j].id}: ${upErr.message}`);
      } else {
        embedded++;
      }
    }
  }

  const { count: remaining } = await supabase
    .from('tag_concepts')
    .select('id', { count: 'exact', head: true })
    .is('embedding_v2', null);

  console.log(`[hf-shadow] backfill: selected ${todo.length}, embedded ${embedded}, failed ${failed}, remaining ${remaining}`);
  return { action: 'backfill', selected: todo.length, embedded, failed, stopped_early: stoppedEarly, remaining: remaining ?? null };
}

// A row that fails this many runs is stamped evaluated with null scores
// (gave up) so it cannot block the queue forever.
const MAX_SHADOW_ATTEMPTS = 3;

async function actionShadow(supabase: Supa, token: string, limit: number, deadline: number) {
  const { data: rows, error } = await supabase
    .from('concept_judge_shadow')
    .select('id, tag_name, candidates, attempts')
    .is('evaluated_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`select concept_judge_shadow: ${error.message}`);

  const todo = (rows ?? []) as {
    id: number;
    tag_name: string;
    candidates: { concept_id: string; name: string; sim: number }[];
    attempts: number | null;
  }[];
  let evaluated = 0, failed = 0, gaveUp = 0, stoppedEarly = false;

  // Record a failed attempt; after MAX_SHADOW_ATTEMPTS, stamp evaluated_at
  // with scores left null (the report excludes those from agreement stats).
  const recordFailure = async (row: (typeof todo)[number], err: string) => {
    failed++;
    const attempts = (row.attempts ?? 0) + 1;
    const giveUp = attempts >= MAX_SHADOW_ATTEMPTS;
    const patch: Record<string, unknown> = { attempts, last_error: err.slice(0, 300) };
    if (giveUp) {
      patch.evaluated_at = new Date().toISOString();
      patch.reranker_model = RERANK_MODEL;
    }
    const { error: upErr } = await supabase.from('concept_judge_shadow').update(patch).eq('id', row.id);
    if (upErr) console.error(`[hf-shadow] shadow failure-record ${row.id}: ${upErr.message}`);
    else if (giveUp) gaveUp++;
  };

  for (const row of todo) {
    if (deadline - Date.now() < MIN_CALL_MS) {
      stoppedEarly = true;
      break;
    }
    const cands = Array.isArray(row.candidates) ? row.candidates : [];
    if (cands.length === 0) {
      // Nothing to score; stamp it so it leaves the queue.
      const { error: upErr } = await supabase.from('concept_judge_shadow')
        .update({ evaluated_at: new Date().toISOString(), reranker_model: RERANK_MODEL, reranker_scores: [], v2_sims: [] })
        .eq('id', row.id);
      if (upErr) {
        failed++;
        console.error(`[hf-shadow] shadow empty-candidates update ${row.id}: ${upErr.message}`);
      } else {
        evaluated++;
      }
      continue;
    }
    const names = cands.map((c) => String(c.name ?? ''));
    const [rr, em] = await Promise.all([
      hfRerank(row.tag_name, names, token, deadline),
      hfEmbed([row.tag_name, ...names], token, deadline),
    ]);
    // Out of time mid-row: leave it untouched for the next run (no attempt).
    if ((!rr.ok && rr.budget) || (!em.ok && em.budget)) {
      stoppedEarly = true;
      break;
    }
    if (!rr.ok || !em.ok) {
      await recordFailure(row, !rr.ok ? rr.error : (em as { error: string }).error);
      continue;
    }
    const scores = rr.value, vecs = em.value;
    if (!vecs[0]) {
      await recordFailure(row, 'embed: no vector for tag');
      continue;
    }
    if (scores.every((s) => s.score === null)) {
      console.error(`[hf-shadow] rerank: no parsable score for row ${row.id}; raw sample`, JSON.stringify(scores[0]?.raw).slice(0, 300));
      await recordFailure(row, `rerank unparsable: ${JSON.stringify(scores[0]?.raw).slice(0, 200)}`);
      continue;
    }
    const tagVec = vecs[0];
    const rerankerScores = cands.map((c, i) => ({ concept_id: c.concept_id, score: scores[i]?.score ?? null, raw: scores[i]?.raw ?? null }));
    const v2Sims = cands.map((c, i) => ({
      concept_id: c.concept_id,
      sim: vecs[i + 1] ? cosine(tagVec, vecs[i + 1]!) : null,
    }));
    const { error: upErr } = await supabase
      .from('concept_judge_shadow')
      .update({
        evaluated_at: new Date().toISOString(),
        reranker_model: RERANK_MODEL,
        reranker_scores: rerankerScores,
        v2_sims: v2Sims,
        last_error: null,
      })
      .eq('id', row.id);
    if (upErr) {
      failed++;
      console.error(`[hf-shadow] shadow update ${row.id}: ${upErr.message}`);
    } else {
      evaluated++;
    }
  }

  console.log(`[hf-shadow] shadow: selected ${todo.length}, evaluated ${evaluated}, failed ${failed}, gave_up ${gaveUp}`);
  return { action: 'shadow', selected: todo.length, evaluated, failed, gave_up: gaveUp, stopped_early: stoppedEarly };
}

async function actionPairs(token: string, deadline: number) {
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  const all = [
    ...SYNONYM_PAIRS.map(([a, b]) => ({ a, b, kind: 'synonym' as const })),
    ...RELATED_PAIRS.map(([a, b]) => ({ a, b, kind: 'related' as const })),
  ];
  const texts = [...new Set(all.flatMap((p) => [p.a, p.b]))];

  const bgeRes = await hfEmbed(texts, token, deadline);
  const bgeList = bgeRes.ok ? bgeRes.value : null;
  const bge = new Map<string, number[] | null>(texts.map((t, i) => [t, bgeList?.[i] ?? null]));

  const gem = new Map<string, number[] | null>();
  for (const t of texts) gem.set(t, geminiKey ? await geminiEmbed(t, geminiKey, deadline) : null);

  const sim = (m: Map<string, number[] | null>, a: string, b: string) => {
    const va = m.get(a), vb = m.get(b);
    return va && vb ? cosine(va, vb) : null;
  };
  const pairs = all.map((p) => ({
    ...p,
    gemini: sim(gem, p.a, p.b),
    bge_m3: sim(bge, p.a, p.b),
  }));

  // Separation: a model separates the two groups cleanly when the weakest
  // synonym still scores above the strongest related pair (gap > 0).
  const summarize = (key: 'gemini' | 'bge_m3') => {
    const syn = pairs.filter((p) => p.kind === 'synonym' && p[key] !== null).map((p) => p[key] as number);
    const rel = pairs.filter((p) => p.kind === 'related' && p[key] !== null).map((p) => p[key] as number);
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10000) / 10000 : null);
    const minSyn = syn.length ? Math.min(...syn) : null;
    const maxRel = rel.length ? Math.max(...rel) : null;
    return {
      synonym_mean: mean(syn),
      related_mean: mean(rel),
      synonym_min: minSyn,
      related_max: maxRel,
      gap: minSyn !== null && maxRel !== null ? Math.round((minSyn - maxRel) * 10000) / 10000 : null,
    };
  };

  return {
    action: 'pairs',
    models: { gemini: 'gemini-embedding-001', bge_m3: EMBED_MODEL },
    gemini_configured: !!geminiKey,
    summary: { gemini: summarize('gemini'), bge_m3: summarize('bge_m3') },
    pairs,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth gate: CRON_SECRET bearer, constant-time (same as linker-health-alert).
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided) return new Response('Forbidden', { status: 403 });
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) return new Response('Forbidden', { status: 403 });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return new Response('Forbidden', { status: 403 });

  let body: { action?: string; limit?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const action = body.action;
  if (action !== 'backfill' && action !== 'shadow' && action !== 'pairs') {
    return json({ error: "action must be 'backfill' | 'shadow' | 'pairs'" }, 400);
  }

  const token = Deno.env.get('HF_TOKEN');
  if (!token) {
    console.warn('[hf-shadow] HF_TOKEN not set — skipping');
    return json({ action, skipped: 'HF_TOKEN not set' });
  }

  const rawLimit = Number(body.limit);
  const deadline = Date.now() + SOFT_BUDGET_MS;
  try {
    if (action === 'pairs') return json(await actionPairs(token, deadline));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    if (action === 'backfill') {
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 1000) : 500;
      return json(await actionBackfill(supabase, token, limit, deadline));
    }
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;
    return json(await actionShadow(supabase, token, limit, deadline));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[hf-shadow] ${action} failed: ${msg}`);
    return json({ action, error: msg }, 500);
  }
});
