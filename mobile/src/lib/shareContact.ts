/**
 * Card-scan invite flow — deep-link builders + opener.
 *
 * After a user scans someone's business card and saves them as a
 * local contact, we offer "send my contact" → opens the user's
 * email/SMS/WhatsApp client pre-filled with a friendly note that
 * INCLUDES the user's own pikt.ag URL. Recipient clicks → lands on
 * their PikTag profile → landing page's download banner takes over
 * the conversion.
 *
 * Why deep links (mailto: / sms: / wa.me) instead of server-side:
 *   - Message comes from the user's actual address — recipient sees
 *     "Armand sent me this" not "noreply@piktag bombed my inbox"
 *   - Zero server infrastructure (no SES/SendGrid, no IP reputation
 *     work, no SPF/DKIM setup)
 *   - Zero CAN-SPAM / GDPR liability — it's a person sending a
 *     person, exactly like exchanging cards in real life
 *
 * NA-first market (founder, 2026-05-29):
 *   - LINE dropped (Asia-only)
 *   - WhatsApp derived from phone (no schema column needed)
 *   - Email / SMS / WhatsApp are the three channels shown,
 *     conditionally available based on what the OCR extracted.
 */
import { Linking, Platform } from 'react-native';

export type ShareChannel = 'email' | 'sms' | 'whatsapp';

export type ShareContactInput = {
  // From the scanned card. All optional — we render channels
  // conditionally based on which fields are populated.
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  recipientName?: string | null;
  // The viewer's own PikTag identity. Username drives the share URL.
  myFirstName: string;
  myUsername: string;
  // Optional event/company context from the AddTag flow earlier in
  // the session. When present, used to disambiguate the subject:
  //   "Armand from ACME conference 2026 — my contact"
  // Falls back to a plain subject when absent.
  eventOrCompanyHint?: string | null;
  // i18n callable. Pre-curried by the screen so we don't have to
  // pass the whole t() type around.
  tBody: (key: string, opts?: Record<string, unknown>) => string;
};

/**
 * Available channels = "we have the field on the card." Returned in
 * presentation order — email first because it's the most reliable
 * NA channel and gets the longest pre-filled message.
 */
export function availableChannels(input: ShareContactInput): ShareChannel[] {
  const out: ShareChannel[] = [];
  if (input.recipientEmail) out.push('email');
  if (input.recipientPhone) out.push('sms');
  if (input.recipientPhone) out.push('whatsapp');
  return out;
}

/** Strip everything except + and digits — E.164 for wa.me. */
function normalizePhoneE164(raw: string): string {
  return raw.replace(/[^\d+]/g, '');
}

/** First name only — for friendlier greetings. */
function firstNameOf(full: string | null | undefined): string {
  if (!full) return '';
  const trimmed = full.trim();
  if (!trimmed) return '';
  // Split on whitespace OR CJK boundary heuristic. For CJK names
  // where surname is first, the FIRST token IS the surname — but
  // most NA business cards print "First Last", which is what we
  // optimize for here. CJK fallback: just use the whole name.
  if (/[一-鿿]/.test(trimmed)) return trimmed;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/** Build the shared URL with a referral tag for analytics. */
function buildShareUrl(username: string): string {
  return `https://pikt.ag/${username}?ref=card_invite`;
}

/**
 * Returns a deep-link URL ready for Linking.openURL().
 * Subject + body interpolation happens via the supplied tBody so
 * the user's selected locale wins.
 */
export function buildChannelUrl(
  channel: ShareChannel,
  input: ShareContactInput,
): string | null {
  const url = buildShareUrl(input.myUsername);
  const theirFirst = firstNameOf(input.recipientName);
  const hint = input.eventOrCompanyHint?.trim() || '';

  if (channel === 'email') {
    if (!input.recipientEmail) return null;
    const subjectKey = hint
      ? 'localContact.shareEmailSubjectWithHint'
      : 'localContact.shareEmailSubject';
    const subject = input.tBody(subjectKey, {
      firstName: input.myFirstName,
      hint,
      defaultValue: hint
        ? '{{firstName}} from {{hint}} — my contact'
        : '{{firstName}} — my contact',
    });
    const body = input.tBody('localContact.shareEmailBody', {
      theirFirst,
      url,
      firstName: input.myFirstName,
      defaultValue:
        'Hey {{theirFirst}},\n\nGreat meeting you. Here\'s my contact:\n{{url}}\n\n— {{firstName}}',
    });
    const qs = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return `mailto:${encodeURIComponent(input.recipientEmail)}?${qs}`;
  }

  if (channel === 'sms') {
    if (!input.recipientPhone) return null;
    const phone = normalizePhoneE164(input.recipientPhone);
    const body = input.tBody('localContact.shareSmsBody', {
      theirFirst,
      url,
      firstName: input.myFirstName,
      defaultValue:
        'Hey {{theirFirst}}, great meeting you. My contact: {{url}} — {{firstName}}',
    });
    // iOS uses `&` for body, Android uses `?`. The native Messages
    // app on both platforms accepts the query-style separator
    // consistently as of recent OS versions; keep `?` for cross-
    // platform reliability.
    const separator = Platform.OS === 'ios' ? '&' : '?';
    return `sms:${phone}${separator}body=${encodeURIComponent(body)}`;
  }

  if (channel === 'whatsapp') {
    if (!input.recipientPhone) return null;
    const phone = normalizePhoneE164(input.recipientPhone).replace(/^\+/, '');
    const body = input.tBody('localContact.shareWhatsappBody', {
      theirFirst,
      url,
      firstName: input.myFirstName,
      defaultValue:
        'Hey {{theirFirst}}, great meeting you. My contact: {{url}} — {{firstName}}',
    });
    return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
  }

  return null;
}

/**
 * Open the chosen channel. Returns true on success, false on
 * canOpenURL == false (channel app not installed) or any throw.
 * Caller decides what to do on false (e.g. fall back to another
 * channel or just notify the user).
 */
export async function openChannel(
  channel: ShareChannel,
  input: ShareContactInput,
): Promise<boolean> {
  try {
    const url = buildChannelUrl(channel, input);
    if (!url) return false;
    const can = await Linking.canOpenURL(url);
    if (!can) return false;
    await Linking.openURL(url);
    return true;
  } catch (err) {
    console.warn('[shareContact] openChannel failed:', err);
    return false;
  }
}
