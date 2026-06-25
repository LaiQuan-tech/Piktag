// NetworkGraphScreen.tsx
//
// "Your network" — a PSEUDO-3D force-directed graph of how the user's OWN
// friends interconnect (replaces the retired invite-lineage Tribe). Founder
// 2026-06-25/26: users care how their people connect, and the graph proved
// popular → a 3D upgrade ("3D 旋轉 + 從外部進入核心").
//
// 3D is FAKED, not a 3D engine (founder picked 甲 over WebView/three.js):
//   • Force layout runs in 3D (x,y,z); each node is projected to 2D every
//     frame with a slow auto-rotation about the vertical axis, driven by a
//     reanimated `spin` shared value on the UI thread (withRepeat 0→2π,
//     seamless because cos/sin are periodic). Depth → scale + opacity (near =
//     bigger/brighter, far = smaller/dimmer).
//   • Intro "fly-in from outside to core": an `intro` value (0→1) radially
//     EXPANDS node positions at t=0 (×1.7) and converges to ×1 + fades in.
//   • Avatars are circle-clipped with ONE objectBoundingBox ClipPath
//     (transform-independent). Per-node <AnimatedG> + per-edge <AnimatedLine>;
//     all projection math in worklets (no JS per-frame setState).
//
// Two node kinds (data from get_friend_graph()):
//   • Friend node — avatar (or purple initial), tap → FriendDetail.
//   • Bridge node — anonymous gray dot + "?" (a 2nd-degree person you may
//     know; identity hidden until a deliberate tap → UserDetail).

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
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  useFrameCallback,
  Easing,
  cancelAnimation,
  type SharedValue,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, Users, UserPlus } from 'lucide-react-native';
import Svg, { Circle, Line, G, Text as SvgText, Image as SvgImage, ClipPath } from 'react-native-svg';
import { type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const AnimatedG = Reanimated.createAnimatedComponent(G);
const AnimatedLine = Reanimated.createAnimatedComponent(Line);

type FriendNode = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  deg: number;
};
type Bridge = { id: string; mutual_count: number };
type GraphData = {
  friends: FriendNode[];
  edges: [string, string][];
  bridges: Bridge[];
  bridge_edges: [string, string][];
};
type Props = { navigation: any };

type Node3D = {
  i: number;
  id: string;
  type: 'friend' | 'bridge';
  x: number; y: number; z: number; // centered (centroid at origin)
  r: number;
  label?: string;
  avatar?: string | null;
  initial?: string;
};
type Edge3D = {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  kind: 'friend' | 'bridge';
};

