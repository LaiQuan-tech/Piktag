/**
 * AI tag suggestion logger — North-Star principle #5 client side.
 *
 * Pairs with the piktag_ai_tag_suggestions table (migration
 * 20260529040000) and its two RPCs:
 *
 *   record_ai_tag_suggestions(source, tag_names[], context?)
 *     → uuid[]  // one id per suggestion, in submission order
 *
 *   mark_ai_tag_suggestion_accepted(id)
 *     → void   // idempotent
 *
 * Usage shape (AddTagScreen is the first caller):
 *
 *   const ids = await recordAiSuggestions('suggest_tags_rpc',
 *     suggestedTagNames, { contextDescription });
 *   // store ids alongside their tag_name for later acceptance lookup
 *
 *   // when the user taps a suggestion chip:
 *   const id = idMap.get(tappedName);
 *   if (id) void markAiSuggestionAccepted(id);
 *
 * Both calls are fire-and-forget — never let logging failure block
 * the actual product flow. Errors logged at warn level only.
 */
import { supabase } from './supabase';

export type AiSuggestionSource =
  | 'suggest_tags_rpc'
  | 'card_scan'
  | 'bio_extract'
  | 'connection_context';

/**
 * Record N suggestions shown to the user, in display order.
 * Returns the array of inserted ids (parallel to input tagNames),
 * empty array on failure / no-op.
 */
export async function recordAiSuggestions(
  source: AiSuggestionSource,
  tagNames: string[],
  context?: Record<string, unknown>,
): Promise<string[]> {
  if (!tagNames || tagNames.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc('record_ai_tag_suggestions', {
      p_source: source,
      p_tag_names: tagNames,
      p_context: context ?? null,
    });
    if (error) {
      // PGRST202 = function not yet deployed; tolerate silently so a
      // partially-rolled-out migration doesn't spam warns.
      const code = (error as { code?: string }).code;
      if (code !== 'PGRST202') {
        console.warn('[aiTagLogger] recordAiSuggestions failed:', error.message);
      }
      return [];
    }
    return Array.isArray(data) ? (data as string[]) : [];
  } catch (err) {
    console.warn('[aiTagLogger] recordAiSuggestions threw:', err);
    return [];
  }
}

/** Mark a previously-recorded suggestion as accepted. Idempotent. */
export async function markAiSuggestionAccepted(id: string): Promise<void> {
  if (!id) return;
  try {
    const { error } = await supabase.rpc('mark_ai_tag_suggestion_accepted', { p_id: id });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'PGRST202') {
        console.warn('[aiTagLogger] markAiSuggestionAccepted failed:', error.message);
      }
    }
  } catch (err) {
    console.warn('[aiTagLogger] markAiSuggestionAccepted threw:', err);
  }
}
