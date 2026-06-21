/**
 * Shared TypeScript types for the admin panel. Kept intentionally lean —
 * derive any extra fields at query time.
 */

export interface AdminUser {
  /** piktag_profiles.id (= auth.users.id) */
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  headline: string | null;
  phone: string | null;
  email: string | null;
  is_verified: boolean;
  is_active: boolean;
  is_public: boolean;
  language: string | null;
  p_points: number | null;
  location: string | null;
  created_at: string;
  updated_at: string | null;
  last_sign_in_at: string | null;
}

export interface AdminUserDetail extends AdminUser {
  connections_count: number;
  tags_count: number;
  biolinks_count: number;
  scan_sessions_count: number;
  reports_filed: number;
  reports_received: number;
  tags: Array<{ id: string; name: string; is_pinned: boolean }>;
  biolinks: Array<{ id: string; platform: string; url: string; label: string | null; visibility: string }>;
  recent_connections: Array<{ id: string; connected_user_id: string; nickname: string | null; met_at: string | null; created_at: string }>;
  recent_points: Array<{ id: number; delta: number; balance_after: number; reason: string; created_at: string }>;
}

export type ReportStatus = 'pending' | 'reviewed' | 'dismissed';

export interface AdminReport {
  id: string;
  reporter_id: string;
  reporter_username: string | null;
  reported_id: string;
  reported_username: string | null;
  reason: string;
  description: string | null;
  status: ReportStatus;
  created_at: string;
}

export interface AdminAnalytics {
  total_users: number;
  total_active_users: number;
  total_connections: number;
  total_tags_created: number;
  pending_reports: number;
  signups_last_30d: Array<{ date: string; count: number }>;
  active_users_last_7d: number;
  qr_scans_last_7d: number;
  top_tags: Array<{ name: string; usage_count: number }>;
  // ── Growth pulse (added 2026-05-27) ─────────────────────────
  // Mirrors the metrics surfaced in the real-time admin push
  // notifications (notify-admin-growth) and the weekly digest
  // body — keeps a single source of truth for "is PikTag growing?"
  // visible without leaving the dashboard.
  new_signups_last_7d: number;
  // Distinct users who created their FIRST outgoing piktag_connections
  // row in the past 7 days. The product-market-fit signal: it's not
  // just "did they sign up" but "did they actually USE it to add a
  // human."
  magic_moments_last_7d: number;
  // magic_moments / new_signups, integer 0–100. Higher = better
  // activation funnel from signup → first friend.
  activation_rate_pct_last_7d: number;
  // Search-engine health pulled from piktag_search_telemetry.
  // recovery_pct LOWER is better (fewer LLM fallbacks). empty_pct
  // LOWER is better (fewer dead-end searches).
  search_total_last_7d: number;
  search_recovery_pct_last_7d: number;
  search_empty_pct_last_7d: number;
  // Prior 7-day window (days 8–14 ago) recovery/empty %, so the dashboard
  // can show the same vs-last-week trend the retired weekly push used to.
  // 0 when there was no prior-window search activity.
  search_recovery_pct_prior_7d: number;
  search_empty_pct_prior_7d: number;
  // Top recurring keywords from searches where the LLM recovery fired but
  // the result set was still empty — the actionable "which tags are missing"
  // signal that used to live in the retired weekly digest body.
  failed_search_keywords_last_7d: Array<{ keyword: string; frequency: number }>;
}

export interface AdminAuditLogEntry {
  id: string;
  admin_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type SocialPlatform = 'instagram' | 'threads';
export type SocialPostStatus = 'draft' | 'scheduled' | 'published' | 'failed';
export type SocialContentType = 'thread' | 'image' | 'carousel' | 'reel' | 'story' | 'other';
export type SocialContentPillar =
  | 'ai_building'
  | 'product_thinking'
  | 'founder_story'
  | 'tutorial'
  | 'launch_update'
  | 'community_question'
  | 'other';

export interface SocialPostMetrics {
  id?: string;
  post_id?: string;
  captured_at?: string;
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
  engagement_rate?: number;
  content_score?: number;
  total_engagements?: number;
  raw_metrics?: Record<string, unknown> | null;
}

export interface SocialPost {
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
  latest_metrics: SocialPostMetrics | null;
}

export interface SocialAnalyticsSummary {
  total_posts: number;
  total_impressions: number;
  total_views: number;
  total_engagements: number;
  average_engagement_rate: number;
  top_exposure_post: SocialPost | null;
  top_engagement_post: SocialPost | null;
  top_conversion_post: SocialPost | null;
}

export interface SocialPostsResponse extends PaginatedResponse<SocialPost> {
  summary: SocialAnalyticsSummary;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
