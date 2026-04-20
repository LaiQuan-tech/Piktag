import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import Sidebar from '@/components/admin/Sidebar';
import Header from '@/components/admin/Header';

export const metadata: Metadata = {
  title: 'PikTag Admin',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    throw new Error('Admin session missing — middleware should have gated this.');
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header adminEmail={user.email} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
