import React, { useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Share,
  Platform,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { X, Copy, Share2 } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../constants/theme';

type QrCodeModalProps = {
  visible: boolean;
  onClose: () => void;
  username: string;
  fullName: string;
};

const APP_BASE_URL = 'https://go.pikt.ag';

export default function QrCodeModal({
  visible,
  onClose,
  username,
  fullName,
}: QrCodeModalProps) {
  const profileUrl = `${APP_BASE_URL}/u/${username}`;

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(profileUrl);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${fullName} (@${username}) on PikTag\n${profileUrl}`,
        url: Platform.OS === 'ios' ? profileUrl : undefined,
      });
    } catch (_err) {
      // User cancelled or share failed
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <X size={24} color={COLORS.gray600} />
          </TouchableOpacity>

          <Text style={styles.title}>{fullName}</Text>
          <Text style={styles.subtitle}>@{username}</Text>

          <View style={styles.qrWrapper}>
            <QRCode
              value={profileUrl}
              size={200}
              backgroundColor={COLORS.white}
              color={COLORS.gray900}
            />
          </View>

          <Text style={styles.urlText}>{profileUrl}</Text>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleCopyLink}
              activeOpacity={0.7}
            >
              <Copy size={20} color={COLORS.gray900} />
              <Text style={styles.actionBtnText}>{'複製連結'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.shareBtn]}
              onPress={handleShare}
              activeOpacity={0.7}
            >
              <Share2 size={20} color={COLORS.gray900} />
              <Text style={styles.actionBtnText}>{'分享'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  container: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    zIndex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.gray500,
    marginBottom: 24,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.piktag500,
    marginBottom: 16,
  },
  urlText: {
    fontSize: 13,
    color: COLORS.gray400,
    marginBottom: 24,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  shareBtn: {
    backgroundColor: COLORS.piktag500,
    borderColor: COLORS.piktag500,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
});
