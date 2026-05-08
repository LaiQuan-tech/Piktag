'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Users,
  Flag,
  BarChart3,
  Tag,
  ScrollText,
  Gauge,
  type LucideIcon,
} from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: '首頁', icon: Home },
  { href: '/users', label: '用戶', icon: Users },
  { href: '/reports', label: '舉報', icon: Flag },
  { href: '/analytics', label: '數據', icon: BarChart3 },
  { href: '/tags', label: '標籤', icon: Tag },
  { href: '/audit-log', label: '操作紀錄', icon: ScrollText },
  { href: '/mission-control', label: '開發看板', icon: Gauge },
];

export default function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <aside className="sticky top-0 left-0 h-screen w-64 bg-white border-r border-slate-200 flex flex-col">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-slate-200">
        <img src="/logo.png" alt="PikTag" className="w-8 h-8" />
        <span className="font-semibold text-slate-900">PikTag Admin</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ' +
                (active
                  ? 'bg-[#8c52ff] text-white'
                  : 'text-slate-700 hover:bg-slate-100')
              }
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
