import { Send } from 'lucide-react-native';
import React, { useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS, type ColorPalette } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type Props = {
  onSend: (text: string) => Promise<void> | void;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Imperative-ish prefill, used by icebreaker chip taps. Whenever
   * this changes to a non-empty string AND the current input is
   * empty (we don't want to nuke half-typed messages), the input
   * adopts it. Repeat-tapping the same chip should still work, so
   * the parent passes a fresh `{text, nonce}` shape and we react
   * to `nonce` changes specifically.
   */
  prefill?: { text: string; nonce: number } | null;
  /**
   * Device bottom safe-area inset (system nav bar height) from the host
   * screen. Reserved below the row while the keyboard is CLOSED so the
   * input + send button clear the Android 3-button / gesture nav bar
   * under edge-to-edge; collapses to 0 while the keyboard is OPEN (the
   * keyboard already occupies that space) so the bar sits flush with no
   * gap. Defaults to 0 → unchanged behavior for any caller that omits it.
   */
  bottomInset?: number;
};

const Composer = React.memo(({ onSend, disabled, disabledReason, prefill, bottomInset = 0 }: Props) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  // Reserve the bottom safe-area inset under the row only while the
  // keyboard is HIDDEN — when it's up the keyboard occupies that space,
  // so adding the inset would leave a gap above the keyboard (notably
  // the iOS home-indicator gap). Toggle on keyboard show/hide.
  const [keyboardShown, setKeyboardShown] = useState(false);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardShown(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardShown(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Adopt incoming prefill text only when (a) it's a fresh nonce vs.
  // last adoption and (b) the input is currently empty — never trample
  // an in-progress message.
  const lastPrefillNonceRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!prefill || prefill.nonce == null) return;
    if (prefill.nonce === lastPrefillNonceRef.current) return;
    if (value.trim().length > 0) {
      // Even if we skip the adoption, remember we saw this nonce so
      // an immediate re-trigger doesn't queue up an unwanted overwrite.
      lastPrefillNonceRef.current = prefill.nonce;
      return;
    }
    setValue(prefill.text);
    lastPrefillNonceRef.current = prefill.nonce;
  }, [prefill, value]);

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
    <View style={[styles.row, { paddingBottom: 8 + (keyboardShown ? 0 : bottomInset) }]}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.gray400}
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
        <Send size={20} color={'#FFFFFF'} />
      </TouchableOpacity>
    </View>
  );
});

Composer.displayName = 'Composer';

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: c.white,
    borderTopWidth: 1,
    borderTopColor: c.gray100,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: c.gray100,
    borderRadius: 20,
    maxHeight: 120,
    color: c.gray900,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginLeft: 8,
    backgroundColor: c.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  });
}

export default Composer;
