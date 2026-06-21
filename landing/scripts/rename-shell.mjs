// Post-build step: rename the built SPA shell from index.html → app.html.
//
// Why: Vercel checks the filesystem for a static file BEFORE applying
// `rewrites`. As long as dist/index.html exists, a `"/" → /api/home`
// rewrite is shadowed by the static file and "/" never reaches the
// homepage social-card serverless fn (verified live 2026-06-21: /api/home
// returns the localized card, but "/" served the static English shell).
// Renaming the shell frees the "/" path so the rewrite applies; the fn
// (api/home.js) fetches /app.html for the shell, and the SPA client routes
// (/contact, /pitch, /reset-password) rewrite to /app.html in vercel.json.
import { renameSync, existsSync } from 'node:fs';

const FROM = 'dist/index.html';
const TO = 'dist/app.html';

if (existsSync(FROM)) {
  renameSync(FROM, TO);
  console.log(`[rename-shell] ${FROM} → ${TO}`);
} else if (existsSync(TO)) {
  console.log(`[rename-shell] ${TO} already present; nothing to do`);
} else {
  console.error(`[rename-shell] neither ${FROM} nor ${TO} exists — build output unexpected`);
  process.exit(1);
}
