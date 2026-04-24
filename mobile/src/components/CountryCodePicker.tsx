import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { Search, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { COUNTRIES, type Country } from '../lib/countryCodes';

const SCREEN_HEIGHT = Dimensions.get('window').height;

type CountryCodePickerProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (country: Country) => void;
  // Current selection — shown with a check mark + highlighted row so
  // users can re-confirm what's active without hunting through the list.
  selectedIso?: string | null;
};

/**
 * Bottom-sheet country code picker. Mirrors `StatusModal`'s
 * `<Modal> + <Animated.View>` slide pattern so the interaction feels
 * native to the rest of the app without pulling in a new library.
 *
 * Filters by three channels at once — the localised country name
 * (`t(nameKey)`), the ISO code, and the dial code itself — so users can
 * search "japan", "日本", "JP", or "+81" and land on the same row.
 */
export default function CountryCodePicker({
  visible,
  onClose,
  onSelect,
  selectedIso,
}: CountryCodePickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      // Reset search on each open so the previous query doesn't bleed
      // into a fresh picker session.
      setQuery('');
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 14,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => {
      const localised = t(c.nameKey, { defaultValue: c.iso }).toLowerCase();
      return (
        localised.includes(q) ||
        c.iso.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        // Allow searching by dial code without the leading "+".
        c.dial.replace('+', '').includes(q)
      );
    });
  }, [query, t]);

  const renderItem = ({ item }: { item: Country }) => {
    const isSelected = item.iso === selectedIso;
    return (
      <TouchableOpacity
        style={[styles.row, isSelected && styles.rowSelected]}
        onPress={() => {
          onSelect(item);
          onClose();
        }}
        activeOpacity={0.6}
      >
        <Text style={styles.flag}>{item.flag}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {t(item.nameKey, { defaultValue: item.iso })}
        </Text>
        <Text style={styles.dial}>{item.dial}</Text>
        {isSelected ? (
          <Check size={18} color={COLORS.piktag500} style={styles.checkIcon} />
        ) : (
          <View style={styles.checkIcon} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
        >
          <View style={styles.handleBar} />
          <Text style={styles.title}>{t('editProfile.selectCountry')}</Text>

          <View style={styles.searchRow}>
            <Search size={16} color={COLORS.gray400} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('editProfile.searchCountry')}
              placeholderTextColor={COLORS.gray400}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(c) => c.iso}
            renderItem={renderItem}
            initialNumToRender={16}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {t('common.noResults', { defaultValue: '—' })}
              </Text>
            }
            style={styles.list}
          />
        </Animated.View>
      </KeyboardAvoidingView>
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
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 28,
    // Cap the sheet so the keyboard + FlatList both fit on small devices
    // without the whole modal getting pushed off-screen.
    maxHeight: SCREEN_HEIGHT * 0.78,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.gray200,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.gray900,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.gray100,
  },
  rowSelected: {
    backgroundColor: COLORS.piktag50 ?? 'rgba(170,0,255,0.06)',
    borderRadius: 8,
  },
  flag: {
    fontSize: 22,
    marginRight: 12,
    // Small width cap so flags with wider glyphs (like 🇬🇧) don't push the
    // name off its alignment.
    width: 28,
    textAlign: 'center',
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: COLORS.gray900,
  },
  dial: {
    fontSize: 14,
    color: COLORS.gray500,
    marginLeft: 8,
    minWidth: 52,
    textAlign: 'right',
  },
  checkIcon: {
    width: 20,
    marginLeft: 8,
    alignItems: 'flex-end',
  },
  emptyText: {
    textAlign: 'center',
    color: COLORS.gray400,
    fontSize: 14,
    paddingVertical: 24,
  },
});
