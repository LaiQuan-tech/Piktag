import type { SupabaseClient } from '@supabase/supabase-js';
import type { SocialContentType, SocialPlatform } from './admin-types';

type JsonRecord = Record<string, unknown>;

const THREADS_GRAPH_BASE = 'https://graph.threads.net/v1.0';
const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export type SocialSyncStatus = 'synced' | 'skipped' | 'error';

export interface SocialSyncResult {
  platform: SocialPlatform;
  status: SocialSyncStatus;
  imported_posts: number;
  updated_posts: number;
  metric_snapshots: number;
  missing_credentials?: string[];
  errors: string[];
}

interface SocialPostRow {
  id: string;
  platform: SocialPlatform;
  handle: string;
  external_post_id: string | null;
  post_url: string | null;
  content: string;
  content_type: SocialContentType;
  content_pillar: string;
  campaign: string | null;
  hook: string | null;
  cta: string | null;
  status: string;
  published_at: string | null;
}

interface NormalizedPlatformPost {
  external_post_id: string;
  platform: SocialPlatform;
  handle: string;
  post_url: string | null;
  content: string;
  content_type: SocialContentType;
  published_at: string | null;
  raw_post: JsonRecord;
}

interface NormalizedMetrics {
  impressions: number;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  replies: number;
  shares: number;
  reposts: number;
  saves: number;
  profile_visits: number;
  follows: number;
  link_clicks: number;
  raw_metrics: JsonRecord;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return 0;
}

