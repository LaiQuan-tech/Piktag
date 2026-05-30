import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  Tag,
  Search,
  Sparkles,
  Globe2,
  Users,
  TrendingUp,
  Zap,
  Layers,
  Target,
  Calendar,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { motion } from 'motion/react';

/**
 * Pitch — investor-facing one-page deck at `/pitch`.
 *
 * IMPORTANT: This page is INTERNAL — it's intentionally NOT linked from
 * the marketing site nav/footer, and the URL is not crawled-friendly.
 * It's a hand-out URL the founder shares with VCs/angels one-by-one.
 *
 * Locale: respects the global i18n detector (browser/localStorage).
 * Don't force zh-TW here — international VCs land via browser language.
 *
 * Three sections (Traction / Team / Ask) ship as VISIBLE STUBS with
 * dashed amber borders + the literal `[placeholder: ___]` bracket syntax
 * spelled out in copy. This is deliberate: the founder MUST replace these
 * before sharing, and the visual treatment makes the unfilled state
 * unmissable (cf. an invisible-by-default stub the founder could ship by
 * accident).
 */
export default function Pitch() {
  const { t, i18n } = useTranslation();

  // Screenshot strip carousel — 5 frames, swipeable on mobile / arrow
  // keys on desktop. Five was picked over more because it forces a
  // narrative ("first connect, see the person, search by tag, get
  // notified, see the loop close in stats") rather than a feature
  // dump.
  const screenshots = [
    {
      src: '/pitch/screen-02-connections.png',
      titleKey: 'pitch.screens.connections.title',
      captionKey: 'pitch.screens.connections.caption',
    },
    {
      src: '/pitch/screen-03-friend-detail.png',
      titleKey: 'pitch.screens.friendDetail.title',
      captionKey: 'pitch.screens.friendDetail.caption',
    },
    {
      src: '/pitch/screen-06-search-by-tag.png',
      titleKey: 'pitch.screens.searchByTag.title',
      captionKey: 'pitch.screens.searchByTag.caption',
    },
    {
      src: '/pitch/screen-07-notifications.png',
      titleKey: 'pitch.screens.notifications.title',
      captionKey: 'pitch.screens.notifications.caption',
    },
    {
      src: '/pitch/screen-10-stats.png',
      titleKey: 'pitch.screens.stats.title',
      captionKey: 'pitch.screens.stats.caption',
    },
  ];

  const [activeShot, setActiveShot] = useState(0);

  // Keyboard nav for the screenshot strip — left/right arrows step
  // through the carousel. Cheap usability win for VC-on-desktop.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setActiveShot((i) => (i + 1) % screenshots.length);
      } else if (e.key === 'ArrowLeft') {
        setActiveShot((i) => (i - 1 + screenshots.length) % screenshots.length);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [screenshots.length]);

  return (
    <div
      lang={i18n.language}
      className="relative min-h-screen bg-gradient-to-b from-[#0a0612] via-[#15082a] to-[#1a0a2e] font-sans text-white selection:bg-accent-purple/40 selection:text-white overflow-x-hidden"
    >
      {/* Static aurora background — same brand-toned gradient as the
          landing page, no animation here so investors reading the deck
          aren't distracted by motion. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[700px] h-[700px] rounded-full bg-accent-red/20 blur-[140px]" />
        <div className="absolute top-[20%] right-[-15%] w-[800px] h-[800px] rounded-full bg-accent-purple/25 blur-[140px]" />
        <div className="absolute bottom-[-10%] left-[20%] w-[600px] h-[600px] rounded-full bg-brand-500/20 blur-[140px]" />
      </div>

      {/* Top bar — minimal: just logo + back-to-home. No language
          switcher (the deck itself is short and one-shot; if the VC's
          browser doesn't match a supported locale they'll see English
          via the i18n fallback, which is the right behavior here). */}
      <nav className="relative z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <img
              src="/logo.png"
              alt="PikTag logo"
              className="w-8 h-8 rounded-lg"
            />
            <span className="font-bold text-xl tracking-tight">PikTag</span>
          </Link>
          <span className="text-xs uppercase tracking-wider text-white/40 font-medium">
            {t('pitch.confidential')}
          </span>
        </div>
      </nav>

      <main className="relative z-10 max-w-5xl mx-auto px-6 pb-32">
        {/* ────────────────────────────────────────────────────────────
            SECTION 1 — Hero
            One sentence, one promise. The deck's job is to get the VC
            to the demo; the hero's job is to make them want to scroll.
        ──────────────────────────────────────────────────────────── */}
        <section className="pt-12 pb-20 sm:pt-20 sm:pb-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm">
              <Sparkles className="w-3.5 h-3.5 text-accent-purple" />
              {t('pitch.hero.eyebrow')}
            </span>
            <h1 className="mt-6 text-4xl sm:text-6xl font-extrabold leading-[1.05] tracking-tight">
              {t('pitch.hero.title1')}
              <br />
              <span className="bg-gradient-to-r from-brand-300 via-accent-purple to-brand-400 bg-clip-text text-transparent">
                {t('pitch.hero.title2')}
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg sm:text-xl text-white/70 leading-relaxed">
              {t('pitch.hero.subtitle')}
            </p>
          </motion.div>
        </section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 2 — Problem
            Three named pains rather than one paragraph. VCs scan; named
            pains stick in working memory better than a wall of prose.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="02"
          eyebrow={t('pitch.problem.eyebrow')}
          title={t('pitch.problem.title')}
        >
          <div className="grid sm:grid-cols-3 gap-4 mt-8">
            <PainCard
              icon={<Users className="w-5 h-5" />}
              title={t('pitch.problem.pain1Title')}
              body={t('pitch.problem.pain1Body')}
            />
            <PainCard
              icon={<Search className="w-5 h-5" />}
              title={t('pitch.problem.pain2Title')}
              body={t('pitch.problem.pain2Body')}
            />
            <PainCard
              icon={<Globe2 className="w-5 h-5" />}
              title={t('pitch.problem.pain3Title')}
              body={t('pitch.problem.pain3Body')}
            />
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 3 — Solution (THE THESIS)
            North Star verbatim: the core IS AI tag recommendation.
            Stated as the thesis sentence, then unpacked into two loops:
              (a) search-tag → reactivate dormant connections
              (b) scan → tag → connect, cross-language semantic match
            Don't reinvent the framing here — the CLAUDE.md North Star
            is the deck's main load-bearing claim.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="03"
          eyebrow={t('pitch.solution.eyebrow')}
          title={t('pitch.solution.title')}
        >
          <p className="mt-6 max-w-3xl text-lg text-white/80 leading-relaxed">
            <span className="text-brand-300 font-semibold">
              {t('pitch.solution.thesisLead')}
            </span>{' '}
            {t('pitch.solution.thesisBody')}
          </p>
          <div className="grid sm:grid-cols-2 gap-4 mt-10">
            <SolutionLoopCard
              icon={<Sparkles className="w-5 h-5" />}
              loopLabel={t('pitch.solution.loop1Label')}
              title={t('pitch.solution.loop1Title')}
              body={t('pitch.solution.loop1Body')}
            />
            <SolutionLoopCard
              icon={<Tag className="w-5 h-5" />}
              loopLabel={t('pitch.solution.loop2Label')}
              title={t('pitch.solution.loop2Title')}
              body={t('pitch.solution.loop2Body')}
            />
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 4 — Product (screenshot strip)
            Five frames, each with a caption that says what HAPPENED
            (e.g. "search 'dog owner', find #養狗 friend you forgot
            about") rather than "screenshot of search screen".
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="04"
          eyebrow={t('pitch.product.eyebrow')}
          title={t('pitch.product.title')}
        >
          <div className="mt-10 flex flex-col items-center">
            <div className="relative w-full max-w-md">
              <motion.div
                key={activeShot}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="relative aspect-[1080/2340] mx-auto rounded-[2rem] overflow-hidden border-4 border-white/10 shadow-2xl shadow-brand-900/40 bg-black"
              >
                <img
                  src={screenshots[activeShot].src}
                  alt={t(screenshots[activeShot].titleKey)}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  width={1080}
                  height={2340}
                />
              </motion.div>

              {/* Carousel controls — small, sit on top of the strip */}
              <button
                type="button"
                aria-label={t('pitch.product.prev')}
                onClick={() =>
                  setActiveShot(
                    (i) => (i - 1 + screenshots.length) % screenshots.length
                  )
                }
                className="absolute left-[-1rem] sm:left-[-3rem] top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur p-2 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label={t('pitch.product.next')}
                onClick={() =>
                  setActiveShot((i) => (i + 1) % screenshots.length)
                }
                className="absolute right-[-1rem] sm:right-[-3rem] top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur p-2 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Active-frame caption */}
            <div className="mt-8 max-w-xl text-center">
              <div className="text-sm uppercase tracking-wider text-brand-300 font-semibold">
                {t(screenshots[activeShot].titleKey)}
              </div>
              <p className="mt-2 text-white/70 leading-relaxed">
                {t(screenshots[activeShot].captionKey)}
              </p>
            </div>

            {/* Thumbnail dots — let the user jump frames without
                tabbing through arrows. Tiny, unobtrusive. */}
            <div className="mt-6 flex gap-2">
              {screenshots.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveShot(i)}
                  aria-label={`Frame ${i + 1}`}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === activeShot
                      ? 'bg-brand-300 w-8'
                      : 'bg-white/30 hover:bg-white/50'
                  }`}
                />
              ))}
            </div>
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 5 — Market
            Three stacked numbers rather than a pie chart. Founder can
            tune the figures over time without redesigning the section.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="05"
          eyebrow={t('pitch.market.eyebrow')}
          title={t('pitch.market.title')}
        >
          <div className="grid sm:grid-cols-3 gap-4 mt-10">
            <MarketCard
              label={t('pitch.market.tamLabel')}
              value={t('pitch.market.tamValue')}
              body={t('pitch.market.tamBody')}
            />
            <MarketCard
              label={t('pitch.market.samLabel')}
              value={t('pitch.market.samValue')}
              body={t('pitch.market.samBody')}
            />
            <MarketCard
              label={t('pitch.market.somLabel')}
              value={t('pitch.market.somValue')}
              body={t('pitch.market.somBody')}
            />
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 6 — Business Model (v3 vision)
            Honest framing: monetization is NOT pre-launch. The North
            Star is explicit that thesis-first, auction-later is the
            order. Surface this honestly to investors — pretending v1
            has revenue would burn credibility on a 2nd meeting.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="06"
          eyebrow={t('pitch.model.eyebrow')}
          title={t('pitch.model.title')}
        >
          <p className="mt-6 max-w-3xl text-lg text-white/80 leading-relaxed">
            {t('pitch.model.lead')}
          </p>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-brand-500/20 p-2 text-brand-300">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm uppercase tracking-wider text-brand-300 font-semibold">
                  {t('pitch.model.honestLabel')}
                </div>
                <p className="mt-2 text-white/80 leading-relaxed">
                  {t('pitch.model.honestBody')}
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 7 — Roadmap
            v1 = thesis proof. v2 = alt accounts (audience curation).
            v3 = tag auction (monetization). Visually a vertical
            timeline so the "current = v1" lands as a beat.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="07"
          eyebrow={t('pitch.roadmap.eyebrow')}
          title={t('pitch.roadmap.title')}
        >
          <div className="mt-10 space-y-4">
            <RoadmapItem
              icon={<Zap className="w-5 h-5" />}
              phase="v1"
              status={t('pitch.roadmap.v1Status')}
              statusTone="active"
              title={t('pitch.roadmap.v1Title')}
              body={t('pitch.roadmap.v1Body')}
            />
            <RoadmapItem
              icon={<Layers className="w-5 h-5" />}
              phase="v2"
              status={t('pitch.roadmap.v2Status')}
              statusTone="next"
              title={t('pitch.roadmap.v2Title')}
              body={t('pitch.roadmap.v2Body')}
            />
            <RoadmapItem
              icon={<TrendingUp className="w-5 h-5" />}
              phase="v3"
              status={t('pitch.roadmap.v3Status')}
              statusTone="future"
              title={t('pitch.roadmap.v3Title')}
              body={t('pitch.roadmap.v3Body')}
            />
          </div>
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 8 — Traction (STUB)
            VISIBLE-STUB pattern: dashed amber border + the literal
            `[placeholder: ___]` syntax so the founder can't miss
            that this needs filling. Don't make it pretty — the
            unfilled state should LOOK unfinished.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="08"
          eyebrow={t('pitch.traction.eyebrow')}
          title={t('pitch.traction.title')}
        >
          <StubSection
            warningTitle={t('pitch.stub.warningTitle')}
            warningBody={t('pitch.stub.tractionWarning')}
            placeholders={[
              t('pitch.traction.placeholder1'),
              t('pitch.traction.placeholder2'),
              t('pitch.traction.placeholder3'),
              t('pitch.traction.placeholder4'),
            ]}
          />
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 9 — Team (STUB)
            Same VISIBLE-STUB treatment.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="09"
          eyebrow={t('pitch.team.eyebrow')}
          title={t('pitch.team.title')}
        >
          <StubSection
            warningTitle={t('pitch.stub.warningTitle')}
            warningBody={t('pitch.stub.teamWarning')}
            placeholders={[
              t('pitch.team.placeholder1'),
              t('pitch.team.placeholder2'),
              t('pitch.team.placeholder3'),
            ]}
          />
        </Section>

        {/* ────────────────────────────────────────────────────────────
            SECTION 10 — Ask (STUB)
            Same VISIBLE-STUB treatment, but framed as "the number
            you're raising + what it buys you" so the founder
            remembers BOTH pieces matter, not just the dollar amount.
        ──────────────────────────────────────────────────────────── */}
        <Section
          number="10"
          eyebrow={t('pitch.ask.eyebrow')}
          title={t('pitch.ask.title')}
        >
          <StubSection
            warningTitle={t('pitch.stub.warningTitle')}
            warningBody={t('pitch.stub.askWarning')}
            placeholders={[
              t('pitch.ask.placeholder1'),
              t('pitch.ask.placeholder2'),
              t('pitch.ask.placeholder3'),
            ]}
          />
        </Section>

        {/* Closing — single contact line. Investors who scrolled this
            far know the URL; no need for another CTA. */}
        <section className="mt-20 pt-12 border-t border-white/10 text-center">
          <p className="text-white/60 text-sm">
            {t('pitch.closing.contactPrompt')}{' '}
            <a
              href="mailto:armand7951@gmail.com"
              className="text-brand-300 hover:text-brand-200 transition-colors underline underline-offset-4"
            >
              armand7951@gmail.com
            </a>
          </p>
        </section>
      </main>

      {/* Footer — minimal, no nav (the deck is hand-out, not a hub) */}
      <footer className="relative z-10 border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <span>&copy; {new Date().getFullYear()} PikTag</span>
          <span>{t('pitch.confidential')}</span>
        </div>
      </footer>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Sub-components — kept in this file (not extracted to /components)
   because they're pitch-specific stylings, not reusable site-wide.
   Per founder rule: "shared UI = ONE shared component," but the
   inverse also holds — single-use UI shouldn't get extracted
   speculatively.
──────────────────────────────────────────────────────────────────── */

/**
 * Section — numbered chapter wrapper. Used for sections 2-10. The
 * number renders as a watermark-style label so the deck reads as
 * a deliberately-paced ten-beat sequence rather than a wall of
 * cards.
 */
function Section({
  number,
  eyebrow,
  title,
  children,
}: {
  number: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="py-16 sm:py-20 border-t border-white/5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-baseline gap-4">
          <span className="text-sm font-mono text-white/30">{number}</span>
          <span className="text-xs uppercase tracking-[0.2em] text-brand-300 font-semibold">
            {eyebrow}
          </span>
        </div>
        <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">
          {title}
        </h2>
        {children}
      </motion.div>
    </section>
  );
}

/** PainCard — used in Problem section (2). */
function PainCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 hover:border-white/20 transition-colors">
      <div className="inline-flex rounded-lg bg-accent-red/15 p-2.5 text-accent-red">
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-white/65 leading-relaxed">{body}</p>
    </div>
  );
}

/** SolutionLoopCard — used in Solution section (3). */
function SolutionLoopCard({
  icon,
  loopLabel,
  title,
  body,
}: {
  icon: ReactNode;
  loopLabel: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-900/30 to-transparent p-6 hover:border-brand-500/50 transition-colors">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-brand-500/20 p-2 text-brand-300">
          {icon}
        </div>
        <span className="text-xs uppercase tracking-wider text-brand-300 font-semibold">
          {loopLabel}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-white/70 leading-relaxed">{body}</p>
    </div>
  );
}

/** MarketCard — used in Market section (5). */
function MarketCard({
  label,
  value,
  body,
}: {
  label: string;
  value: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6">
      <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold bg-gradient-to-br from-brand-300 to-accent-purple bg-clip-text text-transparent">
        {value}
      </div>
      <p className="mt-3 text-sm text-white/65 leading-relaxed">{body}</p>
    </div>
  );
}

/**
 * RoadmapItem — used in Roadmap section (7).
 * statusTone drives the pill color: active = brand, next = soft
 * purple, future = muted white.
 */
function RoadmapItem({
  icon,
  phase,
  status,
  statusTone,
  title,
  body,
}: {
  icon: ReactNode;
  phase: string;
  status: string;
  statusTone: 'active' | 'next' | 'future';
  title: string;
  body: string;
}) {
  const toneClasses = {
    active: 'bg-brand-500/20 text-brand-300 border-brand-500/40',
    next: 'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
    future: 'bg-white/5 text-white/50 border-white/15',
  }[statusTone];

  return (
    <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6">
      <div className="flex flex-col items-center pt-1">
        <div className="rounded-lg bg-brand-500/20 p-2 text-brand-300">
          {icon}
        </div>
        <div className="mt-3 text-xs font-mono text-white/40">{phase}</div>
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <span
            className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses}`}
          >
            {status}
          </span>
        </div>
        <p className="mt-2 text-sm text-white/65 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

