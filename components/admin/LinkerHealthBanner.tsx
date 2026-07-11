'use client';

// Concept-linker health banner — shown at the top of every admin page when
// tag_coverage_pct drops below the floor (embedding pipeline likely stalled).
//
// WHY a banner instead of email: the linker-health-alert edge fn (mobile/
// supabase/functions/linker-health-alert) used to email the founder on every
// unhealthy cron run. That got noisy, so email was removed there — this
// banner is now the primary visibility surface (founder 2026-07-11), backed
// by the CI workflow's `jq .healthy` exit-1 as a second-layer heartbeat.
//
// Reuses the existing GET /api/admin/analytics response (algo_concept_coverage
// .tag_coverage_pct) rather than opening a new endpoint. A fetch failure
// (network blip, auth edge case) stays silent — we never want a broken
// fetch to look like a false "linker is down" alarm.
import { useEffect, useState } from 'react';
import type { AdminAnalytics } from '@/lib/admin-types';

const COVERAGE_FLOOR_PCT = 60;

export default function LinkerHealthBanner() {
  const [coveragePct, setCoveragePct] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/admin/analytics', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as AdminAnalytics;
        if (cancelled) return;
        const pct = json.algo_concept_coverage?.tag_coverage_pct;
        setCoveragePct(typeof pct === 'number' ? pct : null);
      } catch {
        // Silent by design — a fetch failure must not read as "unhealthy".
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || coveragePct === null || coveragePct >= COVERAGE_FLOOR_PCT) {
    return null;
  }

  return (
    <div className="relative overflow-hidden border-b border-red-800 bg-red-600 text-white">
      <style>{`
        @keyframes admin-linker-health-marquee {
          from { transform: translateX(100%); }
          to { transform: translateX(-100%); }
        }
      `}</style>
      <div className="flex items-center gap-4 px-4 py-2">
        <div className="flex-1 overflow-hidden whitespace-nowrap">
          <span
            className="inline-block"
            style={{ animation: 'admin-linker-health-marquee 16s linear infinite' }}
          >
            警示：概念覆蓋率 {coveragePct.toFixed(1)}% 低於 {COVERAGE_FLOOR_PCT}% —
            embedding 可能停擺，檢查 Gemini API / 配額
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded border border-white/40 px-2 py-0.5 text-xs font-medium hover:bg-white/10 transition-colors"
          aria-label="關閉警示"
        >
          ×
        </button>
      </div>
    </div>
  );
}
