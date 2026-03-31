'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  LayoutDashboard, 
  GitBranch, 
  Users, 
  Plus, 
  CheckCircle2, 
  Circle, 
  Clock, 
  ShieldAlert,
  ChevronRight,
  Github
} from 'lucide-react';
import { motion } from 'framer-motion';

type Feature = {
  id: string;
  name: string;
  description: string;
  status: 'Idea' | 'In Progress' | 'Review' | 'Live';
  assigned_to: string;
  progress_pct: number;
  priority: 'High' | 'Medium' | 'Low';
};

type Version = {
  id: string;
  version_tag: string;
  commit_hash: string;
  change_summary: string;
  author: string;
  created_at: string;
};

export default function PiktagDashboard() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();

    // Subscribe to Realtime changes
    const featureChannel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'features' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'versions' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(featureChannel);
    };
  }, []);

  async function fetchData() {
    const { data: featureData } = await supabase.from('features').select('*').order('created_at', { ascending: false });
    const { data: versionData } = await supabase.from('versions').select('*').order('created_at', { ascending: false });
    
    if (featureData) setFeatures(featureData);
    if (versionData) setVersions(versionData);
    setLoading(false);
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Live': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'In Progress': return <Clock className="w-5 h-5 text-amber-500" />;
      case 'Review': return <ShieldAlert className="w-5 h-5 text-blue-500" />;
      default: return <Circle className="w-5 h-5 text-zinc-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-200 font-sans selection:bg-brand/30">
      {/* Sidebar Overlay (Glassmorphism inspired) */}
      <div className="fixed top-0 left-0 w-64 h-full border-r border-white/5 bg-white/[0.02] backdrop-blur-xl hidden lg:block">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-brand/20">P</div>
            <h1 className="text-xl font-bold tracking-tight text-white">Piktag</h1>
          </div>
          <nav className="space-y-2">
            <button className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 text-white transition-all">
              <LayoutDashboard className="w-5 h-5" />
              <span>Mission Control</span>
            </button>
            <button className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white transition-all">
              <GitBranch className="w-5 h-5" />
              <span>Version Sentinel</span>
            </button>
            <button className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white transition-all">
              <Users className="w-5 h-5" />
              <span>Team Sync</span>
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:pl-64 min-h-screen">
        <header className="sticky top-0 z-30 h-20 border-b border-white/5 bg-[#050505]/80 backdrop-blur-md px-8 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">Commander's Dashboard</h2>
          <div className="flex items-center gap-4">
            <div className="text-sm text-zinc-500 hidden sm:block">Last Sync: Just now</div>
            <button className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-lg shadow-brand/20">
              <Plus className="w-4 h-4" />
              New Feature
            </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {[
              { label: 'Active Features', value: features.length, icon: LayoutDashboard, color: 'text-brand' },
              { label: 'Deployed Builds', value: versions.length, icon: Github, color: 'text-emerald-400' },
              { label: 'Collaborators', value: '2', icon: Users, color: 'text-amber-400' },
            ].map((stat, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-6 rounded-2xl border border-white/5 bg-white/[0.02] hover:border-white/10 transition-all group"
              >
                <div className="flex items-center justify-between mb-4">
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                  <div className="text-xs text-zinc-600 font-medium tracking-widest uppercase">Overview</div>
                </div>
                <div className="text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-sm text-zinc-500">{stat.label}</div>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            {/* Feature List (Left & Center) */}
            <div className="xl:col-span-2 space-y-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                  Feature Matrix
                  <span className="text-xs font-normal text-zinc-600 bg-white/5 px-2 py-0.5 rounded-full">{features.length}</span>
                </h3>
              </div>

              <div className="grid gap-4">
                {features.length === 0 ? (
                  <div className="py-20 text-center border border-dashed border-white/10 rounded-3xl text-zinc-600">
                    No features tracked in the matrix yet.
                  </div>
                ) : (
                  features.map((feature, i) => (
                    <motion.div 
                      key={feature.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-5 rounded-2xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-all flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-5">
                        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-brand-dark/10 transition-all">
                          {getStatusIcon(feature.status)}
                        </div>
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h4 className="font-medium text-white">{feature.name}</h4>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                              feature.priority === 'High' ? 'border-rose-500/50 text-rose-400 bg-rose-500/10' :
                              feature.priority === 'Medium' ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                              'border-zinc-500/50 text-zinc-400 bg-zinc-500/10'
                            }`}>
                              {feature.priority}
                            </span>
                          </div>
                          <p className="text-sm text-zinc-500">{feature.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-8">
                        <div className="hidden sm:block text-right">
                          <div className="text-sm text-white font-medium">{feature.progress_pct}%</div>
                          <div className="w-24 h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full bg-brand" style={{ width: `${feature.progress_pct}%` }} />
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-zinc-400 transition-all" />
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            {/* Version History (Right) */}
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                Version Sentinel
                <span className="text-xs font-normal text-zinc-600 bg-white/5 px-2 py-0.5 rounded-full">{versions.length}</span>
              </h3>
              
              <div className="relative pl-6 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-white/10">
                {versions.length === 0 ? (
                  <div className="py-10 text-zinc-600 text-sm">Waiting for first commit...</div>
                ) : (
                  versions.map((version, i) => (
                    <div key={version.id} className="relative group">
                      <div className="absolute -left-[20px] top-1 w-2.5 h-2.5 rounded-full bg-zinc-800 border-2 border-zinc-600 group-hover:border-brand group-hover:scale-125 transition-all" />
                      <div className="text-xs text-zinc-500 mb-2 font-mono">{new Date(version.created_at).toLocaleDateString()}</div>
                      <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:border-white/10 transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-brand uppercase tracking-tighter">{version.version_tag}</span>
                          <span className="text-[10px] text-zinc-600 font-mono">#{version.commit_hash?.slice(0, 7)}</span>
                        </div>
                        <p className="text-sm text-zinc-300 leading-relaxed mb-3">{version.change_summary}</p>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold">{version.author?.[0]}</div>
                          <span className="text-[11px] text-zinc-500 font-medium">{version.author}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
