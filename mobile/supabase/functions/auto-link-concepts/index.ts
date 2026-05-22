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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const response = await fetch(
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

    const response = await fetch(
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
      }
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

    const response = await fetch(
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
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('judgeConceptMatch upstream error: HTTP', response.status, bodyText.slice(0, 300));
      return null;
    }

    const result = await response.json();
    const text = (result.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const n = parseInt(text.match(/\d+/)?.[0] ?? '0', 10);
    if (Number.isFinite(n) && n >= 1 && n <= candidates.length) {
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

    if (!unlinkedTags || unlinkedTags.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No unlinked tags found', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    for (const tag of unlinkedTags) {
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
        if (!result.parent) continue;

        const tag = orphanTags.find(t => t.name === result.tag);
        if (!tag) continue;

        // Find or create parent tag
        let { data: parentTag } = await supabase
          .from('piktag_tags')
          .select('id')
          .eq('name', result.parent)
          .maybeSingle();

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

          // Also update semantic_type if missing
          if (!tag.semantic_type && result.semantic_type) {
            await supabase
              .from('piktag_tags')
              .update({ semantic_type: result.semantic_type })
              .eq('id', tag.id);
          }

          hierarchyUpdated++;
          console.log(`Hierarchy: "${tag.name}" → parent "${result.parent}"`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Auto-link + hierarchy completed',
        processed: unlinkedTags.length,
        linked,
        created,
        hierarchyUpdated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('auto-link-concepts error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
