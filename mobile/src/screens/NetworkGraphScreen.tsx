// NetworkGraphScreen.tsx
//
// "Your network" — a force-directed graph of how the user's OWN friends
// interconnect (replaces the retired invite-lineage Tribe constellation,
// which was built on the dead invite-code system and showed a PikTag-vanity
// "who you dragged in" tree). Founder 2026-06-25: users care about how their
// people connect to each other, not how big a referral tree they grew.
//
// Two node kinds (data from get_friend_graph()):
//   • Friend node (filled purple)  = one of the viewer's friends. Identity IS
//     shown (a short name label) — they're the viewer's own friends. Sized by
//     intra-network degree (a friend who links many of your other friends is
//     bigger/more central). Tap → FriendDetail.
//   • Bridge node (hollow gray)    = a 2nd-degree person who connects >=2 of
//     your friends but you don't know yet — the "you may know" connector.
//     ANONYMOUS in the graph (no name/avatar — privacy). A deliberate tap
//     reveals them on UserDetail (which shows mutual-friend count + a connect
//     action under its own privacy checks). The North-Star friend-add payoff.
//
// Edges: friend↔friend (solid purple) reveal clusters; bridge↔friend (dashed
// gray) show what the connector links. @piktag official is excluded server-
// side so it isn't a universal hub. Render is pure react-native-svg; the
// layout is a Fruchterman-Reingold simulation computed ONCE in useMemo
// (no running animation loop — stable static positions).

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
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, Users } from 'lucide-react-native';
import Svg, { Circle, Line, G, Text as SvgText } from 'react-native-svg';
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
type GraphData = {
  friends: FriendNode[];
  edges: [string, string][];
  bridges: Bridge[];
  bridge_edges: [string, string][];
};

type Props = { navigation: any };

type LaidNode = {
  id: string;
  type: 'friend' | 'bridge';
  x: number;
  y: number;
  r: number;
  label?: string;
};

