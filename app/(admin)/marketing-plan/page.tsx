import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  FileText,
  Flame,
  Hash,
  Instagram,
  MessageCircle,
  Search,
  Sparkles,
  Target,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

type Platform = 'IG' | 'Threads' | 'IG + Threads' | 'Partnership' | '素材' | '成效追蹤' | '產品漏斗' | '營運';
type Priority = 'P0' | 'P1';

type PlanCard = {
  title: string;
  platform: Platform;
  priority: Priority;
  format: string;
  hook: string;
  bullets: string[];
  cta?: string;
};

type WeekPlan = {
  id: string;
  title: string;
  goal: string;
  icon: LucideIcon;
  accent: string;
  cards: PlanCard[];
};

const positioning = [
  'PikTag = 你的社交記憶助理，不是另一個 CRM。',
  '忘記名字沒關係，只要記得他是誰、會什麼、在哪認識，PikTag 幫你找回來。',
  '所有內容都導向 tag → search → connect，而不是滑更久。',
];

const targetAudiences = [
  {
    title: '創業者 / 新創圈 / 投資圈',
    text: '常跑活動，需要快速找到設計師、工程師、投資人、會計師。',
  },
  {
    title: '活動咖 / 社群經營者',
    text: '一場活動認識 10–30 人，最怕三天後只剩大頭貼。',
  },
  {
    title: '創作者 / 設計師 / 自由工作者',
    text: '需要被需求找到，不只靠職稱，而靠標籤身份。',
  },
];

const slogans = [
  '忘記名字，也找得到人。',
  '不用名字找人，用需求找人。',
  '你不是記性差，是通訊錄太笨。',
  'Tag yourself. Find anyone.',
  'Pick. Tag. Connect.',
];

