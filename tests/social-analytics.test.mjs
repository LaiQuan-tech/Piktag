import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEngagementRate,
  computeContentScore,
  summarizeSocialPosts,
} from '../lib/social-analytics.js';

test('computeEngagementRate uses impressions first and returns percentage with one decimal', () => {
  assert.equal(
    computeEngagementRate({
      impressions: 1000,
      views: 5000,
      likes: 70,
      comments: 10,
      replies: 5,
      shares: 8,
      reposts: 4,
      saves: 3,
    }),
    10,
  );
});

test('computeEngagementRate falls back to views when impressions are unavailable', () => {
  assert.equal(
    computeEngagementRate({
      impressions: 0,
      views: 250,
      likes: 20,
      comments: 2,
      replies: 0,
      shares: 1,
      reposts: 0,
      saves: 2,
    }),
    10,
  );
});

test('computeContentScore rewards exposure, engagement, share/save, and click performance', () => {
  const score = computeContentScore({
    impressions: 1000,
    views: 0,
    likes: 80,
    comments: 10,
    replies: 0,
    shares: 10,
    reposts: 5,
    saves: 5,
    link_clicks: 20,
  });
  assert.equal(score, 66);
});

test('summarizeSocialPosts returns dashboard totals and top posts', () => {
  const summary = summarizeSocialPosts([
    {
      id: 'p1',
      platform: 'threads',
      content_preview: 'A strong build in public post',
      published_at: '2026-06-20T00:00:00Z',
      latest_metrics: {
        impressions: 1000,
        reach: 800,
        views: 0,
        likes: 80,
        comments: 10,
        replies: 0,
        shares: 10,
        reposts: 5,
        saves: 5,
        profile_visits: 12,
        follows: 2,
        link_clicks: 20,
      },
    },
    {
      id: 'p2',
      platform: 'instagram',
      content_preview: 'A smaller carousel',
      published_at: '2026-06-21T00:00:00Z',
      latest_metrics: {
        impressions: 500,
        reach: 300,
        views: 0,
        likes: 10,
        comments: 1,
        replies: 0,
        shares: 0,
        reposts: 0,
        saves: 4,
        profile_visits: 4,
        follows: 0,
        link_clicks: 1,
      },
    },
  ]);

  assert.equal(summary.total_posts, 2);
  assert.equal(summary.total_impressions, 1500);
  assert.equal(summary.total_engagements, 125);
  assert.equal(summary.average_engagement_rate, 8.3);
  assert.equal(summary.top_exposure_post?.id, 'p1');
  assert.equal(summary.top_engagement_post?.id, 'p1');
});
