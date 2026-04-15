import React, { useMemo, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { X } from 'lucide-react-native';
import { requestForegroundPermissionsAsync, getCurrentPositionAsync, Accuracy } from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { GOOGLE_PLACES_API_KEY } from '../lib/googlePlaces';
import { logApiUsage } from '../lib/apiUsage';

const isWeb = Platform.OS === 'web';

type FriendLocation = {
  id: string;
  connectionId: string;
  name: string;
  avatarUrl: string | null;
  latitude: number;
  longitude: number;
  location_updated_at?: string | null;
};

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const isLocationFresh = (loc: string | null | undefined): boolean => {
  if (!loc) return false;
  const ts = new Date(loc).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < STALE_THRESHOLD_MS;
};

type FriendsMapModalProps = {
  visible: boolean;
  onClose: () => void;
  friends: FriendLocation[];
  onFriendPress: (connectionId: string, friendId: string) => void;
};

export type { FriendLocation };

// Build the full HTML document that will be loaded into a WebView
// (native) or an iframe (web). It embeds the Google Maps JavaScript
// API with the `marker` library, places an AdvancedMarkerElement with
// an HTML avatar bubble for every friend, and reports clicks back via
// either window.ReactNativeWebView.postMessage (native) or
// window.parent.postMessage (web). The center and zoom are derived
// from the friend coordinates plus the signed-in user's own location.
function buildMapHtml(
  apiKey: string,
  friends: FriendLocation[],
  center: { lat: number; lng: number },
  self: { lat: number; lng: number } | null,
): string {
  const friendsJson = JSON.stringify(friends);
  const centerJson = JSON.stringify(center);
  const selfJson = JSON.stringify(self);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body, #map { width: 100%; height: 100%; background: #e5e7eb; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .avatar-marker { display: flex; flex-direction: column; align-items: center; cursor: pointer; transform: translateY(-6px); }
  .avatar-wrap {
    width: 52px; height: 52px; border-radius: 50%;
    background: #fff; padding: 3px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    border: 3px solid #8B5CF6;
  }
  .avatar-wrap.self { border-color: #10B981; }
  .avatar-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
  .avatar-initials {
    width: 100%; height: 100%; border-radius: 50%;
    background: #EDE9FE; color: #6B21A8;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 16px;
  }
  .avatar-label {
    margin-top: 4px;
    background: rgba(255,255,255,0.96);
    padding: 3px 10px; border-radius: 12px;
    font-size: 11px; font-weight: 600; color: #1F2937;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0,0,0,0.18);
    max-width: 120px; overflow: hidden; text-overflow: ellipsis;
  }
  .fallback {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #6B7280; font-size: 14px; padding: 20px; text-align: center;
  }
</style>
</head>
<body>
  <div id="map"></div>
  <div id="fallback" class="fallback" style="display:none">地圖載入失敗，請檢查網路連線</div>
  <script>
    const FRIENDS = ${friendsJson};
    const CENTER = ${centerJson};
    const SELF = ${selfJson};

    function postToHost(data) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(data));
        } else if (window.parent && window.parent.postMessage) {
          window.parent.postMessage(data, '*');
        }
      } catch (e) {}
    }

    function showInlineError(msg) {
      var el = document.getElementById('fallback');
      if (el) {
        el.textContent = msg;
        el.style.display = 'flex';
      }
      postToHost({ type: 'error', message: msg });
    }

    // Google Maps calls this global hook when the API key is
    // rejected for any auth reason (key invalid, API not enabled,
    // referrer / bundle restriction mismatch, billing disabled).
    // Without this, Maps takes over <body> with its own generic
    // "this page didn't load Google Maps correctly" screen and the
    // host app has no way to tell what went wrong.
    window.gm_authFailure = function () {
      showInlineError('Google Maps 認證失敗：請確認 Cloud Console 有啟用 Maps JavaScript API、API key 未被 referrer 規則擋掉、billing 帳號有效。');
    };

    // Capture top-level script errors (e.g. script tag load failure)
    // and forward them to the host so we can see them on the red
    // debug overlay without a JS console.
    window.addEventListener('error', function (ev) {
      showInlineError('JS error: ' + (ev && ev.message ? ev.message : 'unknown'));
    });

    function escapeText(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.textContent || '';
    }

    function initialsOf(name) {
      if (!name) return '?';
      const trimmed = name.trim();
      if (!trimmed) return '?';
      return trimmed.slice(0, 2);
    }

    function buildMarkerContent(item, isSelf) {
      const root = document.createElement('div');
      root.className = 'avatar-marker';

      const wrap = document.createElement('div');
      wrap.className = 'avatar-wrap' + (isSelf ? ' self' : '');

      if (item.avatarUrl) {
        const img = document.createElement('img');
        img.className = 'avatar-img';
        img.referrerPolicy = 'no-referrer';
        img.alt = item.name || '';
        img.src = item.avatarUrl;
        img.onerror = function () {
          wrap.innerHTML = '';
          const ini = document.createElement('div');
          ini.className = 'avatar-initials';
          ini.textContent = initialsOf(item.name);
          wrap.appendChild(ini);
        };
        wrap.appendChild(img);
      } else {
        const ini = document.createElement('div');
        ini.className = 'avatar-initials';
        ini.textContent = initialsOf(item.name);
        wrap.appendChild(ini);
      }

      const label = document.createElement('div');
      label.className = 'avatar-label';
      label.textContent = isSelf ? '你' : (item.name || '');

      root.appendChild(wrap);
      root.appendChild(label);
      return root;
    }

    async function initMap() {
      try {
        const { Map } = await google.maps.importLibrary('maps');
        const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

        const map = new Map(document.getElementById('map'), {
          center: CENTER,
          zoom: 11,
          mapId: 'piktag_friends_map',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          styles: undefined,
        });

        if (SELF) {
          new AdvancedMarkerElement({
            map,
            position: { lat: SELF.lat, lng: SELF.lng },
            content: buildMarkerContent({ name: '你', avatarUrl: null }, true),
            title: '你',
            zIndex: 1000,
          });
        }

        const bounds = new google.maps.LatLngBounds();
        if (SELF) bounds.extend({ lat: SELF.lat, lng: SELF.lng });

        FRIENDS.forEach(function (friend) {
          const content = buildMarkerContent(friend, false);
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: friend.latitude, lng: friend.longitude },
            content,
            title: friend.name,
          });
          marker.addListener('click', function () {
            postToHost({
              type: 'friendClick',
              connectionId: friend.connectionId,
              friendId: friend.id,
            });
          });
          bounds.extend({ lat: friend.latitude, lng: friend.longitude });
        });

        // If there is more than one point, auto-fit the bounds so
        // every avatar is visible, with a small padding.
        const totalPoints = FRIENDS.length + (SELF ? 1 : 0);
        if (totalPoints > 1) {
          map.fitBounds(bounds, { top: 80, right: 60, bottom: 80, left: 60 });
        }
      } catch (e) {
        document.getElementById('fallback').style.display = 'flex';
        postToHost({ type: 'error', message: String(e && e.message ? e.message : e) });
      }
    }

    window.__initMap = initMap;
  </script>
  <script
    async
    defer
    src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&libraries=maps,marker&loading=async&callback=__initMap"
    onerror="document.getElementById('fallback').style.display='flex';"
  ></script>
