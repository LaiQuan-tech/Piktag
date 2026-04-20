import { AlertCircle } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/theme';
import type { ThreadMessage } from '../../types/chat';
import InitialsAvatar from '../InitialsAvatar';

type Props = {
  message: ThreadMessage;
  isMine: boolean;
  showAvatar: boolean; // only show for first bubble in a group
  avatarName: string;
  avatarUrl?: string | null;
  onRetry?: () => void;
};

const AVATAR_SIZE = 28;

const MessageBubble = React.memo((props: Props) => {
  const { message, isMine, showAvatar, avatarName, onRetry } = props;
  const { t } = useTranslation();

  const isFailed = isMine && message.status === 'failed';
  const isSending = isMine && message.status === 'sending';

  const bubbleCornerStyle = isMine
    ? { borderBottomRightRadius: 4 }
    : { borderBottomLeftRadius: 4 };

  const body = (
    <View
      style={[
        styles.bubble,
        {
          backgroundColor: isMine ? COLORS.piktag500 : COLORS.gray100,
        },
        bubbleCornerStyle,
      ]}
    >
      <Text
        style={[
          styles.bodyText,
          { color: isMine ? COLORS.white : COLORS.gray900 },
        ]}
      >
        {message.body}
      </Text>
    </View>
  );

  return (
    <View
      style={[
        styles.root,
        { alignSelf: isMine ? 'flex-end' : 'flex-start' },
      ]}
    >
      {!isMine ? (
        showAvatar ? (
          <View style={styles.avatarSlot}>
            <InitialsAvatar name={avatarName} size={AVATAR_SIZE} />
          </View>
        ) : (
          <View style={styles.avatarSlot} />
        )
      ) : null}

      <View style={styles.bubbleColumn}>
        {isFailed ? (
          <Pressable onPress={onRetry}>{body}</Pressable>
        ) : (
          body
        )}

        {isSending ? (
          <Text style={styles.sendingText}>…</Text>
        ) : null}

        {isFailed ? (
          <Pressable onPress={onRetry} style={styles.failedRow}>
            <AlertCircle size={14} color={COLORS.red500} />
            <Text style={styles.failedText}>{t('chat.deliveryFailed')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

MessageBubble.displayName = 'MessageBubble';

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    marginVertical: 2,
    maxWidth: '80%',
    paddingHorizontal: 12,
  },
  avatarSlot: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginRight: 6,
    alignSelf: 'flex-end',
  },
  bubbleColumn: {
    flexShrink: 1,
  },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 20,
    writingDirection: 'auto',
  },
  sendingText: {
    fontSize: 11,
    color: COLORS.gray400,
    marginTop: 2,
    alignSelf: 'flex-end',
  },
  failedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    alignSelf: 'flex-end',
  },
  failedText: {
    fontSize: 12,
    color: COLORS.red500,
    marginLeft: 4,
  },
});

export default MessageBubble;
