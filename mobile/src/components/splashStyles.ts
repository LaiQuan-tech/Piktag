import { StyleSheet } from 'react-native';

// Bloom diameter is logo (84) * 1.5 = 126; bumped to 130 to give a touch
// of breathing room before the scale-out makes it feel tight.
export const LOGO_SIZE = 84;
export const BLOOM_SIZE = 130;

export const splashStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  whiteCurtain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  bloom: {
    position: 'absolute',
    width: BLOOM_SIZE,
    height: BLOOM_SIZE,
    borderRadius: BLOOM_SIZE / 2,
    // piktag200 (#d580ff) — sits warmly over the gradient without
    // disappearing into either edge of the brand mix.
    backgroundColor: '#d580ff',
  },
  wordmark: {
    marginTop: 20,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#ffffff',
  },
  tagline: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
    opacity: 0.92,
    textAlign: 'center',
  },
  stillLoading: {
    marginTop: 40,
  },
});
