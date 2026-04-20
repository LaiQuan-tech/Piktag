import type { Metadata } from 'next';
import { Noto_Sans_TC, Inter } from 'next/font/google';
import { ToastProvider } from '@/components/admin/Toast';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const notoTC = Noto_Sans_TC({ subsets: ['latin'], variable: '--font-noto-tc' });

export const metadata: Metadata = {
  title: 'PikTag Admin',
  description: 'PikTag 管理後台 — 僅限授權管理員登入',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className={`${inter.variable} ${notoTC.variable}`}>
      <body className="font-sans antialiased bg-slate-50 text-slate-900">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
