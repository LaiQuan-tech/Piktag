import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  FileText,
  Flame,
  Hash,
  Instagram,
  Lightbulb,
  MessageCircle,
  Rocket,
  Sparkles,
  Target,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

type Platform = 'Threads' | 'IG' | 'IG + Threads' | '營運';
type Priority = 'P0' | 'P1';
type Status = '待製作' | '已發佈' | '排程中' | '觀察中';

type ContentPillar = {
  title: string;
  ratio: string;
  goal: string;
  examples: string[];
  icon: LucideIcon;
};

type SeriesPost = {
  ep: string;
  title: string;
  angle: string;
  cta: string;
  status: Status;
};

type CalendarItem = {
  day: string;
  focus: string;
  posts: Array<{
    time: string;
    platform: Platform;
    title: string;
    format: string;
    priority: Priority;
    status: Status;
    metric: string;
  }>;
};

const positioning = [
  '主定位：兩個 PM 的 AI 造物日記。',
  '核心故事：兩個非傳統工程背景的 PM，用 AI 從 0 做出 PikTag。',
  '內容承諾：公開記錄 AI 開發、產品判斷、踩坑、prompt、上線歷程，讓讀者一邊學 AI，一邊認識 PikTag。',
  '產品角色：PikTag 是我們用 AI 做出來的「社交記憶層」，不是另一個通訊錄或 CRM。',
];

const voiceRules = [
  '真實：可以寫卡住、重做、吵架、AI 寫錯，不要只寫成功。',
  '可學習：每篇至少帶走一個 AI / PM / 產品方法。',
  '不裝懂：用「我們今天發現」「我們原本以為」「結果 AI 做錯了」取代官方公告。',
  '少硬賣：先讓大家追故事，再讓大家自然想試 PikTag。',
];

const bios = [
  '兩個 PM 的 AI 造物日記。\n我們正在用 AI 做出 PikTag：你的社交記憶層。\npikt.ag｜Tag yourself. Find anyone.',
  '兩個 PM 用 AI 從 0 做 PikTag。\n記錄 AI 開發、產品思考、踩坑與上線過程。\npikt.ag',
  '跟著兩個 PM 學 AI 做產品。\n從 0 開發 PikTag，記錄 prompt、踩坑、產品決策。\npikt.ag',
];

const pillars: ContentPillar[] = [
  {
    title: 'AI 開發日記',
    ratio: '40%',
    goal: '吸引 AI 學習者、PM、創業者，建立「追連載」的理由。',
    examples: ['今天用 AI 做了什麼', 'AI 哪裡很強 / 哪裡會亂來', '怎麼跟 Claude / Cursor / Codex 協作', '非工程師如何驗收 AI 寫的程式'],
    icon: Zap,
  },
  {
    title: '產品思考',
    ratio: '25%',
    goal: '讓讀者理解 PikTag 為什麼存在，而不是只看到功能。',
    examples: ['為什麼人脈需要 tags', '為什麼通訊錄不好用', '社交記憶是什麼', '活動後關係為什麼會斷掉'],
    icon: Lightbulb,
  },
  {
    title: '創辦人故事',
    ratio: '20%',
    goal: '建立真實感，讓使用者先認識人，再認識產品。',
    examples: ['兩個 PM 為什麼開始', '決策分歧與熬夜修 bug', '第一次看到 App 跑起來', '第一次覺得真的有人需要'],
    icon: Users,
  },
  {
    title: 'AI 知識教學',
    ratio: '15%',
    goal: '提供收藏價值，讓讀者把帳號當成 AI 做產品筆記。',
    examples: ['PM 如何寫 prompt', '如何讓 AI 不亂改', '怎麼拆 MVP 給 AI', '怎麼建立 AI 開發 SOP'],
    icon: BookOpenText,
  },
];

