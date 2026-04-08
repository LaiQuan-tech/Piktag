/**
 * Tag Resolver — resolves user input to canonical tag concepts
 *
 * Flow: input → alias lookup → embedding similarity → create new
 */
import { supabase, supabaseUrl } from './supabase';
import type { Tag, TagConcept } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ResolveResult =
  | { type: 'exact'; tag: Tag; concept: TagConcept }
  | { type: 'similar'; suggestions: SimilarConcept[] }
  | { type: 'new'; tag: Tag; concept: TagConcept };

export type SimilarConcept = {
  concept_id: string;
  canonical_name: string;
  semantic_type: string | null;
  similarity: number;
};

// ── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve user input to a tag concept.
 * 1. Check alias table for exact match
 * 2. If not found, check embedding similarity (with user context for disambiguation)
 * 3. If no similar match, create new concept + alias + tag
 *
 * @param input - The tag text user typed
 * @param userId - Current user's ID, used to fetch existing tags as context
 */
export async function resolveTag(input: string, userId?: string): Promise<ResolveResult> {
  const trimmed = input.trim().replace(/^#/, '');
  if (!trimmed) throw new Error('Empty tag input');

  // Step 1: Exact alias match
  const exactMatch = await findByAlias(trimmed);
  if (exactMatch) {
    return { type: 'exact', ...exactMatch };
  }

  // Step 2: Try embedding similarity with user context
  try {
    // Fetch user's existing tag names for context
    const contextTags = userId ? await getUserTagNames(userId) : [];
    const similar = await findSimilarByText(trimmed, 0.65, 5, contextTags);
    if (similar.length > 0) {
      return { type: 'similar', suggestions: similar };
    }
  } catch (err) {
    // Embedding not available yet, skip to step 3
    console.warn('[tagResolver] embedding search skipped:', err);
  }

  // Step 3: Create new concept + alias + tag
  const created = await createNewConcept(trimmed);
  return { type: 'new', ...created };
}

/**
 * Fetch a user's existing tag names for context-based disambiguation.
 * e.g. ["天主教", "教堂"] helps disambiguate "聖母" → Virgin Mary
 */
async function getUserTagNames(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('piktag_user_tags')
    .select('tag:piktag_tags(name)')
    .eq('user_id', userId);

  if (!data) return [];
  return data
    .map((ut: any) => ut.tag?.name)
    .filter(Boolean);
}

// ── Alias lookup ─────────────────────────────────────────────────────────────

/**
 * Find a tag by exact alias match (case-insensitive).
 * Returns the tag and its concept if found.
 */
export async function findByAlias(
  input: string
): Promise<{ tag: Tag; concept: TagConcept } | null> {
  // Look up alias → concept_id
  const { data: alias } = await supabase
    .from('tag_aliases')
    .select('concept_id')
    .ilike('alias', input)
    .limit(1)
    .single();

  if (!alias) return null;

  // Get the concept
  const { data: concept } = await supabase
    .from('tag_concepts')
    .select('*')
    .eq('id', alias.concept_id)
    .single();

  if (!concept) return null;

  // Get the primary tag for this concept
  const { data: tag } = await supabase
    .from('piktag_tags')
    .select('*')
    .eq('concept_id', alias.concept_id)
    .order('usage_count', { ascending: false })
    .limit(1)
    .single();

  if (!tag) return null;

  return { tag, concept };
}

// ── Embedding similarity ─────────────────────────────────────────────────────

/**
 * Generate embedding for text via Supabase Edge Function,
 * then search for similar concepts.
 *
 * Uses user's existing tags as context for disambiguation:
 * e.g. "聖母" alone is ambiguous, but "聖母 天主教 教堂" clearly means Virgin Mary
 */
export async function findSimilarByText(
  text: string,
  threshold = 0.65,
  maxResults = 5,
  contextTags: string[] = []
): Promise<SimilarConcept[]> {
  // Build contextual text: input + user's existing tags
  const contextText = contextTags.length > 0
    ? `${text} ${contextTags.join(' ')}`
    : text;

  // Generate embedding with context
  const embedding = await generateEmbedding(contextText);
  if (!embedding) return [];

  // Search similar concepts
  const { data, error } = await supabase.rpc('find_similar_concepts', {
    query_embedding: embedding,
    similarity_threshold: threshold,
    max_results: maxResults,
  });

  if (error) {
    console.warn('[tagResolver] find_similar_concepts error:', error);
    return [];
  }

  return data || [];
}

/**
 * Call Supabase Edge Function to generate text embedding.
 */
export async function generateEmbedding(
  text: string
): Promise<number[] | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const response = await fetch(
    `${supabaseUrl}/functions/v1/generate-embedding`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
    }
  );

  if (!response.ok) {
    console.warn('[tagResolver] generateEmbedding failed:', response.status);
    return null;
  }

  const result = await response.json();
  return result.embedding || null;
}

