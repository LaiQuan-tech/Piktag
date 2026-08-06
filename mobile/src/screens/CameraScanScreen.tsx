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
import { X, QrCode as QrCodeIcon, ScanLine } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuthProfile } from '../context/AuthContext';
import { useAuth } from '../hooks/useAuth';
import { CACHE_KEYS, getPersistentCache, setPersistentCache } from '../lib/dataCache';
import { prewarmScanBusinessCard, startScanJob } from '../lib/scanCard';
import QrNameCard from '../components/QrNameCard';
import ScanSuccessStinger from '../components/stingers/ScanSuccessStinger';

type CameraScanScreenProps = {
  navigation: any;
};

// The viewer's own scannable card, exactly as QrNameCard renders it.
// Persisted per user id so a cold start with no signal can still put a
// complete QR in front of someone at an event.
type MyQrCard = { username: string; name: string; tags: string[] };

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
// Bigger frame (founder 2026-06-26): a small square forced you to hold a card
// far from the phone to fit it in — awkward, and fewer card pixels for OCR. A
// large frame lets the card fill the view at a natural distance. (The frame is
// only a visual guide; capture is the full camera image regardless.)
const SCAN_FRAME_SIZE = SCREEN_WIDTH * 0.82;

// ── Scanner strategy (founder 2026-06-24/25) ───────────────────────────────
// ORIGINAL plan was a shutter-less auto-detect loop: silently snap a frame
// every ~1.3s and OCR it to decide QR-vs-card. KILLED — `takePictureAsync`
// fires the iOS shutter SOUND every time (legally mandated + unmuteable in
// JP/KR and some regions), so an auto-capture loop machine-guns "click click
// click". Truly silent live OCR would need a camera-engine swap
// (react-native-vision-camera frame processors); not worth it pre-launch.
//
// New split, both on ONE screen, both silent-or-single-click:
//   • QR  → continuous, automatic. Barcode scanning makes NO sound. Point at
//           a PikTag QR and it connects instantly, zero taps.
//   • CARD → ONE deliberate "拍名片" tap = ONE capture (one normal shutter
//           click, like any camera photo) → EditLocalContact runs the full,
//           unchanged scanCard pipeline. A framed single shot is also better
//           quality than random auto-snaps (the recognition red line).

