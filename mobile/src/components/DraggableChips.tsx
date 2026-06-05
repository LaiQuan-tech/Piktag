import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import TagChip from './TagChip';

type ChipItem = {
  id: string;
  label: string;
  // isPinned was removed when tag pinning was pulled out as a future
  // paid feature (commit e11a9d6). Kept the field name out of the
  // type so callers can't accidentally re-introduce a pin flag here.
};

type DraggableChipsProps = {
  items: ChipItem[];
  onReorder: (newItems: ChipItem[]) => void;
  onRemove: (item: ChipItem) => void;
  // Two interaction modes, ONE component (no per-screen chip copy):
  //
  //  • 'removable' (default — ManageTagsScreen): the canonical
  //    "#tag ×" chip. Tap does nothing; the × removes; long-press
  //    drags to reorder. Byte-for-byte the old behaviour, just
  //    rendered through the shared <TagChip> now.
  //
  //  • 'toggle' (EditProfile "我的標籤"): NO ×. Every chip is ALWAYS
  //    purple — these ARE the user's selected/owned tags, and the
  //    colour contract is purple = selected (gray is reserved for
  //    recommended-but-unselected suggestions elsewhere). A single
  //    tap removes the tag; that one-tap is safe because removal is
  //    staged (Phase 1) and fully reversible until 儲存. Long-press
  //    still drags.
  chipVariant?: 'removable' | 'toggle';
  // onDoubleTap was the pin-toggle gesture in the original design;
  // pinning was pulled (commit e11a9d6). The prop is gone — the tap
  // gesture now drives the remove model above.
  onDragStateChange?: (isDragging: boolean) => void;
};

type ChipLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SPRING_CONFIG = { damping: 20, stiffness: 300, mass: 0.8 };

export default function DraggableChips({
  items,
  onReorder,
  onRemove,
  chipVariant = 'removable',
  onDragStateChange,
}: DraggableChipsProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [layouts, setLayouts] = useState<Map<string, ChipLayout>>(new Map());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const containerRef = useRef<View>(null);
  const containerLayout = useRef({ x: 0, y: 0 });
  const isToggle = chipVariant === 'toggle';

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

  // 2026-06-05 fix — reorder ONCE on drop, not every pan frame.
  // The old design called a swap on every onDragMove frame: that
  // mutated `items` mid-gesture, so the dragged chip's base layout
  // slot moved while its transform stayed relative to the START slot,
  // and the chip visibly jumped off the finger (the "拖曳壞掉" bug,
  // founder). Now the list stays STABLE during the drag (the chip
  // tracks the finger cleanly), we just remember which chip the finger
  // is currently over, and apply a single move-from→to-index reorder
  // when the finger lifts.
  const dragTargetRef = useRef<string | null>(null);
  const commitReorder = useCallback((fromId: string) => {
    const toId = dragTargetRef.current;
    dragTargetRef.current = null;
    if (!toId || toId === fromId) return;
    const fromIdx = items.findIndex(i => i.id === fromId);
    const toIdx = items.findIndex(i => i.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder(next);
  }, [items, onReorder]);

  // Tap action — both modes: single tap removes (founder rule:
  // every chip in the app is tap-to-remove, no × icons anywhere).
  // In toggle/EditProfile mode the removal is staged (Phase 1) and
  // reversible until Save; in legacy/ManageTags mode it's immediate.
  // Medium haptic marks the destructive step.
  const handleTap = useCallback((item: ChipItem) => {
    impactAsync(ImpactFeedbackStyle.Medium);
    onRemove(item);
  }, [onRemove]);

  return (
    <View ref={containerRef} onLayout={onContainerLayout} style={styles.container}>
      {items.map((item) => (
        <DraggableChip
          key={item.id}
          item={item}
          isToggle={isToggle}
          isDragging={draggingId === item.id}
          onLayout={(e) => onChipLayout(item.id, e)}
          onDragStart={() => { setDraggingId(item.id); onDragStateChange?.(true); }}
          onDragEnd={() => {
            setDraggingId(null);
            onDragStateChange?.(false);
            commitReorder(item.id); // single reorder on lift
          }}
          onDragMove={(absX, absY) => {
            // Just RECORD the chip the finger is over — don't reorder
            // mid-drag (that caused the jump bug). The reorder happens
            // once in onDragEnd.
            const relX = absX - containerLayout.current.x;
            const relY = absY - containerLayout.current.y;
            dragTargetRef.current = findTargetId(relX, relY, item.id);
          }}
          onRemove={() => onRemove(item)}
          // Always wire tap (both modes): chip body = tap-to-remove,
          // no × icon. GestureDetector owns the tap so a nested
          // Pressable inside TagChip is unnecessary (and would
          // race the Pan long-press / Tap gesture composition).
          onTap={() => handleTap(item)}
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
  isToggle: boolean;
  isDragging: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragMove: (absX: number, absY: number) => void;
  onRemove: () => void;
  onTap?: () => void;
};

function DraggableChip({
  item, isToggle, isDragging, onLayout, onDragStart, onDragEnd, onDragMove, onRemove, onTap,
}: DraggableChipProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIndex = useSharedValue(0);

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
      // Snap translate to 0 immediately (not a spring): onDragEnd
      // reorders the list so this chip's base slot becomes ~where the
      // finger released, making translate:0 land it cleanly in the new
      // slot. A spring-back would start from an overshot position and
      // wobble. Scale/zIndex still ease back.
      translateX.value = 0;
      translateY.value = 0;
      scale.value = withSpring(1, SPRING_CONFIG);
      zIndex.value = 0;
      runOnJS(onDragEnd)();
    });

  // Single tap → remove (toggle mode only; legacy mode leaves
  // removal to the × inside the removable TagChip).
  const tapGesture = Gesture.Tap().onEnd(() => {
    if (onTap) runOnJS(onTap)();
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
      <Animated.View onLayout={onLayout} style={[styles.chipHost, animatedStyle]}>
        {isToggle ? (
          // Toggle (EditProfile): always purple — these ARE the
          // user's selected tags. Static display; tap handled by
          // the outer GestureDetector → handleTap → onRemove.
          <TagChip variant="toggle" label={item.label} selected />
        ) : (
          // Removable (ManageTagsScreen): rendered WITHOUT onRemove
          // so the chip itself is a plain View (no nested Pressable
          // inside the GestureDetector). The same tapGesture handles
          // removal — keeps the gesture composition clean.
          <TagChip variant="removable" label={item.label} />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  // No internal paddingHorizontal — callers control the left/right
  // gutter so this component never DOUBLE-indents when nested in
  // an already-padded parent (the alignment bug the founder caught:
  // EditProfile's tag_section is paddingH:20, and 20 here on top
  // made 我的標籤 chips sit 40px from the screen edge while the
  // sibling 熱門 chip wrap sat at 20).
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // The Animated.View only hosts the drag transform + lift shadow;
  // ALL chip visuals come from the shared <TagChip> so there is no
  // per-screen chip styling to drift (founder design contract).
  chipHost: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    shadowColor: c.gray900,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  emptyText: {
    fontSize: 14,
    color: c.gray400,
    paddingVertical: 8,
  },
  });
}
