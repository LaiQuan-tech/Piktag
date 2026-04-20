import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/theme';
import type { InboxConversation } from '../../types/chat';
import InitialsAvatar from '../InitialsAvatar';

type Props = {
  conversation: InboxConversation;
  onPress: (conv: InboxConversation) => void;
};

// Format an ISO timestamp into a short, human-friendly relative label.
// Falls back to yyyy/MM/dd once the gap exceeds ~1 week.
function formatRelativeTime(ts: string | null): string {
  if (!ts) return '';
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return `${diffDay} 天`;
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

const ConversationRow = React.memo(({ conversation, onPress }: Props) => {
  const { unread } = conversation;
  const displayName =
    conversation.other_full_name ||
    (conversation.other_username ? `@${conversation.other_username}` : '');
  const avatarSeed = displayName || conversation.other_user_id;
  const preview = conversation.last_message_preview || '—';

  return (
    <Pressable
      onPress={() => onPress(conversation)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View
        style={[
          styles.avatarWrap,
          { borderColor: unread ? COLORS.piktag500 : 'transparent' },
        ]}
      >
        <InitialsAvatar name={avatarSeed} size={52} />
      </View>

      <View style={styles.middle}>
        <Text
          numberOfLines={1}
          style={[
            styles.name,
            { fontWeight: unread ? '700' : '500' },
          ]}
        >
          {displayName}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            styles.preview,
            {
              color: unread ? COLORS.gray700 : COLORS.gray400,
              fontWeight: unread ? '600' : '400',
            },
          ]}
        >
          {preview}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.timestamp}>
          {formatRelativeTime(conversation.last_message_at)}
        </Text>
        {unread ? <View style={styles.unreadDot} /> : null}
      </View>
    </Pressable>
  );
});

ConversationRow.displayName = 'ConversationRow';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.white,
  },
  rowPressed: {
    backgroundColor: COLORS.gray100,
  },
  avatarWrap: {
    // Gradient-ring stand-in: solid brand border when unread, transparent otherwise.
    borderWidth: 2,
    borderRadius: 30,
    padding: 1,
  },
  middle: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 15,
    color: COLORS.gray900,
  },
  preview: {
    fontSize: 14,
    marginTop: 2,
  },
  right: {
    marginLeft: 8,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  timestamp: {
    fontSize: 12,
    color: COLORS.gray400,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.piktag500,
    marginTop: 6,
  },
});

export default ConversationRow;
