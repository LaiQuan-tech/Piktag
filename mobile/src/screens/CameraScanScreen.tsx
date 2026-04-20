import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

type CameraScanScreenProps = {
  navigation: any;
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCAN_FRAME_SIZE = SCREEN_WIDTH * 0.65;

export default function CameraScanScreen({ navigation }: CameraScanScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, []);

  const decodeQrValue = useCallback((rawValue: string): PiktagQrPayload | null => {
    try {
      const decoded = decodeURIComponent(escape(atob(rawValue)));
      const payload = JSON.parse(decoded) as PiktagQrPayload;

      if (payload.type !== 'piktag_connect') {
        return null;
      }

      if (!payload.sid || !payload.uid || !payload.name) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }, []);

  /** Try to parse new URL format: https://pikt.ag/{username}?sid={sessionId} */
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
      if (scanned) return;
      setScanned(true);

      // Clear any pending timeout
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }

      // Try new URL format first: https://pikt.ag/{username}?sid=xxx
      const urlResult = parseUrlFormat(result.data);
      if (urlResult) {
        navigation.navigate('UserDetail', {
          username: urlResult.username,
          sid: urlResult.sid,
          tags: urlResult.tags,
          date: urlResult.date,
          loc: urlResult.loc,
        });
        scanTimeoutRef.current = setTimeout(() => setScanned(false), 3000);
        return;
      }

      // Try old base64 payload format (backward compat)
      const payload = decodeQrValue(result.data);
      if (payload) {
        navigation.navigate('ScanResult', {
          sessionId: payload.sid,
          hostUserId: payload.uid,
          hostName: payload.name,
          eventDate: payload.date,
          eventLocation: payload.loc,
          hostTags: payload.tags || [],
        });
        scanTimeoutRef.current = setTimeout(() => setScanned(false), 3000);
        return;
      }

      // Invalid QR
      Alert.alert(
        t('camera.invalidQr', { defaultValue: 'Invalid QR Code' }),
        t('camera.invalidQrMessage', {
          defaultValue: 'This QR code is not a valid PikTag connection code.',
        }),
      );
      scanTimeoutRef.current = setTimeout(() => setScanned(false), 3000);
    },
    [scanned, decodeQrValue, parseUrlFormat, navigation, t],
  );

  // Permission not yet determined
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

        {/* Close button */}
        <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
            activeOpacity={0.6}
          >
            <X size={24} color={COLORS.white} />
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
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={styles.permissionButtonText}>
              {t('camera.grantPermission', { defaultValue: 'Grant Permission' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Full-screen camera */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={handleBarcodeScanned}
      />

      {/* Overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Close button */}
        <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
            activeOpacity={0.6}
          >
            <X size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {/* Scan frame overlay */}
        <View style={styles.scanOverlay}>
          {/* Top dark area */}
          <View style={styles.overlayDark} />

          {/* Middle row: dark | clear frame | dark */}
          <View style={styles.middleRow}>
            <View style={styles.overlayDark} />

            {/* Clear scan frame with corner accents */}
            <View style={styles.scanFrame}>
              {/* Top-left corner */}
              <View style={[styles.corner, styles.cornerTopLeft]} />
              {/* Top-right corner */}
              <View style={[styles.corner, styles.cornerTopRight]} />
              {/* Bottom-left corner */}
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              {/* Bottom-right corner */}
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>

            <View style={styles.overlayDark} />
          </View>

          {/* Bottom dark area */}
          <View style={styles.overlayDark} />
        </View>

        {/* Instruction text */}
        <View style={styles.instructionContainer}>
          <Text style={styles.instructionText}>
            {t('camera.instruction', {
              defaultValue: 'Point your camera at a PikTag QR code',
            })}
          </Text>
        </View>
      </View>
    </View>
  );
}

const CORNER_LENGTH = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
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
    color: COLORS.white,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
