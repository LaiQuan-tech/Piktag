// landing/src/pages/Admin.tsx
//
// Off-app ops dashboard. The PikTag mobile app must NOT carry internal
// ops telemetry (founder rule 2026-06-06) — all of it lives here instead,
// behind a Supabase login + the server-side is_admin() gate.
//
// Everything renders from ONE RPC: admin_overview() (SECURITY DEFINER,
// granted to authenticated, raises 42501 for non-admins). A non-admin who
// finds this URL can log in but gets "not authorized" — the gate is on
// the server, not hidden in the client.
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type Overview = {
  generated_at: string;
  growth: Record<string, number>;
  concept_health: Record<string, number>;
  merge_candidates: Array<{
    similarity: number;
    a_name: string; a_aliases: number; a_tags: number; a_usage: number;
    b_name: string; b_aliases: number; b_tags: number; b_usage: number;
  }>;
};

const GROWTH_LABELS: Record<string, string> = {
  total_users: '總使用者',
  signups_24h: '新註冊 24h',
  signups_7d: '新註冊 7d',
  signups_30d: '新註冊 30d',
  onboarded_users: '完成精靈',
  total_connections: '總連結數',
  activated_users: '已加好友的人',
  total_user_tags: '使用者標籤總數',
  active_asks: '進行中的 Ask',
};

const HEALTH_LABELS: Record<string, string> = {
  total_concepts: '概念總數',
  with_embedding: '有向量',
  without_embedding: '無向量',
  single_alias_concepts: '疑似碎片(單一別名)',
  zero_tag_concepts: '零標籤概念',
  total_aliases: '別名總數',
  unlinked_tags: '未連結標籤',
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-2xl font-bold tabular-nums">{value ?? '—'}</div>
      <div className="mt-1 text-xs text-white/55">{label}</div>
    </div>
  );
}

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const load = useCallback(async () => {
    setLoadingData(true);
    setErr(null);
    const { data: d, error } = await supabase.rpc('admin_overview');
    if (error) {
      setErr(
        error.code === '42501' || /not authorized/i.test(error.message)
          ? '此帳號沒有後台權限。'
          : error.message,
      );
      setData(null);
    } else {
      setData(d as Overview);
    }
    setLoadingData(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
      if (data.session) void load();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) void load();
      else {
        setData(null);
        setErr(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setSigningIn(false);
  };

  const signOut = () => void supabase.auth.signOut();

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0612] via-[#15082a] to-[#1a0a2e] text-white font-sans">
      <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
    </div>
  );

  if (checking) return shell(<div className="text-white/60">載入中…</div>);

  // ── Login ──
  if (!session) {
    return shell(
      <div className="mx-auto mt-16 max-w-sm">
        <h1 className="mb-1 text-2xl font-bold">PikTag 後台</h1>
        <p className="mb-6 text-sm text-white/55">管理員登入</p>
        <form onSubmit={signIn} className="space-y-3">
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/40"
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/40"
          />
          <button
            type="submit"
            disabled={signingIn || !email || !password}
            className="w-full rounded-xl bg-gradient-to-r from-accent-red to-accent-purple px-4 py-3 text-sm font-semibold disabled:opacity-50"
          >
            {signingIn ? '登入中…' : '登入'}
          </button>
        </form>
        {err && <p className="mt-4 text-sm text-red-300">{err}</p>}
      </div>,
    );
  }

  // ── Authed ──
  return shell(
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PikTag 後台</h1>
          <p className="text-xs text-white/45">{session.user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void load()}
            disabled={loadingData}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:border-white/35 disabled:opacity-50"
          >
            {loadingData ? '更新中…' : '重新整理'}
          </button>
          <button
            onClick={signOut}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:border-white/35"
          >
            登出
          </button>
        </div>
      </div>

      {err && <p className="mb-6 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>}

      {data && (
        <div className="space-y-10">
          {/* Growth */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">成長</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {Object.entries(GROWTH_LABELS).map(([k, label]) => (
                <Stat key={k} label={label} value={data.growth?.[k]} />
              ))}
            </div>
          </section>

          {/* Concept health */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">概念圖健康</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
              {Object.entries(HEALTH_LABELS).map(([k, label]) => (
                <Stat key={k} label={label} value={data.concept_health?.[k]} />
              ))}
            </div>
          </section>

          {/* Merge candidates */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
              可合併概念對(相似度 ≥ 0.85)— {data.merge_candidates.length} 組
            </h2>
            {data.merge_candidates.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/50">
                沒有碎片。概念圖乾淨。
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase text-white/45">
                    <tr>
                      <th className="px-3 py-2">相似度</th>
                      <th className="px-3 py-2">保留(別名/標籤)</th>
                      <th className="px-3 py-2">碎片(別名/標籤)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.merge_candidates.map((c, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-3 py-2 tabular-nums">{c.similarity.toFixed(3)}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{c.a_name}</span>
                          <span className="text-white/40"> ({c.a_aliases}/{c.a_tags})</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{c.b_name}</span>
                          <span className="text-white/40"> ({c.b_aliases}/{c.b_tags})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-xs text-white/30">
            產生時間 {data.generated_at ? new Date(data.generated_at).toLocaleString() : '—'}
          </p>
        </div>
      )}
    </div>,
  );
}
