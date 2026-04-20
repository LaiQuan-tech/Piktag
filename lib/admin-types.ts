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

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
