// scanCard.ts
//
// Business-card scan orchestrator with an on-device-OCR FAST PATH and
// a multimodal-image FALLBACK. 2026-06-03 "Path A" (founder: card scan
// ~10s, too slow).
//
// Why: sending the whole photo to a multimodal model means paying for
// image-token prefill, which dominates the ~10s. A business card is
// just printed text, so we don't need the model to "see" the image —
// we run on-device OCR (Apple Vision / ML Kit, ~0.5s, no network, no
// API cost), then send only the recognised TEXT to a text-only Gemini
// structuring call (far faster than multimodal).
//
// SAFETY (this is a new native dependency shipped pre-launch): OCR is
// a pure OPTIMISATION layered on top of the proven multimodal path.
// tryOcr() can NEVER throw — if the native module isn't linked (Expo
// Go, a build that didn't bundle it), the model is unavailable, or
// anything else fails, it returns null and scanCard() falls straight
// through to the existing `{ image }` multimodal call. So worst case
// the scan is exactly as it was before Path A; best case it's much
// faster. The fast path also escalates to multimodal when OCR text is
// too thin or the text-structuring yields no usable field — a weak
// OCR never produces a worse result than the image path would have.
//
// 2026-06-03 speed pass: input is now URI-only — base64 is LAZILY
// encoded inside scanCard ONLY when the multimodal fallback fires
// (~5% of scans). Removed a 400-800ms-on-iOS base64 encode from the
// JS thread on the happy path. The re-encode inside loadBase64 is
// wasteful, but it only ever runs on the rare fallback path where
// we're about to pay multimodal latency anyway.
//
// Drop-in: returns the SAME `{ data, error }` shape that
// supabase.functions.invoke('scan-business-card', …) returns, so the
// callers' existing `(data as any)?.data` extraction is unchanged.

import TextRecognition, {
  TextRecognitionScript,
} from '@react-native-ml-kit/text-recognition';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from './supabase';

// Below this many recognised chars we treat OCR as "failed" and let
// the multimodal path try — a near-blank result usually means a poor
// capture the image model might still salvage. A real card (name +
// phone at minimum) clears this easily.
const MIN_OCR_CHARS = 10;

// Kill switch. Flip to false to force every scan down the proven
// multimodal-image path and bypass on-device OCR entirely — a clean,
// one-line revert if the OCR fast path ever misbehaves in prod
// (wrong text structuring into a plausible-but-wrong card, a bad
// model/runtime on some device). Leaves all the wiring intact.
const OCR_ENABLED = true;

export type ScanCardInput = {
  /** Local file URI of the captured frame. Required — both the OCR
   *  fast path (ML Kit reads from a file path) and the lazy base64
   *  encode for the multimodal fallback consume it. */
  uri: string;
  mimeType: string;
  /** 2026-07-04 speed pass: fires the moment on-device OCR text is in
   *  hand (BEFORE the network structuring call) with regex-extracted
   *  phone/email/website, so the caller can paint those fields
   *  instantly. Gemini's structured result arrives 1-2s later and is
   *  allowed to overwrite these quick values (caller's contract).
   *  Only fires on the OCR fast path; the multimodal fallback has no
   *  early text to mine. Never throws into the scan flow. */
  onQuickFields?: (quick: QuickFields) => void;
};

export type QuickFields = { phone?: string; mobile?: string; email?: string; website?: string };

/**
 * Regex-mine the unambiguous contact fields out of raw OCR text.
 * Deliberately conservative: first plausible match per field, dates
 * rejected as phone candidates. Gemini remains the authority — these
 * exist so SOMETHING useful is on screen ~1-2s before it answers.
 */
