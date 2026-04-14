import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Platform,
} from 'react-native';
import { X, Search, MapPin, Navigation, ChevronUp, ChevronDown } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { fetchNearbyPlaces, autocompletePlaces, type PlaceResult, GOOGLE_PLACES_API_KEY } from '../lib/googlePlaces';
import { logApiUsage } from '../lib/apiUsage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT_EXPANDED = SCREEN_HEIGHT * 0.42;
const MAP_HEIGHT_COLLAPSED = SCREEN_HEIGHT * 0.25;

const isWeb = Platform.OS === 'web';

type LocationPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (placeName: string, address: string) => void;
  initialLocation?: string;
};

/** Google Maps embed view — iframe on web, WebView on native */
function EmbedMapView({ latitude, longitude, address }: { latitude: number; longitude: number; address: string }) {
  const src = `https://www.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`;

  if (isWeb) {
    return (
      <View style={{ flex: 1, position: 'relative' }}>
        {/* @ts-ignore - iframe is web-only */}
        <iframe
          src={src}
          style={{ width: '100%', height: '100%', border: 'none' }}
          loading="lazy"
        />
        {address ? (
          <View style={styles.webAddressOverlay}>
            <Text style={styles.webAddressText} numberOfLines={2}>{address}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Native: use react-native WebView
  let WebView: any = null;
  try { WebView = require('react-native-webview').default; } catch {}

  if (!WebView) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.gray100 }}>
        <MapPin size={32} color={COLORS.gray400} />
        <Text style={{ color: COLORS.gray500, marginTop: 8, fontSize: 13 }}>{address || '目前位置'}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, position: 'relative' }}>
      <WebView source={{ uri: src }} style={{ flex: 1 }} />
      {address ? (
        <View style={styles.webAddressOverlay}>
          <Text style={styles.webAddressText} numberOfLines={2}>{address}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function LocationPickerModal({
  visible,
  onClose,
  onSelect,
  initialLocation,
}: LocationPickerModalProps) {
  const insets = useSafeAreaInsets();
  const searchInputRef = useRef<TextInput>(null);

  const [coords, setCoords] = useState({ latitude: 25.033, longitude: 121.5654 });
  const [currentAddress, setCurrentAddress] = useState('');
  const [locating, setLocating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Places list
  const [nearbyPlaces, setNearbyPlaces] = useState<PlaceResult[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);

  // Search
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Map expand/collapse
  const [mapExpanded, setMapExpanded] = useState(true);

  // Get current location on modal open
  useEffect(() => {
    if (visible) {
      getCurrentLocation();
    }
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [visible]);

  const fetchLocationData = useCallback(async (latitude: number, longitude: number) => {
    setCoords({ latitude, longitude });
    // coords state update triggers EmbedMapView re-render

    // Reverse geocode
    if (isWeb) {
      try {
        logApiUsage('geocoding');
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_PLACES_API_KEY}&language=zh-TW`
        );
        const data = await res.json();
        if (data.status === 'REQUEST_DENIED') {
          setErrorMsg('Geocoding API 未啟用，請到 Google Cloud Console 啟用');
        } else if (data.results?.[0]) {
          const addr = data.results[0].formatted_address;
          setCurrentAddress(addr.split(',').slice(0, 2).join(',').trim());
        }
      } catch (e: any) {
        setErrorMsg('Geocoding 錯誤: ' + (e.message || ''));
      }
    } else {
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (place) {
          setCurrentAddress([place.name, place.district, place.city].filter(Boolean).join(', '));
        }
      } catch {}
    }

    setLocating(false);

    // Fetch nearby places
    setLoadingNearby(true);
    const places = await fetchNearbyPlaces(latitude, longitude, 500, 15);
    if (places.length === 0) {
      setErrorMsg(prev => prev || '找不到附近地點，請確認 Google Places API (New) 已啟用');
    }
    setNearbyPlaces(places);
    setLoadingNearby(false);
  }, []);

  const getCurrentLocation = useCallback(async () => {
    setLocating(true);
    setErrorMsg('');
    try {
      // Web: use browser geolocation API
      if (isWeb && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            fetchLocationData(position.coords.latitude, position.coords.longitude);
          },
          (err) => {
            setLocating(false);
            if (err.code === 1) {
              setErrorMsg('位置權限被拒絕，請在瀏覽器設定中允許位置存取');
            } else if (err.code === 2) {
              setErrorMsg('無法取得位置，請確認 GPS 已開啟');
            } else {
              setErrorMsg('位置請求逾時，請重試');
            }
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
        return;
      }

      // Native: use expo-location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocating(false);
        setErrorMsg('位置權限被拒絕');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await fetchLocationData(loc.coords.latitude, loc.coords.longitude);
    } catch (e: any) {
      setLocating(false);
      setErrorMsg('位置錯誤: ' + (e.message || '未知錯誤'));
    }
  }, [fetchLocationData]);

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (text.length < 2) {
      setSearchResults([]);
      setIsSearchMode(false);
      return;
    }

    setIsSearchMode(true);
    setLoadingSearch(true);
    searchTimerRef.current = setTimeout(async () => {
      const results = await autocompletePlaces(text, coords.latitude, coords.longitude);
      setSearchResults(results);
      setLoadingSearch(false);
    }, 300);
  };

  const handleSelectPlace = (place: PlaceResult) => {
    onSelect(place.name, place.address);
    Keyboard.dismiss();
    onClose();
  };

  const displayPlaces = isSearchMode ? searchResults : nearbyPlaces;
  const isLoading = isSearchMode ? loadingSearch : loadingNearby;
  const mapHeight = mapExpanded ? MAP_HEIGHT_EXPANDED : MAP_HEIGHT_COLLAPSED;

  const renderPlaceItem = ({ item }: { item: PlaceResult; index: number }) => (
    <TouchableOpacity
      style={styles.placeItem}
      onPress={() => handleSelectPlace(item)}
      activeOpacity={0.6}
    >
      <View style={styles.placeIcon}>
        <MapPin size={18} color={COLORS.gray500} />
      </View>
      <View style={styles.placeInfo}>
        <Text style={styles.placeName}>{item.name}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} activeOpacity={0.6}>
            <X size={22} color={COLORS.gray800} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>位置資訊</Text>
          <View style={styles.headerBtn} />
        </View>

        {/* Map */}
        <View style={[styles.mapContainer, { height: mapHeight }]}>
          <EmbedMapView latitude={coords.latitude} longitude={coords.longitude} address={currentAddress} />

          {/* Recenter button */}
          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={getCurrentLocation}
            activeOpacity={0.7}
          >
            {locating ? (
              <ActivityIndicator size={18} color={COLORS.gray700} />
            ) : (
              <Navigation size={18} color={COLORS.gray700} />
            )}
          </TouchableOpacity>
        </View>

        {/* Toggle map size */}
        <TouchableOpacity
          style={styles.toggleMapBtn}
          onPress={() => setMapExpanded(!mapExpanded)}
          activeOpacity={0.7}
        >
          {mapExpanded ? (
            <ChevronUp size={20} color={COLORS.gray400} />
          ) : (
            <ChevronDown size={20} color={COLORS.gray400} />
          )}
        </TouchableOpacity>

        {/* "Use current location" — works even when Places API (New) fails,
            because the address comes from expo-location's native reverse
            geocoder (iOS CoreLocation / Android Geocoder), not Google Places. */}
        {currentAddress ? (
          <TouchableOpacity
            style={styles.currentLocationRow}
            onPress={() => handleSelectPlace({ name: currentAddress, address: currentAddress, placeId: '' })}
            activeOpacity={0.6}
          >
            <MapPin size={18} color={COLORS.piktag600} />
            <Text style={styles.currentLocationText} numberOfLines={1}>{currentAddress}</Text>
            <Text style={styles.currentLocationHint}>使用</Text>
          </TouchableOpacity>
        ) : null}

        {/* Search bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Search size={18} color={COLORS.gray400} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              value={searchText}
              onChangeText={handleSearchChange}
              placeholder="搜尋或直接輸入地點名稱"
              placeholderTextColor={COLORS.gray400}
              returnKeyType="done"
              onFocus={() => setMapExpanded(false)}
              onSubmitEditing={() => {
                // Fallback path when Places API returns nothing (e.g. API not
                // enabled / billing / network): use the raw typed text as the
                // location tag. Users can always exit with a typed string.
                const v = searchText.trim();
                if (!v) return;
                handleSelectPlace({ name: v, address: '', placeId: '' });
              }}
            />
            {searchText.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchText('');
                  setSearchResults([]);
                  setIsSearchMode(false);
                }}
                activeOpacity={0.6}
              >
                <X size={18} color={COLORS.gray400} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Error message — surfaced as a neutral hint, not a blocker. Users
            can still select a location via the tappable current-location row
            above, or by typing in the search box and pressing Done. */}
        {errorMsg ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>找不到附近地點，你可以用上方的當前位置,或在搜尋框直接輸入地點名稱後按完成。</Text>
          </View>
        ) : null}

        {/* Places list */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={COLORS.piktag500} />
          </View>
        ) : (
          <FlatList
            data={displayPlaces}
            keyExtractor={(item, i) => item.placeId || `place-${i}`}
            renderItem={renderPlaceItem}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            ListEmptyComponent={
              isSearchMode && searchText.length >= 2 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>找不到相關地點</Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
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
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  recenterBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
      } as any,
    }),
  },
  toggleMapBtn: {
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  currentLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.piktag50,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  currentLocationText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.gray900,
    fontWeight: '500',
  },
  currentLocationHint: {
    fontSize: 13,
    color: COLORS.piktag600,
    fontWeight: '600',
  },
  errorBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.gray50,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  errorBannerText: {
    fontSize: 12,
    color: COLORS.gray600,
    lineHeight: 18,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray100,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.gray900,
    paddingVertical: 0,
    ...(isWeb ? { outlineStyle: 'none' } as any : {}),
  },
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  placeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray200,
  },
  placeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  placeInfo: {
    flex: 1,
  },
  placeName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray900,
    marginBottom: 2,
  },
  placeAddress: {
    fontSize: 13,
    color: COLORS.gray500,
  },
  emptyContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
  },
  webAddressOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  webAddressText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
});
