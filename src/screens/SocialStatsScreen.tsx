import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Users,
  Tag,
  MessageCircle,
  TrendingUp,
  Calendar,
  Star,
  BarChart3,
  Hash,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type SocialStatsScreenProps = {
  navigation: any;
};

type StatsData = {
  totalConnections: number;
  connectionsThisWeek: number;
  connectionsThisMonth: number;
  totalTags: number;
  topTags: { name: string; count: number }[];
  totalNotes: number;
  totalMessages: number;
  messagesThisWeek: number;
  biolinksClicks: number;
  verifiedFriends: number;
  averageTagsPerConnection: number;
  oldestConnection: string | null;
  newestConnection: string | null;
};

type TimeRange = 'week' | 'month' | 'all';

export default function SocialStatsScreen({ navigation }: SocialStatsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [stats, setStats] = useState<StatsData>({
    totalConnections: 0,
    connectionsThisWeek: 0,
    connectionsThisMonth: 0,
    totalTags: 0,
    topTags: [],
    totalNotes: 0,
    totalMessages: 0,
    messagesThisWeek: 0,
    biolinksClicks: 0,
    verifiedFriends: 0,
    averageTagsPerConnection: 0,
    oldestConnection: null,
    newestConnection: null,
  });

  useEffect(() => {
    fetchStats();
  }, [user, timeRange]);

  const fetchStats = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Determine date filter based on timeRange
      const rangeStart = timeRange === 'week' ? weekAgo.toISOString()
        : timeRange === 'month' ? monthAgo.toISOString()
        : null;

      // First fetch connection IDs (needed for tags query)
      const { data: connIds } = await supabase
        .from('piktag_connections')
        .select('id')
        .eq('user_id', user.id);
      const connectionIdList = connIds?.map((c: any) => c.id) || [];

      // Parallel queries
      let connectionsQuery = supabase
        .from('piktag_connections')
        .select('id, created_at, connected_user:piktag_profiles!connected_user_id(is_verified)', { count: 'exact' })
        .eq('user_id', user.id);
      if (rangeStart) connectionsQuery = connectionsQuery.gte('created_at', rangeStart);

      let notesQuery = supabase
        .from('piktag_notes')
        .select('id', { count: 'exact' })
        .eq('user_id', user.id);
      if (rangeStart) notesQuery = notesQuery.gte('created_at', rangeStart);

      let messagesQuery = supabase
        .from('piktag_messages')
        .select('id', { count: 'exact' })
        .eq('sender_id', user.id);
      if (rangeStart) messagesQuery = messagesQuery.gte('created_at', rangeStart);

      let biolinksQuery = supabase
        .from('piktag_biolink_clicks')
        .select('id, biolink:piktag_biolinks!biolink_id(user_id)', { count: 'exact' })
        .not('clicker_user_id', 'eq', user.id);
      if (rangeStart) biolinksQuery = biolinksQuery.gte('created_at', rangeStart);

      const [
        connectionsResult,
        connectionsWeekResult,
        connectionsMonthResult,
        connectionTagsResult,
        notesResult,
        messagesResult,
        messagesWeekResult,
        biolinksClicksResult,
      ] = await Promise.all([
        connectionsQuery,
        // Connections this week (always fetch for subValue)
        supabase
          .from('piktag_connections')
          .select('id', { count: 'exact' })
          .eq('user_id', user.id)
          .gte('created_at', weekAgo.toISOString()),
        // Connections this month (always fetch for subValue)
        supabase
          .from('piktag_connections')
          .select('id', { count: 'exact' })
          .eq('user_id', user.id)
          .gte('created_at', monthAgo.toISOString()),
        // Connection tags (for top tags)
        connectionIdList.length > 0
          ? supabase
              .from('piktag_connection_tags')
              .select('tag:piktag_tags!tag_id(name)')
              .in('connection_id', connectionIdList)
          : Promise.resolve({ data: [], count: 0 }),
        notesQuery,
        messagesQuery,
        // Messages this week (always fetch for subValue)
        supabase
          .from('piktag_messages')
          .select('id', { count: 'exact' })
          .eq('sender_id', user.id)
          .gte('created_at', weekAgo.toISOString()),
        biolinksQuery,
      ]);

      // Calculate top tags
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

      // Count verified friends
      let verifiedCount = 0;
      if (connectionsResult.data) {
        verifiedCount = connectionsResult.data.filter(
          (c: any) => c.connected_user?.is_verified
        ).length;
      }

      // Get oldest/newest
      let oldest: string | null = null;
      let newest: string | null = null;
      if (connectionsResult.data && connectionsResult.data.length > 0) {
        const sorted = [...connectionsResult.data].sort(
          (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        oldest = sorted[0].created_at;
        newest = sorted[sorted.length - 1].created_at;
      }

      const totalConnections = connectionsResult.count || 0;
      const totalTagsUsed = connectionTagsResult.data?.length || 0;

      // Filter biolink clicks to only own biolinks
      const ownClicks = biolinksClicksResult.data?.filter(
        (c: any) => c.biolink?.user_id === user.id
      ).length || 0;

      setStats({
        totalConnections,
        connectionsThisWeek: connectionsWeekResult.count || 0,
        connectionsThisMonth: connectionsMonthResult.count || 0,
        totalTags: Object.keys(tagCounts).length,
        topTags,
        totalNotes: notesResult.count || 0,
        totalMessages: messagesResult.count || 0,
        messagesThisWeek: messagesWeekResult.count || 0,
        biolinksClicks: ownClicks,
        verifiedFriends: verifiedCount,
        averageTagsPerConnection: totalConnections > 0
          ? Math.round((totalTagsUsed / totalConnections) * 10) / 10
          : 0,
        oldestConnection: oldest,
        newestConnection: newest,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };

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
      {subValue && <Text style={styles.statSubValue}>{subValue}</Text>}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>社交統計報表</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Time range selector */}
          <View style={styles.timeRangeRow}>
            {(['week', 'month', 'all'] as TimeRange[]).map((range) => (
              <TouchableOpacity
                key={range}
                style={[
                  styles.timeRangeBtn,
                  timeRange === range && styles.timeRangeBtnActive,
                ]}
                onPress={() => setTimeRange(range)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.timeRangeText,
                    timeRange === range && styles.timeRangeTextActive,
                  ]}
                >
                  {range === 'week' ? '本週' : range === 'month' ? '本月' : '全部'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Main stats grid */}
          <View style={styles.statsGrid}>
            <StatCard
              icon={<Users size={20} color="#3b82f6" />}
              label="總人脈"
              value={stats.totalConnections}
              subValue={`本月 +${stats.connectionsThisMonth}`}
              bgColor="#eff6ff"
            />
            <StatCard
              icon={<Tag size={20} color="#0fcdd6" />}
              label="使用標籤數"
              value={stats.totalTags}
              subValue={`平均 ${stats.averageTagsPerConnection}/人`}
              bgColor="#fef9e8"
            />
            <StatCard
              icon={<MessageCircle size={20} color="#22c55e" />}
              label="發送訊息"
              value={stats.totalMessages}
              subValue={`本週 +${stats.messagesThisWeek}`}
              bgColor="#f0fdf4"
            />
            <StatCard
              icon={<TrendingUp size={20} color="#ec4899" />}
              label="連結點擊"
              value={stats.biolinksClicks}
              bgColor="#fdf2f8"
            />
            <StatCard
              icon={<Star size={20} color="#f97316" />}
              label="認證好友"
              value={stats.verifiedFriends}
              bgColor="#fff7ed"
            />
            <StatCard
              icon={<BarChart3 size={20} color="#a855f7" />}
              label="便利貼"
              value={stats.totalNotes}
              bgColor="#f5f3ff"
            />
          </View>

          {/* Top Tags */}
          {stats.topTags.length > 0 && (
            <View style={styles.topTagsSection}>
              <Text style={styles.sectionTitle}>最常用標籤 Top 5</Text>
              {stats.topTags.map((tag, index) => (
                <View key={tag.name} style={styles.topTagRow}>
                  <View style={styles.topTagRank}>
                    <Text style={styles.topTagRankText}>{index + 1}</Text>
                  </View>
                  <Hash size={14} color={COLORS.piktag600} />
                  <Text style={styles.topTagName}>{tag.name}</Text>
                  <View style={styles.topTagBarContainer}>
                    <View
                      style={[
                        styles.topTagBar,
                        {
                          width: `${Math.max(
                            (tag.count / (stats.topTags[0]?.count || 1)) * 100,
                            10
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.topTagCount}>{tag.count}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Timeline */}
          <View style={styles.timelineSection}>
            <Text style={styles.sectionTitle}>人脈時間軸</Text>
            <View style={styles.timelineRow}>
              <Calendar size={16} color={COLORS.gray500} />
              <Text style={styles.timelineLabel}>最早人脈</Text>
              <Text style={styles.timelineValue}>
                {formatDate(stats.oldestConnection)}
              </Text>
            </View>
            <View style={styles.timelineDivider} />
            <View style={styles.timelineRow}>
              <Calendar size={16} color={COLORS.piktag600} />
              <Text style={styles.timelineLabel}>最新人脈</Text>
              <Text style={styles.timelineValue}>
                {formatDate(stats.newestConnection)}
              </Text>
            </View>
          </View>

          {/* Weekly summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>本週摘要</Text>
            <Text style={styles.summaryText}>
              本週新增了 {stats.connectionsThisWeek} 位人脈，
              發送了 {stats.messagesThisWeek} 則訊息。
              {stats.biolinksClicks > 0
                ? `你的社群連結被點擊了 ${stats.biolinksClicks} 次！`
                : ''}
            </Text>
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
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
    color: COLORS.gray900,
  },
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
  topTagsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 14,
  },
  topTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  topTagRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.piktag100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTagRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  topTagName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray900,
    width: 80,
  },
  topTagBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.gray100,
    borderRadius: 4,
  },
  topTagBar: {
    height: 8,
    backgroundColor: COLORS.piktag400,
    borderRadius: 4,
  },
  topTagCount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray600,
    width: 30,
    textAlign: 'right',
  },
  timelineSection: {
    backgroundColor: COLORS.gray50,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  timelineLabel: {
    fontSize: 14,
    color: COLORS.gray600,
    flex: 1,
  },
  timelineValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  timelineDivider: {
    height: 1,
    backgroundColor: COLORS.gray200,
    marginVertical: 8,
  },
  summaryCard: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.piktag100,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 14,
    color: COLORS.gray700,
    lineHeight: 22,
  },
});
