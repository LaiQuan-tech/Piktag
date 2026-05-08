import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Dimensions,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Users,
  TrendingUp,
  Link2,
  QrCode,
  Hash,
  MapPin,
} from 'lucide-react-native';
import Svg, { Path, Circle, Line, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - 40; // 20px padding each side
const CHART_HEIGHT = 160;

type SocialStatsScreenProps = {
  navigation: any;
};

type TimeRange = 'week' | 'month' | 'all';

type GrowthPoint = { date: string; cumulative: number };
type LocationStat = { location: string; count: number };
type PresetScan = { name: string; totalScans: number };
type BiolinkStat = { platform: string; label: string | null; clickCount: number };

type DashboardData = {
  totalFriends: number;
  friendsThisWeek: number;
  friendsThisMonth: number;
  growthCurve: GrowthPoint[];
  presetScans: PresetScan[];
  totalQrScans: number;
  topTags: { name: string; count: number }[];
  semanticBreakdown: { type: string; count: number; percentage: number }[];
  topLocations: LocationStat[];
  activeLocationsThisMonth: LocationStat[];
  totalBiolinkClicks: number;
  topBiolinks: BiolinkStat[];
};

const INITIAL_DATA: DashboardData = {
  totalFriends: 0,
  friendsThisWeek: 0,
  friendsThisMonth: 0,
  growthCurve: [],
  presetScans: [],
  totalQrScans: 0,
  topTags: [],
  semanticBreakdown: [],
  topLocations: [],
  activeLocationsThisMonth: [],
  totalBiolinkClicks: 0,
  topBiolinks: [],
};

export default function SocialStatsScreen({ navigation }: SocialStatsScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [data, setData] = useState<DashboardData>(INITIAL_DATA);

  useEffect(() => {
    fetchDashboard();
  }, [user, timeRange]);

  const fetchDashboard = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Fetch all connection IDs first (needed for tags query)
      const { data: connIds } = await supabase
        .from('piktag_connections')
        .select('id')
        .eq('user_id', user.id);
      const connectionIdList = connIds?.map((c: any) => c.id) || [];

      const [
        allConnectionsResult,
        weekConnectionsResult,
        monthConnectionsResult,
        connectionTagsResult,
        scanSessionsResult,
        presetsResult,
        biolinkClicksResult,
      ] = await Promise.all([
        // 1. All connections (for growth curve, locations, total count)
        supabase
          .from('piktag_connections')
          .select('id, created_at, met_location')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true }),
        // 2. Connections this week
        supabase
          .from('piktag_connections')
          .select('id', { count: 'exact' })
          .eq('user_id', user.id)
          .gte('created_at', weekAgo.toISOString()),
        // 3. Connections this month
        supabase
          .from('piktag_connections')
          .select('id', { count: 'exact' })
          .eq('user_id', user.id)
          .gte('created_at', monthAgo.toISOString()),
        // 4. Connection tags (top 5 tags)
        connectionIdList.length > 0
          ? supabase
              .from('piktag_connection_tags')
              .select('tag:piktag_tags!tag_id(name, semantic_type)')
              .in('connection_id', connectionIdList)
          : Promise.resolve({ data: [] }),
        // 5. Scan sessions — include event_location/event_date so the
        // "if no preset-linked sessions" fallback (further down) can
        // group by location/date as a label. Selecting a narrower
        // projection silently broke the fallback's typing.
        supabase
          .from('piktag_scan_sessions')
          .select('preset_id, scan_count, event_location, event_date')
          .eq('host_user_id', user.id),
        // 6. Presets
        supabase
          .from('piktag_tag_presets')
          .select('id, name')
          .eq('user_id', user.id),
        // 7. Biolink clicks
        supabase
          .from('piktag_biolink_clicks')
          .select('biolink_id, biolink:piktag_biolinks!biolink_id(user_id, platform, label)')
          .not('clicker_user_id', 'eq', user.id),
      ]);

      const allConnections = allConnectionsResult.data || [];

      // ── Growth curve ──
      const dateMap: Record<string, number> = {};
      for (const conn of allConnections) {
        const d = conn.created_at.slice(0, 10); // YYYY-MM-DD
        dateMap[d] = (dateMap[d] || 0) + 1;
      }
      const sortedDates = Object.keys(dateMap).sort();
      let cumulative = 0;
      const growthCurve: GrowthPoint[] = sortedDates.map((date) => {
        cumulative += dateMap[date];
        return { date, cumulative };
      });

      // Filter growth curve by time range
      const rangeStart = timeRange === 'week' ? weekAgo.toISOString().slice(0, 10)
        : timeRange === 'month' ? monthAgo.toISOString().slice(0, 10)
        : null;
      const filteredGrowth = rangeStart
        ? growthCurve.filter((p) => p.date >= rangeStart)
        : growthCurve;

      // ── Top 5 locations ──
      const locMap: Record<string, number> = {};
      for (const conn of allConnections) {
        const loc = conn.met_location;
        if (loc && loc.trim()) {
          locMap[loc] = (locMap[loc] || 0) + 1;
        }
      }
      const topLocations = Object.entries(locMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([location, count]) => ({ location, count }));

      // ── Active locations this month ──
      const monthLocMap: Record<string, number> = {};
      for (const conn of allConnections) {
        if (conn.created_at >= monthAgo.toISOString() && conn.met_location?.trim()) {
          monthLocMap[conn.met_location] = (monthLocMap[conn.met_location] || 0) + 1;
        }
      }
      const activeLocationsThisMonth = Object.entries(monthLocMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([location, count]) => ({ location, count }));

      // ── Top 5 tags ──
      const tagCounts: Record<string, number> = {};
      if (connectionTagsResult.data) {
        for (const ct of connectionTagsResult.data) {
          const tagName = (ct as any).tag?.name;
          if (tagName) {
            tagCounts[tagName] = (tagCounts[tagName] || 0) + 1;
          }
        }
      }
      const topTags = Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      // ── Semantic type breakdown (pie chart data) ──
      const semanticCounts: Record<string, number> = {};
      let totalSemanticTags = 0;
      if (connectionTagsResult.data) {
        for (const ct of connectionTagsResult.data) {
          const st = (ct as any).tag?.semantic_type;
          if (st) {
            semanticCounts[st] = (semanticCounts[st] || 0) + 1;
            totalSemanticTags++;
          }
        }
      }
      const semanticBreakdown = Object.entries(semanticCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => ({
          type,
          count,
          percentage: totalSemanticTags > 0 ? Math.round((count / totalSemanticTags) * 100) : 0,
        }));

      // ── Preset scans ──
      const presetMap: Record<string, string> = {};
      if (presetsResult.data) {
        for (const p of presetsResult.data) {
          presetMap[p.id] = p.name;
        }
      }
      const presetScanMap: Record<string, number> = {};
      let totalQrScans = 0;
      if (scanSessionsResult.data) {
        for (const s of scanSessionsResult.data) {
          const sc = s.scan_count || 0;
          totalQrScans += sc;
          if (s.preset_id && presetMap[s.preset_id]) {
            presetScanMap[s.preset_id] = (presetScanMap[s.preset_id] || 0) + sc;
          }
        }
      }
      const presetScans = Object.entries(presetScanMap)
        .map(([id, totalScans]) => ({ name: presetMap[id], totalScans }))
        .sort((a, b) => b.totalScans - a.totalScans);

      // If no preset-linked sessions, show sessions by event_location as fallback
      if (presetScans.length === 0 && scanSessionsResult.data) {
        const sessionLocMap: Record<string, number> = {};
        for (const s of scanSessionsResult.data) {
          const label = s.event_location || s.event_date || 'QR Session';
          sessionLocMap[label] = (sessionLocMap[label] || 0) + (s.scan_count || 0);
        }
        // We won't add these to presetScans to keep the empty state clear
      }

      // ── Biolink clicks ──
      const ownClicks = (biolinkClicksResult.data || []).filter(
        (c: any) => c.biolink?.user_id === user.id
      );
      const totalBiolinkClicks = ownClicks.length;

      const biolinkCountMap: Record<string, { platform: string; label: string | null; count: number }> = {};
      for (const c of ownClicks) {
        const id = (c as any).biolink_id;
        if (!biolinkCountMap[id]) {
          biolinkCountMap[id] = {
            platform: (c as any).biolink?.platform || '',
            label: (c as any).biolink?.label || null,
            count: 0,
          };
        }
        biolinkCountMap[id].count++;
      }
      const topBiolinks = Object.values(biolinkCountMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((b) => ({ platform: b.platform, label: b.label, clickCount: b.count }));

      setData({
        totalFriends: allConnections.length,
        friendsThisWeek: weekConnectionsResult.count || 0,
        friendsThisMonth: monthConnectionsResult.count || 0,
        growthCurve: filteredGrowth,
        presetScans,
        totalQrScans,
        topTags,
        semanticBreakdown,
        topLocations,
        activeLocationsThisMonth,
        totalBiolinkClicks,
        topBiolinks,
      });
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Line Chart Component ───
  const renderLineChart = (points: GrowthPoint[]) => {
    if (points.length < 2) return null;

    const padding = { top: 10, right: 10, bottom: 30, left: 40 };
    const w = CHART_WIDTH - padding.left - padding.right;
    const h = CHART_HEIGHT - padding.top - padding.bottom;

    const values = points.map((p) => p.cumulative);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    const xStep = w / (points.length - 1);

    const pathParts: string[] = [];
    const dots: { x: number; y: number; val: number }[] = [];

    points.forEach((p, i) => {
      const x = padding.left + i * xStep;
      const y = padding.top + h - ((p.cumulative - minVal) / range) * h;
      dots.push({ x, y, val: p.cumulative });
      if (i === 0) pathParts.push(`M ${x} ${y}`);
      else pathParts.push(`L ${x} ${y}`);
    });

    // Area fill path
    const areaPath = pathParts.join(' ')
      + ` L ${padding.left + (points.length - 1) * xStep} ${padding.top + h}`
      + ` L ${padding.left} ${padding.top + h} Z`;

    // X-axis labels (show ~5 evenly spaced)
    const labelStep = Math.max(1, Math.floor(points.length / 5));
    const xLabels = points.filter((_, i) => i % labelStep === 0 || i === points.length - 1);

    return (
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {/* Area fill */}
        <Path d={areaPath} fill={COLORS.piktag100} opacity={0.5} />
        {/* Line */}
        <Path d={pathParts.join(' ')} fill="none" stroke={COLORS.piktag500} strokeWidth={2.5} />
        {/* Dots */}
        {dots.map((d, i) => (
          <Circle key={i} cx={d.x} cy={d.y} r={3} fill={COLORS.piktag500} />
        ))}
        {/* Y-axis labels */}
        <SvgText x={padding.left - 6} y={padding.top + 4} fontSize={10} fill={COLORS.gray400} textAnchor="end">
          {maxVal}
        </SvgText>
        <SvgText x={padding.left - 6} y={padding.top + h + 4} fontSize={10} fill={COLORS.gray400} textAnchor="end">
          {minVal}
        </SvgText>
        {/* X-axis labels */}
        {xLabels.map((p, i) => {
          const idx = points.indexOf(p);
          const x = padding.left + idx * xStep;
          return (
            <SvgText
              key={i}
              x={x}
              y={CHART_HEIGHT - 4}
              fontSize={9}
              fill={COLORS.gray400}
              textAnchor="middle"
            >
              {p.date.slice(5)} {/* MM-DD */}
            </SvgText>
          );
        })}
        {/* Baseline */}
        <Line
          x1={padding.left}
          y1={padding.top + h}
          x2={CHART_WIDTH - padding.right}
          y2={padding.top + h}
          stroke={COLORS.gray200}
          strokeWidth={1}
        />
      </Svg>
    );
  };

  // ─── Bar Row Component ───
  const renderBarRow = (
    items: { label: string; value: number }[],
    maxValue: number,
    barColor: string = COLORS.piktag400,
    showRank: boolean = true,
  ) => (
    <>
      {items.map((item, index) => (
        <View key={item.label} style={styles.barRow}>
          {showRank && (
            <View style={styles.barRank}>
              <Text style={styles.barRankText}>{index + 1}</Text>
            </View>
          )}
          <Text style={styles.barLabel} numberOfLines={1}>{item.label}</Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max((item.value / (maxValue || 1)) * 100, 8)}%`,
                  backgroundColor: barColor,
                },
              ]}
            />
          </View>
          <Text style={styles.barValue}>{item.value}</Text>
        </View>
      ))}
    </>
  );

  // ─── Stat Card ───
  const StatCard = ({
    icon,
    label,
    value,
    subValue,
    bgColor,
  }: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    subValue?: string;
    bgColor: string;
  }) => (
    <View style={[styles.statCard, { backgroundColor: bgColor }]}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {subValue ? <Text style={styles.statSubValue}>{subValue}</Text> : null}
    </View>
  );

  // ─── Section Title ───
  const SectionTitle = ({ title }: { title: string }) => (
    <Text style={styles.sectionTitle}>{title}</Text>
  );

  // ─── Empty State ───
  const EmptyState = ({ text }: { text: string }) => (
    <Text style={styles.emptyText}>{text}</Text>
  );

  const newFriendsLabel = timeRange === 'week' ? t('dashboard.newFriendsWeek') : t('dashboard.newFriendsMonth');
  const newFriendsValue = timeRange === 'week' ? data.friendsThisWeek : data.friendsThisMonth;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('dashboard.headerTitle')}</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <PageLoader />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Time Range Selector */}
          <View style={styles.timeRangeRow}>
            {(['week', 'month', 'all'] as TimeRange[]).map((range) => (
              <TouchableOpacity
                key={range}
                style={[styles.timeRangeBtn, timeRange === range && styles.timeRangeBtnActive]}
                onPress={() => setTimeRange(range)}
                activeOpacity={0.7}
              >
                <Text style={[styles.timeRangeText, timeRange === range && styles.timeRangeTextActive]}>
                  {range === 'week' ? t('dashboard.timeRangeWeek') : range === 'month' ? t('dashboard.timeRangeMonth') : t('dashboard.timeRangeAll')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Overview Cards (2x2) ── */}
          <View style={styles.statsGrid}>
            <StatCard
              icon={<Users size={20} color={COLORS.piktag600} />}
              label={t('dashboard.totalFriends')}
              value={data.totalFriends}
              bgColor={COLORS.piktag50}
            />
            <StatCard
              icon={<TrendingUp size={20} color={COLORS.piktag500} />}
              label={newFriendsLabel}
              value={newFriendsValue}
              subValue={t('dashboard.newFriendsSub', { count: newFriendsValue })}
              bgColor={COLORS.piktag50}
            />
            <StatCard
              icon={<Link2 size={20} color={COLORS.piktag400} />}
              label={t('dashboard.totalLinkClicks')}
              value={data.totalBiolinkClicks}
              bgColor={COLORS.piktag50}
            />
            <StatCard
              icon={<QrCode size={20} color={COLORS.piktag300} />}
              label={t('dashboard.totalQrScans')}
              value={data.totalQrScans}
              bgColor={COLORS.piktag50}
            />
          </View>

          {/* ── Growth Curve ── */}
          <View style={styles.sectionContainer}>
            <SectionTitle title={t('dashboard.growthCurveTitle')} />
            {data.growthCurve.length >= 2 ? (
              renderLineChart(data.growthCurve)
            ) : (
              <EmptyState text={t('dashboard.growthCurveEmpty')} />
            )}
          </View>

          {/* ── Preset Scans ── */}
          <View style={styles.sectionContainer}>
            <SectionTitle title={t('dashboard.presetScansTitle')} />
            {data.presetScans.length > 0 ? (
              renderBarRow(
                data.presetScans.map((p) => ({ label: p.name, value: p.totalScans })),
                data.presetScans[0]?.totalScans || 1,
                COLORS.piktag500,
                false,
              )
            ) : (
              <EmptyState text={t('dashboard.presetScansEmpty')} />
            )}
          </View>

          {/* ── Network Composition (Semantic Breakdown) ── */}
          <View style={styles.sectionContainer}>
            <SectionTitle title={t('dashboard.networkCompositionTitle', { defaultValue: '人脈組成' })} />
            {data.semanticBreakdown.length > 0 ? (
              <View>
                {/* Simple horizontal bar breakdown */}
                <View style={styles.compositionBarContainer}>
                  {data.semanticBreakdown.map((item, i) => (
                    <View
                      key={item.type}
                      style={[
                        styles.compositionBarSegment,
                        {
                          flex: item.percentage,
                          backgroundColor: [
                            COLORS.piktag200, COLORS.piktag300, COLORS.piktag400,
                            COLORS.piktag500, COLORS.piktag600, COLORS.accent400,
                            COLORS.accent500, COLORS.accent600,
                          ][i % 8],
                        },
                      ]}
                    />
                  ))}
                </View>
                {/* Legend */}
                <View style={styles.compositionLegend}>
                  {data.semanticBreakdown.map((item, i) => (
                    <View key={item.type} style={styles.compositionLegendItem}>
                      <View
                        style={[
                          styles.compositionLegendDot,
                          {
                            backgroundColor: [
                              COLORS.piktag200, COLORS.piktag300, COLORS.piktag400,
                              COLORS.piktag500, COLORS.piktag600, COLORS.accent400,
                              COLORS.accent500, COLORS.accent600,
                            ][i % 8],
                          },
                        ]}
                      />
                      <Text style={styles.compositionLegendText}>
                        {t(`semanticType.${item.type}`) || item.type} {item.percentage}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <EmptyState text={t('dashboard.networkCompositionEmpty', { defaultValue: '尚無分類資料' })} />
            )}
          </View>

          {/* ── Top 5 Tags ── */}
          <View style={styles.sectionContainer}>
            <SectionTitle title={t('dashboard.topTagsTitle')} />
            {data.topTags.length > 0 ? (
              renderBarRow(
                data.topTags.map((tag) => ({ label: `#${tag.name}`, value: tag.count })),
                data.topTags[0]?.count || 1,
                COLORS.piktag400,
              )
            ) : (
              <EmptyState text={t('dashboard.topTagsEmpty')} />
            )}
          </View>

          {/* ── Top 5 Locations ── */}
          <View style={styles.sectionContainer}>
            <SectionTitle title={t('dashboard.topLocationsTitle')} />
            {data.topLocations.length > 0 ? (
              renderBarRow(
                data.topLocations.map((loc) => ({ label: loc.location, value: loc.count })),
                data.topLocations[0]?.count || 1,
                COLORS.piktag300,
              )
            ) : (
              <EmptyState text={t('dashboard.topLocationsEmpty')} />
            )}
          </View>

          {/* ── Active Locations This Month ── */}
          <View style={styles.sectionContainer}>
            <SectionTitle title={t('dashboard.activeLocationsTitle')} />
            {data.activeLocationsThisMonth.length > 0 ? (
              <View style={styles.chipRow}>
                {data.activeLocationsThisMonth.map((loc) => (
                  <View key={loc.location} style={styles.locationChip}>
                    <MapPin size={12} color={COLORS.piktag600} />
                    <Text style={styles.locationChipText}>{loc.location}</Text>
                    <Text style={styles.locationChipCount}>{loc.count}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState text={t('dashboard.activeLocationsEmpty')} />
            )}
          </View>

          {/* ── Top Biolinks ── */}
          <View style={styles.sectionContainer}>
            <SectionTitle title={t('dashboard.topBiolinksTitle')} />
            {data.topBiolinks.length > 0 ? (
              <>
                {data.topBiolinks.map((link, index) => (
                  <View key={index} style={styles.biolinkRow}>
                    <View style={styles.biolinkRank}>
                      <Text style={styles.biolinkRankText}>{index + 1}</Text>
                    </View>
                    <View style={styles.biolinkInfo}>
                      <Text style={styles.biolinkPlatform}>{link.platform}</Text>
                      {link.label ? <Text style={styles.biolinkLabel} numberOfLines={1}>{link.label}</Text> : null}
                    </View>
                    <Text style={styles.biolinkClicks}>
                      {t('dashboard.clickCount', { count: link.clickCount })}
                    </Text>
                  </View>
                ))}
              </>
            ) : (
              <EmptyState text={t('dashboard.topBiolinksEmpty')} />
            )}
          </View>
        </ScrollView>
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
    padding: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },

  // ── Time Range ──
  timeRangeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  timeRangeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: COLORS.gray100,
  },
  timeRangeBtnActive: {
    backgroundColor: COLORS.piktag500,
  },
  timeRangeText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray600,
  },
  timeRangeTextActive: {
    color: COLORS.white,
  },

  // ── Stats Grid ──
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    width: '48%',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.gray900,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.gray600,
  },
  statSubValue: {
    fontSize: 11,
    color: COLORS.gray500,
  },

  // ── Sections ──
  sectionContainer: {
    marginBottom: 28,
  },
  compositionBarContainer: {
    flexDirection: 'row',
    height: 20,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 12,
  },
  compositionBarSegment: {
    height: '100%',
  },
  compositionLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  compositionLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compositionLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  compositionLegendText: {
    fontSize: 13,
    color: COLORS.gray600,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // ── Bar Chart Rows ──
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  barRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.piktag100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  barLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
    width: 80,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.gray100,
    borderRadius: 4,
  },
  barFill: {
    height: 8,
    borderRadius: 4,
  },
  barValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray600,
    width: 30,
    textAlign: 'right',
  },

  // ── Location Chips ──
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray50,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  locationChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  locationChipCount: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.piktag600,
    backgroundColor: COLORS.piktag50,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },

  // ── Biolink Rows ──
  biolinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  biolinkRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  biolinkRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  biolinkInfo: {
    flex: 1,
  },
  biolinkPlatform: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  biolinkLabel: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 2,
  },
  biolinkClicks: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray500,
  },
});