const weekPlans: WeekPlan[] = [
  {
    id: 'week-1',
    title: 'Week 1｜教育市場：社交失憶痛點',
    goal: '先打痛點，不先打功能，讓受眾知道「原來我需要這個」。',
    icon: Flame,
    accent: 'from-rose-500 to-[#8c52ff]',
    cards: [
      {
        title: '你不是忘記他，你只是忘記名字',
        platform: 'IG',
        priority: 'P0',
        format: 'Reel 15–30 秒',
        hook: '活動現場有人走來：「欸，好久不見！」主角腦袋空白。',
        bullets: ['主角記得：設計師 / 台北 / 養貓', '打開 PikTag 搜尋 #設計師 #台北 #養貓', '找到對方，化解尷尬'],
        cta: '你最近一次忘記別人名字是什麼時候？',
      },
      {
        title: '你的通訊錄壞掉了',
        platform: 'IG',
        priority: 'P0',
        format: 'Carousel 7 頁',
        hook: '通訊錄只記得名字和電話，但人類記人靠的是上下文。',
        bullets: ['他會什麼', '在哪認識', '聊過什麼', 'PikTag 用標籤管理人脈'],
        cta: '存起來，傳給活動後常忘記人的朋友。',
      },
      {
        title: '人類不是用名字記人',
        platform: 'Threads',
        priority: 'P0',
        format: '短文',
        hook: '我們其實不是忘記人，只是忘記名字。',
        bullets: ['但我們記得他是設計師、住台北、養貓', '所以通訊錄用名字搜尋，本來就是錯的', '人類記人，是靠標籤'],
      },
      {
        title: '活動後加 20 個 IG，三天後全忘',
        platform: 'IG',
        priority: 'P0',
        format: 'Reel',
        hook: '加 IG 不是人脈管理，記得對方是誰才是。',
        bullets: ['活動現場瘋狂加 IG / LinkedIn', '三天後只剩頭像，不知道誰是誰', 'PikTag QR 交換時保留活動與話題標籤'],
      },
    ],
  },
  {
    id: 'week-2',
    title: 'Week 2｜功能展示：Tag / Search / QR / Ask',
    goal: '把共鳴轉成「我想試」，用短 demo 讓人看懂產品 loop。',
    icon: Zap,
    accent: 'from-[#8c52ff] to-[#aa00ff]',
    cards: [
      {
        title: 'Tag yourself｜如果別人要找你，他會搜什麼？',
        platform: 'IG',
        priority: 'P0',
        format: 'Reel',
        hook: '你的 10 個標籤，比履歷更像你。',
        bullets: ['展示 #創業者 #AI工具 #設計思考 #台北', 'PikTag AI 從 bio 推薦 tags', '完成 profile'],
        cta: '留言你的 3 個標籤。',
      },
      {
        title: 'Search by need｜不要搜尋名字，搜尋你需要什麼',
        platform: 'IG',
        priority: 'P0',
        format: 'Reel',
        hook: '「我需要懂攝影的朋友」→ PikTag 找出 tagged people。',
        bullets: ['輸入需求', '點開 profile 看共同標籤', 'AI icebreaker 建議開場'],
      },
      {
        title: 'QR 交換｜不只是加好友，是保存上下文',
        platform: 'IG',
        priority: 'P0',
        format: 'Reel',
        hook: 'QR 不是交換聯絡方式而已，是交換可被記住的上下文。',
        bullets: ['活動現場互掃 PikTag QR', '交換 IG / LinkedIn / phone', '加 private tag：#2026AI聚會 #聊過短影音'],
      },
      {
        title: 'PikTag 不追求停留時間',
        platform: 'Threads',
        priority: 'P1',
        format: '產品哲學短文',
        hook: 'PikTag 不想讓你滑更久，而是更快找到對的人。',
        bullets: ['search → find the right person → message → leave', '這才是人脈工具該有的形狀'],
      },
    ],
  },
  {
    id: 'week-3',
    title: 'Week 3｜場景化：創業者、活動咖、創作者',
    goal: '找第一批真正會用的人，把產品放進具體場景。',
    icon: Users,
    accent: 'from-indigo-500 to-purple-500',
    cards: [
      {
        title: '創業者如何用 PikTag',
        platform: 'IG',
        priority: 'P0',
        format: 'Carousel',
        hook: '創業者不缺名片，缺「需要時找得到誰」。',
        bullets: ['找設計師 / 工程師 / 投資人 / 會計師', '用 tags 定義你的 network', '用 Ask 廣播需求'],
        cta: '下次 Demo Day 前，先準備你的 PikTag QR。',
      },
      {
        title: '活動咖如何用 PikTag',
        platform: 'IG',
        priority: 'P0',
        format: 'Carousel',
        hook: '一場活動認識 20 人，真正記住幾個？',
        bullets: ['加 IG 不等於人脈管理', '掃 QR 時保留上下文', '活動後用 tag 找回'],
      },
      {
        title: '創作者 / 自由工作者如何被找到',
        platform: 'IG',
        priority: 'P1',
        format: 'Carousel',
        hook: '不要只寫 Designer，讓需求用標籤找到你。',
        bullets: ['#品牌設計 #AI工具 #插畫', '你的 tags 是更實用的個人 SEO', 'Tag yourself = 讓需求找到你'],
      },
      {
        title: '找 10 個活動主辦 / 社群合作',
        platform: 'Partnership',
        priority: 'P1',
        format: '合作清單',
        hook: '拿到第一批真實場景與截圖。',
        bullets: ['列出 10 個創業 / AI / 設計社群', '私訊主辦提供 PikTag QR', '活動後產出案例貼文'],
      },
    ],
  },
  {
    id: 'week-4',
    title: 'Week 4｜UGC：#My10Tags Challenge',
    goal: '讓用戶自己教育市場，形成 tag identity 的社群語言。',
    icon: Hash,
    accent: 'from-fuchsia-500 to-rose-500',
    cards: [
      {
        title: '#My10Tags Challenge 活動企劃',
        platform: 'IG + Threads',
        priority: 'P0',
        format: 'Campaign',
        hook: '如果只能用 10 個標籤定義你，你會選哪 10 個？',
        bullets: ['用 10 個 tags 介紹自己', '不准只寫職稱', '標記 PikTag 並提名 3 位朋友'],
      },
      {
        title: 'My 10 Tags Story 模板',
        platform: 'IG',
        priority: 'P0',
        format: 'Story Template',
        hook: '截圖填寫，標記 @piktag。',
        bullets: ['紫色品牌底', '保留 10 個空格', '中英版本各一'],
      },
      {
        title: 'Challenge 啟動貼文',
        platform: 'Threads',
        priority: 'P0',
        format: '短文互動',
        hook: '用 10 個標籤介紹你自己。不准用職稱。',
        bullets: ['示範 #創業者 #AI工具 #產品設計 #台北', '引導留言接龍', 'Hashtag：#My10Tags'],
      },
      {
        title: '收集並轉發前 20 位用戶 tags',
        platform: 'IG + Threads',
        priority: 'P1',
        format: 'UGC Ops',
        hook: '把早期用戶變成內容素材。',
        bullets: ['每天查看 tag / mention', '轉發高質感 Story', '挑 5 位做成 PikTag People carousel'],
      },
    ],
  },
];

const assets = [
  {
    icon: Clapperboard,
    title: '15 秒 App Demo 影片',
    text: 'QR 交換、Tag yourself、Search by need、Ask broadcast；9:16、1080x1920、無聲也能看懂。',
  },
  {
    icon: FileText,
    title: 'Carousel 品牌模板 5 套',
    text: '痛點教育、功能拆解、場景案例、平台對比、UGC Challenge。',
  },
  {
    icon: Sparkles,
    title: 'Miranda / 社交記憶助理概念影片',
    text: '借用「耳邊助理」情境，不直接使用電影素材，避免版權問題。',
  },
];

const kpis = [
  'IG：Reels 3 秒留存率、Saves / Shares、Story replies、Link in bio CTR。',
  'Threads：Replies、Reposts、Quotes、是否有人主動貼自己的 tags。',
  '產品 activation：24 小時內完成 3 個 self-tags + 1 個 connection/contact。',
];