const seriesPosts: SeriesPost[] = [
  { ep: 'EP.01', title: '我們是兩個 PM，正在用 AI 做 PikTag', angle: '人設開場 + 為什麼做社交記憶產品', cta: '如果你也常在活動後忘記人，留言「我需要」。', status: '已發佈' },
  { ep: 'EP.02', title: '為什麼我們不想做另一個通訊錄', angle: '通訊錄只存資料，但人靠情境記憶', cta: '你最常靠什麼線索想起一個人？', status: '待製作' },
  { ep: 'EP.03', title: 'AI 開發第一課：先描述問題，不要先寫 code', angle: 'AI 會放大定義能力，也會放大混亂', cta: '存起來，下次開發前先問這 5 題。', status: '待製作' },
  { ep: 'EP.04', title: '兩個 PM 不會傳統寫 code，要怎麼驗收 AI？', angle: 'PM 驗收 AI code 的流程：規格、畫面、測試、邊界條件', cta: '想看我們的 AI 驗收清單可以留言。', status: '待製作' },
  { ep: 'EP.05', title: '為什麼 PikTag 的核心不是聯絡人，而是 tags', angle: '人不是被姓名記住，而是被情境與能力記住', cta: '用三個 tags 介紹你自己。', status: '待製作' },
  { ep: 'EP.06', title: 'AI 幫我們省了時間，但沒有幫我們省思考', angle: 'AI 是加速器，不是產品判斷的替代品', cta: '你覺得 AI 最該省下哪一段工作？', status: '待製作' },
  { ep: 'EP.07', title: '第一次看到 PikTag 跑起來的瞬間', angle: '從抽象想法到可操作產品的情緒故事', cta: '想參與 beta 的人可以留言。', status: '待製作' },
  { ep: 'EP.08', title: '用 AI 做產品，最重要的不是 prompt，是判斷力', angle: 'prompt 是操作，判斷力才是方向盤', cta: '分享給正在用 AI 做產品的朋友。', status: '待製作' },
  { ep: 'EP.09', title: '我們怎麼把一個功能拆給 AI 做', angle: '從 user flow → data → UI state → edge case', cta: '留言想看哪個功能的拆解。', status: '待製作' },
  { ep: 'EP.10', title: 'PikTag beta：我們想找第一批真的會用的人', angle: '從故事轉 beta 招募', cta: '常跑活動、常認識新朋友的人，留言「beta」。', status: '待製作' },
];

const firstPost = `《兩個 PM 用 AI 做 PikTag》EP.01\n\n我們是兩個 PM，不是傳統工程團隊。\n\n但我們正在用 AI 從 0 做一個產品：PikTag。\n\n它想解決一個很小但很真實的問題：\n你在活動、聚會、會議中認識很多人，\n但幾週後，你常常忘了對方是誰、當時聊了什麼。\n\n所以我們想做一個「社交記憶層」。\n\n不是另一個通訊錄。\n不是另一個 CRM。\n\n而是一個可以用 tags 幫你記住人、找回關係、重新開口的工具。\n\n這個帳號會記錄我們用 AI 做產品的完整過程：\n\n1. 我們怎麼把想法拆成 MVP\n2. 怎麼用 AI 寫 code / 改 UI / 修 bug\n3. AI 哪裡幫了大忙，哪裡又很會亂來\n4. 兩個 PM 怎麼判斷產品方向\n5. PikTag 怎麼一步一步被做出來\n\n我們想把這段歷程公開寫下來。\n\n如果你也想學 AI 做產品，\n或你也常在活動後忘記誰是誰，\n歡迎一起看我們把 PikTag 做出來。\n\nTag yourself. Find anyone.`;

const calendar: CalendarItem[] = [
  {
    day: 'Day 1',
    focus: '人設開場：兩個 PM 的 AI 造物日記',
    posts: [
      { time: '20:30', platform: 'Threads', title: 'EP.01｜我們是兩個 PM，正在用 AI 做 PikTag', format: '連載長文', priority: 'P0', status: '已發佈', metric: '目標：Replies ≥ 10 / Reposts ≥ 5 / Profile clicks ≥ 20' },
      { time: '隔日 12:30', platform: 'IG', title: '兩個 PM 用 AI 做 PikTag', format: 'Carousel 7 頁', priority: 'P0', status: '待製作', metric: '目標：Saves ≥ 30 / Shares ≥ 15' },
    ],
  },
  {
    day: 'Day 2',
    focus: '產品問題：不是通訊錄，是社交記憶',
    posts: [
      { time: '12:30', platform: 'Threads', title: 'PikTag 想解決的不是通訊錄問題', format: '產品洞察短文', priority: 'P0', status: '待製作', metric: '目標：Replies ≥ 8 / Saves-like reposts ≥ 5' },
      { time: '20:30', platform: 'IG', title: '你的通訊錄壞掉了', format: 'Carousel', priority: 'P0', status: '待製作', metric: '目標：Saves ≥ 30 / Shares ≥ 15' },
    ],
  },
  {
    day: 'Day 3',
    focus: 'AI 開發第一課',
    posts: [
      { time: '12:30', platform: 'Threads', title: '不要一開始就叫 AI 寫 code', format: '教學短文', priority: 'P0', status: '待製作', metric: '目標：Reposts ≥ 8 / Replies ≥ 10' },
      { time: '20:30', platform: 'Threads', title: 'AI 不會替你定義產品', format: '金句短文', priority: 'P1', status: '待製作', metric: '目標：Quotes ≥ 3' },
    ],
  },
  {
    day: 'Day 4',
    focus: 'Tags 產品哲學',
    posts: [
      { time: '12:30', platform: 'Threads', title: '為什麼是 tags？', format: '產品洞察', priority: 'P0', status: '待製作', metric: '目標：留言自己的 3 tags ≥ 15' },
      { time: '20:30', platform: 'IG', title: '用三個 tags 介紹你自己', format: 'Story / Carousel', priority: 'P1', status: '待製作', metric: '目標：Story replies ≥ 10' },
    ],
  },
  {
    day: 'Day 5',
    focus: 'PM + AI 的優勢',
    posts: [
      { time: '12:30', platform: 'Threads', title: 'AI 負責加速，PM 負責判斷', format: '觀點短文', priority: 'P0', status: '待製作', metric: '目標：Reposts ≥ 8 / Replies ≥ 10' },
      { time: '20:30', platform: 'IG + Threads', title: '本週學到的 5 個 AI 產品開發教訓', format: '週回顧', priority: 'P1', status: '待製作', metric: '目標：Saves ≥ 20 / Replies ≥ 8' },
    ],
  },
];

