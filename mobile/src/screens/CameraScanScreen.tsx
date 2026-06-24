import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X, QrCode as QrCodeIcon, ScanLine, CreditCard } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import QrNameCard from '../components/QrNameCard';
import ScanSuccessStinger from '../components/stingers/ScanSuccessStinger';

type CameraScanScreenProps = {
  navigation: any;
};

type PendingScanNav =
  | { route: 'UserDetail'; params: Record<string, unknown> }
  | { route: 'ScanResult'; params: Record<string, unknown> };

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
const SCAN_FRAME_SIZE = SCREEN_WIDTH * 0.65;

// ── Card auto-detect tuning (founder 2026-06-24: no shutter — point at a
// QR OR a business card and the app figures out which). expo-camera can't
// OCR the live preview, so we periodically take a silent low-res frame and
// run ON-DEVICE OCR (free, no Gemini) purely to DETECT a card. Only when it
// clears the confidence gate do we hand the frame to EditLocalContact,
// which runs the full (unchanged) scanCard pipeline — so the recognition
// red line is untouched. ──────────────────────────────────────────────────
const AUTO_OCR_INTERVAL_MS = 1300;   // gap between silent detection frames
const CARD_MIN_CHARS = 24;           // total recognised text to even consider
const MANUAL_FALLBACK_AFTER = 3;     // misses before surfacing the 拍名片 button
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/;

/** Confidence gate: a real card almost always has an email or a phone
 *  number, plus a few text lines. Requiring one of those + multi-line text
 *  keeps us from OCR-ing random scenery into a junk contact. */
function looksLikeCard(fullText: string, blockCount: number): boolean {
  const text = (fullText || '').trim();
  if (text.length < CARD_MIN_CHARS) return false;
  const hasContact = EMAIL_RE.test(text) || PHONE_RE.test(text);
  return hasContact && blockCount >= 2;
}

