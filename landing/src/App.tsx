import { useTranslation } from 'react-i18next';
import { languages } from './i18n';
import { motion } from 'motion/react';
import { Apple, Play, Globe } from 'lucide-react';

export default function App() {
  const { t, i18n } = useTranslation();

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#0a0612] via-[#15082a] to-[#1a0a2e] font-sans text-white selection:bg-accent-purple/40 selection:text-white overflow-x-hidden">
      {/* Aurora background blobs.
          Switched from `absolute` → `fixed` so the blobs stay locked to
          the viewport while the page scrolls. Previously the aurora layer
          rendered at `absolute inset-0` against an unpositioned wrapper,
          which resolves to the initial containing block (viewport-sized)
          — once content pushed the wrapper past 100vh, the aurora ended
          at the first screenful and the rest of the page just showed the
          dark base color, hence the reported "下半部變黑色". With `fixed`,
          the aurora always occupies the visible viewport regardless of
          scroll, and the wrapper base is a real top-to-bottom gradient
          (was a flat `#0a0612`), so content past the fold still sits on
          a continuous brand-toned background instead of dropping into a
          black void. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            x: [0, 80, -40, 0],
            y: [0, -60, 40, 0],
            scale: [1, 1.15, 0.95, 1],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[-10%] left-[-10%] w-[700px] h-[700px] rounded-full bg-accent-red/30 blur-[120px]"
        />
        <motion.div
          animate={{
            x: [0, -60, 40, 0],
            y: [0, 80, -40, 0],
            scale: [1, 0.9, 1.2, 1],
          }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[20%] right-[-15%] w-[800px] h-[800px] rounded-full bg-accent-purple/30 blur-[120px]"
        />
        <motion.div
          animate={{
            x: [0, 40, -60, 0],
            y: [0, -40, 60, 0],
            scale: [1, 1.1, 0.95, 1],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-[-10%] left-[20%] w-[600px] h-[600px] rounded-full bg-brand-500/25 blur-[120px]"
        />
      </div>

      {/* Grid overlay — also `fixed` so the dot pattern stays continuous
          with the aurora through scroll, instead of cutting off at 100vh
          like the old `absolute` placement did. */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none opacity-[0.07]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Top bar */}
      <nav className="relative z-10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="PikTag Logo" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-xl tracking-tight">PikTag</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/70">
            <Globe className="w-4 h-4" />
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-transparent border border-white/15 rounded-lg px-3 py-1.5 text-sm font-medium text-white/80 cursor-pointer hover:border-white/30 transition-colors [&>option]:bg-[#0a0612] [&>option]:text-white"
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 px-6 pt-12 pb-32">
        <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm text-sm font-medium text-white/80 mb-10"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-purple opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-purple"></span>
            </span>
            {t('hero.badge')}
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[1.02] mb-8"
          >
            <span className="block text-white">{t('hero.title1')}</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-accent-red via-brand-400 to-accent-purple">
              {t('hero.title2')}
            </span>
          </motion.h1>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-lg md:text-xl text-white/60 max-w-2xl mb-12 leading-relaxed whitespace-pre-line"
          >
            {t('hero.description')}
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <button className="group flex items-center justify-center gap-2 bg-white text-neutral-900 px-8 py-4 rounded-2xl font-medium hover:bg-white/90 transition-all hover:scale-[1.02] active:scale-[0.98]">
              <Apple className="w-5 h-5" />
              <div className="text-left">
                <div className="text-[10px] opacity-60 leading-none mb-1">
                  {t('hero.comingSoonOn')}
                </div>
                <div className="text-sm leading-none">{t('hero.appStore')}</div>
              </div>
            </button>
            <button className="group relative flex items-center justify-center gap-2 bg-gradient-to-r from-accent-red to-accent-purple text-white px-8 py-4 rounded-2xl font-medium transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_40px_rgba(140,82,255,0.35)] hover:shadow-[0_0_60px_rgba(140,82,255,0.5)]">
              <Play className="w-5 h-5" />
              <div className="text-left">
                <div className="text-[10px] opacity-70 leading-none mb-1">
                  {t('hero.comingSoonOn')}
                </div>
                <div className="text-sm leading-none">{t('hero.googlePlay')}</div>
              </div>
            </button>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col gap-5 items-center text-xs text-white/40">
          <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => i18n.changeLanguage(lang.code)}
                className={`transition-colors ${
                  i18n.language === lang.code
                    ? 'text-white font-medium'
                    : 'hover:text-white/70'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-5 justify-center items-center">
            <span>&copy; {new Date().getFullYear()} PikTag</span>
            <a href="/privacy" className="hover:text-white transition-colors">
              {t('footer.privacy')}
            </a>
            <a href="/terms" className="hover:text-white transition-colors">
              {t('footer.terms')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
