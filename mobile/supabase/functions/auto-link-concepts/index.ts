// Supabase Edge Function: auto-link-concepts
// Automatically links tags to semantic concepts using Gemini embeddings
// Run periodically (e.g., daily cron) or on-demand
//
// How it works:
// 1. Find tags without concept_id or with concepts missing embeddings
// 2. Generate embedding for each tag name
// 3. Find similar existing concepts (cosine similarity > 0.85)
// 4. If match found → link tag to existing concept + add alias
// 5. If no match → create new concept with embedding
//
// This handles cross-language: #媽祖 ≈ #Mazu ≈ #天上聖母

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIMILARITY_THRESHOLD = 0.85;
const BATCH_SIZE = 50;

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    return new Response(
      JSON.stringify({
        message: 'Auto-link completed',
        processed: unlinkedTags.length,
        linked,
        created,
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