function truncate(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

async function graphGet(base: string, path: string, params: Record<string, string>): Promise<JsonRecord> {
  const url = new URL(`${base}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, { cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as JsonRecord;
  if (!res.ok) {
    const error = json.error as JsonRecord | undefined;
    const message = asString(error?.message) ?? asString(json.message) ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json;
}

function metricMapFromInsights(json: JsonRecord): Record<string, number> {
  const out: Record<string, number> = {};
  const data = Array.isArray(json.data) ? json.data : [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const row = item as JsonRecord;
    const name = asString(row.name);
    if (!name) continue;
    const values = Array.isArray(row.values) ? row.values : [];
    const latest = values.length ? (values[values.length - 1] as JsonRecord) : undefined;
    out[name] = asNumber(latest?.value ?? row.value);
  }
  return out;
}

export function normalizeThreadsPost(row: JsonRecord): NormalizedPlatformPost | null {
  const id = asString(row.id);
  if (!id) return null;
  const text = asString(row.text) ?? '';
  const mediaType = (asString(row.media_type) ?? '').toUpperCase();
  return {
    external_post_id: id,
    platform: 'threads',
    handle: '@pik.tag',
    post_url: asString(row.permalink),
    content: text || `(Threads post ${id})`,
    content_type: mediaType === 'TEXT_POST' || !mediaType ? 'thread' : 'image',
    published_at: asString(row.timestamp),
    raw_post: row,
  };
}

export function normalizeThreadsMetrics(json: JsonRecord): NormalizedMetrics {
  const m = metricMapFromInsights(json);
  return {
    impressions: m.views ?? 0,
    reach: 0,
    views: m.views ?? 0,
    likes: m.likes ?? 0,
    comments: 0,
    replies: m.replies ?? 0,
    shares: m.shares ?? 0,
    reposts: m.reposts ?? 0,
    saves: 0,
    profile_visits: 0,
    follows: 0,
    link_clicks: 0,
    raw_metrics: json,
  };
}

export function normalizeInstagramPost(row: JsonRecord): NormalizedPlatformPost | null {
  const id = asString(row.id);
  if (!id) return null;
  const caption = asString(row.caption) ?? '';
  const mediaType = (asString(row.media_type) ?? '').toUpperCase();
  const contentType: SocialContentType =
    mediaType === 'REELS' || mediaType === 'VIDEO'
      ? 'reel'
      : mediaType === 'CAROUSEL_ALBUM'
        ? 'carousel'
        : 'image';
  return {
    external_post_id: id,
    platform: 'instagram',
    handle: '@pik.tag',
    post_url: asString(row.permalink),
    content: caption || `(Instagram media ${id})`,
    content_type: contentType,
    published_at: asString(row.timestamp),
    raw_post: row,
  };
}

export function normalizeInstagramMetrics(json: JsonRecord): NormalizedMetrics {
  const m = metricMapFromInsights(json);
  const comments = m.comments ?? 0;
  return {
    impressions: m.impressions ?? m.views ?? 0,
    reach: m.reach ?? 0,
    views: m.views ?? m.plays ?? 0,
    likes: m.likes ?? 0,
    comments,
    replies: comments,
    shares: m.shares ?? 0,
    reposts: 0,
    saves: m.saved ?? m.saves ?? 0,
    profile_visits: m.profile_visits ?? 0,
    follows: m.follows ?? 0,
    link_clicks: m.website_clicks ?? m.link_clicks ?? 0,
    raw_metrics: json,
  };
}

async function upsertPost(
  supabase: SupabaseClient,
  post: NormalizedPlatformPost,
): Promise<{ id: string; imported: boolean; updated: boolean }> {
  const { data: byExternal, error: byExternalError } = await supabase
    .from('social_posts')
    .select('*')
    .eq('platform', post.platform)
    .eq('external_post_id', post.external_post_id)
    .maybeSingle();
  if (byExternalError) throw new Error(byExternalError.message);

  let existing = byExternal as SocialPostRow | null;
  if (!existing && post.content) {
    const preview = truncate(post.content, 140);
    const { data: byPreview, error: byPreviewError } = await supabase
      .from('social_posts')
      .select('*')
      .eq('platform', post.platform)
      .eq('handle', post.handle)
      .eq('content_preview', preview)
      .maybeSingle();
    if (byPreviewError) throw new Error(byPreviewError.message);
    existing = byPreview as SocialPostRow | null;
  }

  if (existing) {
    const { error } = await supabase
      .from('social_posts')
      .update({
        external_post_id: post.external_post_id,
        post_url: post.post_url ?? existing.post_url,
        content: existing.content || post.content,
        content_type: post.content_type,
        published_at: existing.published_at ?? post.published_at,
        status: 'published',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    return { id: existing.id, imported: false, updated: true };
  }

  const { data, error } = await supabase
    .from('social_posts')
    .insert({
      platform: post.platform,
      handle: post.handle,
      external_post_id: post.external_post_id,
      post_url: post.post_url,
      content: post.content,
      content_type: post.content_type,
      content_pillar: 'other',
      campaign: 'api_sync',
      hook: truncate(post.content, 80),
      status: 'published',
      published_at: post.published_at,
      created_by: 'Meta API sync',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: (data as { id: string }).id, imported: true, updated: false };
}

async function insertMetrics(
  supabase: SupabaseClient,
  postId: string,
  metrics: NormalizedMetrics,
): Promise<void> {
  const base = metrics.impressions || metrics.views || metrics.reach;
  const totalEngagements =
    metrics.likes +
    metrics.comments +
    metrics.replies +
    metrics.shares +
    metrics.reposts +
    metrics.saves;
  const engagementRate = base > 0 ? Math.round((totalEngagements / base) * 10000) / 100 : 0;
  const saveRate = base > 0 ? Math.round((metrics.saves / base) * 10000) / 100 : 0;
  const shareRate = base > 0 ? Math.round(((metrics.shares + metrics.reposts) / base) * 10000) / 100 : 0;
  const clickRate = base > 0 ? Math.round((metrics.link_clicks / base) * 10000) / 100 : 0;

  const { error } = await supabase.from('social_post_metric_snapshots').insert({
    post_id: postId,
    ...metrics,
    engagement_rate: engagementRate,
    save_rate: saveRate,
    share_rate: shareRate,
    click_rate: clickRate,
  });
  if (error) throw new Error(error.message);
}

async function syncThreads(supabase: SupabaseClient): Promise<SocialSyncResult> {
  const token = env('THREADS_ACCESS_TOKEN') ?? env('META_THREADS_ACCESS_TOKEN');
  const userId = env('THREADS_USER_ID') ?? 'me';
  const result: SocialSyncResult = {
    platform: 'threads',
    status: 'synced',
    imported_posts: 0,
    updated_posts: 0,
    metric_snapshots: 0,
    errors: [],
  };
  if (!token) {
    return {
      ...result,
      status: 'skipped',
      missing_credentials: ['THREADS_ACCESS_TOKEN'],
    };
  }

  const postsJson = await graphGet(THREADS_GRAPH_BASE, `${userId}/threads`, {
    fields: 'id,media_type,permalink,text,timestamp,username',
    limit: '25',
    access_token: token,
  });
  const rows = Array.isArray(postsJson.data) ? postsJson.data : [];
  for (const raw of rows) {
    const post = normalizeThreadsPost(raw as JsonRecord);
    if (!post) continue;
    try {
      const saved = await upsertPost(supabase, post);
      if (saved.imported) result.imported_posts += 1;
      if (saved.updated) result.updated_posts += 1;

      const insights = await graphGet(THREADS_GRAPH_BASE, `${post.external_post_id}/insights`, {
        metric: 'views,likes,replies,reposts,quotes,shares',
        access_token: token,
      });
      await insertMetrics(supabase, saved.id, normalizeThreadsMetrics(insights));
      result.metric_snapshots += 1;
    } catch (err) {
      result.errors.push(`${post.external_post_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (result.errors.length) result.status = result.metric_snapshots ? 'synced' : 'error';
  return result;
}

async function syncInstagram(supabase: SupabaseClient): Promise<SocialSyncResult> {
  const token = env('INSTAGRAM_ACCESS_TOKEN') ?? env('META_INSTAGRAM_ACCESS_TOKEN');
  const accountId = env('INSTAGRAM_BUSINESS_ACCOUNT_ID') ?? env('INSTAGRAM_USER_ID');
  const result: SocialSyncResult = {
    platform: 'instagram',
    status: 'synced',
    imported_posts: 0,
    updated_posts: 0,
    metric_snapshots: 0,
    errors: [],
  };
  const missing = [];
  if (!token) missing.push('INSTAGRAM_ACCESS_TOKEN');
  if (!accountId) missing.push('INSTAGRAM_BUSINESS_ACCOUNT_ID');
  if (missing.length) return { ...result, status: 'skipped', missing_credentials: missing };

  const postsJson = await graphGet(META_GRAPH_BASE, `${accountId}/media`, {
    fields: 'id,caption,media_type,permalink,timestamp,username',
    limit: '25',
    access_token: token!,
  });
  const rows = Array.isArray(postsJson.data) ? postsJson.data : [];
  for (const raw of rows) {
    const post = normalizeInstagramPost(raw as JsonRecord);
    if (!post) continue;
    try {
      const saved = await upsertPost(supabase, post);
      if (saved.imported) result.imported_posts += 1;
      if (saved.updated) result.updated_posts += 1;

      const insights = await graphGet(META_GRAPH_BASE, `${post.external_post_id}/insights`, {
        metric: 'impressions,reach,likes,comments,shares,saved,profile_visits,follows,website_clicks,views,plays',
        access_token: token!,
      });
      await insertMetrics(supabase, saved.id, normalizeInstagramMetrics(insights));
      result.metric_snapshots += 1;
    } catch (err) {
      result.errors.push(`${post.external_post_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (result.errors.length) result.status = result.metric_snapshots ? 'synced' : 'error';
  return result;
}

export async function syncSocialPlatform(
  supabase: SupabaseClient,
  platform: SocialPlatform | 'all',
): Promise<SocialSyncResult[]> {
  const platforms: SocialPlatform[] = platform === 'all' ? ['threads', 'instagram'] : [platform];
  const results: SocialSyncResult[] = [];
  for (const item of platforms) {
    if (item === 'threads') results.push(await syncThreads(supabase));
    if (item === 'instagram') results.push(await syncInstagram(supabase));
  }
  return results;
}
