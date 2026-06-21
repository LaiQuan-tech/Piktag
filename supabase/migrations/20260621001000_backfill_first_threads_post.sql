-- Backfill the first published PikTag Threads post into the social analytics ledger.
-- Metrics are initialized to zero because Threads impression/insight values are
-- not available unless we manually read them or connect the official insights API.

with inserted_post as (
  insert into public.social_posts (
    platform,
    handle,
    post_url,
    content,
    content_type,
    content_pillar,
    campaign,
    hook,
    cta,
    status,
    published_at,
    created_by
  )
  select
    'threads',
    '@pik.tag',
    'https://www.threads.com/@pik.tag',
    $post$《兩個 PM 用 AI 做 PikTag》EP.01

我們是兩個 PM，不是傳統工程團隊。

但我們正在用 AI 從 0 做一個產品：PikTag。

它想解決一個很小但很真實的問題：
你在活動、聚會、會議中認識很多人，
但幾週後，你常常忘了對方是誰、當時聊了什麼。

所以我們想做一個「社交記憶層」。

不是另一個通訊錄。
不是另一個 CRM。

而是一個可以用 tags 幫你記住人、找回關係、重新開口的工具。

這個帳號會記錄我們怎麼用 AI 做出 PikTag：
產品判斷、prompt、踩坑、開發流程、還有我們學到的事。

如果你也在用 AI 做產品，或你也常常忘記人——
歡迎一起看這個實驗長大。

Tag yourself. Find anyone.$post$,
    'thread',
    'ai_building',
    'launch_series',
    '兩個 PM 用 AI 做 PikTag',
    '歡迎一起看這個實驗長大',
    'published',
    now(),
    'Hermes backfill'
  where not exists (
    select 1
    from public.social_posts
    where platform = 'threads'
      and handle = '@pik.tag'
      and content_preview = left($post$《兩個 PM 用 AI 做 PikTag》EP.01

我們是兩個 PM，不是傳統工程團隊。

但我們正在用 AI 從 0 做一個產品：PikTag。

它想解決一個很小但很真實的問題：
你在活動、聚會、會議中認識很多人，
但幾週後，你常常忘了對方是誰、當時聊了什麼。

所以我們想做一個「社交記憶層」。

不是另一個通訊錄。
不是另一個 CRM。

而是一個可以用 tags 幫你記住人、找回關係、重新開口的工具。

這個帳號會記錄我們怎麼用 AI 做出 PikTag：
產品判斷、prompt、踩坑、開發流程、還有我們學到的事。

如果你也在用 AI 做產品，或你也常常忘記人——
歡迎一起看這個實驗長大。

Tag yourself. Find anyone.$post$, 160)
  )
  returning id
)
insert into public.social_post_metric_snapshots (
  post_id,
  impressions,
  reach,
  views,
  likes,
  comments,
  replies,
  shares,
  reposts,
  saves,
  profile_visits,
  follows,
  link_clicks
)
select id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
from inserted_post;
