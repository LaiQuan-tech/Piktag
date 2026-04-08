const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Only stub truly native-only modules (no web implementation at all)
const NATIVE_ONLY_MODULES = [
  'react-native-draggable-flatlist',
  'expo-screen-capture',
  'expo-camera',
  'expo-haptics',
];

const stubPath = path.resolve(__dirname, 'src/stubs/empty-module.ts');

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && NATIVE_ONLY_MODULES.includes(moduleName)) {
    return { filePath: stubPath, type: 'sourceFile' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
