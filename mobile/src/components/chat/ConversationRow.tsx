import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react-native';
import { COLORS, type ColorPalette } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import type { InboxConversation } from '../../types/chat';
import RingedAvatar from '../RingedAvatar';

type Props = {
  conversation: InboxConversation;
  onPress: (conv: InboxConversation) => void;
  /**
   * Fired when the user taps the ⋯ icon on the right edge of the row.
   * Parent owns the bottom-sheet / move flow. When undefined the icon
   * is hidden so this component stays usable in contexts where the
   * "move conversation" affordance doesn't apply.
   */
  onMorePress?: (conv: InboxConversation) => void;
};

// Format an ISO timestamp into a short, human-friendly relative label.
// Falls back to yyyy/MM/dd once the gap exceeds ~1 week. Takes the
// `t` translator so all labels are localized (was hardcoded zh-TW).
function formatRelativeTime(ts: string | null, t: (k: string, opts?: any) => string): string {
  if (!ts) return '';
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('chat.timeJustNow');
  if (diffMin < 60) return t('chat.timeMinutesAgo', { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('chat.timeHoursAgo', { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return t('chat.timeYesterday');
  if (diffDay < 7) return t('chat.timeDaysAgo', { count: diffDay });
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

const ConversationRow = React.memo(({ conversation, onPress, onMorePress }: Props) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { unread } = conversation;
  const displayName =
    conversation.other_full_name ||
    (conversation.other_username ? `@${conversation.other_username}` : '');
  const avatarSeed = displayName || conversation.other_user_id;
  const preview = conversation.last_message_preview || '—';

  return (
    // Outer wrapper is a plain View so the ⋯ Pressable can be a sibling
    // to the row's main Pressable. Nesting them would cause any ⋯ tap
    // to bubble up and also fire onPress(conversation) — opening the
    // chat thread unintentionally.
    <View style={styles.rowContainer}>
      <Pressable
        onPress={() => onPress(conversation)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <RingedAvatar
          name={avatarSeed}
          size={60}
          avatarUrl={conversation.other_avatar_url}
          ringStyle={unread ? 'gradient' : 'subtle'}
          accessibilityLabel={displayName}
        />

        <View style={styles.middle}>
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              // IG uses semibold (not full bold) for unread names; matches
              // their visual weight while still reading as "emphasized".
              { fontWeight: unread ? '600' : '500' },
            ]}
          >
            {displayName}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.preview,
              {
                color: unread ? colors.gray700 : colors.gray400,
                fontWeight: unread ? '600' : '400',
              },
            ]}
          >
            {preview}
          </Text>
        </View>

        <View style={styles.right}>
          <Text style={styles.timestamp}>
            {formatRelativeTime(conversation.last_message_at, t)}
          </Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
      </Pressable>

      {/* ⋯ menu — sibling to the row Pressable, so it captures its own
          taps without bubbling. Absolute positioning against the parent
          keeps it glued to the right edge without rearranging the
          flex layout of the row. */}
      {onMorePress ? (
        <Pressable
          onPress={() => onMorePress(conversation)}
          hitSlop={10}
          style={({ pressed }) => [
            styles.moreBtn,
            pressed && styles.moreBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="More"
        >
          <MoreHorizontal size={18} color={colors.gray400} />
        </Pressable>
      ) : null}
    </View>
  );
});

ConversationRow.displayName = 'ConversationRow';

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  rowContainer: {
    // Lets the ⋯ Pressable be absolutely positioned at the right edge
    // without nesting it inside the row's onPress target.
    position: 'relative',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Slightly tighter than before (12→10) to match IG inbox density.
    paddingVertical: 10,
    // Right inset 44 (paddingHorizontal was 16) reserves space for the
    // absolute-positioned ⋯ button so the timestamp/preview never get
    // clipped underneath it.
    paddingLeft: 16,
    paddingRight: 44,
    backgroundColor: c.white,
  },
  rowPressed: {
    backgroundColor: c.gray100,
  },
  moreBtn: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  moreBtnPressed: {
    opacity: 1,
  },
  middle: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 15,
    color: c.gray900,
  },
  preview: {
    fontSize: 13.5,
    marginTop: 2,
  },
  right: {
    marginLeft: 8,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  timestamp: {
    fontSize: 12,
    color: c.gray400,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.piktag500,
    // Align vertically with the timestamp baseline instead of floating
    // below it — asymmetric spacing felt off-balance in the old layout.
    marginTop: 4,
  },
  });
}

export default ConversationRow;
