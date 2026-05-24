import { StyleSheet } from 'react-native';

// Native splash (app.json → expo-splash-screen plugin) renders the logo
// at this exact width on a white background, centered on screen. The JS
// overlay must MATCH that geometry frame-for-frame at hand-off, otherwise
// the logo visually "jumps" when the native splash dismisses and the JS
// surface takes over.
//
// Key invariants this stylesheet enforces:
//   * Logo size IDENTICAL to app.json's `imageWidth` (84)
//   * Logo positioned at the EXACT screen center via absolute positioning
//     — NOT via a flex column that contains wordmark/tagline (those would
//     pull the logo upward off true center)
//   * Wordmark + tagline are positioned ABSOLUTELY below the logo so
//     their presence doesn't affect logo position
export const LOGO_SIZE = 84;
export const BLOOM_SIZE = 130;
// Vertical gap between the logo's bottom edge and the wordmark's top.
const LOGO_TO_WORDMARK_GAP = 20;

export const splashStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  whiteCurtain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
  },
  // Bloom + logo + image overlays all share this absolute-center recipe
  // so they stack on top of each other at the same point. Using `top: 50%`
  // with `marginTop: -size/2` (instead of flex centering) anchors them
  // to the EXACT screen center even when surrounding text is visible.
  logoCenter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    marginTop: -LOGO_SIZE / 2,
    marginLeft: -LOGO_SIZE / 2,
  },
  // Two Image siblings live inside logoCenter and absolutely fill it —
  // one is the raw colored asset (matches native splash visual), one is
  // the white-tinted version (readable on the gradient backdrop). The
  // white tint cross-fades in as the curtain fades out, so the user
  // never sees the logo blink between states.
  logoImage: {
    ...StyleSheet.absoluteFillObject,
  },
  bloom: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: BLOOM_SIZE,
    height: BLOOM_SIZE,
    marginTop: -BLOOM_SIZE / 2,
    marginLeft: -BLOOM_SIZE / 2,
    borderRadius: BLOOM_SIZE / 2,
    backgroundColor: '#d580ff',
  },
  // Wordmark + tagline column anchored just below the logo's bottom
  // edge. `top: 50%` puts the column origin at screen center; the
  // marginTop offset shifts it down to start below the logo. This keeps
  // them positioned consistently regardless of screen height.
  textBelow: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: LOGO_SIZE / 2 + LOGO_TO_WORDMARK_GAP,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  wordmark: {
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
    position: 'absolute',
    top: '50%',
    alignSelf: 'center',
    marginTop: LOGO_SIZE / 2 + 96,
  },
});
