// Supabase Edge Function: auto-link-concepts
// Automatically links tags to semantic concepts using Gemini embeddings
// + Builds tag hierarchy (parent-child relationships)
// + Improves disambiguation
//
// Capabilities:
// 1. Synonym alignment: #媽祖 ≈ #天上聖母 ≈ #Mazu (embedding similarity)
// 2. Hierarchy: #媽祖 → parent: #民間信仰 → parent: #台灣文化 (LLM)
// 3. Disambiguation: same name, different meaning detection (embedding distance)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIMILARITY_THRESHOLD = 0.85;
// Gray-zone floor. Embeddings of the SAME concept across languages
// (e.g. 扶輪社 ↔ Rotary Club ≈ 0.71, 工程師 ↔ Engineer) land far below
// SIMILARITY_THRESHOLD, so a pure-embedding linker silently fails the
// cross-language matching that is PikTag's whole serendipity thesis.
// Candidates in [GRAY_ZONE_FLOOR, SIMILARITY_THRESHOLD) are NOT linked
// blindly — they go to an LLM judge that decides true synonymy.
// Below GRAY_ZONE_FLOOR we don't even ask: too far to be the same.
const GRAY_ZONE_FLOOR = 0.70;
const BATCH_SIZE = 50;
const HIERARCHY_BATCH = 20;

// Cross-language aliases for freshly minted concepts.
//
// WHY (2026-09-10): a concept minted here used to be MONOLINGUAL. It got
// exactly one alias — the tag string that created it. search_users reaches
// a concept only by matching the query TEXT against piktag_tags.name or
// tag_aliases.alias, so a concept minted from `crystal` was unreachable by
// 水晶 no matter how good its embedding was. Cross-language matching only
// worked when BOTH language forms happened to exist as tags (so embeddings
// could bridge them) or when someone curated the pair by hand. The founder
// found this the obvious way: a friend tagged `crystal`, searching 水晶
// returned nothing.
//
// So at mint time we ask for the concept's name in the major locales and
// write those as aliases. Every new concept is multilingual from birth
// instead of waiting for someone to hit the gap and a human to patch it.
//
// Kept deliberately cheap and fail-open: one extra Gemini call per NEW
// concept only (never on the link path), capped per run, and any failure
// leaves the concept exactly as it would have been before this existed.
// All 19 app locales, matching SUPPORTED_LANGS in mobile/src/i18n/index.ts.
// Someone whose app is in Turkish will search in Turkish, so a concept that
// exists in only twelve languages is unreachable for the other seven.
//
// The whole set goes in one request -- adding languages costs response
// tokens, not extra calls, so the cap below is about how many CONCEPTS a
// run may process, never how many languages each one gets.
const ALIAS_LOCALES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'zh-TW', name: 'Traditional Chinese (Taiwan)' },
  { code: 'zh-CN', name: 'Simplified Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'id', name: 'Indonesian' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ur', name: 'Urdu' },
];

// Per-run ceiling on alias-generation calls. The nine edge functions share
// one GEMINI_API_KEY and that key has run out of quota before (see
// ref-infra-ops "踩坑補遺"), so a 50-tag batch of all-new concepts must not
// be able to add 50 more calls on top of its 50 embeddings. Concepts past
// the cap simply get their aliases on a later run — the linker sweeps every
// five minutes and picks tags up by usage_count, so nothing is lost.
const ALIAS_GEN_PER_RUN = 12;

// ROOT-CAUSE FIX (2026-07-07 hang): the three Gemini fetches below had
// no timeout. When an upstream call hangs, its `await` never returns, so
// the Deno worker is killed by the platform wall-clock limit BEFORE the
// `finally` block that releases linker_run_lock ever runs — leaving the
// lock stuck and every later cron run skipping (lock looks <STALE_LOCK_MIN
// old). AbortController caps each call so a hung upstream throws instead,
// the surrounding try/catch returns null/[], and the lock always releases.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const response = await fetchWithTimeout(
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
      },
      8000,
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('auto-link-concepts embedding upstream error: HTTP', response.status, bodyText.slice(0, 500));
      return null;
    }

    const result = await response.json();
    return result.embedding?.values || null;
  } catch {
    return null;
  }
}

/**
 * Use Gemini LLM to infer hierarchy + semantic_type for a batch of tags
 * Returns: [{ tag: "媽祖", parent: "民間信仰", semantic_type: "interest" }, ...]
 */
