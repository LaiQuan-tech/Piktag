// Web stub for react-native-reanimated
// Provides minimal API surface so imports don't crash
const noop = () => {};
const identity = (v) => v;
const useValue = (v) => ({ value: v });
const useHandler = () => ({});
const FakeComponent = ({ children, style, ...props }) => {
  const React = require('react');
  const { View } = require('react-native');
  return React.createElement(View, { ...props, style }, children);
};

module.exports = {
  __esModule: true,
  default: {
    createAnimatedComponent: (Component) => Component,
    View: FakeComponent,
    Text: FakeComponent,
    ScrollView: FakeComponent,
    FlatList: FakeComponent,
    addWhitelistedNativeProps: noop,
    addWhitelistedUIProps: noop,
  },
  createAnimatedComponent: (Component) => Component,
  useSharedValue: useValue,
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: () => noop,
  useDerivedValue: useValue,
  useAnimatedRef: () => ({ current: null }),
  useAnimatedGestureHandler: () => ({}),
  withSpring: identity,
  withTiming: identity,
  withSequence: (...args) => args[args.length - 1],
  withDelay: (_, v) => v,
  withRepeat: identity,
  interpolate: identity,
  Extrapolate: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
  cancelAnimation: noop,
  Easing: { linear: identity, ease: identity, bezier: () => identity, in: identity, out: identity, inOut: identity },
  FadeIn: { duration: () => ({ delay: () => ({}) }) },
  FadeOut: { duration: () => ({ delay: () => ({}) }) },
  SlideInRight: {},
  SlideOutRight: {},
  Layout: {},
  ZoomIn: {},
  ZoomOut: {},
  BounceIn: {},
  ReduceMotion: { System: 0, Always: 1, Never: 2 },
};
