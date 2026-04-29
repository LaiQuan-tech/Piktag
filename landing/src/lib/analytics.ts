/// <reference types="vite/client" />
/**
 * Analytics module — fans out page views & events to PostHog, GA4, Meta Pixel.
 *
 * Design rules:
 *   - All three SDKs are optional. If env vars are missing, they no-op cleanly.
 *   - In Vite dev mode (`import.meta.env.DEV`), we skip everything — no noise
 *     in dashboards from local development.
 *   - PostHog uses the same project key as the mobile app so we can later tie
 *     web visitors to app users via shared identifiers (e.g. email).
 *   - SPA-aware: page views fire manually on react-router location changes,
 *     not via SDK auto-pageview, so query strings & client-side routes are
 *     captured accurately.
 */

import posthog from 'posthog-js';

// ---------- Types ----------

type GtagFn = (...args: unknown[]) => void;
type FbqFn = ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[] };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

// ---------- Env / config ----------

const POSTHOG_KEY =
  (import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined) ??
  'phc_CagxzXtHwJ6xXYQ2pdDGmmbh5kRiyQ7ikjFjJnSrr7Hr';
const POSTHOG_HOST = 'https://us.i.posthog.com';
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const IS_DEV = import.meta.env.DEV === true;

// Track which SDKs were successfully initialized so we don't fire to dead pipes.
const state = {
  posthog: false,
  ga: false,
  meta: false,
};

// ---------- PostHog ----------

function initPostHog() {
  if (!POSTHOG_KEY) return;
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      autocapture: true,
      capture_pageview: false, // SPA — fired manually on route change
      persistence: 'localStorage+cookie',
    });
    state.posthog = true;
  } catch (err) {
    // Fail open — analytics must never crash the page.
    console.warn('[analytics] PostHog init failed', err);
  }
}

// ---------- GA4 ----------

function initGA4() {
  if (!GA_ID) return;
  try {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer ?? [];
    const gtag: GtagFn = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag = gtag;

    gtag('js', new Date());
    gtag('config', GA_ID, { send_page_view: false });
    state.ga = true;
  } catch (err) {
    console.warn('[analytics] GA4 init failed', err);
  }
}

// ---------- Meta Pixel ----------

function initMetaPixel() {
  if (!META_PIXEL_ID) return;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (function (f: any, b: Document, e: string, v: string) {
      if (f.fbq) return;
      const n: any = function (...args: unknown[]) {
        n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
      };
      f.fbq = n;
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      const t = b.createElement(e) as HTMLScriptElement;
      t.async = true;
      t.src = v;
      const s = b.getElementsByTagName(e)[0];
      s?.parentNode?.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable @typescript-eslint/no-explicit-any */

    window.fbq?.('init', META_PIXEL_ID);
    window.fbq?.('track', 'PageView');
    state.meta = true;
  } catch (err) {
    console.warn('[analytics] Meta Pixel init failed', err);
  }
}

// ---------- Public API ----------

export function initAnalytics(): void {
  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.info('[analytics] dev mode — SDKs disabled');
    return;
  }
  if (typeof window === 'undefined') return;
  initPostHog();
  initGA4();
  initMetaPixel();
}

export function trackPageView(path: string): void {
  if (IS_DEV || typeof window === 'undefined') return;

  if (state.posthog) {
    try {
      posthog.capture('$pageview', { $current_url: window.location.origin + path });
    } catch (err) {
      console.warn('[analytics] posthog pageview failed', err);
    }
  }

  if (state.ga && window.gtag && GA_ID) {
    try {
      window.gtag('event', 'page_view', {
        page_path: path,
        page_location: window.location.origin + path,
        page_title: document.title,
        send_to: GA_ID,
      });
    } catch (err) {
      console.warn('[analytics] ga pageview failed', err);
    }
  }

  if (state.meta && window.fbq) {
    try {
      window.fbq('trackCustom', 'SPAPageView', { path });
    } catch (err) {
      console.warn('[analytics] fbq pageview failed', err);
    }
  }
}

export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (IS_DEV || typeof window === 'undefined') return;

  if (state.posthog) {
    try {
      posthog.capture(name, props);
    } catch (err) {
      console.warn('[analytics] posthog event failed', err);
    }
  }

  if (state.ga && window.gtag) {
    try {
      window.gtag('event', name, props ?? {});
    } catch (err) {
      console.warn('[analytics] ga event failed', err);
    }
  }

  if (state.meta && window.fbq) {
    try {
      window.fbq('trackCustom', name, props ?? {});
    } catch (err) {
      console.warn('[analytics] fbq event failed', err);
    }
  }
}
