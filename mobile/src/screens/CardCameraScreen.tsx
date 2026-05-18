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

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';

type Props = { navigation: any; route: any };

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Business cards run ~1.5–1.75 landscape (85.6×54mm ≈ 1.586,
// US 3.5×2in = 1.75). 1.6 is a sane middle. The frame fractions are
// exported intent for Phase 2's crop (same rect → pixel mapping).
export const FRAME_WIDTH_FRAC = 0.88;
const FRAME_ASPECT = 1.6;
const FRAME_W = Math.round(SCREEN_WIDTH * FRAME_WIDTH_FRAC);
const FRAME_H = Math.round(FRAME_W / FRAME_ASPECT);
const CORNER_LENGTH = 26;
const CORNER_THICKNESS = 3;

export default function CardCameraScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [capturing, setCapturing] = useState(false);
  // Synchronous re-entrancy guard: a fast double-tap on the shutter
  // can fire two takePictureAsync before `capturing` state flushes.
  const busyRef = useRef(false);

  const onCaptured: ((b64: string, mime: string) => void) | undefined =
    route.params?.onCaptured;

  const close = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const handleShutter = useCallback(async () => {
    if (busyRef.current || !cameraRef.current) return;
    busyRef.current = true;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5, // small JPEG → faster upload + vision call
        base64: true,
        skipProcessing: false,
      });
      const b64 = photo?.base64;
      if (!b64) {
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
      onCaptured?.(b64, 'image/jpeg');
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
            three-band technique as CameraScanScreen). */}
        <View style={StyleSheet.absoluteFill}>
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
        </View>

        {/* Hint */}
        <View style={styles.hintContainer} pointerEvents="none">
          <Text style={styles.hintText}>
            {t('camera.cardFrameHint', {
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
