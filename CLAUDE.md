# PikTag — Claude working memory(路由版,2026-07-06 重構)

> 每個 session 自動載入。本檔只放**每次都要遵守的硬規則**與**路由表**。
> 詳細脈絡、verbatim 引言、歷史決策都在 `docs/claude/ref-*.md` —— 路由表
> 寫明什麼情境要先讀哪份。舊版全文:`docs/claude/archive/CLAUDE-2026-07-06-full.md`。
> 制度怎麼維護:`docs/claude/40-MAINTENANCE.md`(改本檔前必讀)。

## North Star(創辦人指定,所有取捨的判準)

**PikTag 的核心 = AI 標籤推薦:在每個情境推薦「對的標籤」。** 標籤讓人
(1) 搜標籤**激活舊人脈**,(2) 跨語言概念匹配**連結新朋友**。優先序:
1. 把每個加好友機會優化到極致(QR、掃名片、搜尋、Ask、匯入、分享連結)。
2. 把非會員收進來、在他們身上建立好標籤資料(未來的緣分燃料),並促轉會員。

**怎麼用**:任何 trade-off,選(a)保護 AI 標籤品質與跨語言匹配、
(b)提高真實加好友/非會員轉化、(c)降低 `掃→標→連` 與 `搜標籤→激活`
兩條迴圈摩擦的那個選項。與 North Star 相悖的要求,**中肯地說出來**,
不要照單全收。反例教訓與 Meta 反模式全文 → `docs/claude/ref-tag-algorithm.md`。

## 硬規則(NEVER / MUST 級,違反即缺陷)

**溝通與判斷**
- **中肯**:創辦人要的是誠實修正,不是順從。要求與鎖定契約衝突時,引契約
  原文推回去。斷言前先驗證(查程式碼/DB),不確定就標註。
- **NO emoji,任何地方**:app 字串、通知、店面文案、對創辦人的回覆全禁。
  兩個刻意保留:電話國碼旗幟(countryCodes.ts)、功能性箭頭(A→Z、←→)。
- **絕不代按商店送審、絕不輸入帳密/金流資料**(創辦人授權也一樣拒絕)。
  改店面文案「草稿」可以;「送審/發布」按鈕永遠由創辦人自己按。

**產品鐵律**
- **速度是戰略紅線**:市面已有的功能(名片掃描、QR、匯入、即時搜尋)不夠快
  = 被當爛 app。辨識延遲不可容忍、推薦延遲可以 —— 掃描先秀欄位,AI 標籤
  async 後補。絕不把生成步驟放回掃描同步路徑。
- **輸入防呆二選一**:能遮罩就入口阻擋(BirthdayInput/normalizeUsername 型),
  不能就即時紅字回饋(isValidEmail 型)。**唯一缺陷是靜默丟棄**。
