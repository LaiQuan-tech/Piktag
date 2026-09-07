// EventTagComposer.tsx
//
// The event-tag CREATE unit, as one indivisible thing:
//
//     活動內容  →  AI 讀它、推薦標籤  →  你挑  →  建立
//
// Founder, on the recording that killed the previous attempt:
// 「要先輸入『活動內容』，以及下面應該要有 ai 生成標籤，有活動內容，才能
// 『建立』… 整個流程就是錯誤的」. That attempt lifted only the description
// box onto the list page and left 建立 pressable with nothing entered, so
// it produced QR codes that described nothing. The lesson is that these
// four steps are ONE unit — you cannot sprinkle pieces of it onto a
// surface and expect the flow to survive. So it is a component, and every
// surface that offers "create an event tag" mounts this whole thing.
//
// Two hosts today:
//   * QrGroupListScreen — inline at the top of the 活動標籤 tab, above the
//     past-tags list. This is the primary entry (the old + is gone).
//   * AddTagScreen — the 編輯QRcode surface reached from a QR screen.
//
// Nothing happens until the user types. No profile fetch, no GPS prompt,
// no AI call. That matters now the unit lives on a TAB ROOT: before this,
// opening the create form was itself the signal that the user wanted an
// event tag, so firing a location permission dialog on mount was fair.
// A tab you land on by tapping the wrong icon is not that signal. Same
// reasoning as maybeAskPushPermission — ask in context, not on arrival.
//
// It also means the AI strip is never an empty labelled box: it appears
// once there is something for the AI to read, which is the order the
// founder described.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Plus, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import {
  requestForegroundPermissionsAsync,
  getCurrentPositionAsync,
  Accuracy,
  reverseGeocodeAsync,
} from 'expo-location';
import BoltIcon from './BoltIcon';
import GradientButton from './GradientButton';
import SectionTitle from './SectionTitle';
import TagChip from './TagChip';
import BrandSpinner from './loaders/BrandSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useAuthProfile } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useRotatingPlaceholder } from '../hooks/useRotatingPlaceholder';
import {
  recordAiSuggestions,
  markAiSuggestionAccepted,
  markAiSuggestionDismissed,
} from '../lib/aiTagLogger';
import { logApiUsage } from '../lib/apiUsage';
import { normalizeTagName } from '../lib/normalizeTag';
import { checkOffline } from '../lib/netStatus';
import { appendLang } from '../lib/shareProfile';
import type { ColorPalette } from '../constants/theme';
import type { PiktagProfile } from '../types';

export type CreatedEventTag = {
  /** DB row id, or a `local_…` id when the insert could not be written. */
  sessionId: string;
  /** False when the row never made it to the DB (offline at the venue). */
  persisted: boolean;
  qrUrl: string;
  username: string;
  /** The 活動內容 the user typed — also written to the row's `name`. */
  name: string;
  tags: string[];
};

type Props = {
  onCreated: (result: CreatedEventTag) => void;
  /** Prefill when re-entering from 編輯QRcode. */
  initialDescription?: string;
  initialTags?: string[];
};

