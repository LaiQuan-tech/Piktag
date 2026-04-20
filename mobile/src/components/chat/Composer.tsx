import { Send } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../../constants/theme';

type Props = {
  onSend: (text: string) => Promise<void> | void;
  disabled?: boolean;
  disabledReason?: string;
};

const Composer = React.memo(({ onSend, disabled, disabledReason }: Props) => {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const trimmed = value.trim();
  const canSend = !disabled && !sending && trimmed.length > 0;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const text = trimmed;
    // Clear input immediately for responsive feel; parent owns optimistic state.
    setValue('');
    setSending(true);
    try {
      const result = onSend(text);
      if (result && typeof (result as Promise<void>).finally === 'function') {
        (result as Promise<void>)
          .catch(() => {
            // Swallow — parent is responsible for surfacing failures.
          })
          .finally(() => setSending(false));
      } else {
        setSending(false);
      }
    } catch {
      setSending(false);
    }
  }, [canSend, onSend, trimmed]);

  const placeholder = disabled
    ? disabledReason || t('chat.messagePlaceholder')
    : t('chat.messagePlaceholder');

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={COLORS.gray400}
        editable={!disabled}
        multiline
        maxLength={4000}
      />
      <TouchableOpacity
        onPress={handleSend}
        disabled={!canSend}
        activeOpacity={0.7}
        style={[styles.sendBtn, { opacity: canSend ? 1 : 0.4 }]}
      >
        <Send size={20} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
});

Composer.displayName = 'Composer';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COLORS.gray100,
    borderRadius: 20,
    maxHeight: 120,
    color: COLORS.gray900,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginLeft: 8,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default Composer;
