// AddTagScreen.tsx
//
// The event-tag QR surface: show the QR that was just created, and offer
// 複製連結 / 分享檔案 / 編輯QRcode.
//
// 2026-09-02 — the create form no longer lives here. Founder: 「在活動標籤
// 頁，最上面，直接就顯示新增活動標籤頁的填寫內容欄位。不要再顯示『新增』
// 或『＋』」. Creating an event tag is now done inline at the top of
// QrGroupListScreen, so this screen is reached two ways:
//
//   * navigate('AddTagCreate', { created })  — straight to the QR, right
//     after the composer on the list page made it.
//   * 編輯QRcode from that QR — drops back to the composer, prefilled.
//
// The composer itself is EventTagComposer, the same component the list
// page mounts. It is one unit (活動內容 → AI 標籤 → 挑 → 建立) and both
// surfaces mount the whole of it; the previous attempt to lift only part
// of it onto the list page is what produced QR codes describing nothing.
//
// Presets are gone. They were already dead code — task 2 made every QR a
// persistent group, which is what a preset was for — and the setup mode
// that referenced them no longer exists here.

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Share2, ScanLine, Copy, Pencil, ArrowLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { setStringAsync as setClipboardStringAsync } from 'expo-clipboard';
import QrShareBody from '../components/QrShareBody';
import EventTagComposer, { type CreatedEventTag } from '../components/EventTagComposer';
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

  // Arriving with a `created` payload means the composer on the list page
  // just made this QR — go straight to it. Arriving without one means the
  // screen was opened to create something, so start on the form.
  const initialCreated = route?.params?.created ?? null;
  const [created, setCreated] = useState<CreatedEventTag | null>(initialCreated);
  const [mode, setMode] = useState<'setup' | 'qr'>(initialCreated ? 'qr' : 'setup');

  const handleCreated = useCallback((result: CreatedEventTag) => {
    setCreated(result);
    setMode('qr');
  }, []);

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

  // ─── Setup (the shared composer) ────────────────────────
  const renderSetupMode = () => (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerLeftGroup}>
          <TouchableOpacity
            onPress={() => (created ? setMode('qr') : navigation.goBack())}
            activeOpacity={0.6}
            style={styles.headerSideBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', { defaultValue: '返回' })}
          >
            <ArrowLeft size={24} color={colors.gray900} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('addTag.headerTitle', { defaultValue: '建立 Tag' })}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <EventTagComposer
          // Remounted per edited QR so the prefill actually takes — the
          // composer seeds its state from these props on mount.
          key={created?.sessionId ?? 'new'}
          onCreated={handleCreated}
          initialDescription={created?.name}
          initialTags={created?.tags}
        />
      </ScrollView>
    </>
  );

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
          {
            icon: <Pencil size={22} color="#111827" />,
            label: t('addTag.editQr', { defaultValue: '編輯QRcode' }),
            onPress: () => setMode('setup'),
          },
        ]}
        bottomInset={insets.bottom}
      />
    </LinearGradient>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />
      {mode === 'setup' ? renderSetupMode() : renderQrMode()}
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.white,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 16,
      backgroundColor: c.white,
      borderBottomWidth: 1,
      borderBottomColor: c.gray100,
    },
    headerLeftGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerSideBtn: {
      padding: 4,
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: '700',
      color: c.gray900,
      lineHeight: 32,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingBottom: 100,
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