export default function EventTagComposer({
  onCreated,
  initialDescription = '',
  initialTags,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  // Disk-cached profile. AuthContext keeps it precisely so an offline
  // session still has a usable handle; the QR's username comes from here
  // when the live fetch cannot answer.
  const { profile: cachedProfile } = useAuthProfile();

  // Rotating "what's this QR for?" placeholder — same hook as the search
  // box, so intent inputs feel the same across the app. Teaches by
  // example (龍洞潛水揪團 / 創業者週末聚會 …) instead of by instruction.
  const contextHints = useMemo(() => {
    const raw = t('addTag.contextPromptHints', { returnObjects: true });
    return Array.isArray(raw) && raw.length > 0 ? (raw as string[]) : null;
  }, [t]);
  const contextPlaceholder = useRotatingPlaceholder(
    contextHints,
    t('addTag.contextPlaceholder', { defaultValue: '例如：週末聚餐、客戶 demo、新書發表會' }),
  );

  const [contextDescription, setContextDescription] = useState(initialDescription);
  const [eventTags, setEventTags] = useState<string[]>(initialTags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [generating, setGenerating] = useState(false);

  // Ambient AI context.
  const [aiLocation, setAiLocation] = useState('');
  const [aiLocationDetail, setAiLocationDetail] = useState('');
  const [popularNearby, setPopularNearby] = useState<string[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiSuggestionIds, setAiSuggestionIds] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiContext, setAiContext] = useState('');
  // Bumped whenever the composer is reset (i.e. after a successful create).
  // An AI request in flight at that moment used to land afterwards and
  // repaint the emptied form with the PREVIOUS event's chips — the render
  // gate is `hasDescription || aiSuggestions.length > 0`, so the strip
  // reappeared over a blank description, and tapping a chip seeded the
  // NEXT event tag with a tag chosen for the last one. Exactly the ghost
  // tags this component was written to eliminate.
  const aiRunRef = useRef(0);
  const [viewerBio, setViewerBio] = useState('');
  const [viewerTagNames, setViewerTagNames] = useState<string[]>([]);

  const hasDescription = contextDescription.trim().length > 0;
  // Everything ambient (identity, GPS, nearby tags) is gathered ONCE, the
  // first time the user shows intent by typing. A prefilled description
  // (編輯QRcode) counts as intent — they already made this QR.
  // TYPING is the signal, not focusing. onFocus used to set this too,
  // which fired the OS location prompt the moment someone tapped the box
  // to read the rotating placeholder — contradicting this file's own
  // stated contract ("nothing happens until the user types"), which is the
  // whole justification for putting this unit on a tab root.
  const [engaged, setEngaged] = useState(initialDescription.trim().length > 0);
  useEffect(() => {
    if (hasDescription) setEngaged(true);
  }, [hasDescription]);

  // ─── Who is making this QR ──────────────────────────────
  const identityFetchedRef = useRef(false);
  useEffect(() => {
    if (!engaged || !user?.id || identityFetchedRef.current) return;
    identityFetchedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { data: profile } = await supabase
          .from('piktag_profiles')
          .select('bio, headline, full_name')
          .eq('id', user.id)
          .maybeSingle();
        if (!cancelled && profile) {
          setViewerBio(
            [profile.bio, profile.headline, profile.full_name].filter(Boolean).join(' · '),
          );
        }
        const { data: ut } = await supabase
          .from('piktag_user_tags')
          .select('piktag_tags(name)')
          .eq('user_id', user.id)
          .eq('is_private', false)
          .limit(10);
        if (!cancelled && Array.isArray(ut)) {
          setViewerTagNames(
            ut.map((row: any) => row?.piktag_tags?.name).filter(Boolean) as string[],
          );
        }
      } catch (err) {
        console.warn('[EventTagComposer] viewer identity fetch failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // user?.id, not `user`: AuthContext hands out a NEW user object on
    // every token refresh, and this only needs the identity.
  }, [engaged, user?.id]);

  // ─── Where they are ─────────────────────────────────────
  // GPS → reverse-geocode → primary place + a multi-level string, then
  // what other hosts have tagged near here in the last 90 days. The
  // nearby tags are AI GROUNDING: without them the model invents
  // plausible-sounding event names; with them a QR made at a convention
  // centre surfaces the convention's real tag.
  const geoFetchedRef = useRef(false);
  useEffect(() => {
    if (!engaged || geoFetchedRef.current) return;
    geoFetchedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { status } = await requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await getCurrentPositionAsync({ accuracy: Accuracy.Balanced });
        const places = await reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (cancelled) return;
        const first = places[0];
        if (!first) return;

        const primary =
          first.name || first.district || first.subregion || first.city || first.region || '';
        // Closest-first, then broadening, deduped — reverseGeocode often
        // repeats the same string across fields for landmarks.
        const levels = Array.from(
          new Set(
            [
              first.name,
              first.district,
              first.subregion,
              first.city,
              first.region,
              first.country,
            ].filter((s): s is string => !!s && s.trim().length > 0),
          ),
        );
        if (primary) setAiLocation(primary);
        if (levels.length > 0) setAiLocationDetail(levels.join(', '));

        if (primary) {
          try {
            const { data: popData } = await supabase.rpc('popular_tags_near_location', {
              p_location: primary,
              p_limit: 10,
            });
            if (cancelled) return;
            setPopularNearby(
              Array.isArray(popData)
                ? (popData as Array<{ name: string }>).map((r) => r.name).filter(Boolean)
                : [],
            );
          } catch {
            /* RPC missing or RLS — non-fatal, AI just gets less grounding */
          }
        }
      } catch {
        /* GPS denied or unavailable — AI still works on bio + description */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engaged]);

  // ─── AI suggestions ─────────────────────────────────────
  const loadAiSuggestions = useCallback(
    async (force = false) => {
      if (!user) return;
      const desc = contextDescription.trim();
      // The description IS the trigger. Firing on identity alone (the old
      // behaviour) put chips on screen before the user had said anything
      // about the event, which is backwards: the tags are supposed to
      // describe THIS occasion.
      if (!desc) return;
      const identity = [viewerBio, viewerTagNames.join(', ')].filter(Boolean).join(' · ');
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateOnly = `${yyyy}-${mm}-${dd}`;
      // eventTags is deliberately NOT part of this key. It still rides in
      // the request body so the model does not repeat what you already
      // picked — but including it here made every chip tap invalidate the
      // cache and fire a fresh Gemini call: the strip you were picking
      // from was replaced under your finger ~1s later, so the second tap
      // landed on whatever had moved into that slot, and five picks cost
      // five invocations of a quota this project has already exhausted
      // once. Re-rolling on demand is what 重新推薦 is for.
      const contextKey = `${identity}|${desc}|${aiLocationDetail || aiLocation}|${popularNearby.join(',')}|${dateOnly}`;
      // `force` = an explicit 重新推薦 tap. Without the bypass the button
      // is a visible no-op on unchanged context, which reads as broken.
      if (!force && contextKey === aiContext && aiSuggestions.length > 0) return;
      const run = ++aiRunRef.current;
      const stale = () => run !== aiRunRef.current;
      setAiContext(contextKey);
      setAiLoading(true);
      try {
        const blob = desc + identity;
        const userLang = blob.match(/[一-鿿]/)
          ? '繁體中文'
          : blob.match(/[぀-ヿ]/)
            ? '日本語'
            : blob.match(/[가-힯]/)
              ? '한국어'
              : blob.match(/[฀-๿]/)
                ? 'ภาษาไทย'
                : 'the same language as the content';
        logApiUsage('gemini_generate', { via: 'edge-fn:qr-group' });
        const { data, error } = await supabase.functions.invoke<{ suggestions?: string[] }>(
          'suggest-tags',
          {
            body: {
              bio: identity,
              name: desc,
              location: aiLocation,
              locationDetail: aiLocationDetail,
              date: dateOnly,
              popularNearby: popularNearby.join(', '),
              existingTags: eventTags.join(', '),
              lang: userLang,
            },
          },
        );
        if (stale()) return;
        if (error) {
          console.warn('[EventTagComposer] AI suggest-tags error:', error.message);
          // Offline is not "the AI had no ideas". Saying so at a venue with
          // no signal tells the host their event is unremarkable when the
          // truth is the request never left the phone. Leave the strip as
          // it was rather than replacing it with a wrong explanation.
          if (!(await checkOffline())) setAiSuggestions([]);
          return;
        }
        const raw = Array.isArray(data?.suggestions) ? data!.suggestions : [];
        const cleaned = Array.from(
          new Set(
            raw
              .map((n) => (typeof n === 'string' ? n.replace(/^#/, '').trim() : ''))
              .filter(Boolean)
              .filter((n) => !eventTags.includes(n)),
          ),
        ).slice(0, 10);

        // Guaranteed-selectable date and location tags. The prompt asks
        // for both, but an LLM is probabilistic and this is a product
        // requirement, so they are synthesised here and merged to the
        // FRONT. A location tag is only ever offered when GPS actually
        // gave us one — a wrong location tag is worse than none.
        const guaranteed: string[] = [`${yyyy}/${mm}/${dd}`];
        const locTag = (aiLocation || aiLocationDetail.split(',')[0] || '')
          .trim()
          .replace(/\s+/g, '');
        if (locTag) guaranteed.push(locTag);

        const merged = Array.from(new Set([...guaranteed, ...cleaned]))
          .filter((n) => !eventTags.includes(n))
          .slice(0, 10);
        if (stale()) return;
        setAiSuggestions(merged);
        // A fresh batch owns the id map outright. Keeping the old entries
        // meant a chip name appearing in two batches logged the EARLIER
        // batch's suggestion id — a wrong position written into the
        // calibration log the tag algorithm learns from.
        setAiSuggestionIds({});
        // Confidence calibration log — fire-and-forget, never blocks the
        // UI. Array index is the position, so the first chip is position 0.
        void (async () => {
          const ids = await recordAiSuggestions('suggest_tags_rpc', merged, {
            context_description: contextKey.slice(0, 200),
            location: aiLocation || null,
          });
          if (ids.length === merged.length && !stale()) {
            const map: Record<string, string> = {};
            merged.forEach((name, i) => {
              map[name] = ids[i];
            });
            setAiSuggestionIds(map);
          }
        })();
      } catch (err) {
        console.warn('[EventTagComposer] AI suggest-tags exception:', err);
        if (!stale()) setAiSuggestions([]);
      } finally {
        if (!stale()) setAiLoading(false);
      }
    },
    [
      user,
      contextDescription,
      aiLocation,
      aiLocationDetail,
      popularNearby,
      viewerBio,
      viewerTagNames,
      eventTags,
      aiContext,
      aiSuggestions.length,
    ],
  );

  // Debounced so typing does not hammer the edge function. popularNearby
  // is a dep so suggestions refresh once that RPC resolves — it usually
  // lands after the first AI call has already gone out.
  useEffect(() => {
    if (!hasDescription) return;
    const id = setTimeout(() => {
      void loadAiSuggestions();
    }, 900);
    return () => clearTimeout(id);
  }, [hasDescription, loadAiSuggestions]);

  const handleAddTag = useCallback(() => {
    // Shared normalizer: typing "#design" used to store the literal
    // "#design" and render "##design" — a second, broken identity for a
    // tag that already exists.
    const trimmed = normalizeTagName(tagInput);
    if (!trimmed) return;
    if (eventTags.includes(trimmed)) {
      Alert.alert(t('addTag.alertTagExists'), t('addTag.alertTagExistsMessage'));
      return;
    }
    setEventTags((prev) => [...prev, trimmed]);
    setTagInput('');
  }, [tagInput, eventTags, t]);

  const handleRemoveTag = useCallback(
    (tag: string) => {
      // If it came from an AI chip this session, record the rejection —
      // that is the negative signal the calibration log needs.
      const id = aiSuggestionIds[tag];
      if (id) void markAiSuggestionDismissed(id);
      setEventTags((prev) => prev.filter((x) => x !== tag));
    },
    [aiSuggestionIds],
  );

  // ─── Create ─────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!user) return;
    const name = contextDescription.trim();
    // Belt to the disabled button's braces. An event tag whose row
    // describes nothing is the exact artifact the founder rejected.
    if (!name) return;
    setGenerating(true);
    try {
      // The username is what the QR POINTS AT, so it is the one field here
      // that must never be guessed. This used to be an unchecked .single()
      // whose result fell back to `user.id` — so a failed profile fetch
      // (offline at a venue, i.e. exactly when this screen is used) baked
      // the raw auth UUID into the link AND persisted it to qr_code_data.
      // Guests scanning it landed on "user not found", and nothing ever
      // repaired the row: a permanently dead QR, created silently.
      //
      // AuthContext already keeps a disk-cached profile for this precise
      // reason, so prefer it and only ask the server to refine it.
      const { data: profileData, error: profileErr } = await supabase
        .from('piktag_profiles')
        .select('full_name, username')
        .eq('id', user.id)
        .maybeSingle();
      const username =
        (!profileErr ? (profileData as PiktagProfile | null)?.username : null) ||
        cachedProfile?.username ||
        '';
      if (!username) {
        // No verified handle from either source. A QR built on a UUID is
        // worse than no QR: it looks like it worked and is dead forever.
        console.warn('[EventTagComposer] no username available:', profileErr);
        Alert.alert(
          t('common.error', { defaultValue: '發生錯誤' }),
          t('addTag.alertQrError'),
        );
        return;
      }

      // Written only when the insert fails, so the host can still show a
      // working QR at a venue with no signal.
      let sessionId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let persisted = false;

      try {
        const { data, error } = await supabase
          .from('piktag_scan_sessions')
          .insert({
            host_user_id: user.id,
            // The 活動內容 becomes the row's name. It was never written
            // before, which is why saved event tags listed as
            // "Tag · 9/2/2026" — the user typed the name of their event
            // and the list showed them a date.
            name,
            preset_id: null,
            event_date: null,
            event_location: null,
            event_tags: eventTags,
            qr_code_data: '',
            is_active: true,
            // Persistent groups: NULL expires_at means re-shareable forever.
            expires_at: null,
          })
          .select('id')
          .single();

        if (!error && data) {
          sessionId = data.id;
          persisted = true;
        } else if (error) {
          // Never silent: the old failure mode was a QR that looked
          // generated but was never written, so it never appeared in the
          // list and the user had no way to tell why.
          console.warn('[EventTagComposer] scan_session insert failed:', error);
          Alert.alert(
            t('addTag.saveWarnTitle', { defaultValue: 'QR 已產生，但無法儲存到 Tag' }),
            t('addTag.saveWarnMsg', {
              code: (error as any).code || '?',
              message: error.message,
              defaultValue: `這個 QR 可以馬上分享，但不會出現在你的 Tag 清單中。\n\n錯誤代碼：${(error as any).code || '?'}\n${error.message}`,
            }),
          );
        }
      } catch (err) {
        console.warn('[EventTagComposer] scan_session insert threw:', err);
      }

      // The row holds event_tags server-side and the landing reads them
      // live, so a persisted QR needs only the sid — that keeps the link
      // short and free of %-encoded CJK, which reads as phishing. The
      // params ride along ONLY in the failed-insert case, where the
      // `local_` id resolves to nothing and the tags would be lost.
      const params = new URLSearchParams();
      params.set('sid', sessionId);
      if (!persisted && eventTags.length > 0) params.set('tags', eventTags.join(','));
      const qrUrl = appendLang(`https://pikt.ag/${username}?${params.toString()}`);

      if (persisted) {
        // The result was previously ignored, and the try/catch could not
        // have caught the realistic failure anyway: a PostgREST builder
        // RESOLVES with { error }, it does not reject. So a dropped
        // connection between the insert and this update left the row
        // holding the '' placeholder — and nothing ever rewrites it. The
        // host sees a working QR (this screen holds the URL in memory) and
        // only discovers later that the saved group renders no QR at all,
        // with 複製連結 and 分享檔案 silently doing nothing.
        const { error: qrErr } = await supabase
          .from('piktag_scan_sessions')
          .update({ qr_code_data: qrUrl })
          .eq('id', sessionId);
        if (qrErr) {
          console.warn('[EventTagComposer] qr_code_data write-back failed:', qrErr);
          Alert.alert(
            t('addTag.saveWarnTitle', { defaultValue: 'QR 已產生，但無法儲存到 Tag' }),
            t('addTag.saveWarnMsg', {
              code: (qrErr as any).code || '?',
              message: qrErr.message,
              defaultValue: `這個 QR 可以馬上分享，但清單裡的這一筆需要重新產生。`,
            }),
          );
        }
      }

      // The EVENT_QR snapshot that used to be written here is gone. The
      // only thing that ever read it was AddTagScreen's old setup mode,
      // restoring a previous QR into a form the user had just opened to
      // make a NEW one — which is where the "I didn't pick those tags,
      // why are they here?" ghost tags came from. Nothing reads it now,
      // and a cache with no reader is a safety net that isn't one.
      //
      // Known gap it leaves untouched (it was never covered): a QR made
      // with no signal lives only in the screen we are about to open. The
      // row was not written either, so leaving loses both. Persisted QRs
      // are safe — they are in the QR_GROUPS snapshot.
      onCreated({ sessionId, persisted, qrUrl, username, name, tags: eventTags });

      // Leave the unit empty and ready. Keeping the text would invite a
      // second identical event tag on the next tap.
      // Invalidate anything the AI still owes us, so it cannot repaint
      // this now-empty form with the event we just created.
      aiRunRef.current++;
      setContextDescription('');
      setEventTags([]);
      setTagInput('');
      setAiSuggestions([]);
      setAiSuggestionIds({});
      setAiContext('');
    } catch (err) {
      console.error('[EventTagComposer] create failed:', err);
      Alert.alert(t('common.error'), t('addTag.alertQrError'));
    } finally {
      setGenerating(false);
    }
  }, [user, contextDescription, eventTags, onCreated, t]);

  return (
    <View>
      {/* 1. 活動內容 — the input everything else reads from. */}
      <View style={styles.section}>
        <SectionTitle variant="form" style={{ marginBottom: 4 }}>
          {t('addTag.contextLabel', { defaultValue: '這次是什麼場合？' })}
        </SectionTitle>
        <Text style={styles.hint}>
          {t('addTag.contextHint', {
            defaultValue:
              '一句話描述就好。AI 會根據你說的、時間和地點推薦標籤，幫你記住在這認識的人。',
          })}
        </Text>
        <View style={[styles.inputRow, { marginTop: 4 }]}>
          <TextInput
            style={styles.textInput}
            value={contextDescription}
            onChangeText={setContextDescription}
            placeholder={contextPlaceholder}
            placeholderTextColor={colors.gray400}
            returnKeyType="done"
            maxLength={60}
          />
        </View>
      </View>

      {/* 2. AI 推薦 — appears once there is something to read. Before
          that it would be an empty labelled box promising nothing. */}
      {(hasDescription || aiSuggestions.length > 0) && (
        <View style={styles.section}>
          <View style={styles.aiHeaderRow}>
            <View style={styles.aiHeaderLeft}>
              {aiLoading ? <BrandSpinner size={16} /> : <BoltIcon size={14} color={colors.piktag600} />}
              <Text style={styles.aiHeaderTitle}>
                {aiLoading
                  ? `${t('addTag.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' })}…`
                  : t('addTag.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' })}
              </Text>
            </View>
            {!aiLoading && (
              <TouchableOpacity
                onPress={() => void loadAiSuggestions(true)}
                activeOpacity={0.7}
                hitSlop={8}
                style={styles.aiRefreshBtn}
                accessibilityRole="button"
                accessibilityLabel={t('addTag.aiRegenerate', { defaultValue: '重新推薦' })}
              >
                <RefreshCw size={14} color={colors.piktag600} />
              </TouchableOpacity>
            )}
          </View>
          {aiSuggestions.length > 0 ? (
            <View style={styles.suggestionChips}>
              {aiSuggestions.map((s) => (
                <TagChip
                  key={s}
                  label={s}
                  variant="toggle"
                  onPress={() => {
                    setEventTags((prev) => (prev.includes(s) ? prev : [...prev, s]));
                    setAiSuggestions((prev) => prev.filter((x) => x !== s));
                    const id = aiSuggestionIds[s];
                    if (id) void markAiSuggestionAccepted(id);
                  }}
                />
              ))}
            </View>
          ) : aiLoading ? null : aiContext.length > 0 ? (
            <Text style={styles.hint}>
              {t('addTag.aiSuggestionsEmpty', {
                defaultValue: 'AI 想不到合適的標籤 — 再試一次或自己加。',
              })}
            </Text>
          ) : null}
        </View>
      )}

      {/* 3. 自訂標籤 — chips ABOVE the input (repo-wide contract: existing
          items first, the input is the prompt at the bottom). */}
      <View style={styles.section}>
        <SectionTitle variant="form" style={{ marginBottom: 4 }}>
          {t('addTag.customTagsLabel')}
        </SectionTitle>
        <Text style={styles.hint}>
          {t('addTag.hiddenTagHint', { defaultValue: '這些標籤僅自己可見，幫助你記住在哪認識' })}
        </Text>

        {eventTags.length > 0 && (
          <View style={styles.chipsContainer}>
            {eventTags.map((tag) => (
              <TagChip key={tag} label={tag} onRemove={() => handleRemoveTag(tag)} />
            ))}
          </View>
        )}

        <View style={styles.tagInputRow}>
          <View style={[styles.inputRow, { flex: 1 }]}>
            <TextInput
              style={styles.textInput}
              value={tagInput}
              onChangeText={setTagInput}
              placeholder={t('addTag.tagPlaceholder')}
              placeholderTextColor={colors.gray400}
              returnKeyType="done"
              onSubmitEditing={handleAddTag}
            />
          </View>
          <TouchableOpacity
            style={styles.addTagBtn}
            onPress={handleAddTag}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('common.add')}
          >
            <Plus size={22} color="#FFFFFF" strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 4. 建立 — the signature action, so it is the gradient, and it is
          dead until there is an 活動內容 for it to describe. */}
      <View style={styles.section}>
        <GradientButton
          label={t('addTag.generateQrButton')}
          onPress={() => void handleCreate()}
          disabled={!hasDescription}
          loading={generating}
        />
      </View>
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    section: {
      paddingHorizontal: 20,
      paddingTop: 24,
    },
    hint: {
      fontSize: 12,
      color: c.gray400,
      marginBottom: 12,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.gray100,
      borderWidth: 1,
      borderColor: c.gray200,
      borderRadius: 16,
      paddingHorizontal: 16,
      height: 48,
    },
    textInput: {
      flex: 1,
      fontSize: 16,
      color: c.gray900,
      padding: 0,
    },
    aiHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    aiHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    aiHeaderTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: c.piktag600,
    },
    aiRefreshBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.piktag200,
      backgroundColor: c.piktag50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    suggestionChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    chipsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 14,
    },
    tagInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 14,
    },
    addTagBtn: {
      backgroundColor: c.piktag500,
      borderRadius: 14,
      width: 44,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
}
