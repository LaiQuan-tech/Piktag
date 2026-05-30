import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Copy, Share2 } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { setStringAsync } from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { APP_BASE_URL, shareProfile } from '../lib/shareProfile';
import QrModalStinger from './stingers/QrModalStinger';
import QrNameCard from './QrNameCard';

type QrCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  username: string;
  fullName: string;
  /** Public identity tags shown inside the My-QR card. */
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

// Personal-profile QR sheet — IG / LINE / Telegram model.
// 2026-05-30 redesign (founder consistency check): the previous
// version of this modal was a centered card while the existing
// full-screen CameraScanScreen had a totally different layout.
// Same product feature, three different visual languages — the
// kind of per-surface drift CLAUDE.md "Shared UI = ONE shared
// component" explicitly warns against.
//
// New layout matches IG's profile-QR sheet:
//   * Full-bleed gradient covers the whole screen.
//   * Top bar: centered segmented tab control (My QR / Scan),
//     close X to the right.
//   * Content area fills the middle — QrNameCard at near-card
//     width when 我的, or a large scanner viewfinder at the same
//     dimensions when 掃描. Sizes match so the tab swap doesn't
//     pop / shrink.
//   * Bottom: Copy / Share pills (My QR mode only).
//
// The full-screen CameraScanScreen still exists (tab-bar entry
// point keeps a dedicated scanner experience), but the SCAN
// surface inside this modal is now visually identical to it —
// same gradient, same corner-bracket frame, same hint copy.
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
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {/* Top bar: tabs centered, close X anchored right.
              The tabs row sits in the flex flow; the close button
              is absolute so the tabs read as the visual anchor. */}
          <View style={styles.topBar}>
            <View style={styles.tabsRow}>
              <TouchableOpacity
                style={[styles.tab, !isScanMode && styles.tabActive]}
                onPress={() => setMode('show')}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.tabText, !isScanMode && styles.tabTextActive]}
                >
                  {t('profile.qrTabMine', { defaultValue: 'My QR' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, isScanMode && styles.tabActive]}
                onPress={() => setMode('scan')}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.tabText, isScanMode && styles.tabTextActive]}
                >
                  {t('profile.qrTabScan', { defaultValue: 'Scan' })}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Content area — flex 1 so the QR card or scanner
              centers vertically between the top bar and the
              bottom actions. */}
          <View style={styles.contentArea}>
            {!isScanMode ? (
              <View style={styles.cardWrap}>
                <QrNameCard
                  qrValue={profileUrl}
                  handle={username}
                  name={fullName}
                  tags={tags}
                />
              </View>
            ) : (
              <View style={styles.scanWrap}>
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
                )}
                <Text style={styles.scanHint}>
                  {t('camera.instruction', {
                    defaultValue: 'Point your camera at a PikTag QR code',
                  })}
                </Text>
              </View>
            )}
          </View>

          {/* Bottom actions — Copy / Share. Only meaningful in
              My-QR mode; in Scan mode the scanner doesn't have a
              "Share what?" affordance, so the row hides. We
              reserve the same vertical space either way so the
              modal doesn't visually jump on tab swap. */}
          <View style={styles.actionsArea}>
            {!isScanMode && (
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleCopyLink}
                  activeOpacity={0.7}
                >
                  <Copy size={20} color={'#111827'} />
                  <Text style={styles.actionBtnText}>
                    {t('profile.copyLink')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleShare}
                  activeOpacity={0.7}
                >
                  <Share2 size={20} color={'#111827'} />
                  <Text style={styles.actionBtnText}>
                    {t('profile.share')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </SafeAreaView>
      </QrModalStinger>
    </Modal>
  );
}

const CORNER_LENGTH = 32;
const CORNER_THICKNESS = 4;
const SCANNER_SIZE = SCREEN_WIDTH * 0.78;

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    safe: {
      flex: 1,
    },
    topBar: {
      paddingHorizontal: 20,
      paddingTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      height: 56,
    },
    tabsRow: {
      flexDirection: 'row',
      backgroundColor: 'rgba(255,255,255,0.22)',
      borderRadius: 999,
      padding: 4,
      width: 240,
    },
    tab: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: {
      backgroundColor: '#FFFFFF',
    },
    tabText: {
      fontSize: 14,
      fontWeight: '700',
      color: 'rgba(255,255,255,0.85)',
    },
    tabTextActive: {
      color: '#111827',
    },
    closeBtn: {
      position: 'absolute',
      right: 20,
      top: 16,
      padding: 4,
    },
    contentArea: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    cardWrap: {
      width: '100%',
      maxWidth: 360,
    },
    scanWrap: {
      alignItems: 'center',
      width: '100%',
    },
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
    actionsArea: {
      minHeight: 72,
      paddingHorizontal: 24,
      paddingBottom: 8,
      justifyContent: 'center',
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      width: '100%',
      maxWidth: 360,
      alignSelf: 'center',
    },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FFFFFF',
      borderRadius: 14,
      paddingVertical: 15,
      gap: 8,
    },
    actionBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#111827',
    },
    corner: {
      position: 'absolute',
      width: CORNER_LENGTH,
      height: CORNER_LENGTH,
      borderColor: '#FFFFFF',
    },
    cornerTopLeft: {
      top: 14,
      left: 14,
      borderTopWidth: CORNER_THICKNESS,
      borderLeftWidth: CORNER_THICKNESS,
      borderTopLeftRadius: 8,
    },
    cornerTopRight: {
      top: 14,
      right: 14,
      borderTopWidth: CORNER_THICKNESS,
      borderRightWidth: CORNER_THICKNESS,
      borderTopRightRadius: 8,
    },
    cornerBottomLeft: {
      bottom: 14,
      left: 14,
      borderBottomWidth: CORNER_THICKNESS,
      borderLeftWidth: CORNER_THICKNESS,
      borderBottomLeftRadius: 8,
    },
    cornerBottomRight: {
      bottom: 14,
      right: 14,
      borderBottomWidth: CORNER_THICKNESS,
      borderRightWidth: CORNER_THICKNESS,
      borderBottomRightRadius: 8,
    },
  });
}
