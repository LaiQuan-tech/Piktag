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
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { X, Search, MapPin, Navigation, ChevronUp, ChevronDown } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { fetchNearbyPlaces, autocompletePlaces, type PlaceResult } from '../lib/googlePlaces';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT_EXPANDED = SCREEN_HEIGHT * 0.42;
const MAP_HEIGHT_COLLAPSED = SCREEN_HEIGHT * 0.25;

type LocationPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (placeName: string, address: string) => void;
  initialLocation?: string;
};

export default function LocationPickerModal({
  visible,
  onClose,
  onSelect,
  initialLocation,
}: LocationPickerModalProps) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const searchInputRef = useRef<TextInput>(null);

  const [region, setRegion] = useState({
    latitude: 25.033,
    longitude: 121.5654,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  });
  const [markerCoord, setMarkerCoord] = useState({ latitude: 25.033, longitude: 121.5654 });
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
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocating(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;

      const newRegion = {
        latitude,
        longitude,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      };
      setRegion(newRegion);
      setMarkerCoord({ latitude, longitude });
      mapRef.current?.animateToRegion(newRegion, 500);

      // Reverse geocode
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (place) {
          const addr = [place.postalCode, place.country, place.region, place.city, place.district, place.street, place.name].filter(Boolean).join('');
          setCurrentAddress(addr);
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
      const results = await autocompletePlaces(
        text,
        markerCoord.latitude,
        markerCoord.longitude,
      );
      setSearchResults(results);
      setLoadingSearch(false);
    }, 300);
  };

  const handleSelectPlace = (place: PlaceResult) => {
    onSelect(place.name, place.address);
    Keyboard.dismiss();
    onClose();
  };

  const handleSelectCurrentLocation = () => {
    if (currentAddress) {
      // Extract a short name from the address
      onSelect(currentAddress, '');
      onClose();
    }
  };

  const handleRecenter = () => {
    getCurrentLocation();
  };

  const displayPlaces = isSearchMode ? searchResults : nearbyPlaces;
  const isLoading = isSearchMode ? loadingSearch : loadingNearby;
  const mapHeight = mapExpanded ? MAP_HEIGHT_EXPANDED : MAP_HEIGHT_COLLAPSED;

  const renderPlaceItem = ({ item, index }: { item: PlaceResult; index: number }) => (
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
        {item.address ? (
          <Text style={styles.placeAddress} numberOfLines={1}>{item.address}</Text>
        ) : null}
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
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            region={region}
            onRegionChangeComplete={setRegion}
            showsUserLocation
            showsMyLocationButton={false}
          >
            <Marker coordinate={markerCoord}>
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
          </MapView>

          {/* Recenter button */}
          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={handleRecenter}
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
    backgroundColor: COLORS.white || '#fff',
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
});