</body>
</html>`;
}

export default function FriendsMapModal({
  visible,
  onClose,
  friends,
  onFriendPress,
}: FriendsMapModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const friendsWithLocation = useMemo(
    () =>
      friends.filter(
        (f) =>
          typeof f.latitude === 'number' &&
          typeof f.longitude === 'number' &&
          isLocationFresh((f as any).location_updated_at),
      ),
    [friends],
  );

  // Fetch the signed-in user's own location when the modal opens so
  // we can place a "you are here" avatar and auto-center the map.
  useEffect(() => {
    if (!visible) return;
    // Each time the modal becomes visible we instantiate a fresh
    // google.maps.Map via the embedded HTML, which counts as one
    // Maps JavaScript API "map load" on the Google billing side.
    // Log it so we can cross-reference against Cloud Console later.
    logApiUsage('maps_js_map_load', { friendCount: friendsWithLocation.length });

    let cancelled = false;
    setLocating(true);

    (async () => {
      try {
        if (isWeb && typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (!cancelled) {
                setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLocating(false);
              }
            },
            () => { if (!cancelled) setLocating(false); },
            { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
          );
        } else {
          const { status } = await requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await getCurrentPositionAsync({
              accuracy: Accuracy.Balanced,
            });
            if (!cancelled) {
              setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
            }
          }
          if (!cancelled) setLocating(false);
        }
      } catch {
        if (!cancelled) setLocating(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible]);

  // Reset the error banner every time the modal is (re)opened so a
  // stale failure from a previous attempt doesn't linger.
  useEffect(() => {
    if (visible) setLoadError(null);
  }, [visible]);

  // Message handler — invoked from the WebView (native) or from the
  // iframe (web) when the in-map HTML posts a friend click or an
  // authentication / script-load error.
  const handleMessage = (raw: unknown) => {
    if (!raw) return;
    let data: any = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch { return; }
    }
    if (!data || typeof data !== 'object') return;
    if (data.type === 'friendClick' && data.connectionId && data.friendId) {
      onFriendPress(data.connectionId, data.friendId);
      return;
    }
    if (data.type === 'error' && typeof data.message === 'string') {
      setLoadError(data.message);
    }
  };

  // Listen for postMessage on web
  useEffect(() => {
    if (!isWeb || !visible) return;
    const listener = (ev: MessageEvent) => {
      // Only trust messages from our own iframe
      if (ev.source !== iframeRef.current?.contentWindow) return;
      handleMessage(ev.data);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    }
  }, [visible, onFriendPress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute center: prefer the signed-in user, fall back to the first
  // friend, and finally a Taipei default so the map never blanks out.
  const center = useMemo(() => {
    if (userCoords) return userCoords;
    if (friendsWithLocation.length > 0) {
      return {
        lat: friendsWithLocation[0].latitude,
        lng: friendsWithLocation[0].longitude,
      };
    }
    return { lat: 25.033, lng: 121.5654 };
  }, [userCoords, friendsWithLocation]);

  const html = useMemo(
    () => buildMapHtml(GOOGLE_PLACES_API_KEY, friendsWithLocation, center, userCoords),
    [friendsWithLocation, center, userCoords],
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} activeOpacity={0.6}>
            <X size={22} color={COLORS.gray800} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>{t('friendsMap.title')}</Text>
            <Text style={styles.headerSubtitle}>
              {friendsWithLocation.length > 0
                ? t('friendsMap.friendCount', { count: friendsWithLocation.length })
                : t('friendsMap.noSharedLocations')}
            </Text>
          </View>
          <View style={styles.headerBtn} />
        </View>

        {/* Stale-location hint */}
        <Text style={styles.staleHint}>
          {t('friendsMap.staleHint')}
        </Text>

        {/* Inline load error (visible to user, no JS console needed) */}
        {loadError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText} numberOfLines={6}>
              {loadError}
            </Text>
          </View>
        )}

        {/* Map */}
        <View style={styles.mapContainer}>
          {locating && !userCoords && friendsWithLocation.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.piktag500} />
            </View>
          ) : isWeb ? (
            // @ts-ignore — iframe is a DOM element, not an RN component
            <iframe
              ref={iframeRef as any}
              srcDoc={html}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="geolocation"
              title="Friends map"
            />
          ) : (
            (() => {
              let WebView: any = null;
              try { WebView = require('react-native-webview').default; } catch {}
              if (!WebView) {
                return (
                  <View style={styles.loadingContainer}>
                    <Text style={{ color: COLORS.gray500 }}>{t('friendsMap.loadFailed')}</Text>
                  </View>
                );
              }
              // NOTE: baseUrl is important. Google Maps will send
              // the current document's origin as the HTTP Referer
              // when it loads its own internal scripts, and the
              // Google Maps Platform API key referrer restriction
              // matches against that Referer. Setting baseUrl to
              // our production web origin means: if the user
              // restricts the API key to https://pikt.ag/* then
              // the iOS WebView will satisfy the restriction.
              return (
                <WebView
                  originWhitelist={['*']}
                  source={{ html, baseUrl: 'https://pikt.ag' }}
                  style={{ flex: 1, backgroundColor: '#e5e7eb' }}
                  javaScriptEnabled
                  domStorageEnabled
                  mixedContentMode="always"
                  onMessage={(event: any) => handleMessage(event?.nativeEvent?.data)}
                  setSupportMultipleWindows={false}
                />
              );
            })()
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.gray900 },
  headerSubtitle: { fontSize: 11, color: COLORS.gray500, marginTop: 1 },
  mapContainer: { flex: 1, backgroundColor: '#e5e7eb' },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staleHint: {
    fontSize: 12,
    color: COLORS.gray500,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderBottomWidth: 1,
    borderBottomColor: '#FCA5A5',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorBannerText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#991B1B',
  },
});
