import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PrivacyPolicy() {
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
      <main className="pt-32 pb-20 px-6">
        <article className="max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{t('privacy.title')}</h1>
          <p className="text-neutral-500 mb-12">
            {t('privacy.lastUpdated')}
          </p>

          <div className="prose prose-neutral max-w-none space-y-10">
            {/* Intro */}
            <p className="text-lg text-neutral-600 leading-relaxed">
              {t('privacy.intro')}
            </p>

            {/* 資料收集 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section1Title')}</h2>
              <p className="text-neutral-600 leading-relaxed mb-4">
                {t('privacy.section1Intro')}
              </p>
              <ul className="list-disc pl-6 space-y-3 text-neutral-600">
                {(t('privacy.section1Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* 資料使用方式 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section2Title')}</h2>
              <p className="text-neutral-600 leading-relaxed mb-4">
                {t('privacy.section2Intro')}
              </p>
              <ul className="list-disc pl-6 space-y-3 text-neutral-600">
                {(t('privacy.section2Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>

            {/* 資料儲存與安全 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section3Title')}</h2>
              <p className="text-neutral-600 leading-relaxed mb-4">
                {t('privacy.section3Intro')}
              </p>
              <ul className="list-disc pl-6 space-y-3 text-neutral-600">
                {(t('privacy.section3Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <p className="text-neutral-600 leading-relaxed mt-4">
                {t('privacy.section3Note')}
              </p>
            </section>

            {/* 第三方服務 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section4Title')}</h2>
              <p className="text-neutral-600 leading-relaxed mb-4">
                {t('privacy.section4Intro')}
              </p>
              <ul className="list-disc pl-6 space-y-3 text-neutral-600">
                <li>
                  {t('privacy.section4Apple')}{' '}
                  <a
                    href="https://www.apple.com/legal/privacy/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline hover:text-brand-800"
                  >
                    {t('privacy.section4AppleLink')}
                  </a>
                  。
                </li>
                <li>
                  {t('privacy.section4Google')}{' '}
                  <a
                    href="https://policies.google.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline hover:text-brand-800"
                  >
                    {t('privacy.section4GoogleLink')}
                  </a>
                  。
                </li>
                <li>
                  {t('privacy.section4Supabase')}{' '}
                  <a
                    href="https://supabase.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline hover:text-brand-800"
                  >
                    {t('privacy.section4SupabaseLink')}
                  </a>
                  。
                </li>
              </ul>
            </section>

            {/* Cookie 與追蹤 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section5Title')}</h2>
              <p className="text-neutral-600 leading-relaxed mb-4">
                {t('privacy.section5Intro')}
              </p>
              <ul className="list-disc pl-6 space-y-3 text-neutral-600">
                {(t('privacy.section5Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <p className="text-neutral-600 leading-relaxed mt-4">
                {t('privacy.section5Note')}
              </p>
            </section>

            {/* 用戶權利 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section6Title')}</h2>
              <p className="text-neutral-600 leading-relaxed mb-4">
                {t('privacy.section6Intro')}
              </p>
              <ul className="list-disc pl-6 space-y-3 text-neutral-600">
                {(t('privacy.section6Items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <p className="text-neutral-600 leading-relaxed mt-4">
                {t('privacy.section6Note')}
              </p>
            </section>

            {/* 兒童隱私 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section7Title')}</h2>
              <p className="text-neutral-600 leading-relaxed">
                {t('privacy.section7Content')}
              </p>
            </section>

            {/* 隱私政策更新 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section8Title')}</h2>
              <p className="text-neutral-600 leading-relaxed">
                {t('privacy.section8Content')}
              </p>
            </section>

            {/* 聯絡方式 */}
            <section>
              <h2 className="text-2xl font-bold mb-4">{t('privacy.section9Title')}</h2>
              <p className="text-neutral-600 leading-relaxed mb-4">
                {t('privacy.section9Intro')}
              </p>
              <div className="bg-white rounded-2xl border border-neutral-200 p-6">
                <ul className="space-y-2 text-neutral-600">
                  <li>
                    {t('privacy.contactAppName')}
                  </li>
                  <li>
                    {t('privacy.contactEmail')}{' '}
                    <a
                      href="mailto:privacy@pikt.ag"
                      className="text-brand-700 underline hover:text-brand-800"
                    >
                      privacy@pikt.ag
                    </a>
                  </li>
                  <li>
                    {t('privacy.contactWebsite')}{' '}
                    <a
                      href="https://pikt.ag"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-700 underline hover:text-brand-800"
                    >
                      https://pikt.ag
                    </a>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </article>
      </main>

      {/* Footer */}
      <footer className="bg-neutral-50 py-12 border-t border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="PikTag Logo" className="w-6 h-6 rounded-md" />
            <span className="font-bold text-lg tracking-tight">PikTag</span>
          </Link>
          <div className="text-sm text-neutral-500">
            &copy; {new Date().getFullYear()} PikTag. All rights reserved.
          </div>
          <div className="flex gap-6 text-sm font-medium text-neutral-600">
            <Link to="/privacy" className="hover:text-neutral-900 transition-colors">
              {t('footer.privacy')}
            </Link>
            <a href="#" className="hover:text-neutral-900 transition-colors">
              {t('footer.terms')}
            </a>
            <a href="mailto:privacy@pikt.ag" className="hover:text-neutral-900 transition-colors">
              {t('footer.contact')}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
