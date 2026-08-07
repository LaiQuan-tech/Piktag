/**
 * Icebreaker generator client.
 *
 * Calls the generate-icebreaker edge function (Gemini-backed) which
 * returns 2-3 context-aware first-message suggestions for the
 * sender to use when opening (or re-opening) a chat. See the edge
 * function header for the why-this-exists narrative.
 *
 * Fire-and-forget shape: caller awaits a Promise<string[]>, but never
 * lets a failure block the chat. A returned empty array means the
 * UI should fall back to "type your own."
 */
import i18n from '../i18n';
import { supabase } from './supabase';
import { checkOffline, NETWORK_PAINT_DEADLINE_MS } from './netStatus';

export type IcebreakerInput = {
  /** The friend / contact you're chatting with. */
  recipientId: string;
  /** Optional — when the chat is opened from an Ask match, the
   *  Ask provides the strongest single anchor for the prompt. */
  askId?: string | null;
};

/** Best-effort: returns at most 3 short message suggestions. */
export async function generateIcebreakers(input: IcebreakerInput): Promise<string[]> {
  // An edge-function invoke is still a supabase-js call, so offline it
  // sits through the ~25s auth-refresh backoff (lib/netStatus.ts) before
  // failing. The caller shows a spinner for that whole window for a
  // suggestion that cannot arrive. "No suggestions" is the documented
  // empty answer, so return it immediately.
  if (await checkOffline()) return [];
  try {
    const invocation = supabase.functions.invoke<{ suggestions: string[] }>(
      'generate-icebreaker',
      {
        body: {
          recipient_id: input.recipientId,
          ask_id: input.askId ?? null,
          // The server uses this only to choose the output language.
          // Default i18n.language is the user's selected app language
          // (e.g. 'en', 'zh-TW') — pass it through verbatim.
          lang: i18n.language || 'English',
        },
      },
    );
    // The case checkOffline cannot see: NetInfo reports a connection but
    // the request is doomed anyway (captive portal, dead venue wifi).
    // The invoke is never cancelled — a late answer is simply ignored —
    // we just stop holding a spinner open for it. Icebreakers are a
    // nicety; the composer works without them.
    const TIMED_OUT = Symbol('timeout');
    const raced = await Promise.race([
      invocation,
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), NETWORK_PAINT_DEADLINE_MS),
      ),
    ]);
    if (raced === TIMED_OUT) {
      console.warn('[icebreaker] generate timed out');
      return [];
    }
    const { data, error } = raced;
    if (error) {
      console.warn('[icebreaker] generate failed:', error.message);
      return [];
    }
    const out = Array.isArray(data?.suggestions) ? data!.suggestions : [];
    return out.filter((s) => typeof s === 'string' && s.trim().length > 0).slice(0, 3);
  } catch (err) {
    console.warn('[icebreaker] threw:', err);
    return [];
  }
}
