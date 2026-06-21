/**
 * GET /api/admin/social-posts
 * POST /api/admin/social-posts
 *
 * MVP social publishing ledger for PikTag marketing posts. Metrics are stored
 * as snapshots in a separate table; this route returns each post with the
 * latest snapshot and computed summary cards.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import type {
  SocialContentPillar,
  SocialContentType,
  SocialPlatform,
  SocialPost,
  SocialPostMetrics,
  SocialPostsResponse,
  SocialPostStatus,
} from '@/lib/admin-types';
import { summarizeSocialPosts } from '@/lib/social-analytics.js';

const VALID_PLATFORMS: ReadonlyArray<SocialPlatform> = ['instagram', 'threads'];
const VALID_TYPES: ReadonlyArray<SocialContentType> = [
  'thread',
  'image',
  'carousel',
  'reel',
  'story',
  'other',
];
const VALID_PILLARS: ReadonlyArray<SocialContentPillar> = [
  'ai_building',
  'product_thinking',
  'founder_story',
  'tutorial',
  'launch_update',
  'community_question',
  'other',
];
const VALID_STATUSES: ReadonlyArray<SocialPostStatus> = [
  'draft',
  'scheduled',
  'published',
  'failed',
];

interface SocialPostRow {
  id: string;
  platform: SocialPlatform;
  handle: string;
  external_post_id: string | null;
  post_url: string | null;
  content: string;
  content_preview: string;
  content_type: SocialContentType;
  content_pillar: SocialContentPillar;
  campaign: string | null;
  hook: string | null;
  cta: string | null;
  status: SocialPostStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

interface MetricRow extends SocialPostMetrics {
  id: string;
  post_id: string;
  captured_at: string;
}

function parseEnum<T extends string>(
  value: string | null,
  valid: ReadonlyArray<T>,
): T | null {
  return value && valid.includes(value as T) ? (value as T) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function postWithLatestMetrics(
  row: SocialPostRow,
  metricsByPostId: Map<string, MetricRow>,
): SocialPost {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    external_post_id: row.external_post_id,
    post_url: row.post_url,
    content: row.content,
    content_preview: row.content_preview,
    content_type: row.content_type,
    content_pillar: row.content_pillar,
    campaign: row.campaign,
    hook: row.hook,
    cta: row.cta,
    status: row.status,
    published_at: row.published_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    latest_metrics: metricsByPostId.get(row.id) ?? null,
  };
}

export async function GET(req: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const platform = parseEnum(url.searchParams.get('platform'), VALID_PLATFORMS);
  const status = parseEnum(url.searchParams.get('status'), VALID_STATUSES);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('page_size') ?? '50', 10) || 50),
  );

  const supabase = createAdminClient();
  let query = supabase.from('social_posts').select('*', { count: 'exact' });
  if (platform) query = query.eq('platform', platform);
  if (status) query = query.eq('status', status);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as SocialPostRow[];
  const postIds = rows.map((row) => row.id);
  const metricsByPostId = new Map<string, MetricRow>();

  if (postIds.length > 0) {
    const { data: metricsRows, error: metricsError } = await supabase
      .from('social_post_metric_snapshots')
      .select('*')
      .in('post_id', postIds)
      .order('captured_at', { ascending: false });

    if (metricsError) {
      return NextResponse.json({ error: metricsError.message }, { status: 500 });
    }

    for (const metric of (metricsRows ?? []) as MetricRow[]) {
      if (!metricsByPostId.has(metric.post_id)) {
        metricsByPostId.set(metric.post_id, metric);
      }
    }
  }

  const items = rows.map((row) => postWithLatestMetrics(row, metricsByPostId));
  const body: SocialPostsResponse = {
    items,
    total: count ?? items.length,
    page,
    page_size: pageSize,
    summary: summarizeSocialPosts(items),
  };
  return NextResponse.json(body);
}

export async function POST(req: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.content !== 'string' || !body.content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const platform = parseEnum(String(body.platform ?? 'threads'), VALID_PLATFORMS) ?? 'threads';
  const contentType = parseEnum(String(body.content_type ?? 'thread'), VALID_TYPES) ?? 'thread';
  const contentPillar =
    parseEnum(String(body.content_pillar ?? 'other'), VALID_PILLARS) ?? 'other';
  const status = parseEnum(String(body.status ?? 'published'), VALID_STATUSES) ?? 'published';

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('social_posts')
    .insert({
      platform,
      handle: String(body.handle ?? '@pik.tag'),
      external_post_id: body.external_post_id ? String(body.external_post_id) : null,
      post_url: body.post_url ? String(body.post_url) : null,
      content: body.content.trim(),
      content_type: contentType,
      content_pillar: contentPillar,
      campaign: body.campaign ? String(body.campaign) : null,
      hook: body.hook ? String(body.hook) : null,
      cta: body.cta ? String(body.cta) : null,
      status,
      published_at:
        typeof body.published_at === 'string' && body.published_at
          ? body.published_at
          : new Date().toISOString(),
      created_by: body.created_by ? String(body.created_by) : 'admin',
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const metrics = body.metrics as Record<string, unknown> | undefined;
  if (metrics) {
    const inserted = data as SocialPostRow;
    const { error: metricError } = await supabase
      .from('social_post_metric_snapshots')
      .insert({
        post_id: inserted.id,
        impressions: nonNegativeInt(metrics.impressions),
        reach: nonNegativeInt(metrics.reach),
        views: nonNegativeInt(metrics.views),
        likes: nonNegativeInt(metrics.likes),
        comments: nonNegativeInt(metrics.comments),
        replies: nonNegativeInt(metrics.replies),
        shares: nonNegativeInt(metrics.shares),
        reposts: nonNegativeInt(metrics.reposts),
        saves: nonNegativeInt(metrics.saves),
        profile_visits: nonNegativeInt(metrics.profile_visits),
        follows: nonNegativeInt(metrics.follows),
        link_clicks: nonNegativeInt(metrics.link_clicks),
      });
    if (metricError) {
      return NextResponse.json({ error: metricError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ item: data }, { status: 201 });
}