/**
 * StubSection — the placeholder-by-design wrapper for Traction /
 * Team / Ask sections.
 *
 * Treatment requirements (founder, 2026-05-31):
 *   - Dashed border (not solid) — signals unfinished
 *   - Amber/yellow color — signals warning, not chrome
 *   - Literal `[placeholder: ___]` syntax visible — so the founder
 *     can grep their own deck for `[` and find every unfilled slot
 *   - Warning headline at top — "FOUNDER FILLS BEFORE SENDING"
 *
 * Anti-pattern this protects against: invisible-by-default stubs
 * that look intentional. If the founder shares the URL forgetting
 * to fill these, the placeholders read as deliberate ("the deck
 * just doesn't have traction yet") and credibility takes a hit.
 * The dashed-amber treatment makes "I forgot to fill it" the
 * obvious read instead.
 */
function StubSection({
  warningTitle,
  warningBody,
  placeholders,
}: {
  warningTitle: string;
  warningBody: string;
  placeholders: string[];
}) {
  return (
    <div className="mt-8 rounded-2xl border-2 border-dashed border-amber-400/60 bg-amber-400/[0.05] backdrop-blur-sm p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-400/20 p-2 text-amber-300">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-amber-300 font-bold">
            {warningTitle}
          </div>
          <p className="mt-2 text-sm text-amber-100/80 leading-relaxed">
            {warningBody}
          </p>
        </div>
      </div>
      <ul className="mt-6 space-y-3">
        {placeholders.map((p, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-lg border border-dashed border-amber-400/40 bg-amber-400/[0.04] px-4 py-3"
          >
            <Calendar className="w-4 h-4 text-amber-300/70 mt-0.5 shrink-0" />
            <span className="font-mono text-sm text-amber-100/80 leading-relaxed break-words">
              {p}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