export function extractQuickFields(text: string): QuickFields {
  const out: QuickFields = {};
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const emailMatch = text.match(EMAIL_RE);
  if (emailMatch) out.email = emailMatch[0];

  // Strip emails first so their domains can't masquerade as websites.
  const withoutEmails = text.replace(new RegExp(EMAIL_RE.source, 'g'), ' ');
  const site =
    withoutEmails.match(/https?:\/\/[^\s]+|www\.[A-Za-z0-9-]+(?:\.[A-Za-z]{2,})+[^\s]*/i) ||
    withoutEmails.match(
      /\b[A-Za-z0-9-]{2,}(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|io|co|ai|app|dev|me|tw|jp|kr|cn|hk|sg|de|fr|uk|us|ca|au|info|biz|tech|xyz|store|shop)\b(?:\/[^\s]*)?/i,
    );
  if (site) out.website = site[0].replace(/[),.;:]+$/, '');

  // Phone: first digit-run with 8-15 digits; date-shaped strings
  // ("2026.06.03" would otherwise pass the 8-digit bar) are rejected.
  const candidates = withoutEmails.match(/\+?\d[\d\s().\-]{6,}\d/g) ?? [];
  const isTaiwanMobile = (d: string) => /^09\d{8}$/.test(d) || /^8869\d{8}$/.test(d);
  for (const c of candidates) {
    const trimmed = c.trim();
    if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(trimmed)) continue;
    const digits = trimmed.replace(/\D/g, '');
    // Skip a clearly-mobile number here so it lands in the `mobile`
    // field ONLY (below), not duplicated into `phone`. A lone mobile is
    // the common case on TW personal cards. Falls through to phone if no
    // non-mobile number exists — Gemini reconciles the ambiguous tail.
    if (isTaiwanMobile(digits)) continue;
    if (digits.length >= 8 && digits.length <= 15) {
      out.phone = trimmed;
      break;
    }
  }

  // Mobile (2026-07-12, additive — never touches the `phone` loop
  // above): separately recognise a Taiwan mobile among the SAME
  // digit-run candidates by its distinctive shape (local 09-prefix,
  // 10 digits, or international +886 9…). Independent loop so a card
  // with both a landline and a mobile surfaces both quick fields
  // instead of the mobile losing to whichever number OCR listed
  // first. If the only number on the card happens to look like a
  // mobile, it lands in BOTH `phone` and `mobile` here — harmless
  // duplication for the ~1-2s until Gemini's authoritative result
  // (which puts a lone, ambiguous number in `phone` only) arrives and
  // overwrites per the caller's contract.
  for (const c of candidates) {
    const trimmed = c.trim();
    if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(trimmed)) continue;
    const digits = trimmed.replace(/\D/g, '');
    if (isTaiwanMobile(digits)) {
      out.mobile = trimmed;
      break;
    }
  }
  return out;
}

// ── Pipeline overlap: capture-time scan jobs (speed lever #3) ───────
// The old sequence was strictly serial: capture → crop → navigate →
// EditLocalContact mounts → OCR starts. The capture screen now calls
// startScanJob() the moment the final frame uri exists, so OCR (and
// usually the structuring round-trip too) runs DURING the navigation
// and mount. EditLocalContact claims the in-flight job by uri instead
// of starting a fresh scan — navigation time is now free.
//
// Single-slot by design: only one card capture can be in flight (the
// camera screens are modal). A job nobody claims (user backs out) is
// simply overwritten by the next capture. Quick fields emitted before
// the claimer subscribes are buffered on the job and replayed at claim.
type ScanJob = {
  uri: string;
  promise: Promise<ScanCardResult>;
  quick?: QuickFields;
  onQuick?: (q: QuickFields) => void;
};

let pendingJob: ScanJob | null = null;

export function startScanJob(input: { uri: string; mimeType: string }): void {
  const job = { uri: input.uri } as ScanJob;
  job.promise = scanCard({
    uri: input.uri,
    mimeType: input.mimeType,
    onQuickFields: (q) => {
      job.quick = q;
      job.onQuick?.(q);
    },
  });
  // Pre-claim rejection guard — the claimer attaches its own handlers.
  job.promise.catch(() => {});
  pendingJob = job;
}

/** Claim the in-flight job for this uri (null = none; caller starts a
 *  fresh scan). Buffered quick fields replay synchronously on claim. */
