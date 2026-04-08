'use strict';

// Minimal web stub for react-native-reanimated
const noop = () => {};
const identity = (v) => v;
const useValue = (v) => ({ value: v });

const Reanimated = {
  createAnimatedComponent: (C) => C,
  View: require('react-native').View,
  Text: require('react-native').Text,
  ScrollView: require('react-native').ScrollView,
  FlatList: require('react-native').FlatList,
  addWhitelistedNativeProps: noop,
  addWhitelistedUIProps: noop,
};

// Named exports
exports.default = Reanimated;
exports.useSharedValue = useValue;
exports.useAnimatedStyle = () => ({});
exports.useAnimatedScrollHandler = () => noop;
exports.useDerivedValue = useValue;
exports.useAnimatedRef = () => ({ current: null });
exports.useAnimatedGestureHandler = () => ({});
exports.useAnimatedProps = () => ({});
exports.withSpring = identity;
exports.withTiming = identity;
exports.withSequence = (...args) => args[args.length - 1];
exports.withDelay = (_, v) => v;
exports.withRepeat = identity;
exports.interpolate = identity;
exports.Extrapolate = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
exports.Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
exports.runOnJS = (fn) => fn;
exports.runOnUI = (fn) => fn;
exports.cancelAnimation = noop;
exports.createAnimatedComponent = (C) => C;
exports.Easing = { linear: identity, ease: identity, bezier: () => identity, in: identity, out: identity, inOut: identity };
exports.FadeIn = { duration: () => ({ delay: () => ({}) }) };
exports.FadeOut = { duration: () => ({ delay: () => ({}) }) };
exports.SlideInRight = {};
exports.SlideOutRight = {};
exports.Layout = {};
exports.ZoomIn = {};
exports.ZoomOut = {};
exports.BounceIn = {};
exports.ReduceMotion = { System: 0, Always: 1, Never: 2 };
exports.measure = noop;
exports.scrollTo = noop;
exports.SharedTransition = { custom: () => ({}) };
exports.EntryExitTransition = {};
