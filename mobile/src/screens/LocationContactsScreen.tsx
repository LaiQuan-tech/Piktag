import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Navigation } from 'lucide-react-native';
import * as Location from 'expo-location';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Connection } from '../types';

type LocationContactsScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function LocationContactsScreen({ navigation }: LocationContactsScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<any[]>([]);
  const [locationName, setLocationName] = useState(t('locationContacts.defaultLocation'));
  const [metLocationContacts, setMetLocationContacts] = useState<any[]>([]);

  useEffect(() => {
    loadNearbyContacts();
  }, []);

  const loadNearbyContacts = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('locationContacts.alertPermTitle'), t('locationContacts.alertPermMessage'));
        setLoading(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;

      // Reverse geocode for location name
      let geoAddr: Location.LocationGeocodedAddress | null = null;
      try {
        const results = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (results && results.length > 0) {
          geoAddr = results[0];
          setLocationName(
            [geoAddr.city, geoAddr.district || geoAddr.subregion].filter(Boolean).join(' ') || t('locationContacts.defaultLocation')
          );
        }
      } catch (e) {
        console.warn('Reverse geocode failed:', e);
      }

      // Update own profile location
      supabase
        .from('piktag_profiles')
        .update({ latitude, longitude, location_updated_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(({ error }) => { if (error) console.warn('Location update failed:', error.message); });

      // Fetch connections with their profiles
      const { data } = await supabase
        .from('piktag_connections')
        .select('*, connected_user:piktag_profiles!connected_user_id(*)')
        .eq('user_id', user.id);

      if (data) {
        // Split into two groups:
        // 1. People whose profile location is near current location
        const nearbyProfiles = data
          .filter((c: any) => {
            const p = c.connected_user;
            return p?.latitude != null && p?.longitude != null;
          })
          .map((c: any) => ({
            ...c,
            distance: haversineDistance(
              latitude,
              longitude,
              c.connected_user.latitude,
              c.connected_user.longitude
            ),
          }))
          .filter((c: any) => c.distance < 10) // Within 10km
          .sort((a: Connection & { distance: number }, b: Connection & { distance: number }) => a.distance - b.distance);

        setContacts(nearbyProfiles);

        // 2. People whose met_location contains the current location name
        const metHere = data.filter((c: any) => {
          if (!c.met_location) return false;
          const locLower = c.met_location.toLowerCase();
          return (
            locLower.includes(locationName.toLowerCase()) ||
            (geoAddr && (
              locLower.includes(geoAddr.city?.toLowerCase() || '') ||
              locLower.includes(geoAddr.district?.toLowerCase() || '')
            ))
          );
        });

        setMetLocationContacts(metHere);
      }
    } catch (err) {
      console.error('Error loading nearby contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderContact = ({ item }: { item: Connection & { distance?: number } }) => {
    const profile = item.connected_user;
    const name = item.nickname || profile?.full_name || profile?.username || 'Unknown';
    const avatarUri =
      profile?.avatar_url ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f3f4f6&color=6b7280`;

    return (
      <TouchableOpacity
        style={styles.contactItem}
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate('FriendDetail', {
            connectionId: item.id,
            friendId: item.connected_user_id,
          })
        }
      >
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>
            {name}
          </Text>
          {item.distance != null && (
            <Text style={styles.contactDistance}>
              {item.distance < 1
                ? `${Math.round(item.distance * 1000)}m`
                : `${item.distance.toFixed(1)}km`}
            </Text>
          )}
          {item.met_location && (
            <Text style={styles.contactMet} numberOfLines={1}>
              {t('locationContacts.metAtPrefix')}{item.met_location}{t('locationContacts.metAtSuffix')}
            </Text>
          )}
        </View>
        <Navigation size={16} color={COLORS.gray400} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('locationContacts.headerTitle')}</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Location banner */}
      <View style={styles.locationBanner}>
        <MapPin size={16} color={COLORS.piktag600} />
        <Text style={styles.locationText}>{locationName}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        <FlatList
          data={[...contacts]}
          renderItem={renderContact}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={() => (
            <>
              {contacts.length > 0 && (
                <Text style={styles.sectionLabel}>
                  {t('locationContacts.nearbySection', { count: contacts.length })}
                </Text>
              )}
            </>
          )}
          ListFooterComponent={() => (
            <>
              {metLocationContacts.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
                    {t('locationContacts.metHereSection', { count: metLocationContacts.length })}
                  </Text>
                  {metLocationContacts.map((item) => {
                    const profile = item.connected_user;
                    const name = item.nickname || profile?.full_name || profile?.username || 'Unknown';
                    const avatarUri =
                      profile?.avatar_url ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f3f4f6&color=6b7280`;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.contactItem}
                        activeOpacity={0.7}
                        onPress={() =>
                          navigation.navigate('FriendDetail', {
                            connectionId: item.id,
                            friendId: item.connected_user_id,
                          })
                        }
                      >
                        <Image source={{ uri: avatarUri }} style={styles.avatar} />
                        <View style={styles.contactInfo}>
                          <Text style={styles.contactName} numberOfLines={1}>
                            {name}
                          </Text>
                          <Text style={styles.contactMet} numberOfLines={1}>
                            {t('locationContacts.metAtPrefix')}{item.met_location}{t('locationContacts.metAtSuffix')}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
              {contacts.length === 0 && metLocationContacts.length === 0 && (
                <View style={styles.emptyContainer}>
                  <MapPin size={48} color={COLORS.gray200} />
                  <Text style={styles.emptyText}>
                    {t('locationContacts.emptyText')}
                  </Text>
                </View>
              )}
            </>
          )}
        />
      )}
    </View>
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
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  locationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.piktag50,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.piktag100,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 100,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.gray100,
  },
  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  contactDistance: {
    fontSize: 13,
    color: COLORS.piktag600,
    marginTop: 2,
  },
  contactMet: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray400,
    marginTop: 16,
  },
});
