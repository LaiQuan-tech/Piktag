// CardCameraScreen.tsx
//
// Custom in-app camera for business-card capture. expo-image-picker's
// launchCameraAsync opens the OS camera with NO overlay — users shoot
// skewed / too-far / cluttered cards and OCR (scan-business-card →
// Gemini vision) suffers. This screen shows a card-aspect framing
// guide so the user fills the frame straight-on → materially better
// extraction. Modeled on CameraScanScreen (same expo-camera +
// useCameraPermissions + dimmed-surround overlay technique).
//
// Returns the photo to the caller via an onCaptured(base64, mimeType)
// callback param (the simple, contained idiom for a "scanner returns
// a value" flow — RN's non-serializable-param dev warning is benign
// for a transient capture). The caller owns the scan/timeout/prefill.
//
// Phase 1: advisory guide, full frame uploaded.
// Phase 2 (follow-up): crop to FRAME_* fractions before returning.
//
// Route params:
//   • onCaptured: (base64: string, mimeType: string) => void   (required)
//   • onManual?: () => void   — "或手動輸入": dismiss to the form
//   • onClose?: () => void    — X tapped, AFTER the camera pops
//                               itself. Create-contact flow uses it
//                               to also pop the form → back to 好友頁.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';

type Props = { navigation: any; route: any };

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// Phase 2 crop expands the mapped guide rect by this fraction on each
// side so small preview→sensor mapping error never slices the card.
// Over-including a little background is harmless to OCR; clipping the
// card is not.
const CROP_SAFETY_FRAC = 0.07;

// Business cards run ~1.5–1.75 landscape (85.6×54mm ≈ 1.586,
// US 3.5×2in = 1.75). 1.6 is a sane middle. The frame fractions are
// exported intent for Phase 2's crop (same rect → pixel mapping).
export const FRAME_WIDTH_FRAC = 0.88;
const FRAME_ASPECT = 1.6;
const FRAME_W = Math.round(SCREEN_WIDTH * FRAME_WIDTH_FRAC);
const FRAME_H = Math.round(FRAME_W / FRAME_ASPECT);
const CORNER_LENGTH = 26;
const CORNER_THICKNESS = 3;

// Phase 2: map the on-screen guide rect back to source-image pixels
// and crop to it. Returns cropped base64, or null on ANY uncertainty
// (orientation mismatch, degenerate rect, manipulate failure) so the
// caller falls back to the full frame — a wrong crop that clips the
// card is worse than no crop, so this fails safe.
async function cropToGuide(
  uri: string,
  pw: number,
  ph: number,
): Promise<string | null> {
  try {
    const portraitScreen = SCREEN_HEIGHT >= SCREEN_WIDTH;
    const portraitPhoto = ph >= pw;
    // Mapping assumes the captured photo's orientation matches the
    // (portrait) preview. If it doesn't, our cover-inverse math is
    // invalid → bail to full frame.
    if (portraitScreen !== portraitPhoto) return null;

    // CameraView preview is "cover": photo scaled to fill the screen,
    // center-cropped. Invert that to place the guide rect in source px.
    const scale = Math.max(SCREEN_WIDTH / pw, SCREEN_HEIGHT / ph);
    const marginX = (pw * scale - SCREEN_WIDTH) / 2;
    const marginY = (ph * scale - SCREEN_HEIGHT) / 2;
    const gx = (SCREEN_WIDTH - FRAME_W) / 2;
    const gy = (SCREEN_HEIGHT - FRAME_H) / 2;

    let originX = (gx + marginX) / scale;
    let originY = (gy + marginY) / scale;
    let cropW = FRAME_W / scale;
    let cropH = FRAME_H / scale;

    const mx = cropW * CROP_SAFETY_FRAC;
    const my = cropH * CROP_SAFETY_FRAC;
    originX -= mx;
    originY -= my;
    cropW += mx * 2;
    cropH += my * 2;

    originX = Math.max(0, Math.round(originX));
    originY = Math.max(0, Math.round(originY));
    cropW = Math.round(Math.min(cropW, pw - originX));
    cropH = Math.round(Math.min(cropH, ph - originY));
    if (cropW < 40 || cropH < 40) return null;

    const ctx = ImageManipulator.manipulate(uri);
    ctx.crop({ originX, originY, width: cropW, height: cropH });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({
      base64: true,
      compress: 0.6,
      format: SaveFormat.JPEG,
    });
    return out.base64 ?? null;
  } catch {
    return null;
  }
}

