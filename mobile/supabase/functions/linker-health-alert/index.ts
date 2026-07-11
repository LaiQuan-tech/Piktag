// Supabase Edge Function: linker-health-alert
//
// Backend-only daily health check for the concept linker (auto-link-concepts).
//
// WHY: the linker's Gemini embedding step silently stalled for three weeks in
// 2026-06 before anyone noticed. An earlier attempt to alert on this
// (notify_linker_stall / enqueue_concept_health_digest, migration
// 20260605070000) piggybacked on the app's admin-push pipeline
// (notify-admin-growth) and was removed in 20260605130000 — ops signals
// don't belong in the app/user notification event stream (piktag_notifications,
// magic-moment pushes, etc). This function is the backend replacement: a
// pure ops surface, triggered ONLY by GitHub Actions cron
// (.github/workflows/daily-cron.yml). It never writes to piktag_notifications
// or any user-facing table.
//
// Unhealthy = tag_coverage_pct < 60 (from admin_concept_coverage(), migration
// 20260705020000_algo_health_and_signals.sql) OR the oldest unlinked tag
// (tag_concept_link_health view, migration
// 20260519010000_auto_link_concepts_pg_cron.sql) is more than 24h old.
//
// Auth: CRON_SECRET bearer only — same constant-time gate as
// auto-link-concepts/index.ts:207-222. This function is cron-only, no user
// JWT path, so unlike notify-admin-signup it does not also accept the
// service-role key as an alternate bearer.
//
// fail-soft: a transient RPC/view error is logged (console.error) and does
// NOT flip the HTTP response to 5xx — that would make the GitHub Actions job
// cry wolf on an infra blip unrelated to the linker itself. An undetermined
// signal also never reports healthy:false — that verdict is reserved for a
// SUCCESSFULLY measured unhealthy reading, per one of the two checks above.
// The workflow job's `jq -e .healthy` fails the build only on a definitive
// false.
//
// NOTE (2026-07-11, founder): this function used to email the founder
// directly via Resend on every unhealthy reading. That got noisy, so the
// email step was removed — visibility now lives in the admin dashboard's
// LinkerHealthBanner (reads algo_concept_coverage.tag_coverage_pct off
// GET /api/admin/analytics), with this function's JSON response still
// consumed by the daily-cron workflow as a second-layer heartbeat (`jq -e
// .healthy`, exit 1 on false). Do NOT re-add an email/notification side
// effect here — the JSON contract below is the only thing callers rely on.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COVERAGE_FLOOR_PCT = 60;
const STALL_HOURS = 24;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Auth gate: require CRON_SECRET via Authorization: Bearer header
  // (copied from auto-link-concepts/index.ts:207-222 — constant-time compare).
  const expected = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided) return new Response('Forbidden', { status: 403 });
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) return new Response('Forbidden', { status: 403 });
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return new Response('Forbidden', { status: 403 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Each signal is independently nullable — a failure on one RPC/view must
  // not block the other from still being able to declare unhealthy.
  let coveragePct: number | null = null;
  let oldestUnlinkedHours: number | null = null;

  try {
    const { data, error } = await supabase.rpc('admin_concept_coverage');
    if (error) {
      console.error('linker-health-alert: admin_concept_coverage RPC error:', error.message);
    } else if (data && data.length > 0 && data[0].tag_coverage_pct !== null) {
      coveragePct = Number(data[0].tag_coverage_pct);
    }
  } catch (e) {
    console.error('linker-health-alert: admin_concept_coverage threw:', e);
  }

  try {
    const { data, error } = await supabase
      .from('tag_concept_link_health')
      .select('oldest_unlinked_at')
      .single();
    if (error) {
      console.error('linker-health-alert: tag_concept_link_health query error:', error.message);
    } else if (data?.oldest_unlinked_at) {
      oldestUnlinkedHours =
        (Date.now() - new Date(data.oldest_unlinked_at).getTime()) / (1000 * 60 * 60);
    } else {
      // No unlinked tags at all — unambiguously 0h stale.
      oldestUnlinkedHours = 0;
    }
  } catch (e) {
    console.error('linker-health-alert: tag_concept_link_health threw:', e);
  }

  const coverageUnhealthy = coveragePct !== null && coveragePct < COVERAGE_FLOOR_PCT;
  const stallUnhealthy = oldestUnlinkedHours !== null && oldestUnlinkedHours > STALL_HOURS;
  const unhealthy = coverageUnhealthy || stallUnhealthy;
  // Fail-open: if neither signal was measurable (both RPCs/views down), we
  // report healthy rather than guessing — an infra blip unrelated to the
  // linker must not trip the workflow's exit-1 heartbeat.
  const healthy = !unhealthy;

  // ── Embedding probe (diagnostic, 2026-07-11 outage) ──────────────────
  // Fires ONE embedContent call with the live GEMINI_API_KEY and reports
  // the exact upstream verdict, plus a key FINGERPRINT (length + whitespace
  // + prefix check — never the key material) so a paste-with-newline in the
  // dashboard is distinguishable from a dead key or a retired model. The
  // probe result rides the JSON response, which the daily-cron workflow
  // prints — readable straight from the Actions log.
  const embedProbe: Record<string, unknown> = { ok: false };
  try {
    const rawKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const trimmed = rawKey.trim();
    embedProbe.key_present = rawKey.length > 0;
    embedProbe.key_len = rawKey.length;
    embedProbe.key_has_whitespace = rawKey !== trimmed;
    embedProbe.key_prefix_ok = trimmed.startsWith('AIzaSy');
    if (trimmed) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const resp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': trimmed },
            body: JSON.stringify({
              model: 'models/gemini-embedding-001',
              content: { parts: [{ text: 'probe' }] },
            }),
            signal: ctrl.signal,
          },
        );
        embedProbe.http_status = resp.status;
        if (resp.ok) {
          const j = await resp.json();
          const vec: number[] = j.embedding?.values ?? [];
          embedProbe.ok = Array.isArray(vec) && vec.length > 0;
          embedProbe.dims = vec.length;

          // Step 2: the NEXT stage of the linker pipeline — pgvector
          // similarity search. The 2026-06 42883 incident hit exactly this
          // class of function (LANGUAGE sql + <=> without extensions on the
          // search_path), so when embedding succeeds but linking is still
          // zero, this is the prime suspect. Report its verdict verbatim.
          if (embedProbe.ok) {
            try {
              const { data: cands, error: simErr } = await supabase.rpc(
                'find_similar_concepts',
                {
                  query_embedding: JSON.stringify(vec),
                  similarity_threshold: 0.5,
                  max_results: 3,
                },
              );
              if (simErr) {
                embedProbe.similar_error = `${simErr.code ?? ''} ${simErr.message ?? ''}`.slice(0, 300);
              } else {
                embedProbe.similar_ok = true;
                embedProbe.similar_candidates = Array.isArray(cands) ? cands.length : 0;
              }
            } catch (e) {
              embedProbe.similar_error = String(e).slice(0, 200);
            }
          }
        } else {
          const bodyText = await resp.text().catch(() => '');
          embedProbe.error = bodyText.slice(0, 300);
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    embedProbe.error = String(e).slice(0, 200);
  }

  // ── Step 3 (diagnostic, 2026-07-11): invoke the linker DIRECTLY and
  // relay its verbatim response. External triggers kept losing the lock
  // race against pg_cron, so ground truth about WHY runs link zero tags
  // was unreadable. This fn holds both the service key (clear the lock)
  // and CRON_SECRET (authorized call), so it can guarantee a real run and
  // capture {processed, linked, created} or the actual error.
  let linkerRelay: Record<string, unknown> | null = null;
  if (unhealthy) {
    try {
      await supabase.from('linker_run_lock').update({ locked_at: null }).eq('id', 1);
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), 120000);
      try {
        const r = await fetch(`${supabaseUrl}/functions/v1/auto-link-concepts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${expected}`,
          },
          signal: ctrl2.signal,
        });
        const body = await r.text().catch(() => '');
        linkerRelay = { status: r.status, body: body.slice(0, 600) };
      } finally {
        clearTimeout(timer2);
      }
    } catch (e) {
      linkerRelay = { error: String(e).slice(0, 300) };
    }
  }

  return new Response(
    JSON.stringify({
      healthy,
      coverage_pct: coveragePct,
      oldest_unlinked_hours: oldestUnlinkedHours,
      embed_probe: embedProbe,
      linker_relay: linkerRelay,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
