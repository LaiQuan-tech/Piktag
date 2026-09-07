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

    // Find tags without parent_tag_id
    const { data: orphanTags } = await supabase
      .from('piktag_tags')
      .select('id, name, semantic_type')
      .is('parent_tag_id', null)
      .order('usage_count', { ascending: false })
      .limit(HIERARCHY_BATCH);

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
