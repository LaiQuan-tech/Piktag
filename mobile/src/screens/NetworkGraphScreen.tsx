// NetworkGraphScreen.tsx
//
// "Your network" — a 2D force-directed graph of how the user's OWN friends
// interconnect (replaces the retired invite-lineage Tribe). The lines ARE the
// product (they show the relationships), so they must always render clearly.
//
// History: a pseudo-3D version (auto-rotation via per-node AnimatedG transform
// + per-edge AnimatedLine) shipped 2026-06-26 but on real sparse data the
// AnimatedLine endpoints didn't render (no lines) and the 3D projection clumped
// nodes on top of each other. Reverted to this robust 2D build (founder
// 2026-06-26): STATIC <Line> edges (guaranteed to draw), an overlap-resolution
// pass so nodes never clump, plus pinch/zoom/pan and a gentle fly-in. 3D can
// return later via a real engine (the WebView 3d-force-graph option) if wanted.
//
// Node kinds:
//   • Friend node — avatar (or purple initial) + name, tap → FriendDetail.
//     (data from get_friend_graph())
//   • Bridge node — gray dot + a faceless PERSON silhouette (a 2nd-degree
//     person you may know; anonymous until a deliberate tap → UserDetail).
//     (data from get_friend_graph())
//   • Contact node (2026-07-06) — the owner's card-scanned local contacts
//     who are NOT on PikTag yet (piktag_local_contacts, owner-only RLS,
//     un-promoted rows). Rendered in the brand gradient's CORAL (#ff5757 —
//     a fixed brand colour, not theme-mapped) so members (purple) vs
//     not-yet-members (coral) read at a glance. Deliberately EDGE-LESS:
//     they aren't connected to anyone on the graph, so the force layout
//     naturally settles them on the periphery — an honest "orbiting your
//     network, waiting to be pulled in" visual. Tap → LocalContactDetail,
//     whose locked CTA (寄我的聯絡資料給他) IS the North-Star conversion
//     action — the graph feeds the install funnel with zero new UI.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, Users, UserPlus, User } from 'lucide-react-native';
import Svg, { Circle, Line, G, Text as SvgText, Image as SvgImage, ClipPath, Defs, Path } from 'react-native-svg';
import { type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type FriendNode = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  deg: number;
};
type Bridge = { id: string; mutual_count: number };
type ContactNode = { id: string; name: string; avatar_url: string | null };
type GraphData = {
  friends: FriendNode[];
  edges: [string, string][];
  bridges: Bridge[];
  bridge_edges: [string, string][];
  contacts: ContactNode[];
  // Contact↔friend bridges (founder 2026-07-12, get_contact_bridges()):
  // [contact_id, friend_id] pairs where a member friend ALSO saved this
  // same coral contact in their own address book. Feeds the force layout
  // as an extra edge so the shared contact gets pulled in between the
  // members who both know them — the "two populations become one net"
  // visual. Purely additive: contacts with no bridge stay edge-less on
  // the periphery exactly as before.
  contact_bridges: [string, string][];
};
type Props = { navigation: any };

type LaidNode = {
  i: number;
  id: string;
  type: 'friend' | 'bridge' | 'contact';
  x: number;
  y: number;
  r: number;
  label?: string;
  avatar?: string | null;
  initial?: string;
};
type Seg = { x1: number; y1: number; x2: number; y2: number };

const EMPTY: GraphData = { friends: [], edges: [], bridges: [], bridge_edges: [], contacts: [], contact_bridges: [] };
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
// Brand-gradient coral — the not-yet-member tier. FIXED brand colour
// (same doctrine as the gradient): pairs with hardcoded white FG.
const CONTACT_CORAL = '#ff5757';
// Force-layout is O(n²) per iteration; cap the contact halo so a huge
// imported address book can't stall the JS thread or pack the canvas.
const MAX_CONTACTS = 30;

