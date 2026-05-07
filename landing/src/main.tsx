import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route, useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import App from './App.tsx';
import Contact from './pages/Contact.tsx';
import ResetPassword from './pages/ResetPassword.tsx';
import {initAnalytics, trackPageView} from './lib/analytics';
import './i18n';
import './index.css';

// Recovery-link rescue: when the user clicks the password-reset link in
// their email, Supabase appends recovery params to whatever Site URL is
// configured in the dashboard (https://pikt.ag) — NOT to /reset-password,
// unless the mobile client passed an explicit `redirectTo`. Mobile clients
// running an older build (TestFlight hasn't picked up the redirectTo
// change yet) still produce links pointing at the bare site root, so they
// land on the marketing page with a recovery hash that nobody reads.
//
// This block runs before BrowserRouter mounts and rewrites the URL to
// `/reset-password` (preserving the original query + hash) whenever it
// detects a recovery flow. Covers both the implicit-flow `#type=recovery`
// hash and the PKCE-flow `?code=…` query. Idempotent — if the user is
// already on /reset-password the redirect is skipped.
//
// Why history.replaceState instead of location.replace: avoids a full
// page reload, so supabase-js's `detectSessionInUrl` on the
// ResetPassword page sees the original URL exactly as Supabase wrote it.
if (typeof window !== 'undefined' && window.location.pathname !== '/reset-password') {
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  const isRecovery =
    /type=recovery/.test(hash) ||
    /access_token=/.test(hash) ||
    new URLSearchParams(search).get('type') === 'recovery' ||
    new URLSearchParams(search).has('code');
  if (isRecovery) {
    window.history.replaceState(null, '', '/reset-password' + search + hash);
  }
}

// Fire analytics SDK init *before* React renders so `$pageview` on the first
// route change has a fully-warm pipeline. SDKs no-op in dev / when env vars
// are missing.
initAnalytics();

/**
 * RouteTracker — listens to react-router location changes and fires a single
 * page view fan-out (PostHog / GA4 / Meta Pixel). Mounted inside BrowserRouter
 * so `useLocation()` works.
 */
function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

/**
 * LocalizedDocumentMeta — keeps <title>, the meta description, OG/Twitter
 * cards, and <html lang> in sync with the active i18n locale. Mounted at
 * the router root so the meta updates apply across all routes (/, /contact,
 * /reset-password).
 *
 * Title format is `PikTag · {hero.title1} {hero.title2}` — the existing
 * brand wordmark followed by the localized two-line slogan ("Define your
 * vibe. Find your tribe." in English, "定義你的風格 遇見你的同類" in
 * zh-TW, etc). Description reuses `hero.description`.
 *
 * NOTE: this only updates the live document — search engines and social
 * crawlers see the static markup in index.html. The static fallback is
 * kept in English so the SEO baseline matches the canonical brand voice.
 * For richer per-locale SEO, prerender or SSR would be the next step.
 */
function LocalizedDocumentMeta() {
  const {t, i18n} = useTranslation();
  useEffect(() => {
    const title = `PikTag · ${t('hero.title1')} ${t('hero.title2')}`.trim();
    const description = t('hero.description');

    document.title = title;
    document.documentElement.setAttribute('lang', i18n.language);

    const setMeta = (selector: string, attr: string, value: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement('meta');
        // The selector is `meta[name="..."]` or `meta[property="..."]`.
        // Extract the attr name + value to recreate when the tag isn't
        // already in index.html.
        const match = selector.match(/meta\[(name|property)="([^"]+)"\]/);
        if (match) {
          el.setAttribute(match[1], match[2]);
          document.head.appendChild(el);
        } else {
          return;
        }
      }
      el.setAttribute(attr, value);
    };

    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
  }, [t, i18n.language]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RouteTracker />
      <LocalizedDocumentMeta />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