export default function CameraScanScreen({ navigation }: CameraScanScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  // Already-hydrated profile (disk-backed in AuthContext) — the offline
  // source for the "show my QR" card.
  const { profile: ctxProfile } = useAuthProfile();
  // Session user — available from the restored session before the
  // profile row lands, so the QR snapshot below is readable on the very
  // first offline cold start rather than one flip later.
  const { user: authUser } = useAuth();

  // 'scan' = camera (QR + card auto-detect); 'show' = display MY QR to be scanned.
  const [mode, setMode] = useState<'scan' | 'show'>('scan');

  const [scanned, setScanned] = useState(false);
  const [stingerVisible, setStingerVisible] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingScanNav | null>(null);
  const [stingerFriendName, setStingerFriendName] = useState<string | undefined>(undefined);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Card-capture state ──
  const lockedRef = useRef(false); // true once we've committed to a QR or card
  const [capturing, setCapturing] = useState(false); // single card shot in flight

  // ── "Show my QR" data (lazy-fetched the first time the user flips) ──
  const [myQr, setMyQr] = useState<MyQrCard | null>(null);

  useEffect(() => {
    // 2026-07-04 speed pass: warm the scan-business-card isolate as soon
    // as the unified scanner opens — the 拍名片 path pays no cold start.
    prewarmScanBusinessCard();
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
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

  // ─── Card: ONE deliberate capture on tap (no auto-loop → no shutter spam) ──
  const handleCaptureCard = useCallback(async () => {
    if (lockedRef.current || capturing || !cameraRef.current) return;
    lockedRef.current = true;       // blocks the QR handler during capture
    setCapturing(true);
    try {
      // A single, framed shot — quality over the throwaway 0.5 we used for
      // detection (this is the real image scanCard will OCR). One shutter
      // click here is normal/expected, unlike the killed auto-loop.
      const scanCapturedAt = Date.now(); // shutter moment for card_scan_latency
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (photo?.uri) {
        // Pipeline overlap (speed lever #3): kick the OCR→structuring job
        // NOW so it runs during the navigation + mount; EditLocalContact
        // claims it by uri instead of starting from zero.
        startScanJob({ uri: photo.uri, mimeType: 'image/jpeg' });
        // Replace the camera with the prefill form (Back from the form →
        // wherever the scanner was opened from).
        navigation.replace('EditLocalContact', {
          scanUri: photo.uri,
          scanMime: 'image/jpeg',
          scanCapturedAt,
        });
        return; // screen is unmounting; leave locked
      }
      // Capture returned nothing — re-arm so the user can retry.
      lockedRef.current = false;
      setCapturing(false);
    } catch {
      lockedRef.current = false;
      setCapturing(false);
    }
  }, [navigation, capturing]);

  // ─── Show-my-QR mode: lazy-load the viewer's handle + tags ────────────
  const flipToShow = useCallback(async () => {
    setMode('show');
    if (myQr) return;
    // Offline-first: paint from the profile AuthContext already holds.
    // That copy is disk-backed, so it survives a cold start with no
    // network — without this the card sat on a spinner forever at a venue,
    // which is the one moment showing your QR actually matters. It also
    // takes a round-trip out of a latency-critical flip.
    if (ctxProfile?.username) {
      setMyQr({
        username: ctxProfile.username,
        name: ctxProfile.full_name || ctxProfile.username,
        tags: [],
      });
    }
    // ...then upgrade to the last FULL card we rendered, which also has
    // the public tags. The AuthContext profile alone cannot supply those
    // (they live in piktag_user_tags), so offline the card used to show
    // a bare handle with no identity tags — technically scannable, but
    // it is the tags that make someone say "oh, you do that too". This
    // snapshot is written on every successful online flip below.
    const cachedCard = await getPersistentCache<MyQrCard>(
      CACHE_KEYS.MY_QR,
      ctxProfile?.id ?? authUser?.id ?? null,
    );
    if (cachedCard?.username) {
      // Upgrade only — if something on screen already carries tags, it is
      // at least as complete as the snapshot; leave it alone.
      setMyQr((prev) => (prev && prev.tags.length > 0 ? prev : cachedCard));
    }
    try {
      // `getUser()` is a NETWORK call; prefer the ids we already have —
      // the profile row, then the restored session (both local).
      const userId =
        ctxProfile?.id ??
        authUser?.id ??
        (await supabase.auth.getUser()).data?.user?.id ??
        null;
      if (!userId) return;
      const [{ data: prof }, { data: tagRows, error: tagsError }] = await Promise.all([
        supabase.from('piktag_profiles').select('username, full_name').eq('id', userId).single(),
        supabase
          .from('piktag_user_tags')
          .select('position, tag:piktag_tags!tag_id(name)')
          .eq('user_id', userId)
          .eq('is_private', false)
          .order('position', { ascending: true })
          .limit(6),
      ]);
      if (prof?.username) {
        const card: MyQrCard = {
          username: prof.username,
          name: prof.full_name || prof.username,
          // Already bounded by the .limit(6) above — the card shows at
          // most six identity tags, so that is exactly what we store.
          tags: (tagRows || []).map((r: any) => r.tag?.name).filter(Boolean),
        };
        if (tagsError) {
          // The two queries above are independent: on venue wifi the
          // profile row can land while the tag query fails. `tagRows`
          // is then null and `card.tags` is `[]` — writing THAT to a
          // cache with no TTL would permanently downgrade the offline
          // card to a bare handle, and the tags are the whole reason
          // this snapshot exists. Keep the tags already on screen (or
          // from the disk snapshot loaded above) and skip the write; the
          // next successful flip refreshes both. An empty result with NO
          // error is a real "this user has no public tags" and falls
          // through to the normal path below.
          setMyQr((prev) =>
            prev && prev.username === card.username && prev.tags.length > 0
              ? { ...card, tags: prev.tags }
              : card,
          );
        } else {
          setMyQr(card);
          void setPersistentCache(CACHE_KEYS.MY_QR, userId, card);
        }
      }
    } catch {
      // Non-fatal — the cached card above stays on screen.
    }
  }, [myQr, ctxProfile, authUser?.id]);

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

        {/* Instruction — QR is automatic; the shutter below captures a card.
            The hint carries the explanation, so the shutter needs no label
            (founder 2026-06-26). */}
        <View style={styles.instructionContainer}>
          <Text style={styles.instructionText}>
            {t('camera.scanOrCardHint', {
              defaultValue: '對準 QR 碼自動連結，或點下方按鈕辨識名片',
            })}
          </Text>
          {/* Camera shutter, with a brand-gradient ring (founder 2026-06-26:
              more brand colour on the scanner). White centre keeps it reading
              as a shutter; the gradient ring is the PikTag signature. */}
          <TouchableOpacity
            style={capturing && styles.shutterBusy}
            onPress={handleCaptureCard}
            disabled={capturing}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('camera.manualCardScan', { defaultValue: '拍名片' })}
          >
            <LinearGradient
              colors={['#ff5757', '#c44dff', '#8c52ff']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.shutterRing}
            >
              <View style={styles.shutterInner}>
                {capturing ? <ActivityIndicator size="small" color={'#111827'} /> : null}
              </View>
            </LinearGradient>
          </TouchableOpacity>
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

const CORNER_LENGTH = 34;
const CORNER_THICKNESS = 4;

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
    // Light dim, not a hard mask. This is a UNIFIED scanner — the square
    // corners read as a QR aim-hint, but a heavy mask boxed in the card
    // use-case (a card is landscape, not square — founder 2026-06-25 "正方
    // 形怪怪的"). A faint dim keeps the center subtly focused while leaving
    // room to frame a whole business card.
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    paddingBottom: 64,
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
  // Camera shutter for the card-capture action (QR is automatic, so this is
  // the only manual control). iOS-style: white ring + white inner circle with
  // a dark gap, so it reads as "take a photo".
  // Brand-gradient ring (fills the round); the white inner circle sits on top,
  // leaving a gradient ring — a PikTag-signature take on the camera shutter.
  shutterRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: {
    opacity: 0.55,
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
