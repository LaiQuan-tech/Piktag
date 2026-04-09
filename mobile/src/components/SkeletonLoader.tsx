import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  ViewStyle,
  DimensionValue,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

// ---------------------------------------------------------------------------
// SkeletonBox
// ---------------------------------------------------------------------------

type SkeletonBoxProps = {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export const SkeletonBox = React.memo(function SkeletonBox({
  width,
  height,
  borderRadius = 6,
  style,
}: SkeletonBoxProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    // NOTE: Previously used Animated.loop(Animated.sequence([...])) with
    // useNativeDriver: true. That combination triggers a known RN bug on
    // iOS (Old Architecture): when many SkeletonBox instances unmount at
    // once (e.g. 20+ skeletons in ProfileScreenSkeleton as data loads),
    // the native animated module can throw NSInvalidArgumentException
    // from RCTNativeAnimatedNodesManager stopAnimation:, which RN then
    // reports via RCTExceptionsManager → RCTFatal → abort.
    //
    // Fix: replicate the pulse loop manually using a .start() callback
    // chain guarded by a mounted flag, and clean up by calling
    // stopAnimation() on the Value itself (which is safe) rather than on
    // a composite Animated.loop handle.
    let mounted = true;

    const pulse = () => {
      if (!mounted) return;
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (mounted && finished) pulse();
      });
    };

    pulse();

    return () => {
      mounted = false;
      opacity.stopAnimation();
    };
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: COLORS.gray200,
          opacity,
        },
        style,
      ]}
    />
  );
});

// ---------------------------------------------------------------------------
// ProfileScreenSkeleton
// ---------------------------------------------------------------------------

const TOP_EDGES = ['top'] as const;

export const ProfileScreenSkeleton = React.memo(function ProfileScreenSkeleton() {
  return (
    <SafeAreaView style={styles.container} edges={TOP_EDGES}>
      {/* Header row */}
      <View style={styles.header}>
        <SkeletonBox width={140} height={24} borderRadius={6} />
        <View style={styles.headerRight}>
          <SkeletonBox width={32} height={32} borderRadius={6} />
          <SkeletonBox width={32} height={32} borderRadius={6} />
        </View>
      </View>

      {/* Scrollable body */}
      <View style={styles.scrollContent}>
        {/* Profile row: username placeholder left, avatar right */}
        <View style={styles.profileRow}>
          <View style={styles.profileLeft}>
            {/* username */}
            <SkeletonBox width={120} height={14} borderRadius={6} />
          </View>
          {/* avatar circle */}
          <SkeletonBox width={80} height={80} borderRadius={40} />
        </View>

        {/* Name (displayed above username in real layout as headerTitle,
            mirrored here as a slightly wider bar) */}
        <SkeletonBox
          width={160}
          height={20}
          borderRadius={6}
          style={styles.spacingSmall}
        />

        {/* Bio – 2 lines */}
        <SkeletonBox
          width="100%"
          height={14}
          borderRadius={6}
          style={styles.spacingSmall}
        />
        <SkeletonBox
          width="80%"
          height={14}
          borderRadius={6}
          style={styles.spacingSmall}
        />

        {/* Tag chips row */}
        <View style={styles.tagsRow}>
          <SkeletonBox width={72} height={22} borderRadius={12} />
          <SkeletonBox width={56} height={22} borderRadius={12} />
          <SkeletonBox width={64} height={22} borderRadius={12} />
        </View>

        {/* Follower count */}
        <SkeletonBox
          width={100}
          height={14}
          borderRadius={6}
          style={styles.spacingMedium}
        />

        {/* Action buttons row */}
        <View style={styles.actionButtonsRow}>
          <SkeletonBox
            width="48%"
            height={50}
            borderRadius={12}
          />
          <SkeletonBox
            width="48%"
            height={50}
            borderRadius={12}
          />
        </View>

        {/* Manage tags button */}
        <SkeletonBox
          width="100%"
          height={46}
          borderRadius={12}
          style={styles.spacingMedium}
        />

        {/* Contact buttons */}
        <SkeletonBox
          width="100%"
          height={56}
          borderRadius={16}
          style={styles.spacingMedium}
        />
        <SkeletonBox
          width="100%"
          height={56}
          borderRadius={16}
          style={styles.spacingSmall}
        />
      </View>
    </SafeAreaView>
  );
});

// ---------------------------------------------------------------------------
// ConnectionsScreenSkeleton
// ---------------------------------------------------------------------------

export const ConnectionsScreenSkeleton = React.memo(function ConnectionsScreenSkeleton() {
  return (
    <View style={skeletonConnectionsStyles.container}>
      {Array.from({ length: 6 }).map((_, index) => (
        <View key={index} style={skeletonConnectionsStyles.row}>
          {/* Circle avatar */}
          <SkeletonBox width={56} height={56} borderRadius={28} />
          {/* Text block */}
          <View style={skeletonConnectionsStyles.textBlock}>
            <SkeletonBox width={160} height={18} borderRadius={6} />
            <SkeletonBox width={120} height={14} borderRadius={6} style={skeletonConnectionsStyles.usernameBox} />
          </View>
        </View>
      ))}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const skeletonConnectionsStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    height: 107,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  textBlock: {
    marginLeft: 14,
    paddingTop: 2,
    gap: 6,
  },
  usernameBox: {
    marginTop: 6,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  profileLeft: {
    flex: 1,
    marginRight: 16,
    gap: 8,
  },
  spacingSmall: {
    marginTop: 8,
  },
  spacingMedium: {
    marginTop: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
});