const kpis = [
  'Threads：Replies、Reposts、Quotes、Profile clicks，尤其追蹤是否有人主動說「想看下一篇」。',
  'IG：Carousel saves / shares、Reels 3 秒留存、Story replies、Link in bio CTR。',
  '產品轉換：導流後是否完成 3 個 self-tags + 1 個 connection/contact。',
  '品牌資產：是否讓 PikTag 和「兩個 PM 用 AI 做產品」形成穩定聯想。',
];

const statusStyle: Record<Status, string> = {
  待製作: 'bg-slate-100 text-slate-700 ring-slate-200',
  排程中: 'bg-amber-50 text-amber-700 ring-amber-100',
  已發佈: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  觀察中: 'bg-blue-50 text-blue-700 ring-blue-100',
};

const platformStyle: Record<Platform, string> = {
  Threads: 'bg-slate-100 text-slate-700 ring-slate-200',
  IG: 'bg-pink-50 text-pink-700 ring-pink-100',
  'IG + Threads': 'bg-violet-50 text-violet-700 ring-violet-100',
  營運: 'bg-orange-50 text-orange-700 ring-orange-100',
};

function PlatformBadge({ platform }: { platform: Platform }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${platformStyle[platform]}`}>{platform}</span>;
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusStyle[status]}`}>{status}</span>;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const cls = priority === 'P0' ? 'bg-red-50 text-red-700 ring-red-100' : 'bg-slate-50 text-slate-600 ring-slate-200';
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`}>{priority}</span>;
}

export default function MarketingPlanPage() {
  return (
    <div className="space-y-8 pb-10">
      <header className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-sm">
        <div className="relative p-8 sm:p-10">
          <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-[#aa00ff]/30 blur-3xl" />
          <div className="absolute bottom-0 right-36 h-40 w-40 rounded-full bg-[#ff5757]/20 blur-3xl" />
          <div className="relative max-w-5xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-purple-100 ring-1 ring-white/15">
              <Sparkles className="h-4 w-4" />
              PikTag Founder Story Engine
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">兩個 PM 的 AI 造物日記</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              Threads 主打創辦人故事與 AI 開發歷程；IG 主打視覺化、Carousel、Demo 與 beta 導流。核心不是硬賣 App，而是讓大家追著看兩個 PM 如何用 AI 把 PikTag 做出來。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['#AI產品實驗者', '#兩個PM創業', '#BuildingInPublic', '#AI開發日記', '#社交記憶產品'].map((tag) => (
                <span key={tag} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/10">{tag}</span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><Target className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">人設定位</h2>
              <p className="text-xs text-slate-500">所有內容都要回到這四句</p>
            </div>
          </div>
          <ul className="space-y-3">
            {positioning.map((item) => (
              <li key={item} className="flex gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#8c52ff]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><Instagram className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">平台分工</h2>
              <p className="text-xs text-slate-500">IG 視覺化，Threads 故事化</p>
            </div>
          </div>
          <div className="space-y-3 text-sm leading-6 text-slate-700">
            <p><strong>Threads：</strong>創辦人日記、AI 開發過程、產品判斷、踩坑、連載。</p>
            <p><strong>IG：</strong>Carousel、Reels、Story 模板、Demo 截圖，把觀點視覺化並導流。</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><MessageCircle className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-950">帳號語氣規則</h2>
            <p className="text-xs text-slate-500">避免官方公告，維持真實連載感</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {voiceRules.map((rule) => (
            <div key={rule} className="rounded-xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">{rule}</div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {pillars.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <article key={pillar.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><Icon className="h-5 w-5" /></div>
                <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">{pillar.ratio}</span>
              </div>
              <h3 className="font-bold text-slate-950">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{pillar.goal}</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {pillar.examples.map((example) => (
                  <li key={example} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#8c52ff]" />{example}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8c52ff] to-[#ff5757] text-white shadow-sm"><CalendarDays className="h-5 w-5" /></div>
              <div>
                <h2 className="text-2xl font-bold text-slate-950">前 5 天發文節奏</h2>
                <p className="text-sm text-slate-500">先建立人設與故事，再轉產品理解與互動。</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold text-slate-500">發文頻率</p><p className="mt-1 text-sm font-bold text-slate-950">每天 2–3 則</p></div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold text-slate-500">主戰場</p><p className="mt-1 text-sm font-bold text-slate-950">Threads 連載</p></div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold text-slate-500">下一步</p><p className="mt-1 text-sm font-bold text-slate-950">Beta 招募</p></div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
          {calendar.map((day) => (
            <article key={day.day} className="flex min-h-[360px] flex-col rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 rounded-xl bg-white p-3 shadow-sm">
                <p className="text-xs font-semibold text-[#8c52ff]">{day.day}</p>
                <h3 className="mt-1 text-sm font-bold leading-5 text-slate-950">{day.focus}</h3>
              </div>
              <div className="flex flex-1 flex-col gap-3">
                {day.posts.map((post) => (
                  <div key={`${day.day}-${post.time}-${post.title}`} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-950 px-2 py-1 text-[11px] font-bold text-white">{post.time}</span>
                      <PlatformBadge platform={post.platform} />
                      <PriorityBadge priority={post.priority} />
                      <StatusBadge status={post.status} />
                    </div>
                    <h4 className="text-sm font-bold leading-5 text-slate-950">{post.title}</h4>
                    <p className="mt-1 text-xs font-semibold text-[#8c52ff]">{post.format}</p>
                    <div className="mt-3 rounded-xl bg-[#faf5ff] px-3 py-2 text-xs leading-5 text-slate-700">{post.metric}</div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><FileText className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-950">《兩個 PM 用 AI 做 PikTag》前 10 篇連載</h2>
            <p className="text-xs text-slate-500">Threads 長文主線；每篇都包含故事、AI/產品洞察與 CTA。</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {seriesPosts.map((post) => (
            <article key={post.ep} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-bold text-white">{post.ep}</span>
                <StatusBadge status={post.status} />
              </div>
              <h3 className="font-bold text-slate-950">{post.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">角度：{post.angle}</p>
              <p className="mt-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-700">CTA：{post.cta}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-emerald-700"><Rocket className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-bold text-emerald-950">第一篇 Threads 文案</h2>
            <p className="text-xs text-emerald-700">狀態：已放入發佈流程；發佈後追蹤 replies / reposts / profile clicks。</p>
          </div>
        </div>
        <pre className="whitespace-pre-wrap rounded-2xl bg-white p-5 text-sm leading-7 text-slate-800 ring-1 ring-emerald-100">{firstPost}</pre>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><Hash className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">Threads Bio 備選</h2>
              <p className="text-xs text-slate-500">優先使用第一版，其他可 A/B test。</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {bios.map((bio, index) => (
              <pre key={bio} className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">版本 {index + 1}\n\n{bio}</pre>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><BarChart3 className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">KPI</h2>
              <p className="text-xs text-slate-500">不是只看追蹤數</p>
            </div>
          </div>
          <ul className="space-y-3">
            {kpis.map((kpi) => (
              <li key={kpi} className="flex gap-2 text-sm leading-6 text-slate-700"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#8c52ff]" />{kpi}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf5ff] text-[#8c52ff]"><Flame className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-950">每週復盤問題</h2>
            <p className="mt-1 text-sm text-slate-500">每週用這 5 題決定下週內容 backlog。</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-5">
          {['哪篇讓最多人留言「想看下一篇」？', 'AI 教學內容有沒有被收藏 / 轉發？', '讀者對「兩個 PM」人設是否有共鳴？', '哪個產品痛點最能導流 PikTag？', '是否有人主動詢問 beta / 試用？'].map((question) => (
            <div key={question} className="rounded-xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">{question}</div>
          ))}
        </div>
      </section>
    </div>
  );
}
