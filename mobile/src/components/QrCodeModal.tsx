import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Share2, Copy, ScanLine, QrCode as QrCodeIcon } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { setStringAsync } from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { APP_BASE_URL, shareProfile } from '../lib/shareProfile';
import QrModalStinger from './stingers/QrModalStinger';
import QrShareBody from './QrShareBody';

type QrCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  username: string;
  fullName: string;
  /** Public identity tags shown inside the QR card. */
  tags?: string[];
};

type PiktagQrPayload = {
  type: string;
  v: number;
  sid: string;
  uid: string;
  name: string;
  date: string;
  loc: string;
  tags: string[];
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCANNER_SIZE = Math.min(SCREEN_WIDTH - 64, 320);

// Personal-profile QR sheet — matches AddTagScreen.renderQrMode
// pattern for consistency with the activity (Tag) QR sheet.
// 2026-05-31 redesign after founder consistency check: the
// previous version used a segmented control to flip between
// "My QR" and "Scan", which read as foreign to the rest of the
// app. The activity QR sheet has an established pattern — full-
// bleed gradient, X top-left, ScanLine icon top-right, white
// card centred, action pills at the bottom — and that's the
// canonical visual language for "this is a QR-related sheet"
// in PikTag.
//
// Mode toggle now lives in the top-right icon:
//   show mode → ScanLine icon (tap = flip to scan)
//   scan mode → QrCode icon (tap = flip back to My QR)
// Same shell, in-place swap of the centre card + bottom row.
//
// Founder verbatim 2026-05-31: "你用 Segmented Control ui 很
// 奇怪... 可以學習我們目前活動 QR code 分享的介面嗎？這樣是
// 一致性，可能是切換".
export default function QrCodeModal({
  visible,
  onClose,
  username,
  fullName,
  tags,
}: QrCodeModalProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const profileUrl = `${APP_BASE_URL}/${username}`;

  const [mode, setMode] = useState<'show' | 'scan'>('show');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const reArmRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setMode('show');
      setScanned(false);
      if (reArmRef.current) {
        clearTimeout(reArmRef.current);
        reArmRef.current = null;
      }
    }
  }, [visible]);

  useEffect(() => {
    if (mode === 'show') {
      setScanned(false);
      if (reArmRef.current) {
        clearTimeout(reArmRef.current);
        reArmRef.current = null;
      }
    }
  }, [mode]);

  useEffect(() => () => {
    if (reArmRef.current) clearTimeout(reArmRef.current);
  }, []);

  const handleCopyLink = async () => {
    await setStringAsync(profileUrl);
  };

  const handleShare = async () => {
    await shareProfile({
      name: `${fullName} (@${username})`,
      username,
      t,
    });
  };

  const parseUrlFormat = useCallback((rawValue: string) => {
    try {
      const url = new URL(rawValue);
      if (url.hostname === 'pikt.ag' || url.hostname === 'www.pikt.ag') {
        const path = url.pathname.replace(/^\//, '');
        if (path && path !== 's') {
          return {
            username: path,
            sid: url.searchParams.get('sid') || undefined,
            tags: url.searchParams.get('tags') || undefined,
            date: url.searchParams.get('date') || undefined,
            loc: url.searchParams.get('loc') || undefined,
          };
        }
      }
    } catch { /* not a URL */ }
    return null;
  }, []);

  const decodeQrValue = useCallback((rawValue: string): PiktagQrPayload | null => {
    try {
      const decoded = decodeURIComponent(escape(atob(rawValue)));
      const payload = JSON.parse(decoded) as PiktagQrPayload;
      if (payload.type !== 'piktag_connect') return null;
      if (!payload.sid || !payload.uid || !payload.name) return null;
      return payload;
    } catch {
      return null;
    }
  }, []);

  const handleBarcodeScanned = useCallback(
    (result: { data: string }) => {
      if (scanned) return;
      setScanned(true);

      const urlResult = parseUrlFormat(result.data);
      if (urlResult) {
        onClose();
        setTimeout(() => {
          navigation.navigate('UserDetail', {
            username: urlResult.username,
            sid: urlResult.sid,
            tags: urlResult.tags,
            date: urlResult.date,
            loc: urlResult.loc,
          });
        }, 220);
        return;
      }

      const payload = decodeQrValue(result.data);
      if (payload) {
        onClose();
        setTimeout(() => {
          navigation.navigate('ScanResult', {
            sessionId: payload.sid,
            hostUserId: payload.uid,
            hostName: payload.name,
            eventDate: payload.date,
            eventLocation: payload.loc,
            hostTags: payload.tags || [],
          });
        }, 220);
        return;
      }

      Alert.alert(
        t('camera.invalidQr', { defaultValue: 'Invalid QR Code' }),
        t('camera.invalidQrMessage', {
          defaultValue: 'This QR code is not a valid PikTag connection code.',
        }),
      );
      reArmRef.current = setTimeout(() => setScanned(false), 3000);
    },
    [scanned, navigation, onClose, parseUrlFormat, decodeQrValue, t],
  );

  const isScanMode = mode === 'scan';
  const toggleMode = () => setMode(isScanMode ? 'show' : 'scan');

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <QrModalStinger visible={visible}>
        <LinearGradient
          colors={['#ff5757', '#c44dff', '#8c52ff']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <StatusBar
            barStyle={isDark ? 'light-content' : 'dark-content'}
            backgroundColor="transparent"
            translucent
          />

          {/* Top bar — verbatim mirror of AddTagScreen.renderQrMode:
              X on the left, scan/QR toggle on the right. Same
              paddingHorizontal, same paddingBottom, same icon sizes
              (26 / 24) so when both sheets sit next to each other in
              the user's memory they read as the same visual
              language. */}
          <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={onClose} activeOpacity={0.6} style={styles.topBtn}>
              <X size={26} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleMode} activeOpacity={0.6} style={styles.topBtn}>
              {isScanMode ? (
                <QrCodeIcon size={24} color="#fff" />
              ) : (
                <ScanLine size={24} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          {/* Show mode = the SHARED QrShareBody (card + bottom action
              pills). Scan mode keeps its own inline scaffolding because
              it needs the scanner inside cardWrap and a spacer in the
              bottom row with `minHeight: 90` to reserve the same
              vertical space as the pill row (so the layout doesn't
              visually jump when toggling mode). */}
          {!isScanMode ? (
            <QrShareBody
              qrValue={profileUrl}
              handle={username}
              name={fullName}
              tags={tags}
              actions={[
                {
                  icon: <Copy size={22} color="#111827" />,
                  label: t('profile.copyLink'),
                  onPress: handleCopyLink,
                },
                {
                  // Label unified to "分享檔案" across every QR-share
                  // sheet (was "分享" here) — same i18n key as the
                  // activity/group sheets so all 19 locales render
                  // identical text. Founder consistency call 2026-06-03:
                  // left = 複製連結, right = 分享檔案, everywhere.
                  icon: <Share2 size={22} color="#111827" />,
                  label: t('addTag.shareFile', { defaultValue: '分享檔案' }),
                  onPress: handleShare,
                },
              ]}
              bottomInset={insets.bottom}
            />
          ) : (
            <>
              <View style={styles.cardWrap}>
                {!permission ? (
                  <View style={styles.scannerBox} />
                ) : !permission.granted ? (
                  <View style={styles.permissionBox}>
                    <Text style={styles.permissionText}>
                      {t('camera.permissionMessage', {
                        defaultValue:
                          'PikTag needs camera access to scan QR codes and connect with friends.',
                      })}
                    </Text>
                    <TouchableOpacity
                      style={styles.permissionBtn}
                      onPress={requestPermission}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.permissionBtnText}>
                        {t('camera.grantPermission', {
                          defaultValue: 'Grant Permission',
                        })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <View style={styles.scannerBox}>
                      <CameraView
                        style={StyleSheet.absoluteFill}
                        facing="back"
                        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                        onBarcodeScanned={
                          visible && isScanMode && !scanned
                            ? handleBarcodeScanned
                            : undefined
                        }
                      />
                      <View style={[styles.corner, styles.cornerTopLeft]} />
                      <View style={[styles.corner, styles.cornerTopRight]} />
                      <View style={[styles.corner, styles.cornerBottomLeft]} />
                      <View style={[styles.corner, styles.cornerBottomRight]} />
                    </View>
                    <Text style={styles.scanHint}>
                      {t('camera.instruction', {
                        defaultValue: 'Point your camera at a PikTag QR code',
                      })}
                    </Text>
                  </>
                )}
              </View>
              {/* Scan-mode bottom spacer. minHeight:90 ≈ the natural
                  height of a pill row so the cardWrap (flex:1) gets
                  the same available space in both modes. Without it
                  the QR card would jump on toggle. */}
              <View
                style={[
                  styles.scanModeBottomSpacer,
                  { paddingBottom: insets.bottom + 20 },
                ]}
              />
            </>
          )}
        </LinearGradient>
      </QrModalStinger>
    </Modal>
  );
}

const CORNER_LENGTH = 28;
const CORNER_THICKNESS = 4;

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    gradient: {
      flex: 1,
    },
    // ── Top bar — mirrors AddTagScreen.qrTopBar / qrTopBtn ──
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    topBtn: {
      padding: 8,
    },
    // ── Centre wrap — mirrors AddTagScreen.qrCardWrap ──
    cardWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    // ── Scanner viewfinder (scan mode) ──
    scannerBox: {
      width: SCANNER_SIZE,
      height: SCANNER_SIZE,
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: '#000000',
      position: 'relative',
    },
    permissionBox: {
      width: SCANNER_SIZE,
      height: SCANNER_SIZE,
      borderRadius: 24,
      backgroundColor: 'rgba(255,255,255,0.95)',
      padding: 28,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    },
    permissionText: {
      fontSize: 14,
      lineHeight: 21,
      color: '#374151',
      textAlign: 'center',
    },
    permissionBtn: {
      backgroundColor: '#111827',
      borderRadius: 14,
      paddingHorizontal: 22,
      paddingVertical: 12,
    },
    permissionBtnText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
    scanHint: {
      marginTop: 22,
      fontSize: 14,
      color: 'rgba(255,255,255,0.95)',
      textAlign: 'center',
      fontWeight: '600',
    },
    // ── Scan-mode bottom spacer ──
    // The show-mode bottom row (pill buttons) lives in QrShareBody.
    // In scan mode we render this empty spacer instead so the
    // cardWrap (flex:1) gets the same available vertical space and
    // the QR card / scannerBox stay vertically pinned at the same
    // position across mode switches. The 90px is approximate but
    // matches the natural pill-row height closely enough that the
    // visual jump is imperceptible.
    scanModeBottomSpacer: {
      minHeight: 90,
    },
    // ── Scanner corner brackets ──
    corner: {
      position: 'absolute',
      width: CORNER_LENGTH,
      height: CORNER_LENGTH,
      borderColor: '#FFFFFF',
    },
    cornerTopLeft: {
      top: 12,
      left: 12,
      borderTopWidth: CORNER_THICKNESS,
      borderLeftWidth: CORNER_THICKNESS,
      borderTopLeftRadius: 8,
    },
    cornerTopRight: {
      top: 12,
      right: 12,
      borderTopWidth: CORNER_THICKNESS,
      borderRightWidth: CORNER_THICKNESS,
      borderTopRightRadius: 8,
    },
    cornerBottomLeft: {
      bottom: 12,
      left: 12,
      borderBottomWidth: CORNER_THICKNESS,
      borderLeftWidth: CORNER_THICKNESS,
      borderBottomLeftRadius: 8,
    },
    cornerBottomRight: {
      bottom: 12,
      right: 12,
      borderBottomWidth: CORNER_THICKNESS,
      borderRightWidth: CORNER_THICKNESS,
      borderBottomRightRadius: 8,
    },
  });
}
