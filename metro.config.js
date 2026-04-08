const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// On web platform, replace native-only modules with empty stubs
// to prevent "Cannot access before initialization" TDZ errors
const NATIVE_ONLY_MODULES = [
  'react-native-draggable-flatlist',
  'expo-screen-capture',
  'expo-camera',
  'expo-haptics',
];

const stubPath = path.resolve(__dirname, 'src/stubs/empty-module.js');
const reanimatedStubPath = path.resolve(__dirname, 'src/stubs/reanimated-stub.js');

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    if (moduleName === 'react-native-reanimated') {
      return { filePath: reanimatedStubPath, type: 'sourceFile' };
    }
    if (NATIVE_ONLY_MODULES.includes(moduleName)) {
      return { filePath: stubPath, type: 'sourceFile' };
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
