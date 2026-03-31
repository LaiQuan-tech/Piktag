import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ImagePlus, Zap, Share2, RotateCcw } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { COLORS } from '../constants/theme';

type UpscaleImageScreenProps = {
  navigation: any;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_PREVIEW_SIZE = SCREEN_WIDTH - 48;

type UpscaleState = 'idle' | 'loading' | 'done' | 'error';

export default function UpscaleImageScreen({ navigation }: UpscaleImageScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [originalUri, setOriginalUri] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [state, setState] = useState<UpscaleState>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [scale, setScale] = useState<2 | 4>(4);

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        t('upscaleImage.permissionTitle'),
        t('upscaleImage.permissionMessage'),
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert(t('common.error'), t('upscaleImage.base64Error'));
      return;
    }

    setOriginalUri(asset.uri);
    setOutputUrl(null);
    setState('idle');
    setErrorMsg('');

    const mimeType = asset.mimeType ?? 'image/jpeg';
    const imageBase64 = `data:${mimeType};base64,${asset.base64}`;
    await runUpscale(imageBase64);
  }, [scale, t]);

  const runUpscale = useCallback(async (imageBase64: string) => {
    setState('loading');
    setErrorMsg('');

    try {
      const { data, error } = await supabase.functions.invoke('upscale-image', {
        body: { imageBase64, scale },
      });

      if (error) {
        throw new Error(error.message ?? t('upscaleImage.genericError'));
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (!data?.outputUrl) {
        throw new Error(t('upscaleImage.noOutputError'));
      }

      setOutputUrl(data.outputUrl);
      setState('done');
    } catch (err: any) {
      setErrorMsg(err.message ?? t('upscaleImage.genericError'));
      setState('error');
    }
  }, [scale, t]);

  const handleShare = useCallback(async () => {
    if (!outputUrl) return;
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(outputUrl);
    } else {
      await Clipboard.setStringAsync(outputUrl);
      Alert.alert(t('upscaleImage.copiedTitle'), t('upscaleImage.copiedMessage'));
    }
  }, [outputUrl, t]);

  const handleReset = useCallback(() => {
    setOriginalUri(null);
    setOutputUrl(null);
    setState('idle');
    setErrorMsg('');
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Settings')}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={COLORS.gray800} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('upscaleImage.title')}</Text>
        {outputUrl ? (
          <TouchableOpacity style={styles.resetButton} onPress={handleReset} activeOpacity={0.7}>
            <RotateCcw size={20} color={COLORS.gray500} />
          </TouchableOpacity>
        ) : (
          <View style={styles.resetButton} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Scale selector */}
        {!originalUri && (
          <View style={styles.scaleRow}>
            <Text style={styles.scaleLabel}>{t('upscaleImage.scaleLabel')}</Text>
            <View style={styles.scaleButtons}>
              {([2, 4] as (2 | 4)[]).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.scaleBtn, scale === s && styles.scaleBtnActive]}
                  onPress={() => setScale(s)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.scaleBtnText, scale === s && styles.scaleBtnTextActive]}>
                    {s}×
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Pick image button */}
        {!originalUri && (
          <TouchableOpacity style={styles.pickArea} onPress={pickImage} activeOpacity={0.8}>
            <ImagePlus size={40} color={COLORS.piktag500} />
            <Text style={styles.pickTitle}>{t('upscaleImage.pickTitle')}</Text>
            <Text style={styles.pickSubtitle}>{t('upscaleImage.pickSubtitle')}</Text>
          </TouchableOpacity>
        )}

        {/* Before image */}
        {originalUri && (
          <View style={styles.imageSection}>
            <Text style={styles.imageLabel}>{t('upscaleImage.original')}</Text>
            <Image
              source={{ uri: originalUri }}
              style={styles.imagePreview}
              resizeMode="contain"
            />
          </View>
        )}

        {/* Loading state */}
        {state === 'loading' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.piktag500} />
            <Text style={styles.loadingText}>{t('upscaleImage.processing')}</Text>
            <Text style={styles.loadingSubtext}>{t('upscaleImage.processingNote')}</Text>
          </View>
        )}

        {/* Error state */}
        {state === 'error' && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{t('upscaleImage.errorTitle')}</Text>
            <Text style={styles.errorDetail}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleReset} activeOpacity={0.8}>
              <Text style={styles.retryButtonText}>{t('upscaleImage.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Output image */}
        {state === 'done' && outputUrl && (
          <View style={styles.imageSection}>
            <View style={styles.outputLabelRow}>
              <Zap size={16} color={COLORS.piktag500} />
              <Text style={styles.imageLabel}>{t('upscaleImage.upscaled', { scale })}</Text>
            </View>
            <Image
              source={{ uri: outputUrl }}
              style={styles.imagePreview}
              resizeMode="contain"
            />

            <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.8}>
              <Share2 size={18} color={COLORS.gray900} />
              <Text style={styles.shareButtonText}>{t('upscaleImage.share')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickAgainButton} onPress={handleReset} activeOpacity={0.8}>
              <Text style={styles.pickAgainText}>{t('upscaleImage.pickAnother')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  resetButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 24,
    alignItems: 'center',
    gap: 24,
  },
  scaleRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.gray50,
    borderRadius: 12,
    padding: 16,
  },
  scaleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  scaleButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  scaleBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
  },
  scaleBtnActive: {
    borderColor: COLORS.piktag500,
    backgroundColor: COLORS.piktag50,
  },
  scaleBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray500,
  },
  scaleBtnTextActive: {
    color: COLORS.piktag600,
  },
  pickArea: {
    width: IMAGE_PREVIEW_SIZE,
    height: IMAGE_PREVIEW_SIZE * 0.7,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.gray200,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: COLORS.gray50,
  },
  pickTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray800,
  },
  pickSubtitle: {
    fontSize: 13,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  imageSection: {
    width: '100%',
    gap: 12,
    alignItems: 'center',
  },
  imageLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  outputLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  imagePreview: {
    width: IMAGE_PREVIEW_SIZE,
    height: IMAGE_PREVIEW_SIZE,
    borderRadius: 12,
    backgroundColor: COLORS.gray100,
  },
  loadingContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray800,
  },
  loadingSubtext: {
    fontSize: 13,
    color: COLORS.gray400,
    textAlign: 'center',
  },
  errorContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.red500,
  },
  errorDetail: {
    fontSize: 13,
    color: COLORS.gray500,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.gray100,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray800,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.piktag500,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
    justifyContent: 'center',
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  pickAgainButton: {
    paddingVertical: 12,
  },
  pickAgainText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
  },
});
