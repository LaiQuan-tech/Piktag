import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route, useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import App from './App.tsx';
import Contact from './pages/Contact.tsx';
import Pitch from './pages/Pitch.tsx';
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
 * Title format is `PikTag — {localized slogan}`. The slogan is
 * `hero.title1 + hero.title2`, which IS localized per locale (the
 * keyword-bearing value prop — kept for non-brand / non-English
 * search discoverability; the unified brand verb "PikTag to connect."
 * lives in the visible hero subtitle via `hero.description`, so the
 * title doesn't need to also carry it). The slogan is tightened for
 * the title slot: trailing sentence punctuation stripped and a single
 * uniform " — " brand separator (titles read better without a final
 * period; one consistent separator across the site).
 *
 * NOTE: this only updates the live document — JS-capable crawlers see
 * this; non-JS social crawlers (FB/LINE/Twitter cards) read the static
 * markup in index.html, whose English baseline is kept in the SAME
 * tightened shape. Richer per-locale SEO would need prerender/SSR.
 */
function LocalizedDocumentMeta() {
  const {t, i18n} = useTranslation();
  useEffect(() => {
    // Tighten the two-line hero slogan into a title: join, collapse
    // whitespace, drop trailing terminal punctuation across scripts —
    // Latin . ! ? , · CJK 。．！？，、 · Devanagari/Bengali danda ।
    // · Arabic/Urdu full stop ۔ (Thai has no sentence terminator).
    const slogan = `${t('hero.title1')} ${t('hero.title2')}`
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/[\s。．.!！?？,，、।۔]+$/u, '');
    const title = `PikTag — ${slogan}`;
    const description = t('hero.description');

    document.title = title;
    document.documentElement.setAttribute('lang', i18n.language);
    // 2026-06-03 fix: ar + ur are shipped locales but `dir` was never
    // set, so Arabic/Urdu rendered left-aligned LTR (wrong alignment,
    // mirrored layout). Set the document direction from the language.
    const isRtl = i18n.language === 'ar' || i18n.language === 'ur';
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');

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
        <Route path="/pitch" element={<Pitch />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
