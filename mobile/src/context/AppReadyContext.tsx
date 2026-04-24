import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * Tracks when the app is ready to reveal to the user.
 *
 * "Ready" means:
 *   - auth state has resolved (session fetched from storage)
 *   - navigator has decided which stack to show (auth vs main vs onboarding)
 *
 * The `SplashOverlay` listens to `isReady` and fades out as soon as it
 * flips true (or the overlay's safety-net timeout fires first).
 *
 * Kept intentionally tiny — no hierarchy of loading reasons, no async
 * dependency graph. If we ever need that, reach for a state machine lib.
 */
type AppReadyContextValue = {
  isReady: boolean;
  /** Mark a single readiness gate as done. Idempotent per gate name. */
  markReady: (gate: string) => void;
};

const AppReadyContext = createContext<AppReadyContextValue>({
  isReady: false,
  markReady: () => {},
});

type Props = {
  /** Gate names that must all be marked ready before isReady flips true. */
  gates: readonly string[];
  children: React.ReactNode;
};

export function AppReadyProvider({ gates, children }: Props) {
  const [readyGates, setReadyGates] = useState<Set<string>>(() => new Set());
  // Stable ref to avoid re-renders triggering stale closures. We want
  // `markReady` to be a stable function identity so effects in consumer
  // components don't refire unnecessarily.
  const gatesRef = useRef(gates);
  gatesRef.current = gates;

  const markReady = useCallback((gate: string) => {
    setReadyGates((prev) => {
      if (prev.has(gate)) return prev;
      const next = new Set(prev);
      next.add(gate);
      return next;
    });
  }, []);

  const isReady = useMemo(() => {
    if (gates.length === 0) return true;
    return gates.every((g) => readyGates.has(g));
  }, [gates, readyGates]);

  const value = useMemo(() => ({ isReady, markReady }), [isReady, markReady]);

  return (
    <AppReadyContext.Provider value={value}>
      {children}
    </AppReadyContext.Provider>
  );
}

export function useAppReady(): AppReadyContextValue {
  return useContext(AppReadyContext);
}