export default function CameraScanScreen({ navigation }: CameraScanScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // 'scan' = camera (QR + card auto-detect); 'show' = display MY QR to be scanned.
  const [mode, setMode] = useState<'scan' | 'show'>('scan');

  const [scanned, setScanned] = useState(false);
  const [stingerVisible, setStingerVisible] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingScanNav | null>(null);
  const [stingerFriendName, setStingerFriendName] = useState<string | undefined>(undefined);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Card auto-detect state ──
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ocrBusyRef = useRef(false);
  const lockedRef = useRef(false); // true once we've committed to a QR or card
  const [missCount, setMissCount] = useState(0);

  // ── "Show my QR" data (lazy-fetched the first time the user flips) ──
  const [myQr, setMyQr] = useState<{ username: string; name: string; tags: string[] } | null>(null);

  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  // ─── QR decode helpers (unchanged) ───────────────────────────────────
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

  const parseUrlFormat = useCallback((rawValue: string): { username: string; sid?: string; tags?: string; date?: string; loc?: string } | null => {
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

  const handleBarcodeScanned = useCallback(
    (result: { data: string }) => {
      if (scanned || lockedRef.current) return;
      lockedRef.current = true;
      setScanned(true);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }

      const urlResult = parseUrlFormat(result.data);
      if (urlResult) {
        setStingerFriendName(undefined);
        setPendingNav({ route: 'UserDetail', params: { ...urlResult } });
        setStingerVisible(true);
        return;
      }

      const payload = decodeQrValue(result.data);
      if (payload) {
        setStingerFriendName(payload.name || undefined);
        setPendingNav({
          route: 'ScanResult',
          params: {
            sessionId: payload.sid,
            hostUserId: payload.uid,
            hostName: payload.name,
            eventDate: payload.date,
            eventLocation: payload.loc,
            hostTags: payload.tags || [],
          },
        });
        setStingerVisible(true);
        return;
      }

      // A non-PikTag QR is not an error in the unified scanner — the user
      // might just be pointing at a card. Re-arm and keep auto-detecting.
      lockedRef.current = false;
      scanTimeoutRef.current = setTimeout(() => setScanned(false), 1200);
    },
    [scanned, decodeQrValue, parseUrlFormat],
  );

  // ─── Card auto-detect loop (silent capture → on-device OCR → gate) ────
  const handoffCard = useCallback((uri: string) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    // Entry mode: replace the camera with the prefill form (Back from the
    // form → wherever the scanner was opened from, not the camera).
    // EditLocalContact runs the full scanCard pipeline on mount.
    navigation.replace('EditLocalContact', { scanUri: uri, scanMime: 'image/jpeg' });
  }, [navigation]);

  const runAutoTick = useCallback(async () => {
    if (lockedRef.current || ocrBusyRef.current || !cameraRef.current) {
      autoTimerRef.current = setTimeout(runAutoTick, AUTO_OCR_INTERVAL_MS);
      return;
    }
    ocrBusyRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        skipProcessing: true,
      });
      if (photo?.uri && !lockedRef.current) {
        const ocr = await TextRecognition.recognize(photo.uri);
        const fullText = ocr?.text ?? '';
        const blockCount = ocr?.blocks?.length ?? 0;
        if (looksLikeCard(fullText, blockCount)) {
          handoffCard(photo.uri);
          return; // locked; no re-schedule
        }
        setMissCount((n) => n + 1);
      }
    } catch {
      // Never let a capture/OCR hiccup kill the loop — just try the next tick.
    } finally {
      ocrBusyRef.current = false;
    }
    if (!lockedRef.current) {
      autoTimerRef.current = setTimeout(runAutoTick, AUTO_OCR_INTERVAL_MS);
    }
  }, [handoffCard]);

  // Start/stop the auto-detect loop with the scan mode + permission.
  useEffect(() => {
    const active = mode === 'scan' && permission?.granted && !stingerVisible;
    if (active && !autoTimerRef.current && !lockedRef.current) {
      autoTimerRef.current = setTimeout(runAutoTick, AUTO_OCR_INTERVAL_MS);
    }
    if (!active && autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    return () => {
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  }, [mode, permission?.granted, stingerVisible, runAutoTick]);

  // Manual fallback — the proven, deliberate-shutter CardCamera (tuned
  // crop + OCR). Surfaced after a few auto-misses so the user is never
  // stuck if auto-detect can't lock the card.
  const openManualCardScan = useCallback(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    lockedRef.current = true;
    navigation.replace('CardCamera', { forNewContact: true });
  }, [navigation]);

  // ─── Show-my-QR mode: lazy-load the viewer's handle + tags ────────────
  const flipToShow = useCallback(async () => {
    setMode('show');
    if (myQr) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: prof }, { data: tagRows }] = await Promise.all([
        supabase.from('piktag_profiles').select('username, full_name').eq('id', user.id).single(),
        supabase
          .from('piktag_user_tags')
          .select('position, tag:piktag_tags!tag_id(name)')
          .eq('user_id', user.id)
          .eq('is_private', false)
          .order('position', { ascending: true })
          .limit(6),
      ]);
      if (prof?.username) {
        setMyQr({
          username: prof.username,
          name: prof.full_name || prof.username,
          tags: (tagRows || []).map((r: any) => r.tag?.name).filter(Boolean),
        });
      }
    } catch {
      // Non-fatal — the show view falls back to a bare QR if the fetch fails.
    }
  }, [myQr]);

  const close = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Connections');
  }, [navigation]);

  // Permission not yet determined
  if (!permission) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={'#000000'} />
      </View>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={'#000000'} />
        <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={close} activeOpacity={0.6}>
            <X size={24} color={'#FFFFFF'} />
          </TouchableOpacity>
        </View>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>
            {t('camera.title', { defaultValue: 'Camera Access' })}
          </Text>
          <Text style={styles.permissionMessage}>
            {t('camera.permissionMessage', {
              defaultValue:
                'PikTag needs camera access to scan QR codes and connect with friends.',
            })}
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission} activeOpacity={0.8}>
            <Text style={styles.permissionButtonText}>
              {t('camera.grantPermission', { defaultValue: 'Grant Permission' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Show-my-QR view (be scanned) ────────────────────────────────────
  if (mode === 'show') {
    return (
      <LinearGradient
        colors={['#ff5757', '#c44dff', '#8c52ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.container}
      >
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <View style={[styles.headerOverlay, styles.headerRow, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={close} activeOpacity={0.6}>
            <X size={24} color={'#FFFFFF'} />
          </TouchableOpacity>
          {/* Flip back to scanning */}
          <TouchableOpacity style={styles.closeButton} onPress={() => setMode('scan')} activeOpacity={0.6}>
            <ScanLine size={22} color={'#FFFFFF'} />
          </TouchableOpacity>
        </View>
        <View style={styles.showCenter}>
          {myQr ? (
            <QrNameCard
              qrValue={`https://pikt.ag/${myQr.username}`}
              handle={myQr.username}
              name={myQr.name}
              tags={myQr.tags}
            />
          ) : (
            <ActivityIndicator color="#FFFFFF" />
          )}
          <Text style={styles.showHint}>
            {t('camera.showQrHint', { defaultValue: '讓對方掃這個 QR，立刻互加好友' })}
          </Text>
        </View>
      </LinearGradient>
    );
  }

  // ─── Scan view (QR + card auto-detect) ───────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle={'light-content'} backgroundColor="transparent" translucent />

      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        animateShutter={false}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={stingerVisible ? undefined : handleBarcodeScanned}
      />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Top bar: close (left) + flip-to-my-QR (right) */}
        <View style={[styles.headerOverlay, styles.headerRow, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={close} activeOpacity={0.6}>
            <X size={24} color={'#FFFFFF'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={flipToShow}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t('camera.showMyQr', { defaultValue: '顯示我的 QR' })}
          >
            <QrCodeIcon size={22} color={'#FFFFFF'} />
          </TouchableOpacity>
        </View>

        {/* Square frame — signals "this is a QR scanner" */}
        <View style={styles.scanOverlay}>
          <View style={styles.overlayDark} />
          <View style={styles.middleRow}>
            <View style={styles.overlayDark} />
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <View style={styles.overlayDark} />
          </View>
          <View style={styles.overlayDark} />
        </View>

        {/* Instruction — tells the user it does BOTH */}
        <View style={styles.instructionContainer}>
          <Text style={styles.instructionText}>
            {t('camera.scanOrCardHint', {
              defaultValue: '對準 QR 碼或名片，自動辨識',
            })}
          </Text>
          {/* Unobtrusive manual fallback — only after auto-detect has
              missed a few times, so the user is never stuck. Routes to the
              proven deliberate-shutter card camera. */}
          {missCount >= MANUAL_FALLBACK_AFTER && (
            <TouchableOpacity
              style={styles.manualBtn}
              onPress={openManualCardScan}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <CreditCard size={16} color={'#FFFFFF'} />
              <Text style={styles.manualBtnText}>
                {t('camera.manualCardScan', { defaultValue: '手動拍名片' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScanSuccessStinger
        visible={stingerVisible}
        friendName={stingerFriendName}
        onComplete={() => {
          setStingerVisible(false);
          const next = pendingNav;
          setPendingNav(null);
          setStingerFriendName(undefined);
          if (next) {
            navigation.replace(next.route, next.params);
          } else {
            lockedRef.current = false;
            setScanned(false);
          }
        }}
      />
    </View>
  );
}

const CORNER_LENGTH = 24;
const CORNER_THICKNESS = 3;

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
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
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionMessage: {
    fontSize: 16,
    color: c.gray400,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayDark: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  middleRow: {
    flexDirection: 'row',
    height: SCAN_FRAME_SIZE,
  },
  scanFrame: {
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE,
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: CORNER_LENGTH,
    height: CORNER_LENGTH,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopColor: c.piktag500,
    borderLeftColor: c.piktag500,
    borderTopLeftRadius: 4,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopColor: c.piktag500,
    borderRightColor: c.piktag500,
    borderTopRightRadius: 4,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomColor: c.piktag500,
    borderLeftColor: c.piktag500,
    borderBottomLeftRadius: 4,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomColor: c.piktag500,
    borderRightColor: c.piktag500,
    borderBottomRightRadius: 4,
  },
  instructionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 100,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  instructionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  manualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  manualBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // ── Show-my-QR view ──
  showCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  showHint: {
    marginTop: 22,
    fontSize: 14,
    color: 'rgba(255,255,255,0.95)',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  });
}
