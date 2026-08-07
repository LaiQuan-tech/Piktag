import { useEffect, useRef } from 'react';
import { NETWORK_PAINT_DEADLINE_MS } from '../lib/netStatus';

/**
 * Kills the indefinite skeleton.
 *
 * While `waiting` is true a timer runs; if it expires before `waiting`
 * goes false, `onDeadline()` fires exactly once per waiting period. The
 * caller uses it to drop its loading flag and show an honest "couldn't
 * load / offline" surface instead of a skeleton that never resolves.
 *
 * This does NOT cancel anything. The in-flight request keeps running and
 * still paints if it eventually lands — this only stops the UI from
 * claiming that content is one moment away for ~25-50 seconds (see the
 * auth-refresh backoff explained in lib/netStatus.ts).
 *
 * `checkOffline()` handles the airplane-mode case up front; this covers
 * the one it cannot see — NetInfo says "connected" but the request is
 * doomed anyway (captive portal, associated-but-routing-nowhere venue
 * wifi, a refresh token the server will not honour).
 *
 * `onDeadline` is held in a ref, so callers do not have to memoise it.
 */
export function useLoadDeadline(
  waiting: boolean,
  onDeadline: () => void,
  ms: number = NETWORK_PAINT_DEADLINE_MS,
): void {
  const cbRef = useRef(onDeadline);
  cbRef.current = onDeadline;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      cbRef.current();
    }, ms);
    return () => clearTimeout(timer);
  }, [waiting, ms]);
}
