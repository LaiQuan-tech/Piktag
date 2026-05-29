/**
 * AskMatchSheet — appears immediately after a user creates an Ask.
 * Lists up to 5 of THEIR OWN friends ranked by how well their public
 * tags match the Ask's tags (+ concept siblings + endorsements).
 * Each row offers "Message" → opens chat with the matched friend AND
 * passes askId so the icebreaker generator (Phase 2) pivots to
 * Ask-anchored openers.
 *
 * Founder design constraints (2026-05-29):
 *   - 1st-degree only (don't blur with 2nd-degree — that's IG-story
 *     territory and stays as the serendipity layer)
 *   - NOT auto-DM. Asker sees candidates, asker chooses.
 *   - Explanation (why we matched) shown alongside each row — "Jeff
 *     #日式甜點 + 3 朋友認同" beats "92% match" because it's the
 *     REASON, not a black-box score
 *   - "Skip / Done" exit ALWAYS visible — don't trap users in the
 *     match flow if they want to fall back to the IG-story discovery
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import RingedAvatar from '../RingedAvatar';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';
import type { ColorPalette } from '../../constants/theme';

type MatchRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  matched_tag_count: number;
  match_score: number;
  top_matched_tags: string[] | null;
};

type Props = {
  visible: boolean;
  askId: string | null;
  onClose: () => void;
};

const AskMatchSheet = React.memo(function AskMatchSheet({
  visible,
  askId,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [openingChatFor, setOpeningChatFor] = useState<string | null>(null);
  // Track which shown candidates the user actually engaged with so
  // we don't log them as dismissed on close. Lives in a ref because
  // the close handler reads it during the same React event tick that
  // the picker set it — state would be stale.
  const messagedSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!visible || !askId) return;
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    messagedSetRef.current = new Set();
    (async () => {
      try {
        const { data, error } = await supabase.rpc('match_ask_to_friends', {
          p_ask_id: askId,
          p_limit: 5,
        });
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setRows([]);
          setErrored(true);
        } else {
          setRows(data as MatchRow[]);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setErrored(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, askId]);

  // Log every shown-but-not-messaged candidate as a dismissal on
  // surface='ask_match'. Fire-and-forget. The server RPC respects
  // these so the same friend doesn't get re-suggested on the next
  // Ask within 60 days (CLAUDE.md "new ranking surface checklist"
  // bullet #3).
  const logDismissalsAndClose = useCallback(() => {
    const messaged = messagedSetRef.current;
    const dismiss = rows.filter((r) => !messaged.has(r.id));
    if (dismiss.length > 0) {
      void supabase
        .from('piktag_match_dismissals')
        .upsert(
          dismiss.map((r) => ({ target_id: r.id, surface: 'ask_match' })),
          { onConflict: 'viewer_id,target_id,surface' },
        )
        .then(({ error }) => {
          if (error) {
            const code = (error as any).code;
            if (code !== '42P01' && code !== 'PGRST205') {
              console.warn('[AskMatch] dismiss log failed:', error.message);
            }
          }
        });
    }
    onClose();
  }, [rows, onClose]);

  // Tap "Message" on a match row → get-or-create the conversation
  // with that friend, then navigate to ChatThread passing askId so
  // the icebreaker generator (Phase 2) pivots to Ask-anchored
  // openers. After navigation, close the sheet so it doesn't blink
  // back when the user returns.
  const handlePick = useCallback(
    async (row: MatchRow) => {
      if (!askId || openingChatFor) return;
      setOpeningChatFor(row.id);
      // Mark BEFORE the await so onClose's dismissal sweep won't
      // log this row even if React batches state and the user
      // immediately taps Done. Ref mutation is sync.
      messagedSetRef.current.add(row.id);
      try {
        const { data, error } = await supabase.rpc('get_or_create_conversation', {
          other_user_id: row.id,
        });
        if (error) {
          console.warn('[AskMatch] get_or_create_conversation failed:', error.message);
          return;
        }
        const conversationId =
          typeof data === 'string'
            ? data
            : (data as any)?.id ?? (data as any)?.conversation_id ?? data;
        if (!conversationId) return;
        navigation.navigate('ChatThread', {
          conversationId,
          otherUserId: row.id,
          otherDisplayName: row.full_name ?? row.username ?? '',
          otherAvatarUrl: row.avatar_url,
          askId,  // ← key piece: icebreaker prompt picks up this anchor
        });
        // Closing via the dismissal-aware wrapper so the OTHER candidates
        // (the ones the user didn't message) get logged as dismissed for
        // this surface. row.id is already in messagedSetRef so it's
        // correctly excluded from the dismissal sweep.
        logDismissalsAndClose();
      } catch (err) {
        console.warn('[AskMatch] navigate threw:', err);
      } finally {
        setOpeningChatFor(null);
      }
    },
    [askId, openingChatFor, navigation, logDismissalsAndClose],
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={logDismissalsAndClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handleBar} />
          <View style={styles.header}>
            <Text style={styles.title}>
              {t('ask.matchSheetTitle', { defaultValue: 'Best matches in your network' })}
            </Text>
            <TouchableOpacity onPress={logDismissalsAndClose} hitSlop={12} activeOpacity={0.6}>
              <X size={22} color={colors.gray500} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            {t('ask.matchSheetSubtitle', {
              defaultValue:
                "Friends whose tags line up with what you're looking for. Reach out, or skip and let the wider feed find them too.",
            })}
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={colors.piktag500} />
            </View>
          ) : errored ? (
            <Text style={styles.emptyText}>
              {t('ask.matchSheetError', { defaultValue: "Couldn't load matches — your Ask is live in the feed regardless." })}
            </Text>
          ) : rows.length === 0 ? (
            <Text style={styles.emptyText}>
              {t('ask.matchSheetEmpty', { defaultValue: 'No close match in your friends — the wider feed will pick this up.' })}
            </Text>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {rows.map((r) => {
                const display = r.full_name || r.username || '—';
                const tags = (r.top_matched_tags ?? []).slice(0, 3);
                return (
                  <View key={r.id} style={styles.row}>
                    <RingedAvatar
                      size={52}
                      ringStyle="subtle"
                      name={display}
                      avatarUrl={r.avatar_url}
                    />
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName} numberOfLines={1}>{display}</Text>
                      {tags.length > 0 ? (
                        <Text style={styles.rowReason} numberOfLines={1}>
                          {tags.map((tg) => `#${tg}`).join('  ')}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={styles.messageBtn}
                      onPress={() => void handlePick(r)}
                      disabled={!!openingChatFor}
                      activeOpacity={0.8}
                    >
                      {openingChatFor === r.id ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.messageBtnText}>
                          {t('ask.matchMessageBtn', { defaultValue: 'Message' })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.doneBtn} onPress={logDismissalsAndClose} activeOpacity={0.7}>
            <Text style={styles.doneBtnText}>
              {t('ask.matchSheetDone', { defaultValue: 'Done' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
});

export default AskMatchSheet;

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.white,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingBottom: 28,
      maxHeight: '85%',
    },
    handleBar: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.gray200,
      marginTop: 10,
      marginBottom: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: c.gray900,
    },
    subtitle: {
      fontSize: 13,
      color: c.gray500,
      marginBottom: 14,
      lineHeight: 19,
    },
    loadingBox: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: c.gray500,
      paddingVertical: 24,
      textAlign: 'center',
    },
    list: { paddingBottom: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
    },
    rowInfo: {
      flex: 1,
    },
    rowName: {
      fontSize: 15,
      fontWeight: '700',
      color: c.gray900,
      marginBottom: 2,
    },
    rowReason: {
      fontSize: 13,
      color: c.piktag600,
      fontWeight: '600',
    },
    messageBtn: {
      backgroundColor: c.piktag500,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 18,
    },
    messageBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    doneBtn: {
      marginTop: 16,
      paddingVertical: 12,
      alignItems: 'center',
    },
    doneBtnText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.gray500,
    },
  });
}
