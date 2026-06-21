import type { SocialAnalyticsSummary, SocialPost, SocialPostMetrics } from './admin-types';

export function totalEngagements(metrics?: Partial<SocialPostMetrics>): number;
export function exposureBase(metrics?: Partial<SocialPostMetrics>): number;
export function computeEngagementRate(metrics?: Partial<SocialPostMetrics>): number;
export function computeContentScore(metrics?: Partial<SocialPostMetrics>): number;
export function normalizePostWithMetrics<T extends { latest_metrics?: SocialPostMetrics | null }>(post: T): T;
export function summarizeSocialPosts(posts?: SocialPost[]): SocialAnalyticsSummary;