const EMPTY: GraphData = { friends: [], edges: [], bridges: [], bridge_edges: [] };

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
      // auth.uid()-guarded server-side — no args. PGRST202 = not deployed
      // yet → silent empty state (same pattern as the old tribe screen).
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

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // ─── Force-directed layout (Fruchterman-Reingold, run once) ──────────
  const { nodes, friendLines, bridgeLines, size } = useMemo(() => {
    const canvas = Math.min(Dimensions.get('window').width - 24, 380);
    const pad = 36;
    const maxDeg = data.friends.reduce((m, f) => Math.max(m, f.deg), 0);

    const laid: LaidNode[] = [
      ...data.friends.map((f) => ({
        id: f.id,
        type: 'friend' as const,
        x: 0,
        y: 0,
        r: friendRadius(f.deg, maxDeg),
        label: shortName(f),
      })),
      ...data.bridges.map((b) => ({
        id: b.id,
        type: 'bridge' as const,
        x: 0,
        y: 0,
        r: 6,
      })),
    ];

    const n = laid.length;
    if (n === 0) {
      return { nodes: [] as LaidNode[], friendLines: [], bridgeLines: [], size: canvas };
    }

    const indexOf = new Map<string, number>();
    laid.forEach((nd, i) => indexOf.set(nd.id, i));

    // Edge index pairs (only edges whose endpoints are both present).
    const fEdges: [number, number][] = [];
    for (const [a, b] of data.edges) {
      const ia = indexOf.get(a);
      const ib = indexOf.get(b);
      if (ia !== undefined && ib !== undefined) fEdges.push([ia, ib]);
    }
    const bEdges: [number, number][] = [];
    for (const [bid, fid] of data.bridge_edges) {
      const ib = indexOf.get(bid);
      const iff = indexOf.get(fid);
      if (ib !== undefined && iff !== undefined) bEdges.push([ib, iff]);
    }

    const cx = canvas / 2;
    const cy = canvas / 2;
    const px = new Array<number>(n);
    const py = new Array<number>(n);
    // Deterministic seed on a circle (no Math.random → stable across renders).
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      px[i] = cx + Math.cos(a) * canvas * 0.3;
      py[i] = cy + Math.sin(a) * canvas * 0.3;
    }

    const area = canvas * canvas;
    const k = 0.72 * Math.sqrt(area / n); // ideal edge length
    const allEdges = [...fEdges, ...bEdges];
    const ITER = 150;
    let temp = canvas * 0.14;
    const cool = temp / (ITER + 1);

    const dx = new Array<number>(n);
    const dy = new Array<number>(n);
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < n; i++) { dx[i] = 0; dy[i] = 0; }
      // Repulsion between every pair.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let vx = px[i] - px[j];
          let vy = py[i] - py[j];
          let d = Math.sqrt(vx * vx + vy * vy) || 0.01;
          const f = (k * k) / d;
          vx /= d; vy /= d;
          dx[i] += vx * f; dy[i] += vy * f;
          dx[j] -= vx * f; dy[j] -= vy * f;
        }
      }
      // Attraction along edges.
      for (const [a, b] of allEdges) {
        let vx = px[a] - px[b];
        let vy = py[a] - py[b];
        let d = Math.sqrt(vx * vx + vy * vy) || 0.01;
        const f = (d * d) / k;
        vx /= d; vy /= d;
        dx[a] -= vx * f; dy[a] -= vy * f;
        dx[b] += vx * f; dy[b] += vy * f;
      }
      // Mild gravity toward center (keeps disconnected nodes from drifting off).
      for (let i = 0; i < n; i++) {
        dx[i] += (cx - px[i]) * 0.025;
        dy[i] += (cy - py[i]) * 0.025;
      }
      // Apply, capped by temperature, clamped to the canvas.
      for (let i = 0; i < n; i++) {
        const dl = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01;
        px[i] += (dx[i] / dl) * Math.min(dl, temp);
        py[i] += (dy[i] / dl) * Math.min(dl, temp);
        px[i] = Math.max(pad, Math.min(canvas - pad, px[i]));
        py[i] = Math.max(pad, Math.min(canvas - pad, py[i]));
      }
      temp = Math.max(temp - cool, canvas * 0.01);
    }

    laid.forEach((nd, i) => { nd.x = px[i]; nd.y = py[i]; });

    const fLines = fEdges.map(([a, b]) => ({
      x1: px[a], y1: py[a], x2: px[b], y2: py[b],
    }));
    const bLines = bEdges.map(([a, b]) => ({
      x1: px[a], y1: py[a], x2: px[b], y2: py[b],
    }));

    return { nodes: laid, friendLines: fLines, bridgeLines: bLines, size: canvas };
  }, [data]);

  const onFriendTap = useCallback(
    (id: string) => navigation.navigate('FriendDetail', { friendId: id }),
    [navigation],
  );
  const onBridgeTap = useCallback(
    (id: string) => navigation.navigate('UserDetail', { userId: id }),
    [navigation],
  );

  const friendCount = data.friends.length;
  const hasGraph = friendCount > 0;

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
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.piktag500} />
        </View>
      ) : !hasGraph ? (
        <View style={styles.center}>
          <View style={styles.emptyWrap}>
            <Users size={40} color={colors.gray300} />
            <Text style={styles.emptyTitle}>{t('network.emptyTitle', { defaultValue: '人脈圖還在等你' })}</Text>
            <Text style={styles.emptyDesc}>
              {t('network.emptyDesc', {
                defaultValue: '多加幾個好友，這裡就會顯示他們如何彼此連結，還有你可能認識的人。',
              })}
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.graphWrap}>
            <Svg width={size} height={size}>
              {/* Friend↔friend edges — solid, the cluster structure. */}
              {friendLines.map((ln, i) => (
                <Line key={`f-${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                  stroke={colors.piktag400} strokeWidth={1.2} opacity={0.45} />
              ))}
              {/* Bridge↔friend edges — dashed, the "you may know" links. */}
              {bridgeLines.map((ln, i) => (
                <Line key={`b-${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                  stroke={colors.gray400} strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
              ))}
              {/* Nodes (drawn over edges). Each wrapped in a G with onPress +
                  an invisible hit circle so small dots stay tappable. */}
              {nodes.map((nd) => (
                <G key={nd.id} onPress={() => (nd.type === 'friend' ? onFriendTap(nd.id) : onBridgeTap(nd.id))}>
                  <Circle cx={nd.x} cy={nd.y} r={Math.max(nd.r + 9, 16)} fill="#000000" fillOpacity={0} />
                  {nd.type === 'friend' ? (
                    <>
                      <Circle cx={nd.x} cy={nd.y} r={nd.r} fill={colors.piktag500} opacity={0.9} />
                      {nd.label ? (
                        <SvgText x={nd.x} y={nd.y + nd.r + 10} fill={colors.gray600}
                          fontSize={8.5} fontWeight="600" textAnchor="middle">
                          {nd.label}
                        </SvgText>
                      ) : null}
                    </>
                  ) : (
                    // Anonymous bridge — hollow ring, no label, never identifying.
                    <Circle cx={nd.x} cy={nd.y} r={nd.r} fill={colors.background}
                      stroke={colors.gray400} strokeWidth={1.6} strokeDasharray="2,2" />
                  )}
                </G>
              ))}
            </Svg>
          </View>

          {/* Legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={styles.legendFriendDot} />
              <Text style={styles.legendText}>{t('network.legendFriend', { defaultValue: '你的好友' })}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.legendBridgeDot} />
              <Text style={styles.legendText}>{t('network.legendBridge', { defaultValue: '你可能認識' })}</Text>
            </View>
          </View>

          {/* "You may know" — the actionable bridge surface. Anonymous chips;
              a deliberate tap reveals the person on UserDetail. */}
          {data.bridges.length > 0 && (
            <View style={styles.bridgeSection}>
              <Text style={styles.bridgeHeader}>{t('network.bridgeHeader', { defaultValue: '你可能認識' })}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bridgeStrip}>
                {data.bridges.map((b) => (
                  <TouchableOpacity key={b.id} style={styles.bridgeCard} activeOpacity={0.7} onPress={() => onBridgeTap(b.id)}>
                    <View style={styles.bridgeAvatar}>
                      <Users size={20} color={colors.gray400} />
                    </View>
                    <Text style={styles.bridgeCardText} numberOfLines={2}>
                      {t('network.bridgeMutual', { n: b.mutual_count, defaultValue: `${b.mutual_count} 位好友認識` })}
                    </Text>
                    <ChevronRight size={14} color={colors.gray400} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <Text style={styles.footnote}>
            {t('network.footnote', { defaultValue: '只有你看得到自己的人脈圖。' })}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────
function friendRadius(deg: number, maxDeg: number): number {
  const t = maxDeg > 0 ? deg / maxDeg : 0;
  return 6 + 7 * Math.sqrt(t); // 6 (isolated) .. 13 (most central)
}
function shortName(f: FriendNode): string {
  const base = (f.full_name || f.username || '').trim();
  const first = base.split(/\s+/)[0] || base;
  return first.length > 8 ? `${first.slice(0, 8)}…` : first;
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.white },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.gray100,
      gap: 8,
    },
    headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '800', color: c.gray900 },
    headerSubtitle: { fontSize: 12, color: c.gray500, marginTop: 2 },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    scrollContent: { alignItems: 'center', paddingBottom: 28 },
    graphWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 12 },

    emptyWrap: { alignItems: 'center', paddingHorizontal: 32, gap: 10 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: c.gray900, marginTop: 4 },
    emptyDesc: { fontSize: 13, color: c.gray500, textAlign: 'center', lineHeight: 19 },

    legendRow: { flexDirection: 'row', gap: 22, marginTop: 6, marginBottom: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendFriendDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.piktag500 },
    legendBridgeDot: {
      width: 12, height: 12, borderRadius: 6,
      borderWidth: 1.6, borderColor: c.gray400, borderStyle: 'dashed', backgroundColor: 'transparent',
    },
    legendText: { fontSize: 12, color: c.gray600 },

    bridgeSection: { alignSelf: 'stretch', marginTop: 18 },
    bridgeHeader: { fontSize: 14, fontWeight: '700', color: c.gray900, paddingHorizontal: 16, marginBottom: 10 },
    bridgeStrip: { paddingHorizontal: 16, gap: 10 },
    bridgeCard: {
      width: 150,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: c.fill,
    },
    bridgeAvatar: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.4, borderColor: c.gray300, borderStyle: 'dashed', backgroundColor: 'transparent',
    },
    bridgeCardText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.gray700 },

    footnote: { fontSize: 11, color: c.gray400, textAlign: 'center', paddingHorizontal: 24, marginTop: 22 },
  });
}
