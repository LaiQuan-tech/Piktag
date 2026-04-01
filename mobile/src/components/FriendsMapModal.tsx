import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Image,
  Platform,
  Dimensions,
} from 'react-native';
import { X, Navigation } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { GOOGLE_PLACES_API_KEY } from '../lib/googlePlaces';
import InitialsAvatar from './InitialsAvatar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
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
  const [selectedFriend, setSelectedFriend] = useState<FriendLocation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setSelectedFriend(null);

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

  // Build Google Maps embed URL with markers
  const mapUrl = useCallback(() => {
    if (!userCoords) return null;
    const center = `${userCoords.lat},${userCoords.lng}`;
    // Use Google Maps with multiple markers
    let url = `https://www.google.com/maps?q=${center}&z=13&output=embed`;
    return url;
  }, [userCoords]);

  // Build a static map with all friend markers
  const staticMapUrl = useCallback(() => {
    if (!userCoords && friends.length === 0) return null;
    const center = userCoords
      ? `${userCoords.lat},${userCoords.lng}`
      : `${friends[0]?.latitude},${friends[0]?.longitude}`;

    let markers = '';
    // User marker (blue)
    if (userCoords) {
      markers += `&markers=color:blue%7Clabel:Me%7C${userCoords.lat},${userCoords.lng}`;
    }
    // Friend markers (red, labeled A-Z)
    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    friends.slice(0, 26).forEach((f, i) => {
      markers += `&markers=color:red%7Clabel:${labels[i]}%7C${f.latitude},${f.longitude}`;
    });

    const width = Math.min(Math.round(SCREEN_WIDTH), 640);
    return `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=12&size=${width}x500&scale=2${markers}&key=${GOOGLE_PLACES_API_KEY}`;
  }, [userCoords, friends]);

  const friendsWithLocation = friends.filter(f => f.latitude && f.longitude);
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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
        <View style={styles.mapContainer}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.piktag500} />
            </View>
          ) : isWeb ? (
            <View style={{ flex: 1, position: 'relative' }}>
              {/* @ts-ignore */}
              <iframe
                src={mapUrl() || ''}
                style={{ width: '100%', height: '100%', border: 'none' }}
                loading="lazy"
              />
              {/* Overlay friend markers as absolute positioned dots */}
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
              return <WebView source={{ uri: mapUrl() || '' }} style={{ flex: 1 }} />;
            })()
          )}
        </View>

        {/* Friend list with location labels */}
        <View style={styles.friendList}>
          <Text style={styles.friendListTitle}>
            {friendsWithLocation.length} 位好友有位置資訊
          </Text>
          {friendsWithLocation.slice(0, 26).map((f, i) => (
            <TouchableOpacity
              key={f.id}
              style={[styles.friendItem, selectedFriend?.id === f.id && styles.friendItemSelected]}
              activeOpacity={0.7}
              onPress={() => {
                setSelectedFriend(f);
                onFriendPress(f.connectionId, f.id);
              }}
            >
              <View style={styles.friendMarkerLabel}>
                <Text style={styles.friendMarkerText}>{labels[i]}</Text>
              </View>
              {f.avatarUrl ? (
                <Image source={{ uri: f.avatarUrl }} style={styles.friendAvatar} />
              ) : (
                <InitialsAvatar name={f.name} size={36} />
              )}
              <Text style={styles.friendName} numberOfLines={1}>{f.name}</Text>
            </TouchableOpacity>
          ))}
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
    flex: 1,
    minHeight: 300,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendList: {
    maxHeight: 250,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
    paddingVertical: 8,
  },
  friendListTitle: {
    fontSize: 13,
    color: COLORS.gray500,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  friendItemSelected: {
    backgroundColor: COLORS.piktag50,
  },
  friendMarkerLabel: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ff3b30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendMarkerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  friendName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gray800,
  },
});
