// AddTagScreen.tsx
//
// The event-tag QR surface: show the QR that was just created, and offer
// 複製連結 / 分享檔案 / 編輯QRcode.
//
// 2026-09-02 — the create form no longer lives here. Founder: 「在活動標籤
// 頁，最上面，直接就顯示新增活動標籤頁的填寫內容欄位。不要再顯示『新增』
// 或『＋』」. Creating an event tag happens inline at the top of
// QrGroupListScreen, so this screen has exactly ONE entry:
//
//   navigate('AddTagCreate', { created })  — straight to the QR, right
//   after the composer on the list page made it.
//
// It used to have a second mode: 編輯QRcode dropped back into the composer.
// That was removed on 2026-09-07 because the composer's only write path is
// .insert(), so "editing" silently created a SECOND scan_session row and
// split the event's attendees across two groups. 編輯 now opens
// QrGroupDetailScreen, which updates in place. With nothing left that can
// reach it, the setup mode and its styles are gone too — a mode with no
// entry point is not a feature, it is a trap for the next person reading
// this header.
//
// Presets are gone for the same reason, one round earlier.

import React, { useMemo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Share2, ScanLine, Copy, Pencil } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { setStringAsync as setClipboardStringAsync } from 'expo-clipboard';
import QrShareBody from '../components/QrShareBody';
import { type CreatedEventTag } from '../components/EventTagComposer';
import { useTheme } from '../context/ThemeContext';
import type { ColorPalette } from '../constants/theme';

type AddTagScreenProps = {
  navigation: any;
  route?: { params?: { created?: CreatedEventTag } };
};

export default function AddTagScreen({ navigation, route }: AddTagScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  // The only caller always passes `created`; there is nothing else to be.
  const created = route?.params?.created ?? null;

  const handleShare = useCallback(async () => {
    if (!created) return;
    try {
      // URL interpolated into the message, not only passed as Share.url —
      // Share.url is iOS-only, so on Android the link would not be tappable.
      await Share.share({
        message: t('addTag.shareMessage', { url: created.qrUrl }),
        url: Platform.OS === 'ios' ? created.qrUrl : undefined,
      });
    } catch {
      /* user cancelled */
    }
  }, [created, t]);

  const handleCopyLink = useCallback(async () => {
    if (!created) return;
    try {
      await setClipboardStringAsync(created.qrUrl);
      Alert.alert(
        t('addTag.alertLinkCopiedTitle', { defaultValue: '已複製' }),
        t('addTag.alertLinkCopiedMessage', { defaultValue: '連結已複製到剪貼簿' }),
      );
    } catch {
      /* no-op */
    }
  }, [created, t]);

  // ─── QR (IG-style gradient + white card + bottom pill row) ───
  const renderQrMode = () => (
    <LinearGradient
      colors={['#ff5757', '#c44dff', '#8c52ff']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.qrGradient}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={[styles.qrTopBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}
          style={styles.qrTopBtn}
          accessibilityRole="button"
          accessibilityLabel={t('common.close', { defaultValue: '關閉' })}
        >
          <X size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.qrTopRightRow}>
          <TouchableOpacity
            onPress={() => navigation.navigate('CameraScan')}
            activeOpacity={0.6}
            style={styles.qrTopBtn}
            accessibilityRole="button"
            accessibilityLabel={t('qrGroup.scan', { defaultValue: '掃描 QR 碼加好友' })}
          >
            <ScanLine size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Shared body — same component as QrCodeModal and QrGroupDetail, so
          all three sheets stay pixel-identical. */}
      <QrShareBody
        qrValue={created?.qrUrl ?? ''}
        handle={created?.username ?? ''}
        name={created?.name || undefined}
        tags={created?.tags ?? []}
        actions={[
          {
            // Order is fixed app-wide: 複製連結 first, then 分享檔案, 編輯 last.
            icon: <Copy size={22} color="#111827" />,
            label: t('addTag.copyLink', { defaultValue: '複製連結' }),
            onPress: handleCopyLink,
          },
          {
            icon: <Share2 size={22} color="#111827" />,
            label: t('addTag.shareFile', { defaultValue: '分享檔案' }),
            onPress: handleShare,
          },
          // 編輯 now opens the REAL edit surface. It used to drop back into
          // the composer, whose only write path is .insert() — so "editing"
          // a QR silently created a SECOND scan_session row with a new sid
          // and a new QR image. The original stayed in 過往活動標籤 with the
          // old text, and the event's attendees ended up split across two
          // groups: whoever had already scanned in group one, everyone
          // after in group two. QrGroupDetailScreen updates in place
          // (handleSaveName / writeTags), which is what editing means.
          //
          // Only offered when the row actually exists. A failed insert
          // leaves a `local_` id with nothing to open, and a button that
          // dead-ends is worse than no button.
          ...(created?.persisted
            ? [
                {
                  icon: <Pencil size={22} color="#111827" />,
                  label: t('addTag.editQr', { defaultValue: '編輯QRcode' }),
                  onPress: () =>
                    navigation.replace('QrGroupDetail', { groupId: created.sessionId }),
                },
              ]
            : []),
        ]}
        bottomInset={insets.bottom}
      />
    </LinearGradient>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />
      {renderQrMode()}
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.white,
    },
    qrGradient: {
      flex: 1,
    },
    qrTopBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    qrTopBtn: {
      padding: 8,
    },
    qrTopRightRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
  });
}
