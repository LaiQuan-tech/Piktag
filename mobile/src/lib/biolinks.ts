import { Alert, Linking } from 'react-native';
import { setStringAsync } from 'expo-clipboard';
import type { TFunction } from 'i18next';
import { isIdModePlatform, isSafeBiolinkUrl, stripPlatformPrefix, getPlatformLabel } from './platforms';

/**
 * Turn a STORED biolink url into the value a human reads off the screen.
 *
 * Why this exists (founder, on a device with no signal, build 1098):
 * 「其他連結都只是有按鈕，但沒有內容」. Every biolink surface used to
 * render a platform NAME and hand the url to another app on tap. That is
 * fine online — the browser/dialer is the content. Offline it is a shell:
 * the phone number is sitting on disk in the snapshot, the row is on
 * screen, and there is no way to read it. A button you cannot get an
 * answer out of is worse than no button, because it costs a tap at the
 * exact moment someone is standing in front of you.
 *
 * Pure and network-free by construction — it only ever looks at the
 * string that is already cached, so it works identically offline.
 *
 * Returns '' when there is nothing readable behind the row; callers use
 * that as "do not render an inert button for this".
 */
export function biolinkDisplayValue(platform: string, rawUrl: string): string {
  const url = (rawUrl ?? '').trim();
  if (!url) return '';
  // idMode (WeChat): the stored string IS the handle, not a url.
  if (isIdModePlatform(platform)) return url;

  const schemeMatch = url.match(/^([a-z][a-z0-9+.-]*):/i);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';

  // Contact schemes: the value after the colon is the whole point — the
  // number you would read aloud, the address you would type by hand.
  // Query suffixes (`?body=`, `?subject=`) are transport, not content.
  if (scheme === 'tel' || scheme === 'sms' || scheme === 'mailto') {
    const body = url.slice(scheme.length + 1).split('?')[0].trim();
    return safeDecode(body);
  }

  // Branded platforms: strip the catalog prefix back to the bare handle
  // (`https://instagram.com/johnsmith` → `johnsmith`). Same helper the
  // edit form uses to repopulate its input, so the two can never drift.
  const bare = stripPlatformPrefix(url, platform);
  if (bare && bare !== url) return trimSlashes(safeDecode(bare));

  // Paste-mode / custom / legacy rows: show the url minus its scheme.
  // `https://` is noise on a card; `pikt.ag/armand` is the content.
  return trimSlashes(url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')) || url;
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function trimSlashes(v: string): string {
  return v.replace(/\/+$/, '');
}

/**
 * Make a `tel:` / `sms:` url something a dialer will actually accept.
 *
 * This is the confirmed silent-no-op. `buildTelUrl` has emitted clean
 * E.164 since 3b9a6fc6 (2026-04-24), but nothing normalises PHONE input
 * on the generic path — normalizeBiolinkInput has no `phone` case, so a
 * row saved before that commit (or by any other writer) can be literally
 * `tel:0916 581 787`. iOS refuses to build an NSURL from a string with
 * raw spaces, `openURL` rejects, and the old `.catch(() => {})` ate the
 * rejection: the tap did nothing at all, forever, with no feedback.
 *
 * Keeps digits, a leading `+`, and the DTMF characters a dialer
 * understands (`*` `#` `,` `;`). Falls back to the original string if
 * stripping leaves nothing, so the reveal path below still has something
 * to show.
 */
export function buildDialUrl(raw: string, scheme: 'tel' | 'sms' = 'tel'): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const m = v.match(/^(tel|sms):(.*)$/i);
  if (!m) {
    // Any OTHER scheme is not a dial string. Pass it through untouched —
    // an https url must never be run through the digit filter.
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
    const bare = safeDecode(v).replace(/[^\d+*#,;]/g, '');
    return bare ? `${scheme}:${bare}` : v;
  }
  const body = safeDecode(m[2]).replace(/[^\d+*#,;]/g, '');
  if (!body) return v;
  return `${m[1].toLowerCase()}:${body}`;
}

/**
 * Show a value and offer to copy it. The offline answer to 「讀給我聽」
 * at a venue: no network, no app switch, no browser tab that cannot
 * load. Used as the long-press affordance everywhere a contact value is
 * rendered, and as the FALLBACK whenever handing the value to another
 * app fails.
 */
export function revealContactValue(title: string, value: string, t: TFunction): void {
  const v = (value ?? '').trim();
  if (!v) return;
  Alert.alert(title, v, [
    { text: t('common.close'), style: 'cancel' },
    {
      text: t('common.copy'),
      onPress: () => {
        void setStringAsync(v)
          .then(() => {
            Alert.alert(t('common.copied'), v);
          })
          .catch(() => {});
      },
    },
  ]);
}

/** revealContactValue, titled with the biolink's own platform label. */
export function revealBiolinkValue(
  link: { platform: string; url: string },
  t: TFunction,
): void {
  revealContactValue(
    getPlatformLabel(link.platform, t),
    biolinkDisplayValue(link.platform, link.url),
    t,
  );
}

/**
 * Single entry point for "user tapped a biolink". Three outcomes, and
 * NONE of them is silence:
 *
 *   - idMode platforms (WeChat): the stored `url` is a bare copy-only
 *     ID (`armand7951`), NOT an openable URL. Copy it to the clipboard
 *     and toast, never Linking.openURL — a scheme-less ID would silently
 *     fail on iOS and produce the dead `https://armand7951` link this
 *     mode exists to kill.
 *   - a url outside the isSafeBiolinkUrl allowlist: still never handed
 *     to Linking.openURL (that gate is a security boundary, not a
 *     convenience), but no longer a dead tap either — reveal the value
 *     so it can be read and copied.
 *   - everything else: normalise dial strings, then open. If the open
 *     REJECTS — malformed legacy row, no handler app, a scheme this
 *     device cannot service — fall back to revealing the value instead
 *     of swallowing the failure.
 *
 * Nothing here touches the network, so the whole path works offline.
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
  // Scheme allowlist gate — fail-closed for old/bad rows whose scheme is
  // outside the allowlist (`javascript:` / `intent:` etc.). We refuse to
  // OPEN them; we do not refuse to tell the user what they say.
  if (!isSafeBiolinkUrl(link.url)) {
    revealBiolinkValue(link, t);
    return;
  }
  const target = buildDialUrl(link.url);
  try {
    await Linking.openURL(target);
  } catch {
    revealBiolinkValue(link, t);
  }
}
