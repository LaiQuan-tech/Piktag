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
  Image,
} from 'react-native';
import { X, Search, MapPin, Navigation, ChevronUp, ChevronDown } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { fetchNearbyPlaces, autocompletePlaces, type PlaceResult, GOOGLE_PLACES_API_KEY } from '../lib/googlePlaces';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT_EXPANDED = SCREEN_HEIGHT * 0.42;
const MAP_HEIGHT_COLLAPSED = SCREEN_HEIGHT * 0.25;

const isWeb = Platform.OS === 'web';

// Conditionally import MapView for native only
let MapView: any = null;
let Marker: any = null;
let PROVIDER_GOOGLE: any = null;
if (!isWeb) {
  try {
    const maps = require('react-native-maps');
    MapView = maps.default;
    Marker = maps.Marker;
    PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
  } catch {}
}

type LocationPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (placeName: string, address: string) => void;
  initialLocation?: string;
};

/** Web: Google Maps Static API (image) */
function WebMapView({ latitude, longitude, address }: { latitude: number; longitude: number; address: string }) {
  if (!isWeb) return null;
  const mapWidth = Math.min(Math.round(SCREEN_WIDTH), 640);
  const mapHeight = Math.round(MAP_HEIGHT_EXPANDED);
  const src = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=16&size=${mapWidth}x${mapHeight}&scale=2&markers=color:red%7C${latitude},${longitude}&key=${GOOGLE_PLACES_API_KEY}&language=zh-TW`;
  return (
    <View style={{ flex: 1 }}>
      <Image
        source={{ uri: src }}
        style={{ width: '100%' as any, height: '100%' as any, resizeMode: 'cover' }}
      />
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
  const mapRef = useRef<any>(null);
  const searchInputRef = useRef<TextInput>(null);

  const [coords, setCoords] = useState({ latitude: 25.033, longitude: 121.5654 });
  const [region, setRegion] = useState({
    latitude: 25.033,
    longitude: 121.5654,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  });
  const [currentAddress, setCurrentAddress] = useState('');
  const [locating, setLocating] = useState(false);

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

  const getCurrentLocation = useCallback(async () => {
    setLocating(true);
    try {
      // Web: use browser geolocation API
      if (isWeb && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            setCoords({ latitude, longitude });
            setRegion({ latitude, longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 });

            // Reverse geocode via Google — use short name from nearby place
            try {
              const res = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_PLACES_API_KEY}&language=zh-TW&result_type=point_of_interest|premise|sublocality`
              );
              const data = await res.json();
              if (data.results?.[0]) {
                // Extract short name from address components
                const components = data.results[0].address_components || [];
                const poi = components.find((c: any) => c.types.includes('point_of_interest'));
                const sublocality = components.find((c: any) => c.types.includes('sublocality'));
                const locality = components.find((c: any) => c.types.includes('locality'));
                const shortName = [poi?.long_name, sublocality?.long_name, locality?.long_name].filter(Boolean).join(', ');
                setCurrentAddress(shortName || data.results[0].formatted_address.split(',').slice(0, 2).join(','));
              }
            } catch {}

            setLocating(false);

            // Fetch nearby
            setLoadingNearby(true);
            const places = await fetchNearbyPlaces(latitude, longitude, 500, 15);
            setNearbyPlaces(places);
            setLoadingNearby(false);
          },
          () => {
            setLocating(false);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
        return;
      }

      // Native: use expo-location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocating(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;

      const newRegion = { latitude, longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 };
      setCoords({ latitude, longitude });
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 500);

      // Reverse geocode — show short place name, not full address
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (place) {
          const shortName = [place.name, place.district, place.city].filter(Boolean).join(', ');
          setCurrentAddress(shortName);
        }
      } catch {}

      setLocating(false);

      // Fetch nearby places
      setLoadingNearby(true);
      const places = await fetchNearbyPlaces(latitude, longitude, 500, 15);
      setNearbyPlaces(places);
      setLoadingNearby(false);
    } catch {
      setLocating(false);
    }
  }, []);

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
          {isWeb ? (
            <WebMapView latitude={coords.latitude} longitude={coords.longitude} address={currentAddress} />
          ) : MapView ? (
            <MapView
              ref={mapRef}
              style={styles.map}
              provider={PROVIDER_GOOGLE}
              region={region}
              onRegionChangeComplete={setRegion}
              showsUserLocation
              showsMyLocationButton={false}
            >
              {Marker && (
                <Marker coordinate={coords}>
                  <View style={styles.markerContainer}>
                    <View style={styles.markerBubble}>
                      <Text style={styles.markerText} numberOfLines={2}>
                        {currentAddress || '目前位置'}
                      </Text>
                    </View>
                    <View style={styles.markerArrow} />
                    <View style={styles.markerDot} />
                  </View>
                </Marker>
              )}
            </MapView>
          ) : (
            <View style={[styles.map, { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.gray100 }]}>
              <MapPin size={32} color={COLORS.gray400} />
              <Text style={{ color: COLORS.gray500, marginTop: 8 }}>地圖載入中...</Text>
            </View>
          )}

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

        {/* Search bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Search size={18} color={COLORS.gray400} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              value={searchText}
              onChangeText={handleSearchChange}
              placeholder="搜尋"
              placeholderTextColor={COLORS.gray400}
              returnKeyType="search"
              onFocus={() => setMapExpanded(false)}
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
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: 'center',
  },
  markerBubble: {
    backgroundColor: COLORS.gray900,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 220,
  },
  markerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  markerArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.gray900,
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ff3b30',
    borderWidth: 2,
    borderColor: '#fff',
    marginTop: 2,
  },
  recenterBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
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
