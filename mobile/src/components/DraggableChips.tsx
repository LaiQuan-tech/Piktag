import React, { useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutChangeEvent, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';
import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { X, Pin } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';

type ChipItem = {
  id: string;
  label: string;
  isPinned?: boolean;
};

type DraggableChipsProps = {
  items: ChipItem[];
  onReorder: (newItems: ChipItem[]) => void;
  onRemove: (item: ChipItem) => void;
  onDoubleTap?: (item: ChipItem) => void;
  onDragStateChange?: (isDragging: boolean) => void;
};

type ChipLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SPRING_CONFIG = { damping: 20, stiffness: 300, mass: 0.8 };

export default function DraggableChips({ items, onReorder, onRemove, onDoubleTap, onDragStateChange }: DraggableChipsProps) {
  const { t } = useTranslation();
  const [layouts, setLayouts] = useState<Map<string, ChipLayout>>(new Map());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const containerRef = useRef<View>(null);
  const containerLayout = useRef({ x: 0, y: 0 });

  // Measure container position
  const onContainerLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      containerLayout.current = { x, y };
    });
  }, []);

  // Measure each chip position
  const onChipLayout = useCallback((id: string, event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setLayouts(prev => {
      const next = new Map(prev);
      next.set(id, { x, y, width, height });
      return next;
    });
  }, []);

  // Find which chip the finger is over
  const findTargetId = useCallback((fingerX: number, fingerY: number, excludeId: string): string | null => {
    for (const [id, layout] of layouts) {
      if (id === excludeId) continue;
      const centerX = layout.x + layout.width / 2;
      const centerY = layout.y + layout.height / 2;
      // Check if finger is within chip bounds (with some tolerance)
      if (
        fingerX >= layout.x - 4 && fingerX <= layout.x + layout.width + 4 &&
        fingerY >= layout.y - 4 && fingerY <= layout.y + layout.height + 4
      ) {
        return id;
      }
    }
    return null;
  }, [layouts]);

  // Swap items
  const handleSwap = useCallback((fromId: string, toId: string) => {
    const fromIdx = items.findIndex(i => i.id === fromId);
    const toIdx = items.findIndex(i => i.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const newItems = [...items];
    [newItems[fromIdx], newItems[toIdx]] = [newItems[toIdx], newItems[fromIdx]];
    onReorder(newItems);
  }, [items, onReorder]);

  return (
    <View ref={containerRef} onLayout={onContainerLayout} style={styles.container}>
      {items.map((item) => (
        <DraggableChip
          key={item.id}
          item={item}
          isDragging={draggingId === item.id}
          onLayout={(e) => onChipLayout(item.id, e)}
          onDragStart={() => { setDraggingId(item.id); onDragStateChange?.(true); }}
          onDragEnd={() => { setDraggingId(null); onDragStateChange?.(false); }}
          onDragMove={(absX, absY) => {
            // Convert absolute to container-relative
            const relX = absX - containerLayout.current.x;
            const relY = absY - containerLayout.current.y;
            const targetId = findTargetId(relX, relY, item.id);
            if (targetId) handleSwap(item.id, targetId);
          }}
          onRemove={() => onRemove(item)}
          onDoubleTap={onDoubleTap ? () => onDoubleTap(item) : undefined}
        />
      ))}
      {items.length === 0 && (
        <Text style={styles.emptyText}>{t('common.noTags')}</Text>
      )}
    </View>
  );
}

// ── Individual draggable chip ──────────────────────────────────────────

type DraggableChipProps = {
  item: ChipItem;
  isDragging: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragMove: (absX: number, absY: number) => void;
  onRemove: () => void;
  onDoubleTap?: () => void;
};

function DraggableChip({
  item, isDragging, onLayout, onDragStart, onDragEnd, onDragMove, onRemove, onDoubleTap,
}: DraggableChipProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIndex = useSharedValue(0);
  const lastTapTime = useRef(0);

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart(() => {
      scale.value = withSpring(1.08, SPRING_CONFIG);
      zIndex.value = 100;
      runOnJS(onDragStart)();
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      runOnJS(onDragMove)(e.absoluteX, e.absoluteY);
    })
    .onEnd(() => {
      translateX.value = withSpring(0, SPRING_CONFIG);
      translateY.value = withSpring(0, SPRING_CONFIG);
      scale.value = withSpring(1, SPRING_CONFIG);
      zIndex.value = 0;
      runOnJS(onDragEnd)();
    });

  const doDoubleTap = useCallback(() => {
    impactAsync(ImpactFeedbackStyle.Medium);
    onDoubleTap?.();
  }, [onDoubleTap]);

  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      if (onDoubleTap) {
        const now = Date.now();
        if (now - lastTapTime.current < 400) {
          runOnJS(doDoubleTap)();
          lastTapTime.current = 0;
        } else {
          lastTapTime.current = now;
        }
      }
    });

  const composed = Gesture.Race(panGesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    zIndex: zIndex.value,
    shadowOpacity: withTiming(isDragging ? 0.2 : 0, { duration: 150 }),
    elevation: isDragging ? 8 : 0,
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        onLayout={onLayout}
        style={[
          styles.chip,
          item.isPinned && styles.chipPinned,
          animatedStyle,
        ]}
      >
        {item.isPinned && <Pin size={11} color={COLORS.piktag600} fill={COLORS.piktag600} />}
        <Text style={[styles.chipText, item.isPinned && styles.chipTextPinned]}>
          {item.label}
        </Text>
        <Pressable onPress={onRemove} style={styles.chipX} hitSlop={8}>
          <X size={14} color={COLORS.gray400} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
  },
  // "Selected" tag chip — these are the user's currently-added public
  // tags. Matches the FriendDetail pickModalTagSelected pattern so the
  // visual contract for "this is one of mine" is the same everywhere
  // in the app: piktag50 fill + 1.5dp piktag500 border + bold piktag600
  // text. (Was previously gray100 / no border / gray900, which read as
  // unselected — wrong signal for a list of items the user OWNS.)
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.piktag50,
    borderRadius: 20,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
  },
  // Pinned variant — already "selected" base + a yellow tint to mark
  // "pinned to top". Override fill + border so the pin signal wins
  // visually (yellow > purple).
  chipPinned: {
    backgroundColor: '#FFFBEB',
    borderColor: COLORS.piktag400,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  chipTextPinned: {
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  chipX: {
    padding: 4,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    paddingVertical: 8,
  },
});