export function claimScanJob(
  uri: string,
  onQuick?: (q: QuickFields) => void,
): Promise<ScanCardResult> | null {
  const job = pendingJob;
  if (!job || job.uri !== uri) return null;
  pendingJob = null;
  if (onQuick) {
    if (job.quick) {
      try {
        onQuick(job.quick);
      } catch {
        /* quick fields are best-effort */
      }
    } else {
      job.onQuick = onQuick;
    }
  }
  return job.promise;
}

// ── Edge-fn prewarm (2026-07-04 speed pass) ─────────────────────────
// scan-business-card answers `{ warmup: true }` immediately, above its
// JWT guard (the pg_cron pinger uses the same door). Firing one ping
// when the card camera OPENS means the Deno isolate is hot by the time
// the user has framed the card — the cron keeps it warm in general,
// but this closes the gap between cron ticks. Throttled so repeated
// camera opens don't spam; fire-and-forget, never blocks anything.
let lastWarmAt = 0;
export function prewarmScanBusinessCard(): void {
  const now = Date.now();
  if (now - lastWarmAt < 60_000) return;
  lastWarmAt = now;
  void supabase.functions
    .invoke('scan-business-card', { body: { warmup: true } })
    .catch(() => {});
}

export type ScanCardResult = {
  /** Mirrors supabase.functions.invoke's `data` — the edge fn body
   *  `{ data: CardData }`. Callers read `(data as any)?.data`. */
  data: any;
  error: any;
  /** Which path produced the result — telemetry / debugging only. */
  source: 'ocr' | 'image' | null;
};

/**
 * Recognise with a single ML Kit script, rebuilt in top→bottom /
 * left→right reading order from block bounding boxes. Returns '' on
 * any failure (never throws).
 */
