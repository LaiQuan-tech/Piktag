// Backup LLM path for when the whole Gemini chain fails (key dead, quota
// exhausted, billing off, Google outage). Context: on 2026-06-22 the single
// GEMINI_API_KEY died and every AI flow went dark for weeks
// (docs/claude/ref-infra-ops.md "踩坑補遺"). This module gives the
// user-facing, ephemeral flows a second provider: Hugging Face Inference
// Providers via the OpenAI-compatible router.
//
// Rules:
// - Gemini stays primary. Call this ONLY after the Gemini chain has failed
//   (or GEMINI_API_KEY is missing). It never runs on the happy path, so it
//   adds zero latency normally.
// - No HF_TOKEN secret → returns null immediately (feature is a no-op until
//   the founder sets `HF_TOKEN` in Supabase function secrets).
// - Returns raw model text; callers reuse their existing Gemini-text parsers.
// - Do NOT use for anything persisted as canonical data (concept aliases in
//   auto-link-concepts): translation quality is the semantic-tag foundation
//   (CLAUDE.md), and those cron jobs retry on their own once Gemini is back.
// - Embeddings have NO fallback: vectors from another model are not
//   comparable with the stored gemini-embedding-001 vectors.
//
// Model ids verified live on HF Inference Providers 2026-11-18 via
// huggingface.co/api/models/<id>?expand[]=inferenceProviderMapping.
// `:fastest` lets the router pick the fastest live provider for that model.
// Re-probe before changing ids (same discipline as the Gemini 2.5 rule).

const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';

// Text-only chain: instruct (non-thinking) models first, so we don't pay
// reasoning latency. Qwen first for zh-TW quality.
const TEXT_MODELS = [
  'Qwen/Qwen3-Next-80B-A3B-Instruct:fastest',
  'google/gemma-4-31B-it:fastest',
] as const;

// Vision chain (image parts present): Gemma 4 31B is multimodal.
const VISION_MODELS = ['google/gemma-4-31B-it:fastest'] as const;

export type HfContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }; // data: URL or https URL

export type HfFallbackRequest = {
  /** Short tag for logs, e.g. the function name. */
  caller: string;
  system?: string;
  /** Plain prompt, or multimodal parts (images as data URLs). */
  user: string | HfContentPart[];
  maxTokens?: number;
  temperature?: number;
  /** Per-model timeout. Keep it tight on latency-sensitive paths. */
  timeoutMs?: number;
};

export function hfFallbackConfigured(): boolean {
  return !!Deno.env.get('HF_TOKEN');
}

/** Build an image part from base64 (no data: prefix) + mime type. */
export function hfImagePart(base64: string, mimeType = 'image/jpeg'): HfContentPart {
  return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } };
}

function stripThinking(text: string): string {
  // Some open models emit <think>…</think> even when asked not to.
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Try the HF backup chain. Returns the model's text, or null if not
 * configured / every model failed. Never throws.
 */
export async function callHfFallback(req: HfFallbackRequest): Promise<string | null> {
  const token = Deno.env.get('HF_TOKEN');
  if (!token) {
    console.warn(`[hf-fallback] ${req.caller}: Gemini failed and HF_TOKEN is not set — no backup available`);
    return null;
  }

  const hasImage = Array.isArray(req.user) && req.user.some((p) => p.type === 'image_url');
  const models = hasImage ? VISION_MODELS : TEXT_MODELS;

  const messages: Array<{ role: string; content: string | HfContentPart[] }> = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  messages.push({ role: 'user', content: req.user });

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 15000);
    try {
      const res = await fetch(HF_ROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: req.maxTokens ?? 1024,
          temperature: req.temperature ?? 0.4,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[hf-fallback] ${req.caller} [${model}]: HTTP ${res.status}`, body.slice(0, 300));
        continue;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) {
        // Distinct log tag so Supabase logs show when we are running on backup.
        console.warn(`[hf-fallback] ${req.caller}: served by ${model} (Gemini unavailable)`);
        return stripThinking(text);
      }
      console.error(`[hf-fallback] ${req.caller} [${model}]: empty response`);
    } catch (e) {
      console.error(`[hf-fallback] ${req.caller} [${model}]: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