// ── Language detection ────────────────────────────────────────────────────────

/**
 * Simple heuristic to detect tag language from its characters.
 */
function detectLanguage(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text)) {
    // Distinguish simplified vs traditional Chinese
    // Common simplified-only chars: 项 们 认 动 应 etc.
    if (/[\u7b80\u4eec\u8ba4\u52a8\u5e94\u53d1\u8fc7\u8fd9\u4e2a\u6ca1\u5c06\u4ece\u7ecf\u8005\u7ba1\u7406]/.test(text)) {
      return 'zh-CN';
    }
    return 'zh-TW';
  }
  if (/[\u0900-\u097f]/.test(text)) return 'hi';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
  if (/[\u0980-\u09ff]/.test(text)) return 'bn';
  if (/[ğışçöüĞİŞÇÖÜ]/.test(text)) return 'tr';
  if (/[àáâãéêíóôõúüñ¿¡]/i.test(text)) return 'es';
  if (/[àâæçéèêëïîôœùûüÿ]/i.test(text)) return 'fr';
  if (/[äöüß]/i.test(text)) return 'de';
  if (/[ãõçáéíóú]/i.test(text)) return 'pt';
  // Indonesian uses Latin script, detected as 'id' if contains common Indonesian words
  return 'en';
}

// ── Create new concept ───────────────────────────────────────────────────────

/**
 * Create a new concept, alias, and tag for a brand-new term.
 */
async function createNewConcept(
  name: string
): Promise<{ tag: Tag; concept: TagConcept }> {
  const language = detectLanguage(name);

  // 1. Create concept
  const { data: concept, error: conceptError } = await supabase
    .from('tag_concepts')
    .insert({ canonical_name: name })
    .select('*')
    .single();

  if (conceptError || !concept) {
    throw new Error(`Failed to create concept: ${conceptError?.message}`);
  }

  // 2. Create alias with detected language
  await supabase
    .from('tag_aliases')
    .insert({ alias: name, concept_id: concept.id, language })
    .select()
    .single();

  // 3. Check if tag already exists (shouldn't, but be safe)
  const { data: existingTag } = await supabase
    .from('piktag_tags')
    .select('*')
    .eq('name', name)
    .single();

  if (existingTag) {
    // Link existing tag to new concept
    await supabase
      .from('piktag_tags')
      .update({ concept_id: concept.id })
      .eq('id', existingTag.id);
    return { tag: { ...existingTag, concept_id: concept.id }, concept };
  }

  // 4. Create new tag
  const { data: tag, error: tagError } = await supabase
    .from('piktag_tags')
    .insert({ name, concept_id: concept.id })
    .select('*')
    .single();

  if (tagError || !tag) {
    throw new Error(`Failed to create tag: ${tagError?.message}`);
  }

  // 5. Generate embedding in background (non-blocking)
  generateEmbedding(name).then(async (embedding) => {
    if (embedding) {
      await supabase
        .from('tag_concepts')
        .update({ embedding })
        .eq('id', concept.id);
    }
  });

  return { tag, concept };
}

// ── Alias management ─────────────────────────────────────────────────────────

/**
 * Add a new alias to an existing concept.
 */
export async function addAlias(
  alias: string,
  conceptId: string,
  language?: string
): Promise<void> {
  language = language || detectLanguage(alias);
  const { error } = await supabase
    .from('tag_aliases')
    .insert({ alias, concept_id: conceptId, language });

  if (error) {
    console.warn('[tagResolver] addAlias error:', error);
  }
}

/**
 * Accept a similar concept suggestion — link user's input as alias to existing concept.
 */
export async function acceptSuggestion(
  input: string,
  conceptId: string
): Promise<{ tag: Tag; concept: TagConcept } | null> {
  // Add input as alias
  await addAlias(input, conceptId);

  // Get the concept and its primary tag
  const { data: concept } = await supabase
    .from('tag_concepts')
    .select('*')
    .eq('id', conceptId)
    .single();

  if (!concept) return null;

  const { data: tag } = await supabase
    .from('piktag_tags')
    .select('*')
    .eq('concept_id', conceptId)
    .order('usage_count', { ascending: false })
    .limit(1)
    .single();

  if (!tag) return null;

  return { tag, concept };
}