const platformStyle: Record<Platform, string> = {
  IG: 'bg-pink-50 text-pink-700 ring-pink-100',
  Threads: 'bg-slate-100 text-slate-700 ring-slate-200',
  'IG + Threads': 'bg-violet-50 text-violet-700 ring-violet-100',
  Partnership: 'bg-amber-50 text-amber-700 ring-amber-100',
  素材: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  成效追蹤: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  產品漏斗: 'bg-blue-50 text-blue-700 ring-blue-100',
  營運: 'bg-orange-50 text-orange-700 ring-orange-100',
};

function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${platformStyle[platform]}`}>
      {platform}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const cls = priority === 'P0'
    ? 'bg-red-50 text-red-700 ring-red-100'
    : 'bg-slate-50 text-slate-600 ring-slate-200';
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`}>{priority}</span>;
}

function PlanCardView({ card }: { card: PlanCard }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PlatformBadge platform={card.platform} />
        <PriorityBadge priority={card.priority} />
        <span className="rounded-full bg-[#faf5ff] px-2.5 py-1 text-xs font-semibold text-[#8c52ff] ring-1 ring-purple-100">
          {card.format}
        </span>
      </div>
      <h3 className="text-base font-bold text-slate-950">{card.title}</h3>
      <p className="mt-2 text-sm font-medium leading-6 text-slate-700">{card.hook}</p>
      <ul className="mt-4 space-y-2 text-sm text-slate-600">
        {card.bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#8c52ff]" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      {card.cta ? (
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
          CTA：{card.cta}
        </div>
      ) : null}
    </article>
  );
}

export default function MarketingPlanPage() {
  return (
    <div className="space-y-8 pb-10">
      <header className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-sm">
        <div className="relative p-8 sm:p-10">
          <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-[#aa00ff]/30 blur-3xl" />
          <div className="absolute bottom-0 right-36 h-40 w-40 rounded-full bg-[#ff5757]/20 blur-3xl" />
          <div className="relative max-w-4xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-purple-100 ring-1 ring-white/15">
              <CalendarDays className="h-4 w-4" />
              PikTag Marketing Command Center
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">IG + Threads 發文規劃</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              用卡片方式整理 4 週內容節奏、平台分工、腳本 hook、CTA、素材與 KPI，方便每天打開後台就知道下一篇要發什麼。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {slogans.map((slogan) => (
                <span key={slogan} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/10">
                  {slogan}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]">
              <Target className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">核心定位</h2>
              <p className="text-xs text-slate-500">所有貼文都要回到這三句</p>
            </div>
          </div>
          <ul className="space-y-3">
            {positioning.map((item) => (
              <li key={item} className="flex gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#8c52ff]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]">
              <Instagram className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">平台分工</h2>
              <p className="text-xs text-slate-500">IG 視覺化，Threads 觀點化</p>
            </div>
          </div>
          <div className="space-y-3 text-sm text-slate-700">
            <p><strong>IG：</strong>Reels、Carousel、Demo、UGC 模板，負責讓人一眼看懂並想下載。</p>
            <p><strong>Threads：</strong>創辦人觀點、產品哲學、痛點短文，負責共鳴與討論。</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {targetAudiences.map((audience) => (
          <div key={audience.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]">
              <Users className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-950">{audience.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{audience.text}</p>
          </div>
        ))}
      </section>

      {weekPlans.map((week) => {
        const Icon = week.icon;
        return (
          <section key={week.id} className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${week.accent} text-white shadow-sm`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-950">{week.title}</h2>
                </div>
                <p className="max-w-3xl text-sm text-slate-600">{week.goal}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {week.cards.map((card) => (
                <PlanCardView key={`${week.id}-${card.title}`} card={card} />
              ))}
            </div>
          </section>
        );
      })}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">素材製作</h2>
              <p className="text-xs text-slate-500">先做會重複使用的素材</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {assets.map((asset) => {
              const Icon = asset.icon;
              return (
                <div key={asset.title} className="rounded-2xl bg-slate-50 p-4">
                  <Icon className="h-5 w-5 text-[#8c52ff]" />
                  <h3 className="mt-3 font-bold text-slate-950">{asset.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{asset.text}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">KPI</h2>
              <p className="text-xs text-slate-500">不是只看追蹤數</p>
            </div>
          </div>
          <ul className="space-y-3">
            {kpis.map((kpi) => (
              <li key={kpi} className="flex gap-2 text-sm leading-6 text-slate-700">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#8c52ff]" />
                {kpi}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-950">每週復盤問題</h2>
            <p className="mt-1 text-sm text-slate-500">每週用這 5 題決定下週內容 backlog。</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-5">
          {[
            '哪種痛點內容 saves / shares 最高？',
            '哪種 CTA 帶來最多 tag replies？',
            '哪個受眾最有反應？',
            '導流後是否完成 self-tags？',
            '有沒有真實故事可做 case study？',
          ].map((question) => (
            <div key={question} className="rounded-xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">
              <MessageCircle className="mb-3 h-5 w-5 text-[#8c52ff]" />
              {question}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
