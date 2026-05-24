import React, { useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { X, Copy, Share2 } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { setStringAsync } from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { APP_BASE_URL, shareProfile } from '../lib/shareProfile';
import QrModalStinger from './stingers/QrModalStinger';
import QrNameCard from './QrNameCard';

type QrCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  username: string;
  fullName: string;
  /** Public identity tags (names, no #) shown inside the card —
      mirrors how the Tag QR card shows its event tags. */
  tags?: string[];
};

// Personal-profile QR share sheet.
//
// Styled to match the Tag "present" card (QrGroupDetailScreen
// renderPresent / AddTagScreen renderQrMode): same red→purple
// gradient, white QR card, white pill actions. Every "show
// someone my QR / share me" surface in the app now shares one
// flashy visual language — deliberate, it's the moment the user
// most wants to look good (Gen-Z share appeal).
export default function QrCodeModal({
  visible,
  onClose,
  username,
  fullName,
  tags,
}: QrCodeModalProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const profileUrl = `${APP_BASE_URL}/${username}`;

  const handleCopyLink = async () => {
    await setStringAsync(profileUrl);
  };

  const handleShare = async () => {
    // Delegates to the shared helper so copy/URL/platform-handling
    // logic lives in one place. Fixes the prior "URL appears twice
    // on iOS" bug — the helper intentionally omits the separate
    // `url` field that caused iMessage to render both an inline URL
    // and a preview card for the same link.
    await shareProfile({
      name: `${fullName} (@${username})`,
      username,
      t,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Stinger wraps the sheet for the branded logo bloom on
          open. Must live INSIDE the Modal and wrap the full
          backdrop so the scale/fade applies to the sheet. */}
      <QrModalStinger visible={visible}>
        <View style={styles.overlay}>
          <LinearGradient
            colors={['#ff5757', '#c44dff', '#8c52ff']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
          >
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.cardWrap}>
              <QrNameCard
                qrValue={profileUrl}
                handle={username}
                name={fullName}
                tags={tags}
              />
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleCopyLink}
                activeOpacity={0.7}
              >
                <Copy size={20} color={'#111827'} />
                <Text style={styles.actionBtnText}>{t('profile.copyLink')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleShare}
                activeOpacity={0.7}
              >
                <Share2 size={20} color={'#111827'} />
                <Text style={styles.actionBtnText}>{t('profile.share')}</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      </QrModalStinger>
    </Modal>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 24,
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    // Clip the gradient to the rounded corners (Android needs the
    // explicit overflow; iOS honours borderRadius natively).
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    padding: 4,
    zIndex: 1,
  },
  // The shared QrNameCard now owns the name/@handle/tags/QR
  // composition (was: title+subtitle on the gradient + a bare
  // QR box). This wrapper just spaces it within the gradient
  // and keeps it clear of the close button.
  cardWrap: {
    marginTop: 14,
    marginBottom: 22,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  // White pill actions — identical treatment to the present
  // card's bottom buttons. A purple button would vanish on the
  // purple gradient; white reads cleanly.
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 15,
    gap: 8,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  });
}
