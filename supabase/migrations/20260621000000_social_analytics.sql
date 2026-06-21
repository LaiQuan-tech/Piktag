-- Social publishing analytics for PikTag admin.
-- Apply in Supabase SQL editor before using /social-analytics live writes.

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram', 'threads')),
  handle text not null,
  display_name text,
  profile_url text,
  external_account_id text,
  access_status text not null default 'manual' check (access_status in ('connected', 'manual', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, handle)
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram', 'threads')),
  handle text not null default '@pik.tag',
  account_id uuid references public.social_accounts(id) on delete set null,
  external_post_id text,
  post_url text,
  content text not null,
  content_preview text not null generated always as (left(regexp_replace(content, '\s+', ' ', 'g'), 140)) stored,
  content_type text not null default 'thread' check (content_type in ('thread', 'image', 'carousel', 'reel', 'story', 'other')),
  content_pillar text not null default 'other' check (content_pillar in ('ai_building', 'product_thinking', 'founder_story', 'tutorial', 'launch_update', 'community_question', 'other')),
  campaign text,
  hook text,
  cta text,
  status text not null default 'published' check (status in ('draft', 'scheduled', 'published', 'failed')),
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_posts_platform_published_idx on public.social_posts(platform, published_at desc);
create index if not exists social_posts_status_idx on public.social_posts(status);
create index if not exists social_posts_content_pillar_idx on public.social_posts(content_pillar);

create table if not exists public.social_post_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  impressions integer not null default 0,
  reach integer not null default 0,
  views integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  replies integer not null default 0,
  shares integer not null default 0,
  reposts integer not null default 0,
  saves integer not null default 0,
  profile_visits integer not null default 0,
  follows integer not null default 0,
  link_clicks integer not null default 0,
  engagement_rate numeric(8,2),
  save_rate numeric(8,2),
  share_rate numeric(8,2),
  click_rate numeric(8,2),
  raw_metrics jsonb
);

create index if not exists social_post_metric_snapshots_post_captured_idx
  on public.social_post_metric_snapshots(post_id, captured_at desc);

alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_metric_snapshots enable row level security;

-- Admin API uses the service-role Supabase client and bypasses RLS.
-- If direct dashboard reads are needed later, add explicit admin policies.

insert into public.social_accounts (platform, handle, display_name, profile_url, access_status)
values
  ('threads', '@pik.tag', 'PikTag', 'https://www.threads.com/@pik.tag', 'manual'),
  ('instagram', '@pik.tag', 'PikTag', 'https://www.instagram.com/pik.tag/', 'manual')
on conflict (platform, handle) do nothing;