async function recognizeOrdered(
  uri: string,
  script: TextRecognitionScript,
): Promise<string> {
  try {
    const result = await TextRecognition.recognize(uri, script);
    if (!result) return '';
    const blocks = Array.isArray(result.blocks) ? result.blocks : [];
    if (blocks.length > 0) {
      return blocks
        .filter((b) => b && typeof b.text === 'string' && b.text.trim())
        .slice()
        .sort((a, b) => {
          const at = a.frame?.top ?? 0;
          const bt = b.frame?.top ?? 0;
          if (Math.abs(at - bt) > 8) return at - bt;
          return (a.frame?.left ?? 0) - (b.frame?.left ?? 0);
        })
        .map((b) => b.text.trim())
        .join('\n');
    }
    return (result.text ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * On-device OCR. NEVER throws — returns the recognised text in
 * top→bottom / left→right reading order, or null on any failure.
 *
 * 2026-07-13 accuracy fix (founder: "email/website 讀錯了"): runs TWO
 * passes and merges. ML Kit's CHINESE recogniser reads Traditional
 * Chinese well but is MEASURABLY worse on embedded Latin (the l↔i,
 * m↔rn, 0↔O confusions that turned "algoltek" → "aigoltek" and
 * mangled the URL). The LATIN recogniser is far more accurate on
 * exactly the fields where one wrong char = broken (email / website /
 * phone). We put the LATIN read FIRST so the caller's quick-regex
 * miner (extractQuickFields, "first plausible match" per field) prefers
 * the accurate Latin version, then append the CHINESE read for the
 * name / title / company. Both are labeled so Gemini's structuring
 * understands they're two OCR views of the SAME card and can cross-
 * reference. Two on-device passes ≈ 1s — still far below the
 * multimodal-image path, so the speed win of Path A is preserved.
 */
async function tryOcr(uri: string): Promise<string | null> {
  const [latin, chinese] = await Promise.all([
    recognizeOrdered(uri, TextRecognitionScript.LATIN),
    recognizeOrdered(uri, TextRecognitionScript.CHINESE),
  ]);

  // Quality gate on ACTUAL OCR content, not the combined string — the
  // pass labels alone are ~55 chars, so measuring the combined text
  // would let a 2-char garbage read sail past MIN_OCR_CHARS and waste
  // a Gemini call that was always going to fail. Thin content → null →
  // caller escalates straight to the multimodal image path.
  const latinText = latin.trim();
  const chineseText = chinese.trim();
  if (latinText.length + chineseText.length < MIN_OCR_CHARS) return null;

  const parts: string[] = [];
  if (latinText) {
    parts.push('--- OCR pass A (Latin — trust for email/website/phone) ---');
    parts.push(latinText);
  }
  if (chineseText) {
    parts.push('--- OCR pass B (Chinese — trust for name/title/company) ---');
    parts.push(chineseText);
  }
  return parts.join('\n');
}

/**
 * Lazy base64 encode for the multimodal fallback path. Re-encodes
 * the file via ImageManipulator (no expo-file-system dependency
 * needed — we reuse a library that's already installed). Returns
 * null on any failure so the outer scanCard surfaces a clean
 * "scan failed" rather than a half-formed invoke.
 *
 * Wasteful on paper (decode-then-encode the JPEG we already wrote)
 * but only ever runs on the ~5% fallback path where we're about to
 * pay multimodal-vision latency anyway — the encode cost is in the
 * noise relative to the model call.
 */
async function loadBase64(uri: string): Promise<string | null> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    const ref = await ctx.renderAsync();
    // compress 1.0 → no further quality loss; the file is already
    // compressed at 0.4 from CardCameraScreen's saveAsync. JPEG to
    // match the source mime.
    const out = await ref.saveAsync({
      base64: true,
      compress: 1.0,
      format: SaveFormat.JPEG,
    });
    return out.base64 ?? null;
  } catch {
    return null;
  }
}

function hasUsableField(invokeData: any): boolean {
  const card = invokeData?.data ?? null;
  return (
    !!card &&
    Object.values(card).some((v) => typeof v === 'string' && v.trim())
  );
}

export async function scanCard(input: ScanCardInput): Promise<ScanCardResult> {
  const { uri, mimeType } = input;

  // ── Fast path: on-device OCR → text-only structuring ──
  if (OCR_ENABLED) {
    const text = await tryOcr(uri);
    if (text && text.length >= MIN_OCR_CHARS) {
      // Instant fields: hand the caller regex-mined phone/email/website
      // NOW, before paying network latency. Guarded so a callback bug
      // can never break the scan itself.
      if (input.onQuickFields) {
        try {
          const quick = extractQuickFields(text);
          if (quick.phone || quick.email || quick.website) {
            input.onQuickFields(quick);
          }
        } catch {
          /* quick fields are best-effort */
        }
      }
      try {
        const { data, error } = await supabase.functions.invoke(
          'scan-business-card',
          { body: { text } },
        );
        if (!error && hasUsableField(data)) {
          return { data, error: null, source: 'ocr' };
        }
        // Rate-limited (shared Gemini key out of quota): do NOT
        // escalate to multimodal — that's two MORE calls guaranteed
        // to 429, which burns quota and delays recovery. Surface the
        // note to the caller so the UI can say "AI busy" instead of
        // blaming the photo. (2026-07-13, free-tier 429 storm.)
        if (!error && (data as any)?.note === 'rate_limited') {
          return { data, error: null, source: null };
        }
        // Structuring errored or yielded nothing usable → escalate to
        // the multimodal image path below (a poor OCR shouldn't be the
        // final answer when the image model might do better).
      } catch {
        // fall through to multimodal
      }
    }
  }

  // ── Fallback: multimodal image (the pre-Path-A behaviour) ──
  // Lazy-encode base64 ONLY now, when the fallback is actually
  // firing. Saves the encode cost on the happy path.
  const base64 = await loadBase64(uri);
  if (!base64) {
    return {
      data: null,
      error: { message: 'failed_to_read_image' },
      source: null,
    };
  }
  const { data, error } = await supabase.functions.invoke(
    'scan-business-card',
    { body: { image: base64, mimeType } },
  );
  return { data, error, source: error ? null : 'image' };
}