async function inferHierarchy(tagNames: string[], apiKey: string): Promise<{ tag: string; parent: string | null; semantic_type: string | null }[]> {
  try {
    const prompt = `Given these tags from a social networking app, for each tag determine:
1. parent_tag: a broader category this tag belongs to (or null if it's already top-level)
2. semantic_type: one of: identity, personality, career, skill, interest, social, meta, relation (or null)

Tags: ${tagNames.join(', ')}

Respond ONLY in JSON array format, no markdown:
[{"tag":"媽祖","parent":"民間信仰","semantic_type":"interest"},{"tag":"工程師","parent":null,"semantic_type":"career"}]`;

    const response = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
      },
      15000,
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('auto-link-concepts hierarchy upstream error: HTTP', response.status, bodyText.slice(0, 500));
      return [];
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

/**
 * LLM gray-zone judge. Given a freshly-coined tag and the embedding
 * candidates that scored in [GRAY_ZONE_FLOOR, SIMILARITY_THRESHOLD) —
 * too far for blind linking, too close to dismiss — ask Gemini whether
 * the tag is a TRUE synonym of any candidate concept. This is the path
 * that recovers cross-language matches (扶輪社 ↔ Rotary Club) which
 * embeddings alone score at only ~0.71.
 *
 * Returns the matched concept_id, or null if none is a true synonym.
 */
async function judgeConceptMatch(
  tagName: string,
  candidates: { concept_id: string; canonical_name: string; similarity: number }[],
  apiKey: string,
): Promise<string | null> {
  try {
    const list = candidates
      .map((c, i) => `${i + 1}. ${c.canonical_name}`)
      .join('\n');
    const prompt = `A user of a social-networking app coined the tag "${tagName}".
Below are existing semantic concepts. Decide whether "${tagName}" denotes the SAME concept as any one of them.

SAME concept = a true synonym, INCLUDING cross-language synonyms:
  e.g. "工程師" = "Engineer" = "エンジニア"; "扶輪社" = "Rotary Club"; "貓派" = "Cat person".
NOT the same = a broader/narrower term or a merely-related term:
  e.g. "軟體工程師" is NOT "工程師" (narrower); "攝影" is NOT "攝影師" (activity vs role).

Concepts:
${list}

Reply with ONLY the number of the matching concept, or 0 if none is a true synonym.`;

    const response = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // gemini-2.5-flash is a thinking model — it spends output
          // budget on internal reasoning before the visible answer.
          // maxOutputTokens must leave room for both or the response
          // comes back empty (finishReason MAX_TOKENS). The visible
          // answer here is just a digit; 1024 is headroom for thinking.
          generationConfig: { temperature: 0, maxOutputTokens: 1024 },
        }),
      },
      15000,
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('judgeConceptMatch upstream error: HTTP', response.status, bodyText.slice(0, 300));
      return null;
    }

    const result = await response.json();
    const text = (result.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    // Require the reply to be EXACTLY a number. A loose /\d+/ match would
    // pick a stray digit out of leaked reasoning (e.g. "Concept 3 ... so
    // 0" → 3) and mint a FALSE synonym link. Anything not clean is
    // treated as no-match — conservative: it just mints a new concept.
    const m = text.match(/^(\d+)$/);
    const n = m ? parseInt(m[1], 10) : 0;
    if (n >= 1 && n <= candidates.length) {
      return candidates[n - 1].concept_id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask Gemini for a concept's name in the major locales, so a newly minted
 * concept is reachable from every language rather than only the one it was
 * coined in. Returns [] on any failure — the caller must treat aliases as a
 * bonus, never a precondition for minting.
 *
 * The prompt is deliberately strict about what counts. A broader or related
 * term here is worse than a missing one: aliases are how search resolves a
 * query to a concept, so "healing" attached to `crystal` would make every
 * search for healing surface crystal users. Narrow, same-meaning terms only.
 */
async function generateCrossLanguageAliases(
  tagName: string,
  semanticType: string | null,
  apiKey: string,
): Promise<{ alias: string; language: string }[]> {
  try {
    const localeList = ALIAS_LOCALES
      .map((l) => `  "${l.code}": "<${l.name}>"`)
      .join(',\n');

    const prompt = `A user of a social-networking app coined the tag "${tagName}"${
      semanticType ? ` (category: ${semanticType})` : ''
    }.

Give the term people ACTUALLY use for this exact concept in each language below.

Rules:
- Same concept only. A broader category, a narrower speciality, or a merely
  related term is WRONG. For "水晶" give the language's word for crystal, not
  "healing", "spirituality" or "amethyst".
- Use what native speakers really write, not a literal word-by-word rendering.
- OMITTING A LANGUAGE IS THE CORRECT ANSWER whenever you are not confident.
  A wrong entry is far worse than a missing one: these strings are unique
  keys in a search index, so a bad one is unusable by any other concept and
  makes searches in that language return the wrong people. Omit rather than
  guess, and omit rather than invent a term to fill the slot.
- Omit a language when speakers of it simply use the English word, when the
  concept has no established term there, or when the only rendering would be
  a transliteration nobody writes.
- Never return a generic everyday word that means many other things.
- For the language "${tagName}" is already in, give the most common written
  form (it may differ in case or spacing from the tag itself).
- Use each language's own script.

Reply with ONLY a JSON object, no markdown fence, no commentary:
{
${localeList}
}
Omit any key you cannot answer well.`;

    const response = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // Same thinking-model budget trap as judgeConceptMatch: 2.5-flash
          // spends output budget on internal reasoning before the visible
          // answer, and an overrun returns EMPTY with finishReason
          // MAX_TOKENS rather than a truncated object. The visible answer
          // here is 19 entries, many in non-Latin scripts that cost several
          // tokens per character, so the budget is sized for the full set
          // plus thinking rather than the 1024 a one-digit reply needs.
          generationConfig: { temperature: 0, maxOutputTokens: 4096 },
        }),
      },
      15000,
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error(
        'generateCrossLanguageAliases upstream error: HTTP',
        response.status,
        bodyText.slice(0, 300),
      );
      return [];
    }

    const result = await response.json();
    const text = (result.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    // Tolerate a stray ```json fence even though the prompt forbids one.
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.warn(`generateCrossLanguageAliases: unparseable reply for "${tagName}"`);
      return [];
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

    const allowed = new Set(ALIAS_LOCALES.map((l) => l.code));
    const seen = new Set<string>([tagName.trim().toLowerCase()]);
    const out: { alias: string; language: string }[] = [];

    // The prompt says to omit a language it cannot answer for, but models
    // answer "N/A" instead often enough that a fixture run caught it
    // landing in the output. tag_aliases.alias is globally UNIQUE, so a
    // junk alias is not merely noise — it permanently occupies that string
    // for every concept, and searching it would surface this concept's
    // users. Cheaper to reject the handful of ways a model says "nothing".
    const NON_ANSWERS = new Set([
      'n/a', 'na', 'none', 'null', 'nil', 'no', '-', '--', '—', 'x',
      'unknown', 'not applicable', 'no equivalent', 'same', 'same as english',
      'omit', 'omitted', 'n.a.',
      '無', '无', '沒有', '没有', 'なし', '無し', '없음', 'ไม่มี', 'không có',
      // Added with the ar/hi/bn/ur expansion: these are the four locales
      // nobody here can eyeball, so the refusal forms they answer with have
      // to be filtered rather than spotted later.
      'لا يوجد', 'لا شيء', 'कोई नहीं', 'नहीं', 'কিছু না', 'নেই', 'کوئی نہیں',
      'yok', 'нет', 'nessuno', 'tidak ada', 'nenhum', 'ninguno', 'aucun',
    ]);

    for (const [code, raw] of Object.entries(parsed)) {
      if (!allowed.has(code)) continue;
      if (typeof raw !== 'string') continue;
      const alias = raw.trim();
      // Length bounds keep out both junk ("-", "N/A") and the model
      // answering with a sentence instead of a term.
      if (alias.length < 2 || alias.length > 40) continue;
      // A reply that still contains the prompt's own placeholder syntax
      // means the model echoed the template rather than answering.
      if (alias.includes('<') || alias.includes('>')) continue;
      const key = alias.toLowerCase();
      if (NON_ANSWERS.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ alias, language: code });
    }
    return out;
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth gate: require CRON_SECRET via Authorization: Bearer header
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided) return new Response('Forbidden', { status: 403 });
  // constant-time compare to avoid timing attack
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) return new Response('Forbidden', { status: 403 });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return new Response('Forbidden', { status: 403 });

  try {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Row-mutex: prevent overlapping linker runs ─────────────────
    // With the LLM gray-zone judge added, a backlog-heavy run can
    // exceed the 5-min cron interval — two concurrent runs would
    // both SELECT `concept_id IS NULL LIMIT 50` and both INSERT new
    // singleton concepts (the exact fragmentation bug the linker
    // exists to fix). The conditional UPDATE below is atomic at the
    // row level: only one caller wins, the loser sees 0 rows and
    // bails. 10-min stale window self-heals a crashed run.
    // Lowered 10→3 (2026-07-07): with fetchWithTimeout above, a run now
    // finishes or errors within seconds and releases the lock cleanly, so
    // a genuinely-stuck lock (e.g. worker OOM-killed mid-run) should be
    // reclaimable fast. 3 min is comfortably above a healthy run's wall time.
    // PHANTOM-SKIP FIX (2026-07-11): the previous PostgREST-side claim
    // (.update().eq().or(...).select()) SET locked_at yet returned an
    // empty representation, so every run false-skipped as "another run
    // in progress" — the linker starved itself indefinitely while the
    // engine underneath was healthy. Claim is now an atomic SQL RPC
    // (claim_linker_lock, migration 20260711040000): true = we own the
    // run, false = someone genuinely does.
    const STALE_LOCK_MIN = 3;
    const { data: claimed, error: lockErr } = await supabase.rpc(
      'claim_linker_lock',
      { p_stale_minutes: STALE_LOCK_MIN },
    );
    if (lockErr) {
      console.warn('claim_linker_lock error (proceeding without lock):', lockErr.message);
      // Fail OPEN — if the lock is unreachable we'd rather process tags
      // than stop entirely. The race only matters when two runs ACTUALLY
      // overlap, which itself is rare.
    } else if (claimed === false) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'another linker run in progress' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    // Always release on exit, success or error.
    const releaseLock = async () => {
      try {
        await supabase
          .from('linker_run_lock')
          .update({ locked_at: null })
          .eq('id', 1);
      } catch (e) {
        console.warn('linker_run_lock release failed:', e);
      }
    };

    try {

    // 1. Find tags without concept_id
    const { data: unlinkedTags, error: fetchError } = await supabase
      .from('piktag_tags')
      .select('id, name, semantic_type, usage_count')
      .is('concept_id', null)
      .order('usage_count', { ascending: false })
      .limit(BATCH_SIZE);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // NO EARLY RETURN HERE. This used to be
    //
    //   if (!unlinkedTags || unlinkedTags.length === 0) return ...
    //
    // which made Phase 2 — hierarchy AND semantic classification — a
    // passenger on Phase 1. Concept linking finished catching up long ago,
    // so every invocation since has claimed the lock, found nothing to
    // link, and returned in about eight seconds without ever reaching the
    // classifier. That is why 317 of 373 tags still had semantic_type
    // NULL after the funnel fix on 2026-09-08: the fix was correct and the
    // code was unreachable.
    //
    // The two phases answer different questions ("is this tag attached to
    // a concept?" and "what KIND of thing is this tag?") and one being
    // finished says nothing about the other. Phase 1 is skipped when it
    // has no work; Phase 2 runs either way.
    const hasUnlinked = Boolean(unlinkedTags && unlinkedTags.length > 0);

    // 2. Also generate embeddings for concepts that don't have one yet
    const { data: conceptsWithoutEmbedding } = await supabase
      .from('tag_concepts')
      .select('id, canonical_name')
      .is('embedding', null)
      .limit(BATCH_SIZE);

    if (conceptsWithoutEmbedding && conceptsWithoutEmbedding.length > 0) {
      for (const concept of conceptsWithoutEmbedding) {
        const embedding = await generateEmbedding(concept.canonical_name, geminiApiKey);
        if (embedding) {
          await supabase
            .from('tag_concepts')
            .update({ embedding: JSON.stringify(embedding) })
            .eq('id', concept.id);
        }
      }
    }

    let linked = 0;
    let created = 0;
    let aliasCalls = 0;   // Gemini calls spent on cross-language aliases
    let aliasesAdded = 0; // rows actually written (conflicts don't count)

    for (const tag of hasUnlinked ? unlinkedTags : []) {
      // 3a. Alias-first resolution (deterministic, exact, free).
      //
      // The seed migrations (20260328_seed_multilingual_aliases +
      // _ko_id_th_tr) populated tag_aliases with hundreds of
      // hand-curated cross-language synonyms — e.g. Project
      // Management ← PM / 專案管理 / 項目管理 / प्रोजेक्ट प्रबंधन /
      // Gestión de proyectos / 프로젝트 관리 / … resolve_tag_alias
      // is an exact, case-insensitive alias→concept_id lookup.
      //
      // Until now NOTHING called it: the embedding path below
      // ignored the curated map entirely, so (a) cross-language
      // synonyms that don't clear the 0.85 cosine bar never
      // unified, and (b) every miss MINTED A NEW SINGLETON
      // concept that shadows the seeded one (that's why
      // tag_concepts is ~248 when the seed defines ~45).
      //
      // Snapping a known alias straight to its seeded concept
      // fixes both, is exact rather than fuzzy, and skips an
      // embedding API call. Embedding stays as the fallback ONLY
      // for tags with no curated alias.
      try {
        const { data: aliasConceptId } = await supabase.rpc(
          'resolve_tag_alias',
          { input_text: tag.name },
        );
        if (aliasConceptId) {
          await supabase
            .from('piktag_tags')
            .update({ concept_id: aliasConceptId })
            .eq('id', tag.id);
          // Keep the alias row self-consistent (no-op if it's
          // already the row that resolved us here).
          await supabase
            .from('tag_aliases')
            .upsert(
              { alias: tag.name, concept_id: aliasConceptId },
              { onConflict: 'alias' },
            );
          linked++;
          console.log(
            `Alias-linked "${tag.name}" → concept ${aliasConceptId} (exact, no embedding)`,
          );
          continue;
        }
      } catch (e) {
        // Non-fatal: fall through to the embedding path. A flaky
        // alias lookup must not stall concept linking.
        console.warn(`resolve_tag_alias failed for "${tag.name}":`, e);
      }

      // 3. Generate embedding for this tag (fallback: no curated
      //    alias matched the tag name).
      const embedding = await generateEmbedding(tag.name, geminiApiKey);
      if (!embedding) continue;

      // 4. Find candidate concepts down to the gray-zone floor.
      const { data: candidates } = await supabase.rpc('find_similar_concepts', {
        query_embedding: JSON.stringify(embedding),
        similarity_threshold: GRAY_ZONE_FLOOR,
        max_results: 5,
      });

      // Decide the concept match:
      //  • top similarity ≥ 0.85 → embedding alone is enough (high
      //    confidence — link directly).
      //  • 0.70–0.85 gray zone → embeddings cannot bridge cross-language
      //    synonyms (中文↔English of the SAME concept sits ~0.71), so
      //    ask the LLM whether any candidate is genuinely the same
      //    concept before giving up and minting a singleton.
      //  • no candidate ≥ 0.70 → fall through and create a new concept.
      let matchedConcept: any = null;
      if (candidates && candidates.length > 0) {
        if (candidates[0].similarity >= SIMILARITY_THRESHOLD) {
          matchedConcept = candidates[0];
        } else {
          const judgedId = await judgeConceptMatch(tag.name, candidates, geminiApiKey);
          if (judgedId) {
            matchedConcept = candidates.find((c: any) => c.concept_id === judgedId) || null;
            if (matchedConcept) {
              console.log(
                `LLM-confirmed "${tag.name}" ≈ concept "${matchedConcept.canonical_name}" ` +
                `(embedding only ${Number(matchedConcept.similarity).toFixed(3)})`,
              );
            }
          }
        }
      }

      if (matchedConcept) {
        // Match found → link to existing concept

        // Update tag's concept_id
        await supabase
          .from('piktag_tags')
          .update({ concept_id: matchedConcept.concept_id })
          .eq('id', tag.id);

        // Add alias if not exists
        await supabase
          .from('tag_aliases')
          .upsert(
            { alias: tag.name, concept_id: matchedConcept.concept_id },
            { onConflict: 'alias' }
          );

        // Update concept usage_count
        await supabase
          .from('tag_concepts')
          .update({ usage_count: matchedConcept.usage_count + tag.usage_count })
          .eq('id', matchedConcept.concept_id);

        linked++;
        console.log(`Linked "${tag.name}" → concept "${matchedConcept.canonical_name}" (similarity: ${matchedConcept.similarity.toFixed(3)})`);
      } else {
        // 5. No match → create new concept
        const { data: newConcept } = await supabase
          .from('tag_concepts')
          .insert({
            canonical_name: tag.name,
            semantic_type: tag.semantic_type,
            embedding: JSON.stringify(embedding),
            usage_count: tag.usage_count,
          })
          .select('id')
          .single();

        if (newConcept) {
          // Link tag to new concept
          await supabase
            .from('piktag_tags')
            .update({ concept_id: newConcept.id })
            .eq('id', tag.id);

          // Add alias
          await supabase
            .from('tag_aliases')
            .upsert(
              { alias: tag.name, concept_id: newConcept.id },
              { onConflict: 'alias' }
            );

          created++;
          console.log(`Created new concept for "${tag.name}"`);

          // Make the new concept reachable from other languages. Bonus
          // work only: every failure path below leaves the concept exactly
          // as it was a moment ago, already linked and already aliased
          // under its own name.
          if (aliasCalls < ALIAS_GEN_PER_RUN) {
            aliasCalls++;
            const crossAliases = await generateCrossLanguageAliases(
              tag.name,
              tag.semantic_type,
              geminiApiKey,
            );
            if (crossAliases.length > 0) {
              // ignoreDuplicates, NOT the upsert used above for the tag's
              // own name. An upsert on `alias` REWRITES the concept_id of a
              // row that already exists, which for generated aliases would
              // quietly steal a well-established word from another concept
              // on the strength of one LLM reply. Adding bridges is safe;
              // moving them is not.
              const { data: aliasRows, error: aliasErr } = await supabase
                .from('tag_aliases')
                .upsert(
                  crossAliases.map((a) => ({
                    alias: a.alias,
                    concept_id: newConcept.id,
                    language: a.language,
                    // Provenance (20260910020000). This is the only writer
                    // that stamps a source, and it is the whole reason the
                    // column exists: four of the 19 locales are languages
                    // nobody here can spot-check, so model output has to
                    // stay separable from the curated bridges. Reverting a
                    // language is then one statement:
                    //   DELETE FROM tag_aliases
                    //   WHERE source = 'llm' AND language = 'bn';
                    source: 'llm',
                  })),
                  { onConflict: 'alias', ignoreDuplicates: true },
                )
                .select('id');

              if (aliasErr) {
                console.warn(`cross-language aliases failed for "${tag.name}":`, aliasErr.message);
              } else {
                // Count rows that actually landed, not rows we offered:
                // ignoreDuplicates silently drops any alias another concept
                // already owns, and reporting the attempt as a success
                // would overstate coverage in exactly the cases where the
                // bridge was NOT built.
                const added = aliasRows?.length ?? 0;
                aliasesAdded += added;
                console.log(
                  `  + ${added}/${crossAliases.length} cross-language aliases for "${tag.name}": ${
                    crossAliases.map((a) => a.alias).join(', ')
                  }`,
                );
              }
            }
          }
        }
      }

      // Rate limit: Gemini free tier is 1500 RPM
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // ── Phase 2: Build hierarchy (parent-child relationships) ──
    let hierarchyUpdated = 0;
    // Counted separately from hierarchyUpdated: the two used to move
    // together by construction, and the whole point of this change is
    // that they no longer do. Reported so a run makes the difference
    // visible instead of hiding it in one number.
    let semanticTypeUpdated = 0;

    // Two candidate sets, merged — because the two jobs in this phase have
    // DIFFERENT definitions of "still needs work".
    //
    // This used to be one query on `parent_tag_id IS NULL` ordered by
    // usage_count. That set is largely PERMANENT: a tag with no sensible
    // parent (#創業, #INFJ, a city) never gets one, so the same top-20 by
    // usage were re-sent to Gemini every run forever. Once those few were
    // classified, every later run spent twenty model calls to change
    // nothing, while the ~275 lower-usage tags with semantic_type NULL
    // never got a turn. Observed live: one run reported
    // semanticTypeUpdated 2 out of a batch of 20.
    //
    // So ask for both, separately and each bounded:
    //   * hierarchy candidates — parent_tag_id IS NULL (as before)
    //   * classification candidates — semantic_type IS NULL
    // and infer over the union. Classification now drains instead of
    // stalling, and hierarchy keeps its old behaviour.
    const [{ data: noParent }, { data: noType }] = await Promise.all([
      supabase
        .from('piktag_tags')
        .select('id, name, semantic_type')
        .is('parent_tag_id', null)
        .order('usage_count', { ascending: false })
        .limit(HIERARCHY_BATCH),
      supabase
        .from('piktag_tags')
        .select('id, name, semantic_type')
        .is('semantic_type', null)
        .order('usage_count', { ascending: false })
        .limit(HIERARCHY_BATCH),
    ]);

    // Dedupe by id — a tag with neither a parent nor a type is in both.
    const orphanTags = Array.from(
      new Map(
        [...(noParent || []), ...(noType || [])].map((t) => [t.id, t]),
      ).values(),
    );

    if (orphanTags && orphanTags.length > 0) {
      const tagNames = orphanTags.map(t => t.name);
      const hierarchyResults = await inferHierarchy(tagNames, geminiApiKey);

      for (const result of hierarchyResults) {
        const tag = orphanTags.find(t => t.name === result.tag);
        if (!tag) continue;

        // Semantic type is written FIRST, and independently of the parent.
        //
        // It used to live at the bottom of this loop, inside `if
        // (parentTag)`, behind a `if (!result.parent) continue` — so the
        // model could answer "this is a personality tag" and we threw the
        // answer away whenever it could not also name a parent concept.
        // Plenty of tags have no sensible parent precisely because they
        // ARE top-level: #創業, #INFJ, a city. Those can never be
        // classified under the old shape, which is why a live count on
        // 2026-09-08 found 317 of 373 tags with semantic_type NULL while
        // every classified one had a hierarchy.
        //
        // This is not only an SEO concern. semantic_type is the dimension
        // the tag algorithm reads; without it a tag is just a string with
        // an embedding.
        //
        // Still only fills a GAP — an existing type is never overwritten,
        // because a human or an earlier pass may have set it deliberately.
        if (!tag.semantic_type && result.semantic_type) {
          const { error: stErr } = await supabase
            .from('piktag_tags')
            .update({ semantic_type: result.semantic_type })
            .eq('id', tag.id);
          if (stErr) {
            console.warn(`semantic_type update failed for "${tag.name}":`, stErr.message);
          } else {
            semanticTypeUpdated++;
            console.log(`Semantic: "${tag.name}" → ${result.semantic_type}`);
          }
        }

        if (!result.parent) continue;

        // Find or create parent tag. Case-insensitive lookup (ilike +
        // escaped wildcards): a case-sensitive .eq misses a case-variant
        // row → spurious INSERT → 23505 on UNIQUE(lower(name)) → the parent
        // concept never links → orphan fragment (hurts cross-language
        // matching). Inline escape — Deno edge fn can't import the mobile
        // normalizeTag lib. .limit(1) tolerates legacy mixed-case dupes.
        const parentLike = result.parent.replace(/[\\_%]/g, '\\$&');
        const { data: parentRows } = await supabase
          .from('piktag_tags')
          .select('id')
          .ilike('name', parentLike)
          .limit(1);
        let parentTag = parentRows && parentRows[0] ? parentRows[0] : null;

        if (!parentTag) {
          // Create parent tag
          const { data: newParent } = await supabase
            .from('piktag_tags')
            .insert({ name: result.parent, semantic_type: result.semantic_type })
            .select('id')
            .single();
          parentTag = newParent;
        }

        if (parentTag) {
          // Set parent_tag_id
          await supabase
            .from('piktag_tags')
            .update({ parent_tag_id: parentTag.id })
            .eq('id', tag.id);

          // (semantic_type is handled at the top of this loop now, so a
          // tag with no parent still gets classified.)

          hierarchyUpdated++;
          console.log(`Hierarchy: "${tag.name}" → parent "${result.parent}"`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Auto-link + hierarchy completed',
        processed: hasUnlinked ? unlinkedTags.length : 0,
        linked,
        created,
        aliasesAdded,
        // Surfaced so a run that hit the per-run alias ceiling is visible
        // in the cron log rather than looking like the generator failed.
        aliasGenCapped: aliasCalls >= ALIAS_GEN_PER_RUN,
        hierarchyUpdated,
        semanticTypeUpdated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    } finally {
      // Always release the row-mutex — success, early-return, or
      // thrown error. JS guarantees finally runs even on a return-in-
      // try, so the success path also releases before the response
      // goes out.
      await releaseLock();
    }
  } catch (err) {
    console.error('auto-link-concepts error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
