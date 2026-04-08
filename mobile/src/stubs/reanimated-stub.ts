// Minimal web stub for react-native-reanimated
import { View, Text, ScrollView, FlatList } from 'react-native';

const noop = () => {};
const identity = (v: any) => v;
const useValue = (v: any) => ({ value: v });

const Reanimated = {
  createAnimatedComponent: (C: any) => C,
  View,
  Text,
  ScrollView,
  FlatList,
  addWhitelistedNativeProps: noop,
  addWhitelistedUIProps: noop,
};

export default Reanimated;
export const createAnimatedComponent = (C: any) => C;
export const useSharedValue = useValue;
export const useAnimatedStyle = () => ({});
export const useAnimatedScrollHandler = () => noop;
export const useDerivedValue = useValue;
export const useAnimatedRef = () => ({ current: null });
export const useAnimatedGestureHandler = () => ({});
export const useAnimatedProps = () => ({});
export const withSpring = identity;
export const withTiming = identity;
export const withSequence = (...args: any[]) => args[args.length - 1];
export const withDelay = (_: any, v: any) => v;
export const withRepeat = identity;
export const interpolate = identity;
export const Extrapolate = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
export const runOnJS = (fn: any) => fn;
export const runOnUI = (fn: any) => fn;
export const cancelAnimation = noop;
export const Easing = { linear: identity, ease: identity, bezier: () => identity, in: identity, out: identity, inOut: identity };
export const FadeIn = { duration: () => ({ delay: () => ({}) }) };
export const FadeOut = { duration: () => ({ delay: () => ({}) }) };
export const SlideInRight = {};
export const SlideOutRight = {};
export const Layout = {};
export const ZoomIn = {};
export const ZoomOut = {};
export const BounceIn = {};
export const ReduceMotion = { System: 0, Always: 1, Never: 2 };
export const measure = noop;
export const scrollTo = noop;
export const SharedTransition = { custom: () => ({}) };
export const EntryExitTransition = {};