export default function CardCameraScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [capturing, setCapturing] = useState(false);
  // Synchronous re-entrancy guard: a fast double-tap on the shutter
  // can fire two takePictureAsync before `capturing` state flushes.
  const busyRef = useRef(false);

  // 3s auto-capture countdown (Option C — pragmatic, no native deps).
  // Starts once permission lands; ticks 3→2→1→0, fires handleShutter
  // at 0. Tapping the dimmed preview RESETs to 3 (gives the user
  // more time to align). Manual shutter press clears the countdown
  // and captures immediately. Cleared on close / goManual too.
  const COUNTDOWN_START = 3;
  const [countdown, setCountdown] = useState<number | null>(null);

  const onCaptured: ((b64: string, mime: string) => void) | undefined =
    route.params?.onCaptured;
  const onManual: (() => void) | undefined = route.params?.onManual;
  // Caller-supplied X/close handler. The auto-opened create-contact
  // flow passes one that ALSO pops EditLocalContact → back to 好友頁
  // (X = cancel the WHOLE add, not "show me the blank form"). Other
  // entries (e.g. the on-form re-scan button) omit it → plain
  // goBack = return to wherever the camera was opened from.
  const onClose: (() => void) | undefined = route.params?.onClose;

  const close = useCallback(() => {
    setCountdown(null);
    // goBack first (pop the camera) so the caller screen is focused
    // when onClose runs — mirrors the capture path's ordering.
    if (navigation.canGoBack()) navigation.goBack();
    onClose?.();
  }, [navigation, onClose]);

  // "或手動輸入" — bail to the form (caller focuses the name field).
  const goManual = useCallback(() => {
    setCountdown(null);
    onManual?.();
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation, onManual]);

  const handleShutter = useCallback(async () => {
    if (busyRef.current || !cameraRef.current) return;
    busyRef.current = true;
    setCountdown(null); // manual press cancels auto-countdown
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5, // small JPEG → faster upload + vision call
        base64: true, // full-frame fallback if the crop bails
        skipProcessing: false,
      });
      const fullB64 = photo?.base64 ?? null;
      // Phase 2: crop to the framing guide. Falls back to the full
      // frame on any uncertainty so it never does worse than Phase 1.
      let finalB64 = fullB64;
      if (photo?.uri && photo.width && photo.height) {
        const cropped = await cropToGuide(photo.uri, photo.width, photo.height);
        if (cropped) finalB64 = cropped;
      }
      if (!finalB64) {
        Alert.alert(
          t('common.error', { defaultValue: '錯誤' }),
          t('auth.onboarding.cardScanFailedMessage', {
            defaultValue: '名片沒有讀取成功，再試一次或手動填寫。',
          }),
        );
        busyRef.current = false;
        setCapturing(false);
        return;
      }
      // Hand the frame back to the caller's scan pipeline, then leave
      // the camera. goBack first so the caller is focused when its
      // scan spinner / alerts show.
      navigation.goBack();
      onCaptured?.(finalB64, 'image/jpeg');
    } catch (err: any) {
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        err?.message ||
          t('common.unknownError', { defaultValue: '發生錯誤' }),
      );
      busyRef.current = false;
      setCapturing(false);
    }
  }, [navigation, onCaptured, t]);

  // Auto-start the countdown once camera permission lands and we're
  // not already mid-capture. Runs ONCE per permission-grant cycle.
  useEffect(() => {
    if (permission?.granted && countdown === null && !capturing && !busyRef.current) {
      setCountdown(COUNTDOWN_START);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted]);

  // Tick. At 0, fire the shutter. setTimeout (vs setInterval) so each
  // tick is its own scheduled task — easier cleanup on unmount.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      handleShutter();
      return;
    }
    const id = setTimeout(() => {
      setCountdown((n) => (n === null ? null : n - 1));
    }, 1000);
    return () => clearTimeout(id);
  }, [countdown, handleShutter]);

  // Tap-anywhere-on-preview to reset the countdown back to 3. Gives
  // the user agency: if they're not ready, one tap buys 3 more
  // seconds. Refuses while capturing so a stray tap doesn't restart
  // a countdown after the shutter has already fired.
  const resetCountdown = useCallback(() => {
    if (capturing || busyRef.current) return;
    setCountdown(COUNTDOWN_START);
  }, [capturing]);

  // Permission still resolving
  if (!permission) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.black} />
      </View>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.black} />
        <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={close} activeOpacity={0.6}>
            <X size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>
            {t('camera.title', { defaultValue: '相機存取' })}
          </Text>
          <Text style={styles.permissionMessage}>
            {t('camera.permissionMessage', {
              defaultValue: 'PikTag 需要相機權限以拍攝名片',
            })}
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={styles.permissionButtonText}>
              {t('camera.grantPermission', { defaultValue: '授予權限' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Close */}
        <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={close} activeOpacity={0.6}>
            <X size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {/* Dimmed surround with a clear card-aspect window (same
            three-band technique as CameraScanScreen). Wrapped in a
            Pressable so a tap anywhere on the dimmed area RESETS the
            auto-capture countdown (gives the user 3 more seconds to
            align). Shutter / close / manual link are later siblings
            in the outer overlay → they sit on top in z-order and
            intercept their own taps first, so this catches the
            "blank space" taps cleanly. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={resetCountdown}>
          <View style={styles.overlayDark} />
          <View style={styles.middleRow}>
            <View style={styles.overlayDark} />
            <View style={styles.cardFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <View style={styles.overlayDark} />
          </View>
          <View style={styles.overlayDark} />
        </Pressable>

        {/* Hint / countdown. During countdown: show "{n}s 後自動拍 ·
            點畫面延長"; otherwise show the static alignment hint. */}
        <View style={styles.hintContainer} pointerEvents="none">
          <Text style={styles.hintText}>
            {countdown !== null && countdown > 0
              ? t('cardCamera.countdownHint', {
                  count: countdown,
                  defaultValue: '{{count}} 秒後自動拍 · 點畫面延長',
                })
              : t('camera.cardFrameHint', {
                  defaultValue: '把整張名片對齊框內、保持清晰',
                })}
          </Text>
        </View>

        {/* Shutter */}
        <View style={[styles.shutterBar, { paddingBottom: insets.bottom + 28 }]}>
          <TouchableOpacity
            style={styles.shutterOuter}
            onPress={handleShutter}
            disabled={capturing}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('localContact.scanCardCta', {
              defaultValue: '掃描名片自動帶入',
            })}
          >
            {capturing ? (
              <ActivityIndicator color={COLORS.piktag500} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </TouchableOpacity>
          {!capturing && (
            <TouchableOpacity
              onPress={goManual}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 20, right: 20 }}
              style={styles.manualLink}
              accessibilityRole="button"
              accessibilityLabel={t('localContact.manualEntry', { defaultValue: '或手動輸入' })}
            >
              <Text style={styles.manualLinkText}>
                {t('localContact.manualEntry', { defaultValue: '或手動輸入' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionMessage: {
    fontSize: 16,
    color: COLORS.gray400,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  overlayDark: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  middleRow: { flexDirection: 'row', height: FRAME_H },
  cardFrame: { width: FRAME_W, height: FRAME_H, backgroundColor: 'transparent' },
  corner: { position: 'absolute', width: CORNER_LENGTH, height: CORNER_LENGTH },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopColor: COLORS.piktag500,
    borderLeftColor: COLORS.piktag500,
    borderTopLeftRadius: 4,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopColor: COLORS.piktag500,
    borderRightColor: COLORS.piktag500,
    borderTopRightRadius: 4,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomColor: COLORS.piktag500,
    borderLeftColor: COLORS.piktag500,
    borderBottomLeftRadius: 4,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomColor: COLORS.piktag500,
    borderRightColor: COLORS.piktag500,
    borderBottomRightRadius: 4,
  },
  hintContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: FRAME_H / 2 + 20,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  hintText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  shutterBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  manualLink: { marginTop: 18, paddingVertical: 6, paddingHorizontal: 16 },
  manualLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
  },
});
