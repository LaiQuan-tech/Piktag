import { useEffect, useRef } from 'react';
import { useNetInfo } from './useNetInfo';

/**
 * Fires `onReconnect` exactly once per offline → online transition.
 *
 * Use this to wire up auto-refetch on screens that errored out while
 * offline: keep an `error` flag in your screen, and have the callback
 * re-run the fetch only if `error` is set. The hook itself is stateless
 * about *what* you want to refetch — it just signals the transition.
 *
 *   const [error, setError] = useState<Error | null>(null);
 *   useNetInfoReconnect(() => {
 *     if (error) {
 *       setError(null);
 *       fetchData();
 *     }
 *   });
 *
 * Implementation note: the initial mount is treated as `was-connected =
 * current state` so we don't fire a spurious reconnect on first render
 * just because `useNetInfo()` defaults to `true` before the first
 * NetInfo event arrives.
 */
export function useNetInfoReconnect(onReconnect: () => void): void {
  const { isConnected } = useNetInfo();
  const wasConnectedRef = useRef<boolean>(isConnected);
  // Keep the latest callback in a ref so consumers don't have to
  // memoise it with useCallback to avoid retriggering this effect.
  const callbackRef = useRef(onReconnect);
  useEffect(() => {
    callbackRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    if (!wasConnectedRef.current && isConnected) {
      try {
        callbackRef.current();
      } catch {
        // Swallow — caller's job to handle their own errors. We only
        // care about firing the signal.
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);
}
