# 00 — Harness 快速診斷(2026-07-06,Fable 5 立制)

> 本檔是整套制度的依據。後面每份檔案的規則都對應這裡的一個病灶。
> 讀者是未來的較弱模型:照做即可,不需要重新推導為什麼。

## 一、最漏 token 的前三名

### 1. CLAUDE.md 本體(修法已執行:路由化)
- **病灶**:1698 行、約 20k token,每個 session 開場全量載入。其中約七成是
  已出貨功能的歷史敘事(3D 圖失敗記、nav 改版的 as-built 計畫、v3 拍賣論文),
  真正每天要遵守的硬規則被稀釋在中間 —— 弱模型會漏看 NEVER 級規則
  (lost-in-the-middle 是實測行為,不是猜測)。
- **修法**:CLAUDE.md 只留「每次都要遵守的硬規則 + 路由表」;長內容全部
  抽到 `docs/claude/ref-*.md`,路由行寫明**觸發條件**(「動到 X 之前先
  Read ref-Y.md」)。詳見 `40-MAINTENANCE.md` 的膨脹回收規則。

### 2. 已完成任務清單的反覆注入
- **病灶**:harness 在 task 工具閒置時,會把**整份任務清單**(本 session 是
  91 條、約 1800 token)以 system-reminder 反覆插進對話 —— 一個長 session
  可被注入數十次,純浪費數萬 token,而且 91 條全是 completed。
- **修法**:(a) 新 session 開頭若看到大量 completed 任務,不要理會其內容 ——
  它們是歷史,不是待辦;(b) 只在真正多步驟的工作才用 TaskCreate,用完即
  completed;(c) 偶爾呼叫一次 TaskList 可壓低 reminder 頻率(reminder 只在
  「最近沒用 task 工具」時觸發)。註:目前未確認有刪除任務的工具;若未來
  版本提供,優先清空 completed。

### 3. 指揮官親自下場讀檔
- **病灶**:主對話直接 Read 整支 400+ 行的 screen、整段 store listing
  (本 session 光店面文案一項就拉了 ~1200 行進主 context)。Fable 撐得住,
  Sonnet 級會因此擠掉前面的約束、後半 session 開始漏規則。
- **修法**:見 `10-DISPATCH.md`。硬門檻:**主對話一回合要讀超過 2 個檔或
  合計 400 行,就改派 Explore/general-purpose subagent**,只收結論 +
  `檔案:行號`。編輯前必要的定位閱讀用 Read 的 offset/limit 讀區段,不讀全檔。

## 二、最容易失焦的前三名

### 1. Context 壓縮(compaction)會吃掉 session 中段的約束
- **病灶**:長 session 被摘要後,「途中口頭講定的規則」只剩摘要一句話,
  細節丟失;更早的多輪推理直接消失。本 session 的接續摘要就是實例。
- **修法**:**講定即落檔**。任何 session 中途成立的規則/決策,當下就寫進
  對應的 docs/claude 檔或 CLAUDE.md(見 40-MAINTENANCE 的格式),不要留在
  對話裡等收尾。落檔的才存在,對話裡的等於沒說。

### 2. 多 session 並行互踩
- **病灶**:本機常有第二個 session 在跑(例:event-photobooth 是另一個
  session 的 WIP)。實際踩過:push 被 reject(遠端有別 session 的新 commit)、
  migration 時間戳撞號、rebase 需要 autostash。最危險的是 `git add -A` 會把
  別 session 的髒檔一起 commit。
- **修法**:(a) **永遠只 stage 明確路徑**,禁止 `git add -A` / `git add .`;
  (b) push 被 reject → `git pull --rebase --autostash origin main`,rebase 後
  重看 `ls mobile/supabase/migrations/ | tail` 確認自己的時間戳仍是最大;
  (c) 動 migration 前先 `git fetch` 看遠端尾巴。

### 3. system-reminder 與工具雜訊打斷任務主線
- **病灶**:reminder(task 清單、preview 提示、hook 輸出)插在工具結果之間,
  弱模型容易被帶走(例:被 preview 提示帶去開不相關的 dev server)。
- **修法**:reminder 只在「與當前任務直接相關」時才行動;否則讀過即棄。
  判準:它是否改變你正在做的那一步的輸入或輸出?不是 → 忽略。
  (真實反例:RN 手機畫面的改動,瀏覽器 preview 根本驗不到 —— 該忽略。)

## 三、最容易出錯的前三名

### 1. 相信文件宣稱,不做 live 探測
- **病灶**:CLAUDE.md 曾記載 `piktag_user_tags.source` 欄位存在(實際不存在)。
  若照文件寫 SQL,一支錯的 migration 會**卡死整條 CI**,後面所有 migration
  靜默不套用(2026-06-06 的 pgvector search_path 事故就是這條鏈)。
- **修法**:凡是要寫 SQL / 依賴 DB schema 的程式碼,先跑探測(食譜在
  `ref-infra-ops.md`「Live-DB 探測」節):
  ```bash
  KEY=$(npx supabase projects api-keys --project-ref kbwfdskulxnhjckdvghj -o json \
    | python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")
  curl -s "https://kbwfdskulxnhjckdvghj.supabase.co/rest/v1/<table>?select=<col>&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
  # 回 [] 或資料列 = 欄位存在;回 42703 錯誤 = 不存在
  ```
  文件與探測結果衝突時:**以探測為準,並立刻修文件**。

### 2. 「推上去了」≠「活著」—— 完成宣告過早
- **病灶**:實際案例:clear-stale-badges cron 上線時少了 config.toml 的
  `verify_jwt = false`,push 成功、CI 綠,但功能是死的。弱模型更容易在
  push 成功時就宣告完成。
- **修法**:完成的定義在 `20-JUDGMENT.md` 第 2 節。最低限:mobile 改動 =
  tsc 0 錯 + CI 四項綠 + 功能級驗證(DB 改動用 live 探測讀回、UI 改動
  說明如何在裝置上驗);不能驗的要對使用者明說「已上但未驗」。

### 3. 19 語系手工同步
- **病灶**:i18n 檔 ×19、store 文案 ×17,手工逐檔改必漏(歷史上漏過 key、
  超過 App Store 4000 字限制而不自知 —— fr 描述曾長期超標)。
- **修法**:多語系批次改動一律寫 Python 腳本:JSON round-trip 插入正確區塊
  → **assert 驗證 19/19 都有新 key** → `git diff --stat` 確認每檔只 +N 行。
  店面文案改完必量字數(≤4000 含換行)。範本見 `30-TEMPLATES.md` 的 i18n 模板。

## 使用方式
- 新 session 不需要重讀本檔,除非:你想改制度、或發現制度與現實不符。
- 每條修法的「執行版」分散在 10/20/30/40 各檔;本檔是「為什麼」的存根。
