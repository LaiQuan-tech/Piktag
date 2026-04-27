import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import InitialsAvatar from './InitialsAvatar';
import { COLORS } from '../constants/theme';

type User = {
  id: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

type Props = {
  users: User[];
  total?: number;
  size?: number;
  max?: number;
  onPress?: () => void;
};

const OverlappingAvatars = React.memo(({ users, total, size = 28, max = 3, onPress }: Props) => {
  if (!users.length && !total) return null;

  const visible = users.slice(0, max);
  const remaining = (total ?? users.length) - visible.length;
  const overlap = Math.round(size * 0.35);
  const borderWidth = 2;

  const content = (
    <View style={styles.row}>
      {visible.map((u, i) => {
        const name = u.full_name || u.username || '?';
        return (
          <View
            key={u.id}
            style={[
              styles.avatarWrap,
              {
                width: size + borderWidth * 2,
                height: size + borderWidth * 2,
                borderRadius: (size + borderWidth * 2) / 2,
                marginLeft: i > 0 ? -overlap : 0,
                zIndex: max - i,
              },
            ]}
          >
            {u.avatar_url ? (
              <Image
                source={{ uri: u.avatar_url }}
                style={{ width: size, height: size, borderRadius: size / 2 }}
                cachePolicy="memory-disk"
              />
            ) : (
              <InitialsAvatar name={name} size={size} />
            )}
          </View>
        );
      })}
      {remaining > 0 && (
        <View
          style={[
            styles.avatarWrap,
            styles.countBubble,
            {
              width: size + borderWidth * 2,
              height: size + borderWidth * 2,
              borderRadius: (size + borderWidth * 2) / 2,
              marginLeft: visible.length > 0 ? -overlap : 0,
              zIndex: 0,
            },
          ]}
        >
          <Text style={[styles.countText, { fontSize: Math.round(size * 0.36) }]}>
            +{remaining}
          </Text>
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    borderWidth: 2,
    borderColor: COLORS.white,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBubble: {
    backgroundColor: COLORS.gray200,
  },
  countText: {
    fontWeight: '700',
    color: COLORS.gray600,
  },
});

export default OverlappingAvatars;
