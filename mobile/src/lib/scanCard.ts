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
};

export type ScanCardResult = {
  /** Mirrors supabase.functions.invoke's `data` — the edge fn body
   *  `{ data: CardData }`. Callers read `(data as any)?.data`. */
  data: any;
  error: any;
  /** Which path produced the result — telemetry / debugging only. */
  source: 'ocr' | 'image' | null;
};

/**
 * On-device OCR. NEVER throws — returns the recognised text in
 * top→bottom / left→right reading order, or null on any failure.
 */
async function tryOcr(uri: string): Promise<string | null> {
  try {
    // CHINESE script: ML Kit's Chinese recogniser reads Traditional
    // Chinese AND embedded Latin / digits / email / URL, so it's the
    // right single choice for a Taiwan-first card (mixed zh + en is
    // the norm). The unlinked-module path throws synchronously here
    // (the library proxies NativeModules) — caught below.
    const result = await TextRecognition.recognize(
      uri,
      TextRecognitionScript.CHINESE,
    );
    if (!result) return null;

    const blocks = Array.isArray(result.blocks) ? result.blocks : [];
    let text: string;
    if (blocks.length > 0) {
      // Rebuild in reading order from block bounding boxes so the
      // model gets the card top-to-bottom regardless of ML Kit's
      // internal detection order. ~8px row tolerance groups items on
      // the same visual line before ordering left→right. This is the
      // cheap version of the "preserve layout" mitigation — it keeps
      // the dominant vertical signal (name on top, contact below).
      text = blocks
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
    } else {
      text = (result.text ?? '').trim();
    }
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    // Native module missing / model unavailable / any runtime error.
    // Swallow → caller falls back to the multimodal image path.
    return null;
  }
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
      try {
        const { data, error } = await supabase.functions.invoke(
          'scan-business-card',
          { body: { text } },
        );
        if (!error && hasUsableField(data)) {
          return { data, error: null, source: 'ocr' };
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
