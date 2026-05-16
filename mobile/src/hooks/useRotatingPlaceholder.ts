import { useEffect, useMemo, useState } from 'react';

// Rotating prompt-style placeholder.
//
// Extracted verbatim from SearchScreen's inline rotation so the
// search box and the "建立 Tag" context input (and any future
// intent-style input) share ONE calibrated implementation — no
// two copies of finely-tuned timing drifting apart.
//
// Rotation timing is calibrated PER PROMPT, not a global constant.
// CJK scripts (zh/ja/ko) pack ~3-4 chars/sec of comfortable
// reading; Latin scripts (en/es/fr/pt/ru) read at ~5-7 char/s;
// complex scripts (ar/bn/hi/th) sit in between but are often
// non-native and benefit from extra dwell time.
//
// A flat 3.5s burned bored CJK users while clipping mid-sentence
// on 35-char Spanish/Bengali prompts. Length-based scheduling
// balances both ends:
//   floor 3500ms — snappy for short CJK
//   + 130ms/char — scales up to ~5s for the longest prompts
//   (≈ 460 chars/min, comfortable non-native reading speed).
//
// setTimeout (not setInterval) is intentional: each prompt's dwell
// time is recomputed from its own length because promptIdx is an
// effect dep. We keep rotating even while the user has typed
// something (placeholder hidden) so they land on a fresh prompt
// when they clear the field, not the same stale one.
const PROMPT_ROTATION_MIN_MS = 3500;
const PROMPT_ROTATION_MS_PER_CHAR = 130;

/**
 * @param hints   Already-resolved prompt strings (caller does any
 *                interpolation like {{city}} BEFORE passing in),
 *                or null/empty to fall back.
 * @param fallback Shown when there are no hints.
 * @returns The current placeholder string to feed a TextInput.
 */
export function useRotatingPlaceholder(
  hints: string[] | null | undefined,
  fallback: string,
): string {
  const safeHints = useMemo(
    () => (Array.isArray(hints) && hints.length > 0 ? hints : null),
    [hints],
  );
  const [promptIdx, setPromptIdx] = useState(0);

  useEffect(() => {
    if (!safeHints) return;
    const current = safeHints[promptIdx % safeHints.length] ?? '';
    const delay = Math.max(
      PROMPT_ROTATION_MIN_MS,
      Math.ceil(current.length * PROMPT_ROTATION_MS_PER_CHAR),
    );
    const id = setTimeout(() => {
      setPromptIdx((i) => (i + 1) % safeHints.length);
    }, delay);
    return () => clearTimeout(id);
  }, [safeHints, promptIdx]);

  if (!safeHints) return fallback;
  // Modulo guard: a locale switch can shrink the array below a
  // stale promptIdx before the effect re-settles.
  return safeHints[promptIdx % safeHints.length] ?? fallback;
}
