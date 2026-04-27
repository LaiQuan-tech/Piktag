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
const BATCH_SIZE = 50;
const HIERARCHY_BATCH = 20;

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] },
        }),
      }
    );

    if (!response.ok) return null;

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!response.ok) return [];

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
      // 3. Generate embedding for this tag
      const embedding = await generateEmbedding(tag.name, geminiApiKey);
      if (!embedding) continue;

      // 4. Find similar existing concepts
      const { data: similar } = await supabase.rpc('find_similar_concepts', {
        query_embedding: JSON.stringify(embedding),
        similarity_threshold: SIMILARITY_THRESHOLD,
        max_results: 1,
      });

      if (similar && similar.length > 0) {
        // Match found → link to existing concept
        const matchedConcept = similar[0];

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
