const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Modules that are stubbed on web because they rely on native code that
// isn't available there.
const WEB_ONLY_STUBS = new Set([
  'expo-screen-capture',
  'expo-camera',
  'expo-haptics',
]);

// react-native-reanimated and react-native-draggable-flatlist used to ship
// with the app, but reanimated's UIManager swizzling (REASwizzledUIManager)
// crashes on RN 0.81 + iOS 17 (NSException inside RCTUIManager.manageChildren,
// reported via RCTExceptionsManager → RCTFatal → abort). The packages have
// been uninstalled so the REASwizzledUIManager native code is no longer in
// the binary, and Metro redirects every JS import of them to our stubs
// below so the codebase still compiles.
const reanimatedStubPath = path.resolve(__dirname, 'src/stubs/reanimated-stub.ts');
const draggableFlatlistStubPath = path.resolve(__dirname, 'src/stubs/draggable-flatlist-stub.tsx');
const emptyStubPath = path.resolve(__dirname, 'src/stubs/empty-module.ts');

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-reanimated') {
    // react-native-gesture-handler detects whether reanimated is installed
    // by checking `Reanimated?.useSharedValue`. If that's truthy it takes
    // the worklet-based gesture path, which we can't support without the
    // real reanimated runtime. By giving gesture-handler an empty stub
    // (no useSharedValue export) we force it to fall back to the
    // JS-thread gesture callback path, which works fine for our usage.
    const caller = context.originModulePath || '';
    if (caller.includes('react-native-gesture-handler')) {
      return { filePath: emptyStubPath, type: 'sourceFile' };
    }
    return { filePath: reanimatedStubPath, type: 'sourceFile' };
  }
  if (moduleName === 'react-native-draggable-flatlist') {
    return { filePath: draggableFlatlistStubPath, type: 'sourceFile' };
  }
  if (platform === 'web' && WEB_ONLY_STUBS.has(moduleName)) {
    return { filePath: emptyStubPath, type: 'sourceFile' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
