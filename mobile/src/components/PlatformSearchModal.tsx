// PlatformSearchModal.tsx
//
// Browse-all-platforms picker for the biolink edit modal. Surfaces
// the long-tail of 50 platforms behind a search box + categorized
// list — the alternative to forcing users to scroll a horizontal
// chip rail of 50 items, which was the original UX complaint.
//
// Pattern is the same as Linktree / Beacons / Bento: top search bar
// filters the list as you type, otherwise see all platforms grouped
// by category. Tap a row → modal closes, parent gets the platform
// key via onSelect.

import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SectionList,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import PlatformIcon from './PlatformIcon';
import {
  PLATFORMS,
  CATEGORIES,
  getPlatformLabel,
  getCategoryLabel,
  type PlatformCategory,
} from '../lib/platforms';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
};

type SectionData = {
  title: string;
  cat: PlatformCategory;
  data: typeof PLATFORMS;
};

export default function PlatformSearchModal({ visible, onClose, onSelect }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  // Reset the search box every time the modal opens so the previous
  // user's query doesn't leak into the new session.
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const sections: SectionData[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Filter against label, key, and category — match anywhere in
    // the string. Empty query shows everything.
    const filtered = q
      ? PLATFORMS.filter(
          (p) =>
            p.label.toLowerCase().includes(q) ||
            p.key.toLowerCase().includes(q) ||
            p.cat.toLowerCase().includes(q),
        )
      : PLATFORMS;

    // Group by category in the canonical CATEGORIES order so search
    // results stay grouped (not just a flat list) — easier to scan
    // when "spotify" surfaces a Music section header above the row.
    return CATEGORIES.map((cat) => ({
      cat,
      title: getCategoryLabel(cat, t),
      data: filtered.filter((p) => p.cat === cat),
    })).filter((s) => s.data.length > 0);
  }, [query, t]);

  // Conditional render — no <Modal> wrapper at all.
  // Why: when this component lives inside another <Modal> (the
  // biolink edit sheet), an inner <Modal> on iOS hits the native
  // presentationController stacking limit and silently fails to
  // animate in. Even with `transparent` it doesn't reliably show.
  // Solution: render an absolute-positioned overlay directly. The
  // parent <Modal> already establishes the native modal context;
  // this overlay just sits on top of the parent's content within
  // that same context. Works on both iOS and Android, no stacking
  // gymnastics.
  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Backdrop dim — also catches taps to dismiss when the user
          taps outside the sheet. */}
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={[styles.container, { paddingTop: 16 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>
            {t('editProfile.browseAllPlatforms') || 'Browse all platforms'}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <X size={24} color={COLORS.gray700} />
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Search size={18} color={COLORS.gray400} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('editProfile.platformSearchPlaceholder') || 'Search platforms…'}
            placeholderTextColor={COLORS.gray400}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <X size={16} color={COLORS.gray400} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* List */}
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => {
                onSelect(item.key);
                onClose();
              }}
            >
              <View style={styles.rowIcon}>
                <PlatformIcon platform={item.key} size={22} />
              </View>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {getPlatformLabel(item.key, t)}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                {t('editProfile.platformSearchEmpty') || 'No platforms match your search'}
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-screen dim catches taps to dismiss outside the sheet.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  // Sheet style — top corners rounded, slides in from bottom,
  // ~85% of viewport height so the user can still see a sliver of
  // whatever modal it's overlaying (visual context).
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '85%',
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  closeBtn: {
    padding: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    borderRadius: 12,
    backgroundColor: COLORS.gray100,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.gray900,
    paddingVertical: 0,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gray900,
  },
  emptyWrap: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray500,
  },
});
