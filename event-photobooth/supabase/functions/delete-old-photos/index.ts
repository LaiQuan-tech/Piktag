// Edge Function: delete guest photos older than 30 days.
//
// Called daily by pg_cron via net.http_post (see migrations/). Deployed with
// --no-verify-jwt so pg_cron doesn't need to manage a JWT; the function is
// internal-only and the only invoker is the scheduled cron job inside the
// same project.
//
// Implementation: query storage.objects directly (faster + simpler than
// listing through the Storage REST API for thousands of files), then call
// storage.deleteObject to remove them properly (handles both DB row and
// the underlying bytes via Supabase's storage backend hooks).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "event";
const RETENTION_DAYS = 30;
const BATCH_SIZE = 500; // how many to delete per call

Deno.serve(async () => {
  const startedAt = new Date().toISOString();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // PostgREST blocks direct access to the `storage` schema, so the query
  // lives in a SECURITY DEFINER function in the public schema (see
  // migrations/*_list_expired_event_photos.sql).
  const { data: rows, error: queryErr } = await sb.rpc(
    "list_expired_event_photos",
    { retention_days: RETENTION_DAYS, batch_limit: BATCH_SIZE },
  );
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000);

  if (queryErr) {
    return json({ ok: false, stage: "query", error: queryErr.message }, 500);
  }

  if (!rows || rows.length === 0) {
    return json({ ok: true, deleted: 0, cutoff: cutoff.toISOString(), startedAt });
  }

  const paths = rows.map((r: { name: string }) => r.name);
  const { data: deleted, error: delErr } = await sb.storage
    .from(BUCKET)
    .remove(paths);

  if (delErr) {
    return json({ ok: false, stage: "delete", error: delErr.message }, 500);
  }

  return json({
    ok: true,
    deleted: deleted?.length ?? 0,
    paths_first_3: paths.slice(0, 3),
    cutoff: cutoff.toISOString(),
    startedAt,
    // If we hit BATCH_SIZE, the cron job will keep catching up day by day.
    // Add an explicit hint so the operator can spot it in logs.
    more_to_clean: rows.length === BATCH_SIZE,
  });
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
