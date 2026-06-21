# Social Platform API Sync

PikTag `/social-analytics` keeps its own ledger in Supabase (`social_posts` + `social_post_metric_snapshots`). Threads/Instagram posts do **not** appear automatically unless we import them through this sync endpoint or manually create a ledger row.

## Admin endpoint

```txt
POST /api/admin/social-posts/sync
```

Body:

```json
{ "platform": "threads" }
```

`platform` can be:

- `threads`
- `instagram`
- `all`

The endpoint imports recent platform posts, upserts them into `social_posts`, then appends one `social_post_metric_snapshots` row per post using the official insights response.

## Required environment variables

### Threads

```txt
THREADS_ACCESS_TOKEN=<long-lived Threads access token>
THREADS_USER_ID=me                 # optional; defaults to me
```

The token must have access to the `@pik.tag` Threads account and permissions/scopes required for reading Threads media + insights.

### Instagram

```txt
INSTAGRAM_ACCESS_TOKEN=<Meta Graph API token>
INSTAGRAM_BUSINESS_ACCOUNT_ID=<Instagram professional account id>
```

The IG account must be a professional/business account connected to Meta Graph API, with permissions for media reads and insights.

## Behavior without credentials

If credentials are missing, the endpoint returns a successful JSON payload with `status: "skipped"` and `missing_credentials`. The admin UI displays the missing env names and keeps manual metrics entry available.

## Current metric mapping

Threads insights:

- `views` → `views` + fallback `impressions`
- `likes` → `likes`
- `replies` → `replies`
- `reposts` → `reposts`
- `shares` → `shares`

Instagram insights:

- `impressions` → `impressions`
- `reach` → `reach`
- `views`/`plays` → `views`
- `likes` → `likes`
- `comments` → `comments` + `replies`
- `shares` → `shares`
- `saved`/`saves` → `saves`
- `profile_visits` → `profile_visits`
- `follows` → `follows`
- `website_clicks`/`link_clicks` → `link_clicks`

Raw API responses are preserved in `raw_metrics` for debugging and future remapping.