- **不對使用者暴露無脈絡分數**(標籤健康度 25/100 事件)。指標留 server-side。
- **CTA 三層制**:漸層(#ff5757→#c44dff→#8c52ff)= 招牌動作,每頁最多一顆;
  實心 piktag500 = 一般提交;外框 = 次要。piktag50 底按鈕層已廢除。
  每頁有一個「創辦人鎖定 CTA」的不得競爭其視覺權重(清單在 ref-founder-style)。
- **共用 UI = 一個共用元件**,禁止逐頁複製樣式(TagChip、InitialsAvatar、
  GradientButton、BoltIcon=AI 標示,不用 Sparkles)。
- **AI 標籤預設狀態不對稱**:掃名片(活動中)= 預選 opt-out;活動前配置
  (AddTag)= 灰色 opt-in。這是設計,不是不一致,不要「統一」。
- **免費/付費批次標籤界線(2026-09-09 創辦人改切)**:界線在「**怎麼選人**」,
  不在「能不能選」。免費 = 系統 cohort(爆發偵測、匯入分類)**+ 使用者手選**
  (好友列表選取模式);付費 = 條件選人(依標籤/地點/時間/未標籤者)、一次套
  多標籤、整批 AI 建議、匯出。**絕不把已免費的手選批次收回付費**(roadmap
  原則:免費層永遠完整可用,付費是升級不是解鎖基本功能)。**批次 UI 只有
  BatchTagScreen 一個**,任何新批次面都掛它的 mode,不另建畫面。
  (原記載「付費 = 使用者任選好友;絕不新增免費的任選好友批次入口」——
  2026-09-09 探測發現手選批次早已免費出貨於 ConnectionsScreen,規則描述的
  是不存在的現狀,創辦人裁決改切。)
- **通知四點檢查**:新 notification type 必須同 PR 落齊
  (1) is_notification_category_enabled 映射 (2) filterNotifications 分頁
  (3) KNOWN_NOTIFICATION_TYPES (4) i18n key ×19。且 **SQL body 絕不寫空字串**
  (英文 fallback 必填,i18n 是加強不是承重)。
- **排序/媒合面四點檢查**:(1) Connected 與 Recommended 分管線不混算
  (2) 搜尋不分區、瀏覽可分區 (3) 讀 piktag_match_dismissals(surface 有
  CHECK 約束,新面要先 ALTER)(4) **必排除 is_official**(人人自動好友
  @piktag,漏了 = FoF 爆炸)。v2 上線後加第 5 點 is_alt。
- **搜尋排序改動先過重放門檻**:`admin_search_funnel` 沒贏過現行排序,
  任何權重改動(含搜尋面 IDF)不准上線。主權重係數調整一律先看
  ref-tag-algorithm 的延後調參清單。
- **刪帳號契約**:新表的 user FK 必須 `ON DELETE CASCADE` 到 auth.users;
  任何新的 email/phone 重連結面必須沿用 delete-user 的 scrub(否則資料復活)。
- **通知/開關對層**:in-app 開關管 in-app,OS 的歸 OS,不要造跨層橋。
- **Onboarding 嚴格線性**:註冊→精靈 1→2→3,唯一出口是完成;只有頭像可跳過;
  啟動閘門不可 block 在網路上。
- **推播權限情境式索取**:啟動時只刷新 token(requestPermission:false),
  OS 詢問只在首次加好友成功/首開通知頁(maybeAskPushPermission 一次性)。

**Dark mode(全 app 已上)**
- 樣式一律 `useTheme()` + `makeStyles(colors)` + useMemo;每個用到 styles 的
  元件(含 React.memo 子元件)自己拿 hooks;memoized JSX 的 deps 必列
  styles/colors。**固定底色配固定前景色**(白底配 #111827,不配 colors.gray900
  —— 深色模式白字消失的經典錯)。品牌固定色(漸層、CONTACT_CORAL #ff5757)
  不隨主題變。

**品牌鎖定字**
- `Pick. Tag. Connect.` 全語系鎖英文,五面同步(landing hero.description
  ×19、SplashOverlay、QrGroupList header、scan.html、download.html ——
  動一處動全部)。hook line `Tag yourself. Find anyone.` **不對稱**:
  mobile brandTagline 鎖英文,但 landing hero.title1+title2 **逐語系在地化**
  (zh-TW「自己標自己,誰都找得到。」是創辦人核准的,不是違規,別修掉)。
  全文 → ref-founder-style.md 品牌節。主市場 = 北美:文案範例城市按市場
  在地化(en=Seattle,只有 zh-TW 留台北),絕不把台灣範例輸出到其他語系。
- @piktag 的標籤是教學面:任何調整保住維度覆蓋(身份/技能/興趣/MBTI),
  不可退回全口號。

## 工程機制(每次改動的操作規則)

- **Repo**:root = piktag-admin(Next.js,live);`mobile/` = RN app;
  `landing/` = Vite;只有頂層 `/src` 是舊物。`event-photobooth/` 等髒檔
  是**別的 session 的 WIP —— 絕不 stage**。
- **Git**:只 stage 明確路徑,禁 `git add -A`/`git add .`。push 被拒 →
  `git pull --rebase --autostash origin main`,rebase 後確認自己的 migration
  時間戳仍是尾巴。每次改動完成即 commit(先 tsc 0 錯);mobile 的 **push**
  合批 —— 觸發 TestFlight build 的是 push 不是 commit(每日上傳有上限)。
  push 後看 CI。
- **Migrations**:**只放 `mobile/supabase/migrations/`**(root 的 supabase/
  不部署)。14 位時間戳、冪等(IF NOT EXISTS / CREATE OR REPLACE /
  ON CONFLICT)。寫時間戳前先 `ls mobile/supabase/migrations/ | tail -3`。
  絕不 `supabase config push`(會清掉 dashboard 的 OAuth 設定)。
  push 到 main 自動套用,不要叫創辦人手跑 SQL。Supabase ref
  `kbwfdskulxnhjckdvghj`。
- **寫 SQL 前先 live 探測 schema**(文件會過期,DB 不會):探測食譜與
  pgvector search_path、CLI 陷阱 → `docs/claude/ref-infra-ops.md`。
- **i18n ×19**(`mobile/src/i18n/locales/*.json`):批次改動一律 Python
  round-trip + assert 19/19 + `git diff --stat` 核對;店面文案 ×17 改完量
  字數 ≤4000。模板 → `docs/claude/30-TEMPLATES.md`。
- **Gemini 只用 2.5 家族**(`gemini-2.5-flash` / `-lite`;embedding
  `gemini-embedding-001`)。非 2.5 的 id 已全數 404,絕不放進 fallback 鏈;
  延遲敏感呼叫設 thinkingBudget 0。新一代出來先探測再換。
- **In-house 翻譯即定稿**:19 語系自己翻,不加「待母語者覆核」註記。

## 主對話行為準則(弱模型必讀)

- **本節只適用「主對話」。如果你是被派出的 subagent:你就是實作者,
  親自完成收到的任務,禁止再往下派 subagent** —— 遞迴派工 = 無限循環,
  2026-07-06 實測發生過(三層 agent 互相等待、零產出)。
- **指揮官不下場**:大量讀檔、掃 repo、查網頁、批次改檔 → 派 subagent,
  主對話只收結論 + 檔案:行號。門檻與派工規則 → `docs/claude/10-DISPATCH.md`。
- **講定即落檔**:session 中途成立的決策當下寫進檔案(壓縮會吃掉對話)。
- **完成的定義、何時問人、何時換路** → `docs/claude/20-JUDGMENT.md`。
- 創辦人問「接下來做什麼」→ 先讀 `docs/claude/60-TRIGGERS.md`(延後觸發清單)。

## 路由表(動手前先讀對的檔)

| 情境 | 先讀 |
|---|---|
| 動標籤/搜尋/推薦/媒合演算法;新增或改排序面;調權重 | `docs/claude/ref-tag-algorithm.md` |
| 不確定創辦人會怎麼判;要推回需求;動 CTA/表單/分數呈現 | `docs/claude/ref-founder-style.md` |
| 動 migration/CI/Auth 信件/DNS/Gemini/admin 後台 | `docs/claude/ref-infra-ops.md` |
| 動既有功能(官方帳號、掃描器、活動標籤、人脈圖、nav、聊天、批次標籤) | `docs/claude/ref-product-history.md` |
| 被問 v2 小號、變現、拍賣、付費功能 | `docs/MONETIZATION_ROADMAP.md`(藍圖)+ `docs/claude/ref-future-plans.md`(決策脈絡) |
| 要派 subagent、選 model/effort、驗收別人的產出 | `docs/claude/10-DISPATCH.md` |
| 拿不準:升級模型?算完成?問使用者?放棄重來? | `docs/claude/20-JUDGMENT.md` |
| 要寫派工 prompt(搜尋/實作/重構/研究/審查) | `docs/claude/30-TEMPLATES.md` |
| 要更新 docs/claude 任何檔案(含本檔) | `docs/claude/40-MAINTENANCE.md` |
| 新 session 開場想了解環境(選讀) | `docs/claude/50-LETTER.md` |
| 創辦人問 roadmap/接下來 | `docs/claude/60-TRIGGERS.md` |
| harness 病灶與為什麼有這套制度 | `docs/claude/00-DIAGNOSIS.md` |

_(North Star 由創辦人明示要求記住 —— 2026-05。本檔 2026-07-06 由 Fable 5
重構為路由版;內容有疑義時以 ref 檔全文為準,ref 檔與 live 系統衝突時以
live 探測為準並回寫修正。)_
