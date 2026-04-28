import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Terms() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-neutral-50 font-sans text-neutral-900 selection:bg-brand-200 selection:text-neutral-900">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="PikTag Logo" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-xl tracking-tight">PikTag</span>
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-28 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold tracking-tight mb-2">{t('terms.title')}</h1>
          <p className="text-neutral-500 mb-12">{t('terms.lastUpdated')}</p>

          <div className="space-y-10 text-neutral-700 leading-relaxed">
            {/* Section 1 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section1Title')}</h2>
              <p>
                {t('terms.section1Content')}
              </p>
            </section>

            {/* Section 2 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section2Title')}</h2>
              <ul className="list-disc list-inside space-y-2">
                {(t('terms.section2Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* Section 3 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section3Title')}</h2>
              <p className="mb-3">{t('terms.section3Intro')}</p>
              <ul className="list-disc list-inside space-y-2">
                {(t('terms.section3Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* Section 4 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section4Title')}</h2>
              <ul className="list-disc list-inside space-y-2">
                {(t('terms.section4Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* Section 5 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section5Title')}</h2>
              <ul className="list-disc list-inside space-y-2">
                {(t('terms.section5Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* Section 6 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section6Title')}</h2>
              <p>
                {t('terms.section6Content')}
                <Link to="/privacy" className="text-brand-700 hover:text-brand-800 underline underline-offset-2 mx-1">
                  {t('terms.section6Link')}
                </Link>
                {t('terms.section6Content2')}
              </p>
            </section>

            {/* Section 7 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section7Title')}</h2>
              <ul className="list-disc list-inside space-y-2">
                {(t('terms.section7Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* Section 8 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section8Title')}</h2>
              <p>
                {t('terms.section8Content')}
              </p>
            </section>

            {/* Section 9 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section9Title')}</h2>
              <ul className="list-disc list-inside space-y-2">
                {(t('terms.section9Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* Section 10 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section10Title')}</h2>
              <p>
                {t('terms.section10Content')}
              </p>
            </section>

            {/* Section 11 */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('terms.section11Title')}</h2>
              <p>
                {t('terms.section11Intro')}
              </p>
              <ul className="list-disc list-inside space-y-2 mt-3">
                <li>{t('terms.contactEmail')}<a href="mailto:support@pikt.ag" className="text-brand-700 hover:text-brand-800 underline underline-offset-2">support@pikt.ag</a></li>
                <li>{t('terms.contactWebsite')}<a href="https://pikt.ag" className="text-brand-700 hover:text-brand-800 underline underline-offset-2">https://pikt.ag</a></li>
              </ul>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-neutral-50 py-12 border-t border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="PikTag Logo" className="w-6 h-6 rounded-md" />
            <span className="font-bold text-lg tracking-tight">PikTag</span>
          </Link>
          <div className="text-sm text-neutral-500">
            &copy; {new Date().getFullYear()} PikTag. {t('footer.rights')}
          </div>
          <div className="flex gap-6 text-sm font-medium text-neutral-600">
            <Link to="/privacy" className="hover:text-neutral-900 transition-colors">{t('footer.privacy')}</Link>
            <Link to="/terms" className="hover:text-neutral-900 transition-colors">{t('footer.terms')}</Link>
            <a href="mailto:support@pikt.ag" className="hover:text-neutral-900 transition-colors">{t('footer.contact')}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
