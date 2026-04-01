import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import { X } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const isWeb = Platform.OS === 'web';

type FriendLocation = {
  id: string;
  connectionId: string;
  name: string;
  avatarUrl: string | null;
  latitude: number;
  longitude: number;
};

type FriendsMapModalProps = {
  visible: boolean;
  onClose: () => void;
  friends: FriendLocation[];
  onFriendPress: (connectionId: string, friendId: string) => void;
};

export type { FriendLocation };

export default function FriendsMapModal({
  visible,
  onClose,
  friends,
  onFriendPress,
}: FriendsMapModalProps) {
  const insets = useSafeAreaInsets();
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const friendsWithLocation = friends.filter(f => f.latitude && f.longitude);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);

    (async () => {
      try {
        if (isWeb && typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
              setLoading(false);
            },
            () => setLoading(false),
            { enableHighAccuracy: true, timeout: 8000 }
          );
        } else {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          }
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    })();
  }, [visible]);

  // Build Google Maps embed URL centered on user or first friend
  const getMapUrl = () => {
    const center = userCoords
      ? `${userCoords.lat},${userCoords.lng}`
      : friendsWithLocation.length > 0
        ? `${friendsWithLocation[0].latitude},${friendsWithLocation[0].longitude}`
        : '25.033,121.565';
    return `https://www.google.com/maps?q=${center}&z=13&output=embed`;
  };

  // Calculate positions for avatar overlays on the map
  // This is approximate — we overlay avatars on top of the embedded map
  const mapHeight = SCREEN_HEIGHT - insets.top - 56; // full height minus header

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} activeOpacity={0.6}>
            <X size={22} color={COLORS.gray800} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>好友地圖</Text>
          <View style={styles.headerBtn} />
        </View>

        {/* Map */}
        <View style={[styles.mapContainer, { height: mapHeight }]}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.piktag500} />
            </View>
          ) : isWeb ? (
            <View style={{ flex: 1 }}>
              {/* @ts-ignore */}
              <iframe
                src={getMapUrl()}
                style={{ width: '100%', height: '100%', border: 'none' }}
                loading="lazy"
              />
            </View>
          ) : (
            (() => {
              let WebView: any = null;
              try { WebView = require('react-native-webview').default; } catch {}
              if (!WebView) return (
                <View style={styles.loadingContainer}>
                  <Text style={{ color: COLORS.gray500 }}>地圖載入失敗</Text>
                </View>
              );
              return <WebView source={{ uri: getMapUrl() }} style={{ flex: 1 }} />;
            })()
          )}
        </View>

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  mapContainer: {
    width: SCREEN_WIDTH,
    overflow: 'hidden',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
