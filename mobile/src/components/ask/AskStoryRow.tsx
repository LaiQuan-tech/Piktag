import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Plus, X, Clock } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import InitialsAvatar from '../InitialsAvatar';
import OverlappingAvatars from '../OverlappingAvatars';
import { COLORS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import type { AskFeedItem, MyActiveAsk } from '../../types/ask';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAX_BODY = 150;

type AskStoryRowProps = {
  asks: AskFeedItem[];
  myAsk: MyActiveAsk | null;
  myAvatarUrl: string | null;
  myName: string;
  onRefresh: () => void;
  onPressUser: (userId: string) => void;
};

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600000));
}

export default function AskStoryRow({ asks, myAsk, myAvatarUrl, myName, onRefresh, onPressUser }: AskStoryRowProps) {
  const { t } = useTranslation();
  const [createVisible, setCreateVisible] = useState(false);

  return (
    <>
      <View style={styles.container}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* My Ask card */}
          <TouchableOpacity style={styles.storyItem} activeOpacity={0.7} onPress={() => setCreateVisible(true)}>
            {myAsk ? (
              <LinearGradient colors={['#22c55e', '#16a34a']} style={styles.ring}>
                <View style={styles.ringInner}>
                  {myAvatarUrl ? (
                    <Image source={{ uri: myAvatarUrl }} style={styles.avatar} cachePolicy="memory-disk" />
                  ) : (
                    <InitialsAvatar name={myName} size={52} />
                  )}
                </View>
              </LinearGradient>
            ) : (
              <View style={[styles.ring, styles.ringCreate]}>
                <View style={styles.ringInner}>
                  {myAvatarUrl ? (
                    <Image source={{ uri: myAvatarUrl }} style={styles.avatar} cachePolicy="memory-disk" />
                  ) : (
                    <InitialsAvatar name={myName} size={52} />
                  )}
                </View>
                <View style={styles.plusBadge}>
                  <Plus size={12} color="#fff" strokeWidth={3} />
                </View>
              </View>
            )}
            <Text style={styles.storyName} numberOfLines={1}>
              {myAsk ? t('ask.yourAsk') : t('ask.newAsk')}
            </Text>
          </TouchableOpacity>

          {/* Friend Asks */}
          {asks.map((ask) => {
            const name = ask.author_full_name || ask.author_username || '?';
            const h = hoursLeft(ask.expires_at);
            return (
              <TouchableOpacity
                key={ask.ask_id}
                style={styles.storyItem}
                activeOpacity={0.7}
                onPress={() => onPressUser(ask.author_id)}
              >
                <LinearGradient
                  colors={ask.degree === 1 ? ['#ff5757', '#c44dff', '#8c52ff'] : ['#60a5fa', '#818cf8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.ring}
                >
                  <View style={styles.ringInner}>
                    {ask.author_avatar_url ? (
                      <Image source={{ uri: ask.author_avatar_url }} style={styles.avatar} cachePolicy="memory-disk" />
                    ) : (
                      <InitialsAvatar name={name} size={52} />
                    )}
                  </View>
                </LinearGradient>
                <Text style={styles.storyName} numberOfLines={1}>{name}</Text>
                <Text style={styles.storyLabel} numberOfLines={1}>
                  {ask.title || ask.body.slice(0, 20)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <AskCreateModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        existingAsk={myAsk}
        onCreated={onRefresh}
      />
    </>
  );
}

// ── Create/Edit Ask Modal ──

type AskCreateModalProps = {
  visible: boolean;
  onClose: () => void;
  existingAsk: MyActiveAsk | null;
  onCreated: () => void;
};

type ExpiryOption = { label: string; hours: number };

function AskCreateModal({ visible, onClose, existingAsk, onCreated }: AskCreateModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const [body, setBody] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [myTags, setMyTags] = useState<{ id: string; name: string }[]>([]);
  const [expiryHours, setExpiryHours] = useState(24);
  const [saving, setSaving] = useState(false);

  const expiryOptions: ExpiryOption[] = useMemo(() => [
    { label: '24h', hours: 24 },
    { label: '48h', hours: 48 },
    { label: '72h', hours: 72 },
    { label: '1w', hours: 168 },
  ], []);

  useEffect(() => {
    if (visible) {
      setBody(existingAsk?.body || '');
      setExpiryHours(24);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 14 }).start();
      if (user) {
        supabase
          .from('piktag_user_tags')
          .select('tag_id, piktag_tags!tag_id(id, name)')
          .eq('user_id', user.id)
          .eq('is_private', false)
          .then(({ data }) => {
            if (data) {
              setMyTags(data.map((d: any) => ({ id: d.piktag_tags?.id, name: d.piktag_tags?.name })).filter((t: any) => t.id && t.name));
            }
          });
      }
    } else {
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible, existingAsk, user]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!user || !body.trim() || selectedTagIds.size === 0) return;
    setSaving(true);
    try {
      // If editing existing ask, deactivate it first
      if (existingAsk) {
        await supabase.from('piktag_asks').update({ is_active: false }).eq('id', existingAsk.id);
      }

      const expiresAt = new Date(Date.now() + expiryHours * 3600000).toISOString();
      const { data: askData, error } = await supabase
        .from('piktag_asks')
        .insert({ author_id: user.id, body: body.trim(), expires_at: expiresAt })
        .select('id')
        .single();

      if (error || !askData) throw error || new Error('Insert failed');

      // Insert ask tags
      const tagRows = [...selectedTagIds].map(tag_id => ({ ask_id: askData.id, tag_id }));
      await supabase.from('piktag_ask_tags').insert(tagRows);

      // AI title generation (async, non-blocking)
      const tagNames = myTags.filter(t => selectedTagIds.has(t.id)).map(t => t.name);
      supabase.functions.invoke('generate-ask-title', {
        body: JSON.stringify({ body: body.trim(), tags: tagNames }),
      }).then(({ data }) => {
        if (data?.title) {
          supabase.from('piktag_asks').update({ title: data.title }).eq('id', askData.id);
        }
      }).catch(() => {});

      onCreated();
      onClose();
    } catch (err) {
      console.warn('Ask create failed:', err);
    } finally {
      setSaving(false);
    }
  }, [user, body, selectedTagIds, expiryHours, existingAsk, myTags, onCreated, onClose]);

  const handleDelete = useCallback(async () => {
    if (!existingAsk) return;
    setSaving(true);
    try {
      await supabase.from('piktag_asks').update({ is_active: false }).eq('id', existingAsk.id);
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [existingAsk, onCreated, onClose]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={modalStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={modalStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[modalStyles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={modalStyles.handleBar} />

          <Text style={modalStyles.title}>{t('ask.createTitle')}</Text>

          {/* Body input */}
          <TextInput
            style={modalStyles.input}
            value={body}
            onChangeText={(v) => setBody(v.slice(0, MAX_BODY))}
            placeholder={t('ask.bodyPlaceholder')}
            placeholderTextColor={COLORS.gray400}
            multiline
            maxLength={MAX_BODY}
            autoFocus
          />
          <Text style={modalStyles.charCount}>{body.length}/{MAX_BODY}</Text>

          {/* Tag selector */}
          <Text style={modalStyles.sectionTitle}>{t('ask.selectTags')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={modalStyles.tagScroll}>
            {myTags.map((tag) => (
              <TouchableOpacity
                key={tag.id}
                style={[modalStyles.tagChip, selectedTagIds.has(tag.id) && modalStyles.tagChipSelected]}
                onPress={() => toggleTag(tag.id)}
                activeOpacity={0.7}
              >
                <Text style={[modalStyles.tagChipText, selectedTagIds.has(tag.id) && modalStyles.tagChipTextSelected]}>
                  #{tag.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Expiry selector */}
          <View style={modalStyles.expiryRow}>
            <Clock size={14} color={COLORS.gray500} />
            <Text style={modalStyles.expiryLabel}>{t('ask.expiry')}</Text>
            {expiryOptions.map((opt) => (
              <TouchableOpacity
                key={opt.hours}
                style={[modalStyles.expiryBtn, expiryHours === opt.hours && modalStyles.expiryBtnActive]}
                onPress={() => setExpiryHours(opt.hours)}
                activeOpacity={0.7}
              >
                <Text style={[modalStyles.expiryBtnText, expiryHours === opt.hours && modalStyles.expiryBtnTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Actions */}
          <View style={modalStyles.actions}>
            {existingAsk && (
              <TouchableOpacity style={modalStyles.deleteBtn} onPress={handleDelete} disabled={saving}>
                <Text style={modalStyles.deleteBtnText}>{t('ask.deleteAsk')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[modalStyles.submitBtn, (!body.trim() || selectedTagIds.size === 0) && modalStyles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={saving || !body.trim() || selectedTagIds.size === 0}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={modalStyles.submitBtnText}>{t('ask.postAsk')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
    paddingVertical: 12,
  },
  scroll: {
    paddingHorizontal: 12,
    gap: 14,
  },
  storyItem: {
    alignItems: 'center',
    width: 72,
  },
  ring: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
  },
  ringCreate: {
    borderWidth: 2,
    borderColor: COLORS.gray300,
    borderStyle: 'dashed',
    backgroundColor: COLORS.gray50,
  },
  ringInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  storyName: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.gray800,
    marginTop: 4,
    textAlign: 'center',
    width: 72,
  },
  storyLabel: {
    fontSize: 10,
    color: COLORS.gray500,
    textAlign: 'center',
    width: 72,
    marginTop: 1,
  },
});

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  handleBar: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.gray200, alignSelf: 'center', marginBottom: 16,
  },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.gray900, marginBottom: 16 },
  input: {
    borderWidth: 1.5, borderColor: COLORS.gray200, borderRadius: 12,
    padding: 14, fontSize: 15, color: COLORS.gray900,
    minHeight: 80, textAlignVertical: 'top', lineHeight: 22,
  },
  charCount: { fontSize: 12, color: COLORS.gray400, textAlign: 'right', marginTop: 4, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: COLORS.gray700, marginBottom: 8 },
  tagScroll: { marginBottom: 16, flexGrow: 0 },
  tagChip: {
    backgroundColor: COLORS.gray100, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
  },
  tagChipSelected: { backgroundColor: COLORS.piktag500 },
  tagChipText: { fontSize: 13, fontWeight: '500', color: COLORS.gray700 },
  tagChipTextSelected: { color: '#fff' },
  expiryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20,
  },
  expiryLabel: { fontSize: 13, color: COLORS.gray500, marginRight: 4 },
  expiryBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: COLORS.gray100,
  },
  expiryBtnActive: { backgroundColor: COLORS.piktag500 },
  expiryBtnText: { fontSize: 13, fontWeight: '500', color: COLORS.gray700 },
  expiryBtnTextActive: { color: '#fff' },
  actions: { flexDirection: 'row', gap: 12 },
  deleteBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', borderWidth: 2, borderColor: COLORS.gray200,
  },
  deleteBtnText: { fontSize: 15, fontWeight: '700', color: COLORS.gray700 },
  submitBtn: {
    flex: 2, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', backgroundColor: COLORS.piktag500,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
