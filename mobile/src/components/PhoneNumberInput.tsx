import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { type ColorPalette } from '../constants/theme';
import CountryCodePicker from './CountryCodePicker';
import { type Country } from '../lib/countryCodes';

type PhoneNumberInputProps = {
  country: Country;
  national: string;
  onChangeCountry: (country: Country) => void;
  onChangeNational: (national: string) => void;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
};

/**
 * The single, shared phone-number field for the whole app: a dial-code
 * chip (taps open the CountryCodePicker bottom sheet) + a national-number
 * input. Used by EditProfile (the add form AND the edit modal) and the
 * onboarding wizard's "電子名片" step, so the phone UI and the stored
 * format never drift per-screen again (the founder caught the divergence:
 * onboarding had a plain text field storing messy `tel:+1 234 ...` while
 * EditProfile had the picker storing clean `tel:+886...`).
 *
 * This component owns only the (country, national) field pair + its own
 * picker modal. The caller owns the add/save button and turns the pair
 * into the canonical URL via `buildTelUrl(country, national)` at save
 * time — keeping the digits-only national value here means buildTelUrl
 * always receives clean input.
 */
export default function PhoneNumberInput({
  country,
  national,
  onChangeCountry,
  onChangeNational,
  autoFocus,
  onSubmitEditing,
}: PhoneNumberInputProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={styles.phoneRow}>
      <TouchableOpacity
        style={styles.countryChip}
        onPress={() => setPickerOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.countryFlag}>{country.flag}</Text>
        <Text style={styles.countryDial}>{country.dial}</Text>
        <ChevronDown size={14} color={colors.gray500} />
      </TouchableOpacity>
      <TextInput
        style={styles.phoneInput}
        value={national}
        // Keep the national value digits-only at the source so buildTelUrl
        // never has to strip formatting and the stored tel: is always clean.
        onChangeText={(v) => onChangeNational(v.replace(/\D/g, ''))}
        placeholder={t('editProfile.phonePlaceholder')}
        placeholderTextColor={colors.gray400}
        keyboardType="phone-pad"
        maxLength={15}
        autoFocus={autoFocus}
        returnKeyType="done"
        onSubmitEditing={onSubmitEditing}
      />
      <CountryCodePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={onChangeCountry}
        selectedIso={country.iso}
      />
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    phoneRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    countryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: c.gray200 ?? '#E5E7EB',
      borderRadius: 8,
      backgroundColor: c.white,
    },
    countryFlag: {
      fontSize: 18,
    },
    countryDial: {
      fontSize: 14,
      fontWeight: '600',
      color: c.gray900,
    },
    phoneInput: {
      flex: 1,
      fontSize: 14,
      color: c.gray900,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: c.gray200 ?? '#E5E7EB',
      borderRadius: 8,
      backgroundColor: c.white,
    },
  });
}
