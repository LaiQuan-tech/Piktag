// Expo config plugin: patch AppDelegate.swift to install a non-fatal
// RCTFatal handler.
//
// Why this exists
// ---------------
// We have been chasing a chain of production iOS launch crashes caused by
// native modules throwing NSException during startup (builds 14, 15, 16,
// 17, 18, 19). Each crash followed the same pattern:
//
//   RCTFatal (RCTAssert.m:147)
//   ← -[RCTExceptionsManager reportFatal:stack:...]
//   ← -[RCTExceptionsManager reportException:]
//   ← @catch inside -[RCTModuleMethod invokeWithBridge:module:arguments:]
//
// i.e. some native module's method threw, RN's @catch block converted the
// NSException into a fatal report, and RCTFatal called abort().
//
// The release-mode crash logs have been stripped of symbol information so
// we cannot identify *which* native module method is throwing without an
// enormous guess-and-check loop. Instead we take the surgical path: replace
// the default RCTFatal handler with one that logs the error and returns
// without killing the process. This converts every would-be crash into a
// warning, so the app can keep running, we can see the UI, and any
// remaining issues become debuggable from the JS side (errors will surface
// via console.warn and whatever UI feedback the user observes).
//
// The default RN fatal handler calls `abort()` in release builds. Setting
// a custom handler via `RCTSetFatalHandler` completely replaces that
// behavior. JS-side error reporting (ExceptionsManager / LogBox) is
// orthogonal and still works — we install this only to stop the process
// from being killed.

const { withAppDelegate } = require('@expo/config-plugins');

const IMPORT_LINE = 'import React';
const INSTALL_MARKER = '// [piktag] non-fatal RCTFatal handler installed';
const INSTALL_BLOCK = `
    ${INSTALL_MARKER}
    RCTSetFatalHandler { error in
      let nsError = error as NSError?
      let message = nsError?.localizedDescription ?? "unknown error"
      NSLog("[piktag][RCTFatal] %@", message)
      if let userInfo = nsError?.userInfo, !userInfo.isEmpty {
        NSLog("[piktag][RCTFatal] userInfo: %@", userInfo)
      }
      // Intentionally do NOT call abort(). Swallow the fatal so the app
      // keeps running; surviving with a logged warning is better than a
      // production launch crash.
    }
`;

module.exports = function withNonFatalRCTFatalHandler(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes(INSTALL_MARKER)) {
      // Already patched — idempotent.
      return config;
    }

    // Ensure `import React` is present (AppDelegate.swift in SDK 54 already
    // imports React, but guard against a future change).
    if (!contents.includes(IMPORT_LINE)) {
      contents = contents.replace(
        /(import Expo\n)/,
        `$1${IMPORT_LINE}\n`,
      );
    }

    // Insert the RCTSetFatalHandler call at the very start of
    // `application(_:didFinishLaunchingWithOptions:)`. SDK 54's generated
    // AppDelegate.swift has this signature:
    //
    //   public override func application(
    //     _ application: UIApplication,
    //     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    //   ) -> Bool {
    //     ...
    //
    // We anchor on the opening brace of that method and inject right after.
    const methodSignatureRegex = /(public override func application\([^)]*\)\s*->\s*Bool\s*\{)/;
    if (!methodSignatureRegex.test(contents)) {
      // Fallback: if the signature has changed in a future SDK, bail out
      // loudly so CI surfaces the problem instead of silently doing nothing.
      throw new Error(
        '[withNonFatalRCTFatalHandler] Could not find expected ' +
        'application(_:didFinishLaunchingWithOptions:) signature in ' +
        'AppDelegate.swift. Plugin needs updating.',
      );
    }

    contents = contents.replace(methodSignatureRegex, `$1\n${INSTALL_BLOCK}`);

    config.modResults.contents = contents;
    return config;
  });
};
