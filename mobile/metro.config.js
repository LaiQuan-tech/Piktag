const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const NATIVE_ONLY_MODULES = [
  'react-native-draggable-flatlist',
  'expo-screen-capture',
  'expo-camera',
  'expo-haptics',
];

const stubPath = path.resolve(__dirname, 'src/stubs/empty-module.ts');
const reanimatedStubPath = path.resolve(__dirname, 'src/stubs/reanimated-stub.ts');

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
