const round1 = (value) => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function totalEngagements(metrics = {}) {
  return (
    (metrics.likes ?? 0) +
    (metrics.comments ?? 0) +
    (metrics.replies ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.reposts ?? 0) +
    (metrics.saves ?? 0)
  );
}

export function exposureBase(metrics = {}) {
  return (metrics.impressions ?? 0) > 0 ? metrics.impressions ?? 0 : metrics.views ?? 0;
}

export function computeEngagementRate(metrics = {}) {
  const base = exposureBase(metrics);
  if (!base) return 0;
  return round1((totalEngagements(metrics) / base) * 100);
}

export function computeContentScore(metrics = {}) {
  const base = exposureBase(metrics);
  const engagementRate = computeEngagementRate(metrics);
  const sharesAndSaves =
    (metrics.shares ?? 0) + (metrics.reposts ?? 0) + (metrics.saves ?? 0);
  const clickRate = base ? ((metrics.link_clicks ?? 0) / base) * 100 : 0;
  const shareSaveRate = base ? (sharesAndSaves / base) * 100 : 0;

  const exposureScore = clamp((base / 1350) * 100, 0, 100);
  const engagementScore = clamp((engagementRate / 15) * 100, 0, 100);
  const shareSaveScore = clamp((shareSaveRate / 5) * 100, 0, 100);
  const clickScore = clamp((clickRate / 3) * 100, 0, 100);

  return Math.round(
    exposureScore * 0.35 +
      engagementScore * 0.35 +
      shareSaveScore * 0.2 +
      clickScore * 0.1,
  );
}

export function normalizePostWithMetrics(post) {
  const latestMetrics = post.latest_metrics ?? null;
  const engagement_rate = latestMetrics ? computeEngagementRate(latestMetrics) : 0;
  const content_score = latestMetrics ? computeContentScore(latestMetrics) : 0;
  const engagements = latestMetrics ? totalEngagements(latestMetrics) : 0;

  return {
    ...post,
    latest_metrics: latestMetrics
      ? {
          ...latestMetrics,
          engagement_rate,
          content_score,
          total_engagements: engagements,
        }
      : null,
  };
}

export function summarizeSocialPosts(posts = []) {
  const normalized = posts.map(normalizePostWithMetrics);
  const total_posts = normalized.length;
  const total_impressions = normalized.reduce(
    (sum, post) => sum + (post.latest_metrics?.impressions ?? 0),
    0,
  );
  const total_views = normalized.reduce(
    (sum, post) => sum + (post.latest_metrics?.views ?? 0),
    0,
  );
  const total_engagements = normalized.reduce(
    (sum, post) => sum + (post.latest_metrics?.total_engagements ?? 0),
    0,
  );
  const exposure = total_impressions > 0 ? total_impressions : total_views;
  const average_engagement_rate = exposure
    ? round1((total_engagements / exposure) * 100)
    : 0;

  const top_exposure_post = [...normalized].sort(
    (a, b) => exposureBase(b.latest_metrics ?? {}) - exposureBase(a.latest_metrics ?? {}),
  )[0] ?? null;

  const top_engagement_post = [...normalized].sort(
    (a, b) =>
      (b.latest_metrics?.engagement_rate ?? 0) -
      (a.latest_metrics?.engagement_rate ?? 0),
  )[0] ?? null;

  const top_conversion_post = [...normalized].sort(
    (a, b) =>
      (b.latest_metrics?.link_clicks ?? 0) - (a.latest_metrics?.link_clicks ?? 0),
  )[0] ?? null;

  return {
    total_posts,
    total_impressions,
    total_views,
    total_engagements,
    average_engagement_rate,
    top_exposure_post,
    top_engagement_post,
    top_conversion_post,
  };
}
