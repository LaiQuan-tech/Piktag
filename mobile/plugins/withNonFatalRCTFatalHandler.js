// Expo config plugin: patch AppDelegate.swift to install a non-fatal
// RCTFatal handler that also surfaces errors visibly on screen.
//
// Why this exists
// ---------------
// We have been chasing a chain of production iOS launch crashes caused
// by native modules throwing NSException during startup. Each crash
// followed this pattern:
//
//   RCTFatal (RCTAssert.m:147)
//   ← -[RCTExceptionsManager reportFatal:...]
//   ← -[RCTExceptionsManager reportException:]
//   ← @catch inside -[RCTModuleMethod invokeWithBridge:module:arguments:]
//
// Release-mode crash logs are symbol-stripped so we cannot identify
// WHICH native module is throwing. An earlier version of this plugin
// just swallowed the fatal (NSLog only) — that stopped the crash but
// left the app rendering a white screen, because the RN bridge ended
// up in an unusable partial-init state and we had no visibility into
// what had happened.
//
// This version adds a visible red overlay banner at the top of the
// UIWindow that appends every fatal error message as it arrives. The
// user can screenshot the overlay and send it back so we can apply a
// targeted fix, instead of playing guess-and-check with TestFlight
// builds.

const { withAppDelegate } = require('@expo/config-plugins');

const INSTALL_MARKER = '// [piktag] non-fatal RCTFatal handler installed';
const INSTALL_BLOCK = `
    ${INSTALL_MARKER}
    RCTSetFatalHandler { error in
      let nsError = error as NSError?
      let message = nsError?.localizedDescription ?? "unknown error"
      let domain = nsError?.domain ?? "?"
      let code = nsError?.code ?? 0
      let line = String(format: "[%@#%ld] %@", domain, code, message)
      NSLog("[piktag][RCTFatal] %@", line)
      if let userInfo = nsError?.userInfo, !userInfo.isEmpty {
        NSLog("[piktag][RCTFatal] userInfo: %@", userInfo)
      }

      DispatchQueue.main.async {
        guard let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow })
                         ?? UIApplication.shared.windows.first else { return }

        // Reuse a single overlay label across invocations so repeated
        // errors append instead of stacking views. The tag is an
        // arbitrary high number unlikely to collide with RN-created views.
        let overlayTag = 999887
        let label: UILabel
        if let existing = window.viewWithTag(overlayTag) as? UILabel {
          label = existing
        } else {
          label = UILabel()
          label.tag = overlayTag
          label.numberOfLines = 0
          label.lineBreakMode = .byWordWrapping
          label.backgroundColor = UIColor.red.withAlphaComponent(0.92)
          label.textColor = .white
          label.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
          label.textAlignment = .left
          label.translatesAutoresizingMaskIntoConstraints = false
          label.layer.zPosition = 9999
          label.isUserInteractionEnabled = false
          window.addSubview(label)
          NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: window.safeAreaLayoutGuide.topAnchor, constant: 4),
            label.leadingAnchor.constraint(equalTo: window.leadingAnchor, constant: 4),
            label.trailingAnchor.constraint(equalTo: window.trailingAnchor, constant: -4),
          ])
        }

        let prefix = "• "
        let newLine = prefix + line
        let existingText = label.text ?? ""
        if !existingText.contains(newLine) {
          label.text = existingText.isEmpty ? newLine : existingText + "\\n" + newLine
        }
      }

      // Intentionally do NOT call abort(). Swallow the fatal so the app
      // keeps running; surviving with an on-screen warning is better than
      // a production launch crash.
    }
`;

module.exports = function withNonFatalRCTFatalHandler(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes(INSTALL_MARKER)) {
      // Already patched — idempotent.
      return config;
    }

    // Anchor on the SDK 54 method signature. Throw loudly if it changes
    // in a future SDK so the failure is noticed instead of silent.
    const methodSignatureRegex = /(public override func application\([^)]*\)\s*->\s*Bool\s*\{)/;
    if (!methodSignatureRegex.test(contents)) {
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