const EMPTY: GraphData = { friends: [], edges: [], bridges: [], bridge_edges: [] };
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const SPIN_MS = 48000;          // one full revolution
const INTRO_MS = 1500;          // fly-in duration
const EXPAND = 0.7;             // how far "outside" nodes start (×1.7)
const DEPTH_SCALE = 0.30;       // near/far size delta
const DEPTH_FADE = 0.55;        // near/far opacity delta

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
      const { data: res, error } = await supabase.rpc('get_friend_graph');
      if (error) {
        const isMissing =
          (error as any).code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(error.message);
        if (!isMissing) console.warn('[NetworkGraph] fetch failed:', error);
        setData(EMPTY);
      } else if (res) {
        setData({
          friends: Array.isArray(res.friends) ? res.friends : [],
          edges: Array.isArray(res.edges) ? res.edges : [],
          bridges: Array.isArray(res.bridges) ? res.bridges : [],
          bridge_edges: Array.isArray(res.bridge_edges) ? res.bridge_edges : [],
        });
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // ─── 3D force-directed layout (Fruchterman-Reingold, run once) ───────
  const { nodes, edges, size, cx, cy, depthR } = useMemo(() => {
    const canvas = Math.min(Dimensions.get('window').width - 24, 360);
    const maxDeg = data.friends.reduce((m, f) => Math.max(m, f.deg), 0);

    const laid: Node3D[] = [
      ...data.friends.map((f, idx) => ({
        i: idx, id: f.id, type: 'friend' as const,
        x: 0, y: 0, z: 0, r: friendRadius(f.deg, maxDeg),
        label: shortName(f), avatar: f.avatar_url, initial: initialOf(f),
      })),
      ...data.bridges.map((b, idx) => ({
        i: data.friends.length + idx, id: b.id, type: 'bridge' as const,
        x: 0, y: 0, z: 0, r: 11,
      })),
    ];
    const n = laid.length;
    const cc = canvas / 2;
    if (n === 0) return { nodes: [], edges: [], size: canvas, cx: cc, cy: cc, depthR: 1 };

    const indexOf = new Map<string, number>();
    laid.forEach((nd, i) => indexOf.set(nd.id, i));
    const edgePairs: [number, number, 'friend' | 'bridge'][] = [];
    for (const [a, b] of data.edges) {
      const ia = indexOf.get(a), ib = indexOf.get(b);
      if (ia !== undefined && ib !== undefined) edgePairs.push([ia, ib, 'friend']);
    }
    for (const [bid, fid] of data.bridge_edges) {
      const ib = indexOf.get(bid), iff = indexOf.get(fid);
      if (ib !== undefined && iff !== undefined) edgePairs.push([ib, iff, 'bridge']);
    }

    const px = new Array<number>(n), py = new Array<number>(n), pz = new Array<number>(n);
    // Deterministic seed on a sphere (Fibonacci-ish; no Math.random).
    for (let i = 0; i < n; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const rad = canvas * 0.28;
      px[i] = Math.sin(phi) * Math.cos(theta) * rad;
      py[i] = Math.sin(phi) * Math.sin(theta) * rad;
      pz[i] = Math.cos(phi) * rad;
    }

    const k = 0.62 * Math.cbrt((canvas * canvas * canvas) / n); // 3D ideal length
    const ITER = 140;
    let temp = canvas * 0.12;
    const cool = temp / (ITER + 1);
    const dx = new Array<number>(n), dy = new Array<number>(n), dz = new Array<number>(n);

    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < n; i++) { dx[i] = 0; dy[i] = 0; dz[i] = 0; }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let vx = px[i] - px[j], vy = py[i] - py[j], vz = pz[i] - pz[j];
          let d = Math.sqrt(vx * vx + vy * vy + vz * vz) || 0.01;
          const f = (k * k) / d; vx /= d; vy /= d; vz /= d;
          dx[i] += vx * f; dy[i] += vy * f; dz[i] += vz * f;
          dx[j] -= vx * f; dy[j] -= vy * f; dz[j] -= vz * f;
        }
      }
      for (const [a, b] of edgePairs) {
        let vx = px[a] - px[b], vy = py[a] - py[b], vz = pz[a] - pz[b];
        let d = Math.sqrt(vx * vx + vy * vy + vz * vz) || 0.01;
        const f = (d * d) / k; vx /= d; vy /= d; vz /= d;
        dx[a] -= vx * f; dy[a] -= vy * f; dz[a] -= vz * f;
        dx[b] += vx * f; dy[b] += vy * f; dz[b] += vz * f;
      }
      for (let i = 0; i < n; i++) {
        dx[i] += -px[i] * 0.02; dy[i] += -py[i] * 0.02; dz[i] += -pz[i] * 0.02;
      }
      for (let i = 0; i < n; i++) {
        const dl = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i] + dz[i] * dz[i]) || 0.01;
        const step = Math.min(dl, temp);
        px[i] += (dx[i] / dl) * step; py[i] += (dy[i] / dl) * step; pz[i] += (dz[i] / dl) * step;
      }
      temp = Math.max(temp - cool, canvas * 0.008);
    }

    // Center the cloud + fit it inside the canvas with padding.
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += px[i]; my += py[i]; mz += pz[i]; }
    mx /= n; my /= n; mz /= n;
    let maxR = 1;
    for (let i = 0; i < n; i++) {
      px[i] -= mx; py[i] -= my; pz[i] -= mz;
      maxR = Math.max(maxR, Math.sqrt(px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i]));
    }
    const fit = (canvas / 2 - 44) / maxR; // leave room for labels + depth scale
    for (let i = 0; i < n; i++) { px[i] *= fit; py[i] *= fit; pz[i] *= fit; }
    laid.forEach((nd, i) => { nd.x = px[i]; nd.y = py[i]; nd.z = pz[i]; });

    const edges3d: Edge3D[] = edgePairs.map(([a, b, kind]) => ({
      ax: px[a], ay: py[a], az: pz[a], bx: px[b], by: py[b], bz: pz[b], kind,
    }));

    return { nodes: laid, edges: edges3d, size: canvas, cx: cc, cy: cc, depthR: maxR * fit };
  }, [data]);

  // ─── Animation drivers (rotation + intro) — UI thread ────────────────
  const spin = useSharedValue(0);
  const intro = useSharedValue(0);
  // Auto-rotation PAUSES while the user touches the graph (founder 2026-06-26:
  // don't make them tap a moving target), resumes on release. Driven by a
  // frame callback so pause/resume is exact (no withRepeat continuation math).
  const paused = useSharedValue(false);
  // pinch-zoom + pan (outer container)
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const hasGraph = data.friends.length > 0;

  useEffect(() => {
    if (!hasGraph) return;
    intro.value = 0;
    intro.value = withTiming(1, { duration: INTRO_MS, easing: Easing.out(Easing.cubic) });
    return () => { cancelAnimation(intro); };
  }, [hasGraph, intro]);

  // Continuous rotation, except while paused (finger on the graph). Advance by
  // real elapsed time so the speed is frame-rate independent; wrap at 2π.
  useFrameCallback((frame) => {
    if (paused.value) return;
    const dt = frame.timeSincePreviousFrame ?? 16;
    spin.value = (spin.value + ((Math.PI * 2) / SPIN_MS) * dt) % (Math.PI * 2);
  });

  const pinch = Gesture.Pinch()
    .onBegin(() => { paused.value = true; })
    .onUpdate((e) => { scale.value = Math.min(Math.max(savedScale.value * e.scale, MIN_ZOOM), MAX_ZOOM); })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_ZOOM + 0.01) { tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0; }
    })
    .onFinalize(() => { paused.value = false; });
  const pan = Gesture.Pan()
    .minDistance(8)
    // onBegin fires on finger-DOWN (before the 8px activation), so the graph
    // freezes the instant you touch it — even for a stationary tap on a node.
    .onBegin(() => { paused.value = true; })
    .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; })
    .onFinalize(() => { paused.value = false; });
  const composed = Gesture.Simultaneous(pinch, pan);
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const onFriendTap = useCallback((id: string) => navigation.navigate('FriendDetail', { friendId: id }), [navigation]);
  const onBridgeTap = useCallback((id: string) => navigation.navigate('UserDetail', { userId: id }), [navigation]);

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
          {hasGraph && (
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
                {edges.map((e, i) => (
                  <GraphEdge key={`e-${i}`} edge={e} spin={spin} intro={intro} cx={cx} cy={cy} depthR={depthR} colors={colors} />
                ))}
                {nodes.map((nd) => (
                  <GraphNode
                    key={nd.id}
                    nd={nd}
                    spin={spin}
                    intro={intro}
                    cx={cx}
                    cy={cy}
                    depthR={depthR}
                    colors={colors}
                    onPress={() => (nd.type === 'friend' ? onFriendTap(nd.id) : onBridgeTap(nd.id))}
                  />
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
                  <Text style={styles.legendBridgeQ}>?</Text>
                </View>
                <Text style={styles.legendText}>{t('network.legendBridge', { defaultValue: '你可能認識' })}</Text>
              </View>
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

// ─── Animated node (projected + depth-scaled per frame on the UI thread) ──
function GraphNode({
  nd, spin, intro, cx, cy, depthR, colors, onPress,
}: {
  nd: Node3D; spin: SharedValue<number>; intro: SharedValue<number>;
  cx: number; cy: number; depthR: number; colors: ColorPalette; onPress: () => void;
}) {
  const aProps = useAnimatedProps(() => {
    const t = spin.value;
    const iv = intro.value;
    const expand = 1 + (1 - iv) * EXPAND;
    const ct = Math.cos(t), st = Math.sin(t);
    const X = nd.x * ct + nd.z * st;
    const Z = -nd.x * st + nd.z * ct;
    const sx = cx + X * expand;
    const sy = cy + nd.y * expand;
    const dn = depthR > 0 ? Z / depthR : 0;            // -1 (near) .. 1 (far)
    const s = 1 - dn * DEPTH_SCALE;
    const opacity = (1 - ((dn + 1) / 2) * DEPTH_FADE) * iv;
    return { opacity, transform: [{ translateX: sx }, { translateY: sy }, { scale: s }] };
  });

  const r = nd.r;
  return (
    <AnimatedG animatedProps={aProps} onPress={onPress}>
      {/* invisible hit target (drawn at local origin) */}
      <Circle cx={0} cy={0} r={Math.max(r + 9, 18)} fill="#000000" fillOpacity={0} />
      {nd.type === 'friend' ? (
        <>
          {nd.avatar ? (
            <>
              {/* Per-node clip in LOCAL coords — lives inside the transformed G,
                  so it follows the node's projection (an absolute-coord clip in
                  <Defs> would not). */}
              <ClipPath id={`clip-${nd.i}`}>
                <Circle cx={0} cy={0} r={r} />
              </ClipPath>
              <SvgImage x={-r} y={-r} width={r * 2} height={r * 2} href={{ uri: nd.avatar }}
                preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${nd.i})`} />
              <Circle cx={0} cy={0} r={r} fill="none" stroke={colors.piktag500} strokeWidth={1.5} />
            </>
          ) : (
            <>
              <Circle cx={0} cy={0} r={r} fill={colors.piktag500} opacity={0.9} />
              <SvgText x={0} y={r * 0.38} fill="#FFFFFF" fontSize={r} fontWeight="700" textAnchor="middle">{nd.initial}</SvgText>
            </>
          )}
          {nd.label ? (
            <SvgText x={0} y={r + 11} fill={colors.gray600} fontSize={9} fontWeight="600" textAnchor="middle">{nd.label}</SvgText>
          ) : null}
        </>
      ) : (
        <>
          <Circle cx={0} cy={0} r={r} fill={colors.gray500} opacity={0.92} />
          <SvgText x={0} y={r * 0.36} fill="#FFFFFF" fontSize={r * 1.15} fontWeight="700" textAnchor="middle">?</SvgText>
        </>
      )}
    </AnimatedG>
  );
}

function GraphEdge({
  edge, spin, intro, cx, cy, depthR, colors,
}: {
  edge: Edge3D; spin: SharedValue<number>; intro: SharedValue<number>;
  cx: number; cy: number; depthR: number; colors: ColorPalette;
}) {
  const aProps = useAnimatedProps(() => {
    const t = spin.value;
    const iv = intro.value;
    const expand = 1 + (1 - iv) * EXPAND;
    const ct = Math.cos(t), st = Math.sin(t);
    const ax = cx + (edge.ax * ct + edge.az * st) * expand;
    const ay = cy + edge.ay * expand;
    const bx = cx + (edge.bx * ct + edge.bz * st) * expand;
    const by = cy + edge.by * expand;
    const az = -edge.ax * st + edge.az * ct;
    const bz = -edge.bx * st + edge.bz * ct;
    const dn = depthR > 0 ? ((az + bz) / 2) / depthR : 0;
    const base = edge.kind === 'friend' ? 0.45 : 0.5;
    const opacity = (1 - ((dn + 1) / 2) * 0.45) * iv * base;
    return { x1: ax, y1: ay, x2: bx, y2: by, opacity };
  });
  return (
    <AnimatedLine
      animatedProps={aProps}
      stroke={edge.kind === 'friend' ? colors.piktag400 : colors.gray400}
      strokeWidth={edge.kind === 'friend' ? 1.2 : 1}
      strokeDasharray={edge.kind === 'bridge' ? '3,3' : undefined}
    />
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────
function friendRadius(deg: number, maxDeg: number): number {
  const tt = maxDeg > 0 ? deg / maxDeg : 0;
  return 13 + 6 * Math.sqrt(tt);
}
function shortName(f: FriendNode): string {
  const base = (f.full_name || f.username || '').trim();
  const first = base.split(/\s+/)[0] || base;
  return first.length > 8 ? `${first.slice(0, 8)}…` : first;
}
function initialOf(f: FriendNode): string {
  const base = (f.full_name || f.username || '?').trim();
  return (base[0] || '?').toUpperCase();
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

    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 16, marginBottom: 2 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendFriendDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.piktag500 },
    legendBridgeDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: c.gray500, alignItems: 'center', justifyContent: 'center' },
    legendBridgeQ: { fontSize: 10, fontWeight: '700', color: '#FFFFFF', lineHeight: 12 },
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
