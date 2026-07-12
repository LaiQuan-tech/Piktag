import { Alert, Linking } from 'react-native';
import { setStringAsync } from 'expo-clipboard';
import type { TFunction } from 'i18next';
import { isIdModePlatform, isSafeBiolinkUrl } from './platforms';

/**
 * Single entry point for "user tapped a biolink". Two behaviours,
 * decided by the platform's `idMode` flag (see platforms.ts):
 *
 *   - idMode platforms (WeChat): the stored `url` is a bare copy-only
 *     ID (`armand7951`), NOT an openable URL. Copy it to the clipboard
 *     and toast, never Linking.openURL — a scheme-less ID would silently
 *     fail on iOS and produce the dead `https://armand7951` link this
 *     mode exists to kill.
 *   - everything else: gate on the isSafeBiolinkUrl allowlist
 *     (fail-closed, silent no-op for hostile/malformed schemes) and open.
 *
 * Centralising this here is why all five biolink tap sites
 * (FriendDetail / UserDetail / Profile / ScanResult / EditProfile) call
 * one function — the copy-vs-open branch can't drift per screen.
 */
export async function openOrCopyBiolink(
  link: { platform: string; url: string; id?: string },
  t: TFunction,
): Promise<void> {
  if (isIdModePlatform(link.platform)) {
    await setStringAsync(link.url);
    Alert.alert(
      t('editProfile.idCopiedTitle', { defaultValue: '已複製' }),
      t('editProfile.idCopiedMessage', { defaultValue: '已複製到剪貼簿' }),
    );
    return;
  }
  // Scheme allowlist gate — silent no-op for old/bad rows whose scheme
  // is outside the allowlist (`javascript:` / `intent:` etc.).
  if (!isSafeBiolinkUrl(link.url)) return;
  Linking.openURL(link.url).catch(() => {});
}
