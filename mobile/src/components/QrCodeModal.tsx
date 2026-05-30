import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
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
  /** Public identity tags (names, no #) shown inside the card —
      mirrors how the Tag QR card shows its event tags. */
  tags?: string[];
};

// Same payload shape CameraScanScreen decodes. Kept here as a
// duplicate (small, stable) rather than extracted to a shared lib
// — refactor when a third caller appears.
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

// Personal-profile QR sheet — IG / LINE / Telegram model:
// one sheet, two modes (show my QR vs scan someone else's).
// 2026-05-30: founder asked for the "翻過來掃別人" affordance
// that every modern messenger app has. The sheet stays the
// same physical card; the centre block swaps between QR display
// and a live camera viewfinder with corner-frame overlay.
//
// Styled to match the Tag "present" card (QrGroupDetailScreen
// renderPresent / AddTagScreen renderQrMode): same red→purple
// gradient, white QR card, white pill actions. Every "show
// someone my QR / share me" surface in the app shares one
// flashy visual language.
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

  // 'show' = my QR (default, what tap-to-open lands on).
  // 'scan' = camera viewfinder, scan someone else's QR.
  const [mode, setMode] = useState<'show' | 'scan'>('show');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const reArmRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always re-open in 'show' mode — never trap a returning user
  // on the scan side. Also reset the scanned latch so the next
  // open is a fresh decode.
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
    // Switching tabs re-arms the scanner. Without this, after a
    // failed decode the latch would stay set when the user toggles
    // away and back.
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

  // Mirror of CameraScanScreen.parseUrlFormat — the canonical
  // pikt.ag/{username}?sid=… shape. When a third caller appears,
  // extract to src/lib/qrParser.ts.
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

  // Mirror of CameraScanScreen.decodeQrValue — the legacy base64
  // payload shape. Same caveat re: extraction.
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

      // URL format wins; falls through to legacy base64; invalid
      // → alert + 3s re-arm so the user can retry without
      // re-opening the modal.
      const urlResult = parseUrlFormat(result.data);
      if (urlResult) {
        onClose();
        // Tiny delay so the modal's close animation completes
        // before the next screen pushes — avoids a visual jolt.
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
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <QrModalStinger visible={visible}>
        <View style={styles.overlay}>
          <LinearGradient
            colors={['#ff5757', '#c44dff', '#8c52ff']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
          >
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color="#FFFFFF" />
            </TouchableOpacity>

            {/* IG-style segmented tab control. Two pill buttons,
                the active one filled white, the inactive translucent.
                Sits at the top of the gradient card, above the
                content swap. */}
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

            {!isScanMode ? (
              <>
                <View style={styles.cardWrap}>
                  <QrNameCard
                    qrValue={profileUrl}
                    handle={username}
                    name={fullName}
                    tags={tags}
                  />
                </View>

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
              </>
            ) : (
              <View style={styles.scanWrap}>
                {!permission ? (
                  <View style={styles.scanPlaceholder} />
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
                  <View style={styles.cameraBox}>
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
                    {/* Corner-bracket frame — softer than the full-
                        screen scanner's because the viewfinder here
                        is smaller. */}
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
          </LinearGradient>
        </View>
      </QrModalStinger>
    </Modal>
  );
}

const CORNER_LENGTH = 22;
const CORNER_THICKNESS = 3;

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      borderRadius: 24,
      paddingTop: 32,
      paddingBottom: 24,
      paddingHorizontal: 28,
      alignItems: 'center',
      width: '100%',
      maxWidth: 360,
      overflow: 'hidden',
    },
    closeBtn: {
      position: 'absolute',
      top: 14,
      right: 14,
      padding: 4,
      zIndex: 1,
    },
    // Tab row sits above the content, padding-tight to the close-X
    // sightline. Translucent track holds two equal pill cells; the
    // active one fills with white.
    tabsRow: {
      flexDirection: 'row',
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: 999,
      padding: 4,
      marginTop: 14,
      width: '100%',
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
    cardWrap: {
      marginTop: 18,
      marginBottom: 22,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      width: '100%',
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
    // Scan mode — preserves the same vertical space the QR card
    // takes up in show mode so the gradient sheet doesn't pop /
    // shrink between tab swaps.
    scanWrap: {
      width: '100%',
      marginTop: 18,
      alignItems: 'center',
    },
    cameraBox: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: '#000000',
      position: 'relative',
    },
    scanPlaceholder: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    permissionBox: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: 16,
      backgroundColor: 'rgba(255,255,255,0.95)',
      padding: 22,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    permissionText: {
      fontSize: 13,
      lineHeight: 19,
      color: '#374151',
      textAlign: 'center',
    },
    permissionBtn: {
      backgroundColor: '#111827',
      borderRadius: 12,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    permissionBtnText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    scanHint: {
      marginTop: 14,
      marginBottom: 4,
      fontSize: 12,
      color: 'rgba(255,255,255,0.9)',
      textAlign: 'center',
      fontWeight: '600',
    },
    corner: {
      position: 'absolute',
      width: CORNER_LENGTH,
      height: CORNER_LENGTH,
      borderColor: '#FFFFFF',
    },
    cornerTopLeft: {
      top: 10,
      left: 10,
      borderTopWidth: CORNER_THICKNESS,
      borderLeftWidth: CORNER_THICKNESS,
      borderTopLeftRadius: 6,
    },
    cornerTopRight: {
      top: 10,
      right: 10,
      borderTopWidth: CORNER_THICKNESS,
      borderRightWidth: CORNER_THICKNESS,
      borderTopRightRadius: 6,
    },
    cornerBottomLeft: {
      bottom: 10,
      left: 10,
      borderBottomWidth: CORNER_THICKNESS,
      borderLeftWidth: CORNER_THICKNESS,
      borderBottomLeftRadius: 6,
    },
    cornerBottomRight: {
      bottom: 10,
      right: 10,
      borderBottomWidth: CORNER_THICKNESS,
      borderRightWidth: CORNER_THICKNESS,
      borderBottomRightRadius: 6,
    },
  });
}
