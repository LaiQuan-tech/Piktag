import { Link } from "react-router-dom";
import { Mail, MessageCircle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-neutral-200 rounded-lg">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left font-medium text-neutral-800 hover:bg-neutral-100 transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>{question}</span>
        {open ? (
          <ChevronUp className="h-5 w-5 text-neutral-500 shrink-0" />
        ) : (
          <ChevronDown className="h-5 w-5 text-neutral-500 shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-4 text-neutral-600 leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}

export default function Contact() {
  const { t } = useTranslation();

  const faqs = [
    { question: t('contact.faq1Question'), answer: t('contact.faq1Answer') },
    { question: t('contact.faq2Question'), answer: t('contact.faq2Answer') },
    { question: t('contact.faq3Question'), answer: t('contact.faq3Answer') },
    { question: t('contact.faq4Question'), answer: t('contact.faq4Answer') },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="PikTag logo" className="h-8 w-8 rounded" />
            <span className="text-xl font-bold text-neutral-900">PikTag</span>
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-12">
        {/* Title */}
        <section className="mb-12">
          <h1 className="text-3xl font-bold text-neutral-900 mb-3">{t('contact.title')}</h1>
          <p className="text-neutral-600 leading-relaxed max-w-2xl">
            {t('contact.description')}
          </p>
        </section>

        {/* Contact Info */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-neutral-900 mb-5">{t('contact.emailTitle')}</h2>
          <div className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
            <a
              href="mailto:support@pikt.ag"
              className="flex items-center gap-3 text-neutral-700 hover:text-brand-700 transition-colors"
            >
              <Mail className="h-5 w-5 text-brand-600" />
              <span>{t('contact.emailAddress')}</span>
            </a>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-neutral-900 mb-5">
            <span className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-brand-600" />
              {t('contact.faqTitle')}
            </span>
          </h2>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />
            ))}
          </div>
        </section>

        {/* Social Links */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-neutral-900 mb-5">{t('contact.socialTitle')}</h2>
          <div className="flex flex-wrap gap-4">
            <a
              href="https://www.facebook.com/pikttag"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-neutral-700 hover:border-brand-500 hover:text-brand-700 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              {t('contact.socialFacebook')}
            </a>
            <a
              href="https://www.instagram.com/pikt.ag"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-neutral-700 hover:border-brand-500 hover:text-brand-700 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              {t('contact.socialInstagram')}
            </a>
            <a
              href="https://line.me/R/ti/p/@pikttag"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-neutral-700 hover:border-brand-500 hover:text-brand-700 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              {t('contact.socialLine')}
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-neutral-500">
          <span>&copy; {new Date().getFullYear()} PikTag</span>
          <nav className="flex items-center gap-6">
            <Link to="/privacy" className="hover:text-neutral-800 transition-colors">
              {t('footer.privacy')}
            </Link>
            <Link to="/terms" className="hover:text-neutral-800 transition-colors">
              {t('footer.terms')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
