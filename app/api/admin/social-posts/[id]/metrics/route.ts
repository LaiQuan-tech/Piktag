/**
 * POST /api/admin/social-posts/[id]/metrics
 *
 * Add a point-in-time metrics snapshot for a social post. Used for MVP manual
 * entry now and for API/cron sync later.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import { computeEngagementRate } from '@/lib/social-analytics.js';

function nonNegativeInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!id || !body) {
    return NextResponse.json({ error: 'invalid metrics payload' }, { status: 400 });
  }

  const metrics = {
    impressions: nonNegativeInt(body.impressions),
    reach: nonNegativeInt(body.reach),
    views: nonNegativeInt(body.views),
    likes: nonNegativeInt(body.likes),
    comments: nonNegativeInt(body.comments),
    replies: nonNegativeInt(body.replies),
    shares: nonNegativeInt(body.shares),
    reposts: nonNegativeInt(body.reposts),
    saves: nonNegativeInt(body.saves),
    profile_visits: nonNegativeInt(body.profile_visits),
    follows: nonNegativeInt(body.follows),
    link_clicks: nonNegativeInt(body.link_clicks),
  };
  const base = metrics.impressions > 0 ? metrics.impressions : metrics.views;
  const shareTotal = metrics.shares + metrics.reposts;

  const supabase = createAdminClient();
  const { data: post, error: postError } = await supabase
    .from('social_posts')
    .select('id')
    .eq('id', id)
    .single();

  if (postError || !post) {
    return NextResponse.json(
      { error: postError?.message ?? 'social post not found' },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from('social_post_metric_snapshots')
    .insert({
      post_id: id,
      ...metrics,
      engagement_rate: computeEngagementRate(metrics),
      save_rate: rate(metrics.saves, base),
      share_rate: rate(shareTotal, base),
      click_rate: rate(metrics.link_clicks, base),
      raw_metrics:
        body.raw_metrics && typeof body.raw_metrics === 'object' ? body.raw_metrics : null,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data }, { status: 201 });
}
