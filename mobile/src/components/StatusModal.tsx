import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const MAX_CHARS = 100;
const SCREEN_HEIGHT = Dimensions.get('window').height;

type StatusModalProps = {
  visible: boolean;
  onClose: () => void;
  initialText: string | null;
  onStatusUpdated: (text: string | null) => void;
};

export default function StatusModal({
  visible,
  onClose,
  initialText,
  onStatusUpdated,
}: StatusModalProps) {
  const { user } = useAuth();
  const [text, setText] = useState(initialText ?? '');
  const [saving, setSaving] = useState(false);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  // Sync text when modal opens with fresh initialText
  useEffect(() => {
    if (visible) {
      setText(initialText ?? '');
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
  }, [visible, initialText]);

  const handleSave = async () => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from('piktag_user_status')
        .upsert(
          { user_id: user.id, text: text.trim(), expires_at: expiresAt },
          { onConflict: 'user_id' },
        );
      onStatusUpdated(text.trim() || null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await supabase
        .from('piktag_user_status')
        .delete()
        .eq('user_id', user.id);
      onStatusUpdated(null);
      onClose();
    } finally {
      setSaving(false);
    }
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
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
        >
          {/* Handle bar */}
          <View style={styles.handleBar} />

          <Text style={styles.title}>{'分享近況'}</Text>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(val) => setText(val.slice(0, MAX_CHARS))}
            placeholder={'寫下你現在的心情…'}
            placeholderTextColor={COLORS.gray400}
            multiline
            maxLength={MAX_CHARS}
            autoFocus
          />

          <Text style={styles.charCount}>
            {text.length}/{MAX_CHARS}
          </Text>

          <View style={styles.buttonsRow}>
            {initialText ? (
              <TouchableOpacity
                style={[styles.button, styles.clearButton]}
                onPress={handleClear}
                activeOpacity={0.7}
                disabled={saving}
              >
                <Text style={styles.clearButtonText}>{'清除狀態'}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.button, styles.saveButton, !initialText ? styles.saveButtonFull : null]}
              onPress={handleSave}
              activeOpacity={0.7}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>{'儲存'}</Text>
            </TouchableOpacity>
          </View>
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
    padding: 20,
    paddingBottom: 36,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.gray200,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.gray900,
    minHeight: 80,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.gray400,
    textAlign: 'right',
    marginTop: 6,
    marginBottom: 20,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    flex: 1,
    backgroundColor: COLORS.piktag500,
  },
  saveButtonFull: {
    flex: 1,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  clearButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gray200,
  },
  clearButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray700,
  },
});
