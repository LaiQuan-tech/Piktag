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
      let header = String(format: "[%@#%ld] %@", domain, code, message)
      NSLog("[piktag][RCTFatal] %@", header)
      if let userInfo = nsError?.userInfo, !userInfo.isEmpty {
        NSLog("[piktag][RCTFatal] userInfo keys: %@", Array(userInfo.keys))
      }

      // Pull the JS stack frames out of userInfo. RN stores them under
      // "RCTJSStackTraceKey" (note: the key name includes the "Key" suffix;
      // defined in React/Base/RCTAssert.m).
      var stackLines: [String] = []
      if let stackArray = nsError?.userInfo["RCTJSStackTraceKey"] as? [[String: Any]] {
        for (i, frame) in stackArray.prefix(8).enumerated() {
          let methodName = frame["methodName"] as? String ?? "?"
          let file = frame["file"] as? String ?? "?"
          let lineNumber = frame["lineNumber"] as? Int ?? -1
          let column = frame["column"] as? Int ?? -1
          // Show just the final path component of file so it fits on screen.
          let shortFile = (file as NSString).lastPathComponent
          stackLines.append(String(format: "  %d. %@ @ %@:%d:%d", i, methodName, shortFile, lineNumber, column))
        }
      }
      // Also try the Obj-C call stack for non-JS native errors.
      if stackLines.isEmpty, let objcStack = nsError?.userInfo["RCTObjCStackTraceKey"] as? [String] {
        for (i, frame) in objcStack.prefix(6).enumerated() {
          stackLines.append(String(format: "  %d. %@", i, frame))
        }
      }
      for s in stackLines { NSLog("[piktag][RCTFatal]%@", s) }

      DispatchQueue.main.async {
        guard let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow })
                         ?? UIApplication.shared.windows.first else { return }

        // Compose the block for this error: header line + stack lines.
        var block = "• " + header
        for s in stackLines { block += "\\n" + s }

        // Auto-copy to clipboard on every new error so the user can just
        // paste into chat instead of trying to read a tiny on-screen label.
        let overlayTag = 999887
        let textView: UITextView
        if let existing = window.viewWithTag(overlayTag) as? UITextView {
          textView = existing
        } else {
          textView = UITextView()
          textView.tag = overlayTag
          textView.isEditable = false
          textView.isSelectable = true
          textView.isScrollEnabled = true
          textView.backgroundColor = UIColor.red.withAlphaComponent(0.95)
          textView.textColor = .white
          textView.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
          textView.textContainer.lineBreakMode = .byCharWrapping
          textView.translatesAutoresizingMaskIntoConstraints = false
          textView.layer.zPosition = 9999
          window.addSubview(textView)
          NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: window.safeAreaLayoutGuide.topAnchor, constant: 2),
            textView.leadingAnchor.constraint(equalTo: window.leadingAnchor, constant: 2),
            textView.trailingAnchor.constraint(equalTo: window.trailingAnchor, constant: -2),
            textView.heightAnchor.constraint(equalToConstant: 260),
          ])
        }

        let existingText = textView.text ?? ""
        if !existingText.contains(block) {
          let newText = existingText.isEmpty ? block : existingText + "\\n" + block
          textView.text = newText
          // Put the full error on the clipboard so the user can paste.
          UIPasteboard.general.string = newText
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
