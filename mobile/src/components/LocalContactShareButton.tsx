// LocalContactShareButton.tsx
//
// "寄我的聯絡資料給他" — the purple-outlined CTA that lets a viewer
// hand their PikTag handle to a local (non-member) contact via the
// viewer's own messaging client (email / SMS / WhatsApp). North-Star
// play: every saved local card is potentially a new PikTag user via
// the recipient → pikt.ag/{viewer} → install-banner funnel. The
// outgoing message is composed on the VIEWER's device, so there's
// no server-side spam-list liability.
//
// Pre-extraction this block lived inline in EditLocalContactScreen
// (~80 lines of IIFE) and was missing from LocalContactDetailScreen
// — founder caught the gap 2026-06-03. Both screens now render the
// same component, so behavioural drift can't happen by accident.
//
// Self-managing:
//   - Pulls the viewer's profile via useAuthProfile()
//   - Renders nothing when (a) viewer has no username / full_name,
//     or (b) recipient has no reachable channel (no email + no phone)
//   - Single-channel taps go straight to the messaging client;
//     multi-channel taps show an iOS ActionSheet / Android Alert

import React from 'react';
import {
  Alert,
  ActionSheetIOS,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuthProfile } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { type ColorPalette } from '../constants/theme';
import {
  availableChannels,
  openChannel,
  type ShareChannel,
} from '../lib/shareContact';

type Props = {
  /** Recipient's email — pass the normalised lowercase form when
   *  available (e.g. existing.email_lower); the SMS / WhatsApp
   *  channels don't use this. */
  recipientEmail: string | null | undefined;
  /** Recipient's phone — pass the normalised form (E.164 or local
   *  digits with no separators). */
  recipientPhone: string | null | undefined;
  /** Recipient's name — used in the share-sheet title ("Send to
   *  Alice") and in the message body greeting. */
  recipientName: string | null | undefined;
  /** Optional event / company hint (e.g. "Rotary club lunch
   *  2026-04-12") — surfaces in the outgoing message as
   *  "we met at...". The contact's `headline` field works. */
  eventOrCompanyHint?: string | null;
  /** Optional outer-style override — useful when the caller's
   *  container has its own marginTop / marginBottom rhythm. */
  style?: ViewStyle;
  /**
   * Visual tier — pick by the HOST screen's CTA hierarchy
   * (CLAUDE.md "Know the CTA of every screen" lock):
   *   - 'primary'   = solid piktag500 + white text. Use when this
   *                   button IS the page's primary CTA.
   *                   LocalContactDetailScreen → 'primary' (founder
   *                   verbatim 2026-06-03: "寄我的聯絡資料給他就是
   *                   那頁的 CTA").
   *   - 'secondary' = outlined piktag500 + piktag600 text. Use when
   *                   the page has a DIFFERENT primary CTA the
   *                   share button must defer to.
   *                   EditLocalContactScreen → 'secondary' (儲存 is
   *                   the page's primary; share button must not
   *                   compete with it).
   * Defaults to 'secondary' so existing call-sites that haven't been
   * audited stay visually correct (the original treatment).
   */
  variant?: 'primary' | 'secondary';
};

export default function LocalContactShareButton({
  recipientEmail,
  recipientPhone,
  recipientName,
  eventOrCompanyHint = null,
  style,
  variant = 'secondary',
}: Props) {
  const { t } = useTranslation();
  const { profile: myProfile } = useAuthProfile();
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const isPrimary = variant === 'primary';

  const channels = availableChannels({
    recipientEmail: recipientEmail ?? '',
    recipientPhone: recipientPhone ?? '',
    recipientName: recipientName ?? '',
    myFirstName: '',
    myUsername: '',
    tBody: t as any,
  });

  const canShare =
    channels.length > 0 &&
    !!myProfile?.username &&
    !!myProfile?.full_name;
  if (!canShare) return null;

  const myFirst = (myProfile.full_name ?? '').trim().split(/\s+/)[0] ?? '';
  const myUsername = myProfile.username ?? '';

  const onPick = (channel: ShareChannel) => {
    void openChannel(channel, {
      recipientEmail: recipientEmail ?? '',
      recipientPhone: recipientPhone ?? '',
      recipientName: recipientName ?? '',
      myFirstName: myFirst,
      myUsername,
      eventOrCompanyHint,
      tBody: t as any,
    });
  };

  const labelFor = (c: ShareChannel) =>
    c === 'email'
      ? t('localContact.shareChannelEmail', { defaultValue: 'Email' })
      : c === 'sms'
        ? t('localContact.shareChannelSms', { defaultValue: 'Text Message' })
        : t('localContact.shareChannelWhatsapp', { defaultValue: 'WhatsApp' });

  const onTapShare = () => {
    if (channels.length === 1) {
      onPick(channels[0]);
      return;
    }
    const cancelLabel = t('common.cancel', { defaultValue: 'Cancel' });
    const sheetTitle = t('localContact.shareSheetTitle', {
      name: (recipientName || t('common.them', { defaultValue: 'them' })).trim(),
      defaultValue: 'Send to {{name}}',
    });
    if (Platform.OS === 'ios') {
      const options = [...channels.map(labelFor), cancelLabel];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          title: sheetTitle,
        },
        (idx) => {
          if (idx < 0 || idx >= channels.length) return;
          onPick(channels[idx]);
        },
      );
    } else {
      Alert.alert(
        sheetTitle,
        '',
        [
          ...channels.map((c) => ({ text: labelFor(c), onPress: () => onPick(c) })),
          { text: cancelLabel, style: 'cancel' as const },
        ],
      );
    }
  };

  return (
    <TouchableOpacity
      style={[styles.btn, isPrimary && styles.btnPrimary, style]}
      onPress={onTapShare}
      activeOpacity={0.7}
    >
      <Text style={[styles.btnText, isPrimary && styles.btnTextPrimary]}>
        {t('localContact.shareBtn', { defaultValue: '寄我的聯絡資料給他' })}
      </Text>
    </TouchableOpacity>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    // Base = outlined purple pill (secondary tier). Used when the
    // host page has a DIFFERENT primary CTA the share must defer to
    // — e.g. EditLocalContact, where 儲存 is primary. Outlined
    // treatment signals "optional friendly action" without competing
    // for the eye.
    btn: {
      borderWidth: 1.5,
      borderColor: c.piktag500,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      // backgroundColor stays unset so the outline reads against
      // either the screen bg or a footer card.
    },
    btnText: {
      fontSize: 15,
      fontWeight: '700',
      color: c.piktag600,
    },
    // Primary tier override — matches the canonical primary CTA
    // pattern (EditLocalContact.saveBtn / EditProfile save / etc.):
    // solid piktag500 fill, white text, slightly larger padding so
    // the button reads as the page's anchor action. Applied via
    // StyleSheet array on top of `btn`, so only the deltas live
    // here (border stays from base but the solid fill visually
    // covers it; no need to zero borderWidth — saves a re-layout).
    btnPrimary: {
      backgroundColor: c.piktag500,
      borderColor: c.piktag500, // keep visual edge consistent
      paddingVertical: 15,
    },
    btnTextPrimary: {
      fontSize: 16,
      color: '#FFFFFF',
    },
  });
}
