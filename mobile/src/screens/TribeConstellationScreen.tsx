// TribeConstellationScreen.tsx
//
// "Tribe Constellation" — an anonymous radial visualization of
// the lineage tree rooted at the current user. Every dot is a
// person the user (transitively) brought to PikTag; every line
// is an invite edge. No names, no avatars, no IDs ever rendered
// — privacy-by-default. The user can only view their OWN
// constellation (the RPC is auth.uid()-guarded server-side).
//
// Visual design:
//   • Center dot   = the viewer ("you")
//   • Ring N       = generation N descendants
//   • Dot SIZE     = proportional to that node's own downstream
//                    count; nodes that personally brought lots
//                    of people in render as larger orbs
//   • Lines        = parent → child invites
//
// Render is pure SVG (react-native-svg). No interaction in v1
// beyond a back-button — taps on dots don't reveal IDs because
// we never want to expose them. If interactivity is added
// later, the most we'd show is "this branch has N descendants",
// still without identifying who any specific dot is.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Share2 } from 'lucide-react-native';
import Svg, { Circle, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type LineageNode = {
  node_id: string;
  parent_id: string | null;
  depth: number;
  downstream_count: number;
};

type Props = { navigation: any };

// Layout config — tuned for a 360-ish point-wide screen. The
// canvas itself scales to whatever the actual viewport is; only
// these radii / sizes scale with it.
const RING_GAP = 70;          // distance between concentric generations
const MAX_RINGS = 6;          // visual cap; deeper nodes collapse onto the outermost ring
const BASE_DOT_RADIUS = 4;    // a node with zero downstream
const MAX_DOT_RADIUS = 14;    // a node that brought in a huge subtree
const CENTER_DOT_RADIUS = 18; // "you"
const LINE_STROKE_WIDTH = 1;

export default function TribeConstellationScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();

  const [lineage, setLineage] = useState<LineageNode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLineage = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // get_tribe_lineage is auth.uid()-guarded server-side, so
      // we don't pass a user id — the RPC always returns the
      // caller's own subtree. PGRST202 = function not deployed
      // yet → silent fallback to empty state.
      const { data, error } = await supabase.rpc('get_tribe_lineage');
      if (error) {
        const isMissing =
          (error as any).code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(error.message);
        if (!isMissing) {
          console.warn('[TribeConstellation] fetch failed:', error);
        }
        setLineage([]);
      } else if (Array.isArray(data)) {
        setLineage(data as LineageNode[]);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchLineage();
  }, [fetchLineage]);

  // ─── Geometry ──────────────────────────────────────────────
  // Each node gets (x, y) placed on its generation's ring.
  // Within a ring, nodes are evenly distributed by angle. To
  // avoid the worst case where every Gen-1 root spawns radial
  // chains directly outward (visually misleading because it
  // makes one root look like a long arm even when its subtree
  // is small), we lay out by GENERATION first then re-anchor
  // each child near its parent's angle (parent-centric arc).
  const { positions, lines, width, height } = useMemo(() => {
    const screenW = Dimensions.get('window').width;
    const canvasSize = Math.min(screenW - 32, 360);
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;

    const pos = new Map<string, { x: number; y: number; r: number }>();

    if (lineage.length === 0) {
      return { positions: pos, lines: [] as { x1: number; y1: number; x2: number; y2: number }[], width: canvasSize, height: canvasSize };
    }

    // Group by depth and seed Gen-1 evenly. Within each ring we
    // bias child angles toward their parent's angle (parents'
    // children cluster, so a viewer can read "this big lobe is
    // one branch" without IDs).
    const byDepth = new Map<number, LineageNode[]>();
    for (const node of lineage) {
      const d = Math.min(node.depth, MAX_RINGS);
      const arr = byDepth.get(d) ?? [];
      arr.push(node);
      byDepth.set(d, arr);
    }

    // Gen 1 — even spread around the center.
    const gen1 = byDepth.get(1) ?? [];
    const angleMap = new Map<string, number>();
    gen1.forEach((node, i) => {
      const angle = (i / Math.max(gen1.length, 1)) * Math.PI * 2 - Math.PI / 2;
      angleMap.set(node.node_id, angle);
      const radius = RING_GAP;
      pos.set(node.node_id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        r: dotRadius(node.downstream_count, gen1),
      });
    });

    // Gen 2+ — group by parent, sweep a small arc around the
    // parent's angle (so a parent with 5 kids gets a fan of 5
    // pointing roughly outward from itself).
    for (let depth = 2; depth <= MAX_RINGS; depth++) {
      const generation = byDepth.get(depth) ?? [];
      if (generation.length === 0) continue;
      // Group by parent.
      const byParent = new Map<string, LineageNode[]>();
      for (const node of generation) {
        const pid = node.parent_id ?? '__root__';
        const arr = byParent.get(pid) ?? [];
        arr.push(node);
        byParent.set(pid, arr);
      }
      // Lay each parent's children on a small arc around the
      // parent angle. Arc width scales with sibling count so
      // dense parents don't overlap.
      for (const [parentId, kids] of byParent) {
        const parentAngle = angleMap.get(parentId) ?? 0;
        const arcSpan = Math.min(Math.PI / 2, 0.4 + kids.length * 0.12);
        const startAngle = parentAngle - arcSpan / 2;
        const radius = RING_GAP * depth;
        kids.forEach((node, i) => {
          const tFrac = kids.length === 1 ? 0.5 : i / (kids.length - 1);
          const angle = startAngle + tFrac * arcSpan;
          angleMap.set(node.node_id, angle);
          pos.set(node.node_id, {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius,
            r: dotRadius(node.downstream_count, generation),
          });
        });
      }
    }

    // Build line segments (parent → child).
    const lineSegs: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const node of lineage) {
      const childPos = pos.get(node.node_id);
      if (!childPos) continue;
      // Parent is either another node in `pos` or — for Gen 1 —
      // the center "you" point. We don't have an entry for "you"
      // in `pos`, so fall back to centerX/centerY.
      const parentPos = node.parent_id ? pos.get(node.parent_id) : null;
      lineSegs.push({
        x1: parentPos?.x ?? centerX,
        y1: parentPos?.y ?? centerY,
        x2: childPos.x,
        y2: childPos.y,
      });
    }

    return { positions: pos, lines: lineSegs, width: canvasSize, height: canvasSize };
  }, [lineage]);

  const tribeSize = lineage.length;
  const centerX = width / 2;
  const centerY = height / 2;

  const handleShareSize = useCallback(async () => {
    // Future: share an image of the constellation. For v1, no-op.
    // The button is here as a placeholder for that path; tap is
    // wired to nothing rather than crash. Keep so the layout
    // reads as "this is mine, I can share it" affordance.
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={22} color={COLORS.gray900} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{t('tribe.title', { defaultValue: 'Tribe' })}</Text>
          <Text style={styles.headerSubtitle}>
            {t('tribe.subtitle', {
              count: tribeSize,
              defaultValue: `${tribeSize} 個人因為你加入 PikTag`,
            })}
          </Text>
        </View>
        <TouchableOpacity onPress={handleShareSize} style={styles.headerBtn} hitSlop={8}>
          <Share2 size={20} color={COLORS.gray400} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator size="small" color={COLORS.piktag500} />
        ) : tribeSize === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyDot} />
            <Text style={styles.emptyTitle}>
              {t('tribe.emptyTitle', { defaultValue: '你的 Tribe 還是 0' })}
            </Text>
            <Text style={styles.emptyDesc}>
              {t('tribe.emptyDesc', {
                defaultValue: '分享你的活動 QR、或從設定發邀請連結 — 每個透過你加入的人都會長在這張圖裡。',
              })}
            </Text>
          </View>
        ) : (
          <Svg width={width} height={height}>
            <Defs>
              {/* Soft purple radial gradient for the center "you" dot.
                  Makes the root visually distinct from descendants. */}
              <RadialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={COLORS.piktag500} stopOpacity={1} />
                <Stop offset="100%" stopColor={COLORS.piktag500} stopOpacity={0.6} />
              </RadialGradient>
            </Defs>

            {/* Lines first — they sit BEHIND the dots. */}
            {lines.map((ln, i) => (
              <Line
                key={`l-${i}`}
                x1={ln.x1}
                y1={ln.y1}
                x2={ln.x2}
                y2={ln.y2}
                stroke={COLORS.piktag200}
                strokeWidth={LINE_STROKE_WIDTH}
                opacity={0.5}
              />
            ))}

            {/* Descendant dots. Each one renders the same way —
                anonymous, no metadata. The radius from `pos` is
                what encodes their personal downstream count. */}
            {lineage.map((node) => {
              const p = positions.get(node.node_id);
              if (!p) return null;
              return (
                <Circle
                  key={node.node_id}
                  cx={p.x}
                  cy={p.y}
                  r={p.r}
                  fill={COLORS.piktag500}
                  opacity={0.85}
                />
              );
            })}

            {/* "You" — the center dot, always largest, glow-styled
                to read as the anchor. */}
            <Circle
              cx={centerX}
              cy={centerY}
              r={CENTER_DOT_RADIUS}
              fill="url(#centerGlow)"
            />
            <Circle
              cx={centerX}
              cy={centerY}
              r={CENTER_DOT_RADIUS + 2}
              fill="none"
              stroke={COLORS.piktag500}
              strokeWidth={1.5}
              opacity={0.3}
            />
          </Svg>
        )}
      </View>

      {tribeSize > 0 ? (
        <Text style={styles.footnote}>
          {t('tribe.footnote', {
            defaultValue: '只有你看得到自己的 Tribe 星圖。',
          })}
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

// Dot radius from a node's downstream count, scaled relative to
// the max in its generation. Generations with one big node and
// many small ones get visual hierarchy; generations of equals
// get equal dots.
function dotRadius(downstream: number, peers: { downstream_count: number }[]): number {
  const max = Math.max(1, ...peers.map((p) => p.downstream_count));
  const t = Math.min(downstream / max, 1);
  return BASE_DOT_RADIUS + (MAX_DOT_RADIUS - BASE_DOT_RADIUS) * Math.sqrt(t);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    gap: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.gray900 },
  headerSubtitle: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },

  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },

  // Empty state — a single dot + copy that points the user at
  // the two paths that grow Tribe size (invite link, Vibe QR).
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.piktag500,
    opacity: 0.6,
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.gray900 },
  emptyDesc: {
    fontSize: 13,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 19,
  },

  footnote: {
    fontSize: 11,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
});
