// One-time coach-mark state, backed by AsyncStorage — mirrors the
// one-shot pattern in lib/phonePrompt.ts and lib/pushNotifications.ts
// (write a key once, never show again). Device-scoped, same as those:
// a user on a new device sees the hints again, which is acceptable.
//
// Each hint has a stable `hintId`. The stored key is namespaced +
// versioned so bumping the copy (v1 -> v2) can re-surface a hint if we
// ever need to. `dismiss()` hides it immediately and persists.
import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'piktag_coach_';
const VERSION = 'v1';

export const coachKey = (hintId: string): string => `${PREFIX}${hintId}_${VERSION}`;

// Small delay so the bubble fades in AFTER the screen's navigation
// transition settles, instead of popping mid-slide.
const SHOW_DELAY_MS = 450;

export function useCoachMark(hintId: string): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(coachKey(hintId));
        if (!alive || seen != null) return;
        timer.current = setTimeout(() => {
          if (alive) setVisible(true);
        }, SHOW_DELAY_MS);
      } catch {
        /* storage unavailable — just don't show the hint */
      }
    })();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hintId]);

  const dismiss = useCallback(() => {
    setVisible(false);
    AsyncStorage.setItem(coachKey(hintId), '1').catch(() => {});
  }, [hintId]);

  return { visible, dismiss };
}

// Dev/testing helper: clear every coach-mark seen flag so all hints
// re-appear on next launch. Not wired to any UI — call from a debug
// action or a temporary button while testing.
export async function resetAllCoachMarks(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    /* best-effort */
  }
}