export default function NetworkGraphScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [data, setData] = useState<GraphData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const fetchGraph = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Members via the RPC; the coral halo straight off the owner-only
      // table (same predicate shape as phonePrompt/ConnectionsScreen:
      // un-promoted rows only — promoted contacts already ARE friend
      // nodes, drawing both would double-count the person).
      // Contact bridges (get_contact_bridges(), founder 2026-07-12) run
      // in the same wave — it's owner-scoped and param-less like the
      // other two, and a failure here must never block the graph (same
      // "silent degrade" contract as the friend-graph RPC below).
      const [{ data: res, error }, contactsRes, bridgesRes] = await Promise.all([
        supabase.rpc('get_friend_graph'),
        supabase
          .from('piktag_local_contacts')
          .select('id, name, avatar_url')
          .eq('owner_user_id', user.id)
          .is('promoted_to_connection_id', null)
          .order('created_at', { ascending: false })
          .limit(MAX_CONTACTS),
        supabase.rpc('get_contact_bridges'),
      ]);
      const contacts = Array.isArray(contactsRes.data)
        ? (contactsRes.data as ContactNode[]).filter((cNode) => !!cNode.name?.trim())
        : [];
      if (bridgesRes.error) {
        const isMissing =
          (bridgesRes.error as any).code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(bridgesRes.error.message);
        if (!isMissing) console.warn('[NetworkGraph] contact bridges fetch failed:', bridgesRes.error);
      }
      const contactBridges: [string, string][] = Array.isArray(bridgesRes.data)
        ? (bridgesRes.data as { contact_id: string; friend_id: string }[])
            .filter((row) => !!row?.contact_id && !!row?.friend_id)
            .map((row) => [row.contact_id, row.friend_id])
        : [];
      if (error) {
        const isMissing =
          (error as any).code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(error.message);
        if (!isMissing) console.warn('[NetworkGraph] fetch failed:', error);
        setData({ ...EMPTY, contacts, contact_bridges: contactBridges });
      } else if (res) {
        setData({
          friends: Array.isArray(res.friends) ? res.friends : [],
          edges: Array.isArray(res.edges) ? res.edges : [],
          bridges: Array.isArray(res.bridges) ? res.bridges : [],
          bridge_edges: Array.isArray(res.bridge_edges) ? res.bridge_edges : [],
          contacts,
          contact_bridges: contactBridges,
        });
      }
    } finally {
      setLoading(false);
    }
  // user?.id, not `user`: AuthContext hands out a NEW user object on
  // every token refresh (hourly, and on every foreground). This only
  // needs the identity, and depending on the object re-ran the whole
  // query on every refresh — wasted bandwidth on exactly the weak venue
  // networks this app exists for.
  }, [user?.id]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // ─── 2D force-directed layout (run once) ─────────────────────────────
  const { nodes, friendLines, bridgeLines, contactBridgeLines, size } = useMemo(() => {
    const canvas = Math.min(Dimensions.get('window').width - 24, 360);
    const pad = 42;
    const maxDeg = data.friends.reduce((m, f) => Math.max(m, f.deg), 0);

    const laid: LaidNode[] = [
      ...data.friends.map((f, idx) => ({
        i: idx, id: f.id, type: 'friend' as const, x: 0, y: 0,
        r: friendRadius(f.deg, maxDeg), label: shortName(f), avatar: f.avatar_url, initial: initialOf(f),
      })),
      ...data.bridges.map((b, idx) => ({
        i: data.friends.length + idx, id: b.id, type: 'bridge' as const, x: 0, y: 0, r: 11,
      })),
      // Edge-less BY DEFAULT — repulsion pushes them to the periphery, a
      // coral halo of not-yet-members around the purple network. A
      // contact with a bridge (get_contact_bridges(): a friend also
      // saved this same person) is the one exception — its extra edge
      // (cbE below) pulls it in among the members instead.
      ...data.contacts.map((lc, idx) => ({
        i: data.friends.length + data.bridges.length + idx, id: lc.id,
        type: 'contact' as const, x: 0, y: 0, r: 11,
        label: shortLabel(lc.name), avatar: lc.avatar_url, initial: initialOfName(lc.name),
      })),
    ];
    const n = laid.length;
    if (n === 0) return { nodes: [] as LaidNode[], friendLines: [] as Seg[], bridgeLines: [] as Seg[], contactBridgeLines: [] as Seg[], size: canvas };

    const indexOf = new Map<string, number>();
    laid.forEach((nd, i) => indexOf.set(nd.id, i));
    const fE: [number, number][] = [];
    for (const [a, b] of data.edges) {
      const ia = indexOf.get(a), ib = indexOf.get(b);
      if (ia !== undefined && ib !== undefined) fE.push([ia, ib]);
    }
    const bE: [number, number][] = [];
    for (const [bid, fid] of data.bridge_edges) {
      const ib = indexOf.get(bid), iff = indexOf.get(fid);
      if (ib !== undefined && iff !== undefined) bE.push([ib, iff]);
    }
    // Contact bridges (get_contact_bridges()): a coral contact both the
    // viewer AND a member friend saved. Same "both ends must be laid"
    // guard as bridge_edges above — only maps to a real edge when the
    // friend is actually rendered on this graph. Feeding these into the
    // SAME force-layout `edges` list (below) is what pulls a bridged
    // contact off the coral periphery and in among the members — an
    // un-bridged contact never gets an entry here and stays edge-less.
    const cbE: [number, number][] = [];
    for (const [contactId, friendId] of data.contact_bridges) {
      const ic = indexOf.get(contactId), ifr = indexOf.get(friendId);
      if (ic !== undefined && ifr !== undefined) cbE.push([ic, ifr]);
    }

    const cx = canvas / 2, cy = canvas / 2;
    const px = new Array<number>(n), py = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      px[i] = cx + Math.cos(a) * canvas * 0.3;
      py[i] = cy + Math.sin(a) * canvas * 0.3;
    }

    const k = 1.05 * Math.sqrt((canvas * canvas) / n); // generous spread
    const edges = [...fE, ...bE, ...cbE];
    const ITER = 220;
    let temp = canvas * 0.16;
    const cool = temp / (ITER + 1);
    const dx = new Array<number>(n), dy = new Array<number>(n);

    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < n; i++) { dx[i] = 0; dy[i] = 0; }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let vx = px[i] - px[j], vy = py[i] - py[j];
          let d = Math.sqrt(vx * vx + vy * vy) || 0.01;
          const f = (k * k) / d; vx /= d; vy /= d;
          dx[i] += vx * f; dy[i] += vy * f; dx[j] -= vx * f; dy[j] -= vy * f;
        }
      }
      for (const [a, b] of edges) {
        let vx = px[a] - px[b], vy = py[a] - py[b];
        let d = Math.sqrt(vx * vx + vy * vy) || 0.01;
        const f = (d * d) / k; vx /= d; vy /= d;
        dx[a] -= vx * f; dy[a] -= vy * f; dx[b] += vx * f; dy[b] += vy * f;
      }
      for (let i = 0; i < n; i++) { dx[i] += (cx - px[i]) * 0.03; dy[i] += (cy - py[i]) * 0.03; }
      for (let i = 0; i < n; i++) {
        const dl = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01;
        px[i] += (dx[i] / dl) * Math.min(dl, temp);
        py[i] += (dy[i] / dl) * Math.min(dl, temp);
      }
      temp = Math.max(temp - cool, canvas * 0.01);
    }

    // Center + fit inside the canvas with padding for labels.
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let i = 0; i < n; i++) { mnx = Math.min(mnx, px[i]); mny = Math.min(mny, py[i]); mxx = Math.max(mxx, px[i]); mxy = Math.max(mxy, py[i]); }
    const w = Math.max(mxx - mnx, 1), h = Math.max(mxy - mny, 1);
    const fit = Math.min((canvas - 2 * pad) / w, (canvas - 2 * pad) / h, 1.6);
    const ox = (mnx + mxx) / 2, oy = (mny + mxy) / 2;
    for (let i = 0; i < n; i++) {
      px[i] = cx + (px[i] - ox) * fit;
      py[i] = cy + (py[i] - oy) * fit;
    }

    // Overlap resolution runs AFTER the fit, on FINAL screen coords, so the
    // scale can never re-collapse the spacing — GUARANTEES no clumping (the
    // 3D build's bug). Clamp to the canvas so a push can't shove a node off.
    const lo = pad, hi = canvas - pad;
    for (let it = 0; it < 90; it++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const minSep = laid[i].r + laid[j].r + 28;
          let vx = px[i] - px[j], vy = py[i] - py[j];
          let d = Math.sqrt(vx * vx + vy * vy) || 0.01;
          if (d < minSep) {
            const push = (minSep - d) / 2;
            vx /= d; vy /= d;
            px[i] += vx * push; py[i] += vy * push;
            px[j] -= vx * push; py[j] -= vy * push;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        px[i] = Math.max(lo, Math.min(hi, px[i]));
        py[i] = Math.max(lo, Math.min(hi, py[i]));
      }
    }
    laid.forEach((nd, i) => { nd.x = px[i]; nd.y = py[i]; });

    const fLines = fE.map(([a, b]) => ({ x1: px[a], y1: py[a], x2: px[b], y2: py[b] }));
    const bLines = bE.map(([a, b]) => ({ x1: px[a], y1: py[a], x2: px[b], y2: py[b] }));
    const cbLines = cbE.map(([a, b]) => ({ x1: px[a], y1: py[a], x2: px[b], y2: py[b] }));
    return { nodes: laid, friendLines: fLines, bridgeLines: bLines, contactBridgeLines: cbLines, size: canvas };
  }, [data]);

  // ─── Pinch-zoom + pan + a gentle fly-in (container-level — reliable) ──
  const intro = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Contacts alone are enough to draw — cold-start users with an
  // imported address book but no member friends still get a live,
  // rich graph (and every coral node is a conversion entry).
  const hasGraph = data.friends.length > 0 || data.contacts.length > 0;

  useEffect(() => {
    if (!hasGraph) return;
    intro.value = 0;
    intro.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [hasGraph, intro, data]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.min(Math.max(savedScale.value * e.scale, MIN_ZOOM), MAX_ZOOM); })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_ZOOM + 0.01) { tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0; }
    });
  const pan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });
  const composed = Gesture.Simultaneous(pinch, pan);
  const containerStyle = useAnimatedStyle(() => ({
    opacity: intro.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      // fly-in: start a touch zoomed-out, settle to the user's zoom.
      { scale: scale.value * (0.82 + 0.18 * intro.value) },
    ],
  }));

  const onFriendTap = useCallback((id: string) => navigation.navigate('FriendDetail', { friendId: id }), [navigation]);
  const onBridgeTap = useCallback((id: string) => navigation.navigate('UserDetail', { userId: id }), [navigation]);
  // Contact tap lands on LocalContactDetail — its locked CTA
  // (寄我的聯絡資料給他) is the member-conversion push.
  const onContactTap = useCallback((id: string) => navigation.navigate('LocalContactDetail', { contactId: id }), [navigation]);

  const friendCount = data.friends.length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={22} color={colors.gray900} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{t('network.title', { defaultValue: '你的人脈' })}</Text>
          {friendCount > 0 && (
            <Text style={styles.headerSubtitle}>
              {t('network.subtitle', { n: friendCount, defaultValue: `${friendCount} 位好友，看看他們如何連結` })}
            </Text>
          )}
        </View>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="small" color={colors.piktag500} /></View>
      ) : !hasGraph ? (
        <View style={styles.center}>
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}><Users size={40} color={colors.piktag500} /></View>
            <Text style={styles.emptyTitle}>{t('network.emptyTitle', { defaultValue: '人脈圖還在等你' })}</Text>
            <Text style={styles.emptyDesc}>
              {t('network.emptyDesc', { defaultValue: '多加幾個好友，這裡就會顯示他們如何彼此連結，還有你可能認識的人。' })}
            </Text>
            <TouchableOpacity style={styles.emptyCta} activeOpacity={0.85} onPress={() => navigation.navigate('CameraScan')} accessibilityRole="button">
              <UserPlus size={18} color="#FFFFFF" />
              <Text style={styles.emptyCtaText}>{t('network.emptyCta', { defaultValue: '加好友' })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          <GestureDetector gesture={composed}>
            <Reanimated.View style={[styles.graphBox, containerStyle]}>
              <Svg width={size} height={size}>
                <Defs>
                  {nodes.map((nd) =>
                    nd.type !== 'bridge' && nd.avatar ? (
                      <ClipPath key={`clip-${nd.i}`} id={`clip-${nd.i}`}>
                        <Circle cx={nd.x} cy={nd.y} r={nd.r} />
                      </ClipPath>
                    ) : null,
                  )}
                </Defs>

                {/* Friend↔friend edges — solid, bright, the relationships. */}
                {friendLines.map((ln, i) => (
                  <Line key={`f-${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                    stroke={colors.piktag500} strokeWidth={3} strokeLinecap="round" opacity={0.8} />
                ))}
                {/* Bridge↔friend edges — dashed, the "you may know" links. */}
                {bridgeLines.map((ln, i) => (
                  <Line key={`b-${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                    stroke={colors.gray400} strokeWidth={2} strokeDasharray="4,5" opacity={0.6} />
                ))}
                {/* Contact↔friend bridges (get_contact_bridges(), founder
                    2026-07-12) — dashed CORAL, same weight/dash as the
                    gray bridge line above so both "shared with someone"
                    hints read as one visual family, just colour-coded to
                    which side that someone is on. Fixed brand colour, not
                    theme-mapped (same doctrine as the coral contact node
                    fill). */}
                {contactBridgeLines.map((ln, i) => (
                  <Line key={`cb-${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                    stroke={CONTACT_CORAL} strokeWidth={2} strokeDasharray="4,5" opacity={0.55} />
                ))}

                {/* Nodes */}
                {nodes.map((nd) => (
                  <G
                    key={nd.id}
                    onPress={() =>
                      nd.type === 'friend' ? onFriendTap(nd.id)
                      : nd.type === 'contact' ? onContactTap(nd.id)
                      : onBridgeTap(nd.id)
                    }
                  >
                    <Circle cx={nd.x} cy={nd.y} r={Math.max(nd.r + 10, 20)} fill="#000000" fillOpacity={0} />
                    {nd.type !== 'bridge' ? (
                      <>
                        {/* Friend = purple, contact = brand coral. Both are
                            fixed brand colours with hardcoded white FG. */}
                        {nd.avatar ? (
                          <>
                            <SvgImage x={nd.x - nd.r} y={nd.y - nd.r} width={nd.r * 2} height={nd.r * 2}
                              href={{ uri: nd.avatar }} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${nd.i})`} />
                            <Circle cx={nd.x} cy={nd.y} r={nd.r} fill="none"
                              stroke={nd.type === 'contact' ? CONTACT_CORAL : colors.piktag500} strokeWidth={1.5} />
                          </>
                        ) : (
                          <>
                            <Circle cx={nd.x} cy={nd.y} r={nd.r}
                              fill={nd.type === 'contact' ? CONTACT_CORAL : colors.piktag500} opacity={0.92} />
                            <SvgText x={nd.x} y={nd.y + nd.r * 0.38} fill="#FFFFFF" fontSize={nd.r} fontWeight="700" textAnchor="middle">{nd.initial}</SvgText>
                          </>
                        )}
                        {nd.label ? (
                          <SvgText x={nd.x} y={nd.y + nd.r + 13} fill={colors.gray600} fontSize={10} fontWeight="600" textAnchor="middle">{nd.label}</SvgText>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {/* Anonymous bridge — gray dot + a faceless person (a
                            POSITIVE "you may know", not a negative "?"). */}
                        <Circle cx={nd.x} cy={nd.y} r={nd.r} fill={colors.gray500} opacity={0.92} />
                        <Circle cx={nd.x} cy={nd.y - nd.r * 0.24} r={nd.r * 0.3} fill="#FFFFFF" />
                        <Path
                          d={`M ${nd.x - nd.r * 0.46} ${nd.y + nd.r * 0.52} C ${nd.x - nd.r * 0.46} ${nd.y + nd.r * 0.05}, ${nd.x + nd.r * 0.46} ${nd.y + nd.r * 0.05}, ${nd.x + nd.r * 0.46} ${nd.y + nd.r * 0.52} Z`}
                          fill="#FFFFFF"
                        />
                      </>
                    )}
                  </G>
                ))}
              </Svg>
            </Reanimated.View>
          </GestureDetector>

          <View style={styles.belowGraph}>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={styles.legendFriendDot} />
                <Text style={styles.legendText}>{t('network.legendFriend', { defaultValue: '你的好友' })}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={styles.legendBridgeDot}>
                  <User size={11} color="#FFFFFF" />
                </View>
                <Text style={styles.legendText}>{t('network.legendBridge', { defaultValue: '你可能認識' })}</Text>
              </View>
              {data.contacts.length > 0 && (
                <View style={styles.legendItem}>
                  <View style={styles.legendContactDot} />
                  <Text style={styles.legendText}>{t('network.legendContact', { defaultValue: '還沒加入 PikTag' })}</Text>
                </View>
              )}
              <Text style={styles.zoomHint}>{t('network.zoomHint', { defaultValue: '雙指縮放 · 拖曳移動' })}</Text>
            </View>

            {data.bridges.length > 0 && (
              <View style={styles.bridgeSection}>
                <Text style={styles.bridgeHeader}>{t('network.bridgeHeader', { defaultValue: '你可能認識' })}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bridgeStrip}>
                  {data.bridges.map((b) => (
                    <TouchableOpacity key={b.id} style={styles.bridgeCard} activeOpacity={0.7} onPress={() => onBridgeTap(b.id)}>
                      <View style={styles.bridgeAvatar}><Users size={20} color={colors.gray400} /></View>
                      <Text style={styles.bridgeCardText} numberOfLines={2}>
                        {t('network.bridgeMutual', { n: b.mutual_count, defaultValue: `${b.mutual_count} 位好友認識` })}
                      </Text>
                      <ChevronRight size={14} color={colors.gray400} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={styles.footnote}>{t('network.footnote', { defaultValue: '只有你看得到自己的人脈圖。' })}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────
function friendRadius(deg: number, maxDeg: number): number {
  const tt = maxDeg > 0 ? deg / maxDeg : 0;
  return 13 + 6 * Math.sqrt(tt);
}
function shortLabel(name: string): string {
  const base = (name || '').trim();
  const first = base.split(/\s+/)[0] || base;
  return first.length > 8 ? `${first.slice(0, 8)}…` : first;
}
function initialOfName(name: string): string {
  const base = (name || '?').trim();
  return (base[0] || '?').toUpperCase();
}
function shortName(f: FriendNode): string {
  return shortLabel(f.full_name || f.username || '');
}
function initialOf(f: FriendNode): string {
  return initialOfName(f.full_name || f.username || '?');
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.white },
    header: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: c.gray100, gap: 8,
    },
    headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '800', color: c.gray900 },
    headerSubtitle: { fontSize: 12, color: c.gray500, marginTop: 2 },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    body: { flex: 1 },
    graphBox: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    belowGraph: { paddingTop: 4 },

    emptyWrap: { alignItems: 'center', paddingHorizontal: 36, gap: 12 },
    emptyIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: c.piktag50, marginBottom: 4 },
    emptyTitle: { fontSize: 19, fontWeight: '800', color: c.gray900 },
    emptyDesc: { fontSize: 14, color: c.gray500, textAlign: 'center', lineHeight: 20 },
    emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: c.piktag500, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 },
    emptyCtaText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

    // flexWrap: three legend items + the zoom hint won't fit one row on
    // narrow screens once the contact tier is present.
    legendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, marginBottom: 2 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendFriendDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.piktag500 },
    legendBridgeDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: c.gray500, alignItems: 'center', justifyContent: 'center' },
    legendContactDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: CONTACT_CORAL },
    legendText: { fontSize: 12, color: c.gray600 },
    zoomHint: { marginLeft: 'auto', fontSize: 11, color: c.gray400 },

    bridgeSection: { marginTop: 14 },
    bridgeHeader: { fontSize: 14, fontWeight: '700', color: c.gray900, paddingHorizontal: 16, marginBottom: 10 },
    bridgeStrip: { paddingHorizontal: 16, gap: 10 },
    bridgeCard: { width: 150, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.fill },
    bridgeAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.4, borderColor: c.gray300, borderStyle: 'dashed', backgroundColor: 'transparent' },
    bridgeCardText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.gray700 },

    footnote: { fontSize: 11, color: c.gray400, textAlign: 'center', paddingHorizontal: 24, marginTop: 16, marginBottom: 8 },
  });
}
