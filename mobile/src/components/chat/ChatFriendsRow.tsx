import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { COLORS } from '../../constants/theme';
import InitialsAvatar from '../InitialsAvatar';

export type FriendRowItem = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Active piktag_user_status text (within 24h TTL). Empty/null → no bubble. */
  noteText?: string | null;
};

type Props = {
  /** First card is always the viewer's own note. */
  myName: string;
  myAvatarUrl: string | null;
  myNoteText: string | null;
  onPressMyNote: () => void;
  /** Chat counterparts, ordered by most-recent conversation first. */
  friends: FriendRowItem[];
  onPressFriend: (userId: string) => void;
};

/**
 * Instagram-style "Notes" row rendered above the chat inbox tabs.
 *
 * Each card = a circular avatar with a speech-bubble-looking chip of
 * text above it (the user's current piktag_user_status, if active).
 * The first card is always the viewer themselves — tapping it opens
 * StatusModal so they can post / edit their own 24h note.
 *
 * Visual choices:
 *   - No decorative bubble tail (RN triangle hacks read as cheap);
 *     the physical gap between bubble and avatar plus matching widths
 *     is enough to read as IG's Notes.
 *   - Bubble is omitted entirely when there's no active note — an
 *     empty bubble would add visual noise for quiet accounts.
 *   - A subtle "+" badge sits on the bottom-right of the viewer's
 *     own avatar so the affordance reads as "add a note" even when
 *     they already have one posted.
 */
const ChatFriendsRow = React.memo(
  ({
    myName,
    myAvatarUrl,
    myNoteText,
    onPressMyNote,
    friends,
    onPressFriend,
  }: Props) => {
    const { t } = useTranslation();
    const myLabel = t('chat.yourNote');

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Viewer's own note card */}
        <Pressable
          onPress={onPressMyNote}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={myLabel}
        >
          <Bubble text={myNoteText ?? myLabel} />
          <View style={styles.avatarWrap}>
            <InitialsAvatar name={myName} size={56} avatarUrl={myAvatarUrl} />
            {/* + badge overlaid on the bottom-right so the affordance
                reads as "add / edit your note" regardless of whether
                the viewer has one posted already. */}
            <View style={styles.plusBadge}>
              <Plus size={12} color={COLORS.white} strokeWidth={3} />
            </View>
          </View>
          <Text numberOfLines={1} style={styles.label}>
            {t('chat.yourNoteLabel')}
          </Text>
        </Pressable>

        {/* Friends */}
        {friends.map((f) => (
          <Pressable
            key={f.userId}
            onPress={() => onPressFriend(f.userId)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            accessibilityRole="button"
            accessibilityLabel={f.name}
          >
            {f.noteText ? <Bubble text={f.noteText} /> : <BubbleSpacer />}
            <View style={styles.avatarWrap}>
              <InitialsAvatar
                name={f.name}
                size={56}
                avatarUrl={f.avatarUrl}
              />
            </View>
            <Text numberOfLines={1} style={styles.label}>
              {f.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  },
);

ChatFriendsRow.displayName = 'ChatFriendsRow';

function Bubble({ text }: { text: string }) {
  return (
    <View style={styles.bubble}>
      <Text numberOfLines={2} style={styles.bubbleText}>
        {text}
      </Text>
    </View>
  );
}

/**
 * Invisible reservation matching Bubble's height so avatars in the row
 * line up even when some cards have no note. Without this spacer the
 * avatars of no-note friends would jump vertically to the position of
 * the bubble of their noted neighbors.
 */
function BubbleSpacer() {
  return <View style={styles.bubbleSpacer} />;
}

const CARD_WIDTH = 72;
const BUBBLE_MIN_HEIGHT = 34;

const styles = StyleSheet.create({
  scroll: {
    // Without flexGrow:0 a horizontal ScrollView expands vertically to
    // fill its parent, stealing space from the FlatList below — exact
    // bug we just fixed in ChatTabs. Cap it here too.
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    gap: 6,
  },
  card: {
    width: CARD_WIDTH,
    alignItems: 'center',
  },
  cardPressed: {
    opacity: 0.7,
  },
  bubble: {
    width: CARD_WIDTH - 6,
    minHeight: BUBBLE_MIN_HEIGHT,
    backgroundColor: COLORS.gray100,
    borderRadius: 18,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleSpacer: {
    width: CARD_WIDTH - 6,
    minHeight: BUBBLE_MIN_HEIGHT,
    marginBottom: 6,
  },
  bubbleText: {
    fontSize: 11.5,
    lineHeight: 14,
    color: COLORS.gray700,
    textAlign: 'center',
  },
  avatarWrap: {
    width: 56,
    height: 56,
    position: 'relative',
  },
  plusBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.piktag500,
    borderWidth: 2,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.gray700,
    maxWidth: CARD_WIDTH,
  },
});

export default ChatFriendsRow;
