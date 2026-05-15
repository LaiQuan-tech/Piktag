// Supabase Edge Function: scan-business-card
//
// Onboarding accelerator. The user photographs their physical
// business card; this extracts the structured fields needed to
// bootstrap a PikTag profile so they don't type them by hand.
//
// Why this exists: the cold-start onboarding was deliberately
// stripped to name+avatar to minimise friction (see
// OnboardingScreen.tsx header). bio + social links were dropped
// because TYPING them is the friction. A card photo is one tap,
// zero typing — it restores the "根本" (bio + links) without
// re-introducing the friction that got them cut.
//
// Mirrors suggest-tags' conventions: same GEMINI_API_KEY, same
// model fallback chain, same CORS, same defensive JSON parsing —
// but a VISION call (inline_data image part) instead of text-only.
// gemini-2.5-flash is multimodal, so the endpoint is identical.
//
// Returns EVERY field nullable. A business card is sparse and
// OCR is imperfect; the client shows an editable confirmation
// screen, so "best effort, null when unsure" beats hallucinating.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL_FALLBACK_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const;

// Roughly 6MB of base64 ≈ 4.5MB raw — generous for a card photo,
// guards against someone POSTing a huge payload.
const MAX_B64_LEN = 6 * 1024 * 1024;

type ScanBody = {
  image?: string; // base64, no data: prefix
  mimeType?: string; // image/jpeg | image/png | image/webp
  lang?: string; // bio_draft language hint, e.g. "繁體中文"
};

type CardData = {
  full_name: string | null;
  job_title: string | null;
  company: string | null;
  bio_draft: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  line: string | null;
};

const EMPTY: CardData = {
  full_name: null,
  job_title: null,
  company: null,
  bio_draft: null,
  phone: null,
  email: null,
  website: null,
  instagram: null,
  facebook: null,
  linkedin: null,
  line: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Same robustness posture as suggest-tags.extractStringArray: the
// model sometimes wraps JSON in ``` fences or prose. Pull the
// first {...} object out and coerce to the CardData shape.
function extractCardObject(text: string): CardData | null {
  if (!text) return null;
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();

  const obj = s.match(/\{[\s\S]*\}/);
  if (obj) s = obj[0];

  try {
    const parsed = JSON.parse(s);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const pick = (k: keyof CardData): string | null => {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v !== 'string') return null;
      const t = v.trim();
      // The model is told to use null; it sometimes emits the
      // literal strings instead. Treat those as null.
      if (!t || /^(null|none|n\/a|unknown|-)$/i.test(t)) return null;
      return t.slice(0, 300);
    };
    return {
      full_name: pick('full_name'),
      job_title: pick('job_title'),
      company: pick('company'),
      bio_draft: pick('bio_draft'),
      phone: pick('phone'),
      email: pick('email'),
      website: pick('website'),
      instagram: pick('instagram'),
      facebook: pick('facebook'),
      linkedin: pick('linkedin'),
      line: pick('line'),
    };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return jsonResponse(500, {
        error: 'GEMINI_API_KEY not configured on the Edge Function',
      });
    }

    let body: ScanBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Body must be valid JSON' });
    }

    const image = (body.image ?? '').trim();
    const mimeType = (body.mimeType ?? 'image/jpeg').trim();
    const lang = (body.lang ?? '繁體中文').trim().slice(0, 50);

    if (!image) {
      return jsonResponse(400, { error: 'Missing image (base64)' });
    }
    if (image.length > MAX_B64_LEN) {
      return jsonResponse(413, { error: 'Image too large' });
    }
    if (!/^image\/(jpe?g|png|webp)$/i.test(mimeType)) {
      return jsonResponse(400, { error: 'Unsupported mimeType' });
    }

    const prompt = [
      `You are reading a photo of a physical business card.`,
      `Extract the cardholder's details and return ONLY a single JSON`,
      `object, no prose, no markdown fences.`,
      ``,
      `Shape (use null — the JSON null, not the string — for anything`,
      `not clearly on the card; never guess):`,
      `{`,
      `  "full_name": string|null,   // person's name, not the company`,
      `  "job_title": string|null,   // e.g. "資深產品經理"`,
      `  "company":   string|null,`,
      `  "bio_draft": string|null,   // see rule below`,
      `  "phone":     string|null,   // digits + country code if shown, e.g. "+886 912 345 678"`,
      `  "email":     string|null,`,
      `  "website":   string|null,   // company / personal site, full domain`,
      `  "instagram": string|null,   // HANDLE only, no URL, no @`,
      `  "facebook":  string|null,   // handle or vanity path only`,
      `  "linkedin":  string|null,   // the /in/ vanity slug only`,
      `  "line":      string|null    // LINE ID only`,
      `}`,
      ``,
      `bio_draft rule: write ONE natural first-person-neutral`,
      `sentence in ${lang} that a person with this job_title at this`,
      `company would plausibly use as a social bio. Keep it under 60`,
      `characters, no company-confidential claims, no emojis. If`,
      `job_title AND company are both null, set bio_draft to null.`,
      `Example: job_title "智慧財產權律師" company "理慈" →`,
      `"專注智慧財產權的律師，喜歡把複雜的事講清楚".`,
      ``,
      `Social handles: if the card prints a full URL, return only the`,
      `account part (instagram.com/foobar → "foobar"). If a field`,
      `isn't on the card, null. Do not invent plausible-looking`,
      `handles from the person's name.`,
    ].join('\n');

    let lastError = '';
    let rawSnippet = '';

    for (const model of MODEL_FALLBACK_CHAIN) {
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { inline_data: { mime_type: mimeType, data: image } },
                    { text: prompt },
                  ],
                },
              ],
              // Low temperature: this is extraction, not creativity.
              // (bio_draft is the only generative field and one
              // bland sentence is exactly what we want.)
              generationConfig: { temperature: 0.2 },
            }),
          },
        );

        if (!upstream.ok) {
          const bodyText = await upstream.text().catch(() => '');
          console.error(
            `scan-business-card upstream error [${model}]: HTTP ${upstream.status}`,
            bodyText.slice(0, 500),
          );
          lastError = `${model}: HTTP ${upstream.status}`;
          if (/API_KEY|api key/i.test(bodyText)) break;
          continue;
        }

        const result = await upstream.json();
        const text: string =
          result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        rawSnippet = text.slice(0, 300);

        const card = extractCardObject(text);
        if (card) {
          return jsonResponse(200, { data: card });
        }
        lastError = `${model}: response did not contain a usable JSON object`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`scan-business-card fetch threw [${model}]:`, msg);
        lastError = `${model}: fetch threw`;
      }
    }

    console.error(
      'scan-business-card all models failed:',
      lastError,
      'snippet:',
      rawSnippet,
    );
    // 200 with an empty shape rather than 5xx: the client's
    // confirmation screen handles "nothing detected" gracefully
    // (user just fills it in manually) — a hard error would make
    // the whole scan affordance feel broken when really the photo
    // was just unreadable.
    return jsonResponse(200, { data: EMPTY, note: 'no_extraction' });
  } catch (err) {
    console.error('scan-business-card edge function error:', err);
    return jsonResponse(500, { error: 'Internal error' });
  }
});
