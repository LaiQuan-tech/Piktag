import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS } from '../../constants/theme';
import type { InboxTab } from '../../types/chat';

const SCREEN_HEIGHT = Dimensions.get('window').height;

type Props = {
  visible: boolean;
  /** Which bucket the conversation is currently showing in. Used to
   *  decide which move options to render. */
  currentBucket: InboxTab;
  /** Fired when the user taps one of the move options. The parent owns
   *  optimistic state + the set_conversation_folder RPC call. */
  onMove: (target: InboxTab) => void;
  onClose: () => void;
};

/**
 * Bottom-sheet menu that appears when the user taps the ⋯ icon on a
 * conversation row. Patterns borrowed from StatusModal.tsx — native
 * Modal + Animated so we don't have to pull in a bottom-sheet lib.
 *
 * Option visibility is bucket-dependent and intentionally asymmetric:
 *
 *   primary   → "移到一般"
 *   general   → "移到主要"
 *   requests  → "接受並移到主要"  (promote a stranger's message)
 *
 * Manually pushing a thread INTO 陌生訊息 is not offered — that bucket
 * is for "someone I don't know yet tried to reach me", which only the
 * system can determine.
 */
export default function ConversationActionSheet({
  visible,
  currentBucket,
  onMove,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  // Slide up on open, slide down on close. Mirrors StatusModal timing
  // so the two sheets feel like the same surface across the app.
  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 14,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  // Each option is rendered via this helper so the destructive / plain
  // styling stays consistent. `primary` variant = accented purple text
  // to draw attention to the recommended accept action on requests.
  const Option = ({
    label,
    onPress,
    variant = 'default',
  }: {
    label: string;
    onPress: () => void;
    variant?: 'default' | 'primary';
  }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
    >
      <Text
        style={[
          styles.optionText,
          variant === 'primary' && styles.optionTextPrimary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
        >
          <View style={styles.handleBar} />

          {/* Primary source bucket: offer demotion to general. */}
          {currentBucket === 'primary' ? (
            <Option
              label={t('chat.moveToGeneral')}
              onPress={() => onMove('general')}
            />
          ) : null}

          {/* General source bucket: offer promotion to primary. */}
          {currentBucket === 'general' ? (
            <Option
              label={t('chat.moveToPrimary')}
              onPress={() => onMove('primary')}
            />
          ) : null}

          {/* Requests source bucket: offer the "accept" action that
              promotes the thread into primary. Styled with the primary
              variant so it reads as the recommended next step. */}
          {currentBucket === 'requests' ? (
            <Option
              label={t('chat.acceptRequest')}
              onPress={() => onMove('primary')}
              variant="primary"
            />
          ) : null}

          <View style={styles.separator} />

          <Option label={t('common.cancel')} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 28,
    paddingTop: 8,
  },
  handleBar: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.gray300,
    marginVertical: 8,
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  optionPressed: {
    backgroundColor: COLORS.gray100,
  },
  optionText: {
    fontSize: 16,
    color: COLORS.gray900,
    fontWeight: '500',
  },
  optionTextPrimary: {
    color: COLORS.piktag500,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.gray100,
    marginHorizontal: 16,
    marginVertical: 4,
  },
});
