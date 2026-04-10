import { registerRootComponent } from 'expo';

import App from './App';

// ---------------------------------------------------------------------------
// Global JS error handler (safety net)
// ---------------------------------------------------------------------------
// We have been chasing a series of iOS production crashes caused by native
// modules throwing NSException during startup. RN catches those via
// RCTModuleMethod's @try/@catch and reports them through RCTExceptionsManager,
// which in production escalates to RCTFatal → abort.
//
// While the ideal fix is to eliminate the source of every exception (we have
// been doing that one-by-one: expo-notifications lazy-load, Animated.loop
// replacement, StatusBar → expo-status-bar), we also want a catch-all so that
// any future startup JS error downgrades gracefully instead of killing the
// app on a tester's phone.
//
// Note: this only catches JS-side errors and unhandled promise rejections. It
// does NOT catch native NSExceptions — those still need to be prevented at
// the source. But it does stop JS-side throws from becoming fatal reports.
// ---------------------------------------------------------------------------
type RNErrorUtils = {
  getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | null;
  setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

const errorUtils: RNErrorUtils | undefined = (globalThis as any).ErrorUtils;
if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
  const defaultHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      console.warn(
        '[GlobalErrorHandler] caught error' + (isFatal ? ' (originally fatal)' : ''),
        error && (error.stack || error.message || String(error)),
      );
    } catch {}
    // Always forward to the default handler as non-fatal so the app stays up.
    if (defaultHandler) {
      try {
        defaultHandler(error, false);
      } catch {}
    }
  });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
