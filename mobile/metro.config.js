const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Modules that are native-only and therefore stubbed when bundling for
// web. On native platforms the real packages are used as-is.
const WEB_ONLY_STUBS = new Map([
  ['react-native-reanimated', path.resolve(__dirname, 'src/stubs/reanimated-stub.ts')],
  ['react-native-draggable-flatlist', path.resolve(__dirname, 'src/stubs/draggable-flatlist-stub.tsx')],
  ['expo-screen-capture', path.resolve(__dirname, 'src/stubs/empty-module.ts')],
  ['expo-camera', path.resolve(__dirname, 'src/stubs/empty-module.ts')],
  ['expo-haptics', path.resolve(__dirname, 'src/stubs/empty-module.ts')],
]);

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const stub = WEB_ONLY_STUBS.get(moduleName);
    if (stub) {
      return { filePath: stub, type: 'sourceFile' };
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
