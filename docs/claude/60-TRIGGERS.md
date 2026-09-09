# 60 — 延後觸發總帳(創辦人問「接下來做什麼」先讀這裡)

> 這些是散落在歷史決策裡的「條件到了就要做/要提醒創辦人」義務。
> 弱模型不會自己想起來 —— 所以收成一本帳。
> 維護規則:狀態欄可自行更新(40-MAINTENANCE 第 1 節);新增延後決策時
> 同步在此登記。iOS 已於 2026-07 上線,「上線後 N 個月」從此起算。

## 怎麼用
創辦人問 roadmap / 接下來 / 有什麼該做 → 逐條檢查「條件」欄(多數有
檢查指令),把**已達標**的條目主動端給創辦人。平時不用背。

## 帳目

| # | 事項 | 觸發條件(怎麼查) | 動作 | 詳情在 | 狀態 |
|---|---|---|---|---|---|
| 1 | 搜尋權重係數調參 | 上線 ≥3 個月 且 完成搜尋 ≥500 次(`select count(*) from piktag_search_telemetry`) | 跑 admin_search_funnel 重放,top-3 與 7-10 名轉化差不多 → 重調權重 | ref-tag-algorithm 延後調參 #1 | 未達 |
| 2 | 搜尋面 IDF | **重放門檻**:IDF 版在 admin_search_funnel 上贏過現行排序 | 才准把 IDF 加進 search_users | ref-tag-algorithm 演算法七條 #1 | 未達(推薦面已上) |
| 3 | TagDetail 排序升級加權和 | 標籤頁平均 endorser_count ≥2 | 換 `mutual*5 + endorser*2` | ref-tag-algorithm #2 | 未達 |
| 4 | 熱門標籤加背書維度 | 任一標籤總背書 ≥50 | usage*1 + search*0.5 + endorser*0.3 次要 tiebreak | ref-tag-algorithm #3 | 未達 |
| 5 | AI 建議校準分析 | 上線 ≥30 天 且 piktag_ai_tag_suggestions ≥1000 筆 | 按 position 分桶算 accept rate;平的 → 升級 suggest-tags 回真信心值 | ref-tag-algorithm #4(SQL 在 a6ab9c8 commit msg) | 未達 |
| 6 | 自標籤過期刷新 | 上線滿 1 年 | 對「舊自標 0 背書但他標高背書」用戶加密 endorsement cron,不自動重排 | ref-tag-algorithm #5 | 未達 |
| 7 | EditProfile 維度多樣 AI 建議 | semantic_type 分類穩定 且 用戶活躍建檔(**創辦人明示要被提醒**) | context:'self_profile' 的 prompt 變體,絕不動名片掃描路徑 | ref-tag-algorithm #6 | 未達 |
| 8 | 精靈第三步降門檻 | tags→links 步流失 >30%(PostHog wizard_step_completed 漏斗) | **已預先批准**:≥3 連結放寬到 ≥1 或可跳過,直接執行不用再問 | ref-founder-style 上線契約 | 未達 |
| 9 | 活動標籤改版成效 | 看三個數:新連結帶活動情境標籤比例、搜尋命中活動標籤次數、friend_added source='event_room' 量 | 數字冷 → 考慮把房間 opt-in 翻成 opt-out(要創辦人點頭) | ref-product-history 活動標籤 | 觀察中 |
| 10 | Concept GC 合併 | 有「高相似 且 兩邊都有真實標籤」的合併候選(admin Tags 頁) | 才做合併;0-tag 單例不動 | ref-tag-algorithm GC 節 | 未達 |
| 11 | vision-camera 即時 OCR | 1.0.8 出貨後,分支 spike | 驗收 = QR+名片雙路徑真機穩定,對比 card_scan_latency p50/p95 | ref-product-history 掃描速度 (d) | 未達 |
| 12 | 付費批次標籤 | (併入 #19 PikTag Pro) | **界線 2026-09-09 改切**(原記載:付費 = 使用者任選好友):免費 = 使用者手選(已出貨);付費 = 使用者自訂條件選人/多標籤/整批 AI/匯出選取批次。系統自動提出的 cohort 一律免費。照 CLAUDE.md 硬規則;BatchTagScreen 是唯一共用 UI(好友列表那套自建 modal 已於 abe542a5 併入)。需求證據看 PostHog `manual_batch_tagged` —— 沒人手選就沒東西可賣 | ref-future-plans 收費節 #3 | 併入 #19 |
| 13 | 跨語言媒合率首報 | 上線後數週,`admin_cross_language_match_rate()` 有量 | 主動報給創辦人(募資可用的數字);覆蓋率掉 = linker 出事 | ref-tag-algorithm 七條 #3 | 觀察中 |
| 14 | RTL 版面 | ar 市場有真實 traction 才做 | I18nManager 全套;目前 ar 是 LTR 排版屬刻意 | ref-founder-style | 未達 |
| 15 | 大字體破版 | 用戶回報 Dynamic Type 破版 | 逐元件 maxFontSizeMultiplier(全域法在 RN 0.81+React19 不可靠) | ref-founder-style 字級節 | 未達 |
| 16 | 程式一致性合併 | 下次動到對應畫面時順手做,不專程 | connectUsers 統一 ×4 處、UserDetail inline tag helper 換 lib 版 | ref-product-history 一致性 | 未達 |
| 17 | v2 小號上線時 | v2 開工 | 排序面檢查表加第 5 點 `is_alt=false`;掃 23 支函式加謂詞 | ref-future-plans | 等 v2 |
| 18 | 店面文案**精簡版**貼上 | Play 隨時可貼;ASC 的 Promotional Text 也是隨時生效,只有 **Description 要等下次版本送審**(**等創辦人開口才動**) | 照 `store-assets/STORE_PASTE_CHECKLIST.md` 逐步做(可交給 agent 執行)。ASC 17 語系、Play 19 語系(多 ur/bn);**SUBTITLE 與 KEYWORDS 不動**;fr 必重貼(長版曾超 4000 被截斷) | **store-assets/STORE_LISTING_SHORT_ALL.md**(2026-08-10 精簡版,~1695→~600 字。**取代** STORE_LISTING_FINAL.md 的長版 Rev 3 —— 長版只留歷史,不要貼) | 材料已備,未貼 |
| 19 | **PikTag Pro 啟動**(貴人王+批次標籤+標籤置頂+CRM 進階,$5-8/mo 單一訂閱) | 門檻(暫定值,創辦人可調):WAU ≥500 且 週真實加好友 ≥200 且 推薦→加好友轉化 ≥10%(查法:PostHog WAU;friend_added 週計數;recommendation 通知→friend_added 歸因) | 啟動 Pro 設計 + IAP;批次界線見 #12(2026-09-09 改切,原記載「付費 = 任選好友」,現手選維持免費);置頂=補 pin UI(is_pinned 機制已在 FriendDetail 排序鏈最高位);冷啟動期不開賣 | ref-future-plans 收費節 | 未達 |
| 20 | 真人認證徽章 | Pro 上線後,或 Ask/活動房間出現信任摩擦回報 | 低價($2-3/mo 或一次性);is_verified 只表真人,絕不與廣告主資格共用 flag | ref-future-plans 收費節 | 未達 |
| 21 | 主辦方方案(B2B) | 同一 host 辦 ≥3 場活動,或主辦方主動詢價 | 大房間/名單匯出/品牌 QR/會後分析;向企業收費補貼用戶成長 | ref-future-plans 收費節 | 未達 |
| 22 | 人氣王 → 標示贊助軌道 | **絕不以保證前三混排形式做**;僅當 v3 原語齊備(品質分 view、search_users 讀 dismissals)且 Pro 已驗證付費意願 | 獨立贊助區塊、明確標示、每查詢限 1-2 席、品質分把關 | ref-future-plans 收費節 + v3 節 | 未達 |
| 23 | 商業檔案(business_profiles) | 賣車/賣房型「想被看到」請求累積 ≥3 起,或 #22 軌道啟動前 | v3 選項(b);個人標籤置頂需求導入此處,不做小配件 | ref-future-plans 收費節 | 未達 |
| 24 | 贊助標籤上線時建 personalized_ads 欄 | Phase 3 贊助標籤(#22 軌道)開工 | 建 `piktag_profiles.personalized_ads` 欄,與 personalized_recs **並列**:一顆管推薦個人化、一顆管廣告個人化,**永不共用 flag**;贊助管線只讀 personalized_ads | ref-tag-algorithm Biolink 興趣訊號節 | 等 Phase 3 |
| 25 | 推薦 affinity tiebreaker 成效檢查 | 上線 2-4 週後跑 `admin_recommendation_funnel(30)`:affinity>0 與 =0 兩群 read/轉化**無差異** | 提「mutual_score 改 ROUND(,1) 分桶」升級案給創辦人;**不得逕行改主排序** | ref-tag-algorithm Biolink 興趣訊號節 | 觀察中 |
| 26 | 微信個人 QR 圖片上傳(取代目前的「點擊複製微信號」) | 創辦人示意做微信第一版加好友體驗(2026-07-18 選「先上線,QR 排後續」) | EditProfile 加 QR 圖片上傳欄→存 Supabase storage→名片頁 BiolinkSocialSection 顯示可長按辨識的圖片。**技術硬事實:個人微信號無法生成可點加好友連結**(`weixin://dl/chat` 已停用;`weixin.qq.com/r/` 後綴是每張 QR 的加密 token 非帳號;自生成純文字 QR 微信掃不觸發加好友)——唯一可靠是使用者上傳自己微信「我的二維碼」圖片(帶微信 token)。**絕不走自生成 QR 或第三方中轉頁** | platforms.ts:100-113 idMode 註記 + 本 session 查證 | 未達 |
| 27 | UTM 活動追蹤(產連結 UI + admin 分管道報表) | **有第二個外部管道要分辨**才做:第一筆付費廣告、電子報、或合作夥伴連結上線;或創辦人要比較兩個外部來源的成效 | 才做產連結 UI 與 admin 分管道報表。**現在明確不做**:管道只有 QR、個人檔案連結、口耳,三者已由 `signup_source`(qr / web_profile / app_store / play_store)分開,加 utm 等於手工維護一組沒人看的參數 | 2026-09-09 裁決。防禦已先做:robots.txt 擋 `/*?utm_`、`/*&utm_`(跟 `?sid=` 同一種爬蟲陷阱,且每次爬會觸發 server-side share_link_viewed,等於把機器人算成活動流量);acquisition.ts 的 utm_campaign 跟著 utm_source 一起轉小寫(EP01 / ep01 不會裂成兩個活動) | 未達 |
| 28 | 批次**移除**標籤 | 上線後有真實使用者用過批次加標籤(最可能的觸發:有人手滑全選、加錯一批來反映) | 在 **BatchTagScreen 加一個移除模式**,不另開畫面(CLAUDE.md:批次 UI 只有一個)。現況是完全沒有批次移除:會員要一個個進 HiddenTagEditor 刪(`piktag_connection_tags` delete),聯絡人要一個個開 EditLocalContact 改 tags 陣列 —— 分散在兩個畫面。**這個不對稱是 2026-09-09 自己造出來的**:同一天把「幫 30 人加標籤」變成一鍵,卻沒動移除。照片 app 的同一條工具列裡就有「從相簿移除」,借的時候漏掉這一半 | 本 session 查證(HiddenTagEditor.tsx:265、EditLocalContactScreen.tsx:181) | 上線後 |
| 29 | @piktag 可被單獨點選進批次 | 下次動到 ConnectionsScreen 選取模式時順手做,不專程(同 #16 規矩) | 全選已排除 is_official,但手動點該列仍選得進去 —— 同一條規則兩個地方不一致。讓官方帳號那一列在選取模式中不可選即可。後果不嚴重(把官方帳號標成「客戶」),但那是我們自己留的髒資料 | 本 session 查證(ConnectionsScreen selectableIds 過濾 OFFICIAL_USER_ID,handleConnectionPress 沒有) | 未達 |
| 30 | 觸覺回饋鋪全 app | 上線後,且要**一次鋪完**不挑單頁 | `expo-haptics` 已在依賴(~15.0.8)但**全 app 零使用**。選取、加好友成功、儲存等離散動作加輕震,是「原生感」的一大半。**只加在某一頁 = 不一致**,比不加更糟。(2026-09-09 從照片 app 借使用者習慣時提出並延後;創辦人未明示要,若判定不做就刪掉本條) | 本 session 查證(package.json:33;grep Haptics 全無) | 上線後 |
| 31 | SECURITY DEFINER RPC 權限收尾(7 支) | **上線後**,或 Supabase advisor 的 anon-executable 清單要清乾淨時。創辦人 2026-09-09 裁決:只修真的有洞的三條,其餘不動 | **先讀本列再重查,這輪稽核花了 130k token。** ①**機制**:Supabase 上 `REVOKE ... FROM PUBLIC` **無效** —— default privileges 會另給每支函式一份指名 anon/authenticated 的 grant,REVOKE PUBLIC 動不到。repo 裡有 8 支 REVOKE FROM PUBLIC 過的函式至今仍 anon 可執行。**一律用三角色具名撤銷**(`FROM PUBLIC, anon, authenticated` 再 GRANT 回去),照 20260626000000 與 20260909230000 的寫法。②**還沒修的 7 支**(依風險):`trigger_tag_suggest_nudge`(20260702170000:252,匿名可無限觸發整輪 Gemini + 推播,**帳單風險,這支是 7 支裡唯一會花錢的**)、`bump_tag_search_count`(20260526010000:53,裸 +1 零去重,且 popularity_score 給 search_count **兩倍** usage_count 權重 → 可灌搜尋排序;撤 anon 只止血,登入者仍可灌,要另加節流)、`is_admin`(20260429180000:33,可枚舉管理員)、`popular_tags_near_location`(20260508150001:27)、`qr_group_member_count`(20260513070000:59;**20260626000000:30 說它是「pre-auth 公開流程」是錯的**,唯一 caller 是已登入的 QrGroupListScreen.tsx:210)、`is_test_account_user`(20260705030000:47)、`is_notification_category_enabled`(20260706030000:161)。另 `notify_admin_on_signup` 是 `RETURNS trigger`,PostgREST 不暴露,**純 lint 潔癖不必修**。③**絕不可撤 anon 的 6 支**(landing/api 用 anon key,撤了就是把公開頁弄壞,`get_tribe_size` 已經犯過一次):`tag_page_members`、`get_tribe_size`、`record_pending_connection`、`get_scan_session_public`、`get_ask_public`、`submit_ask_web_reply`。④**兩支查不到定義、不要猜**:`increment_scan_count`(migrations 裡零 CREATE,是在 dashboard 直接建的,**要 live 探 prosrc** —— 若是裸 +1 就是第四支可灌水計數器)、`increment_tag_usage`/`decrement_tag_usage` 的 `tag_id` overload(repo 最新版參數名是 `p_tag_id` 且為重算式不可灌水,但所有 client 傳 `tag_id`,PostgREST 照參數名解析 → 線上必有一份原始碼不在 repo 的舊 overload)。⑤順手:`get_scan_session_public` 缺 `SET search_path`(20260521000000:22) | 2026-09-09 subagent 稽核 + 本 session 逐條驗證 | 上線後 |

## 已結案(留檔防重做)
- **SECURITY DEFINER 稽核的三條真洞 — 2026-09-09 修掉並上線(20260909230000,deploy ab2e0a3f success)。**
  ①`resolve_pending_connections` 原本**零 auth 檢查**卻是 SECURITY DEFINER,
  且 `p_new_user_id` 由呼叫端傳 —— 匿名者拿著印在公開分享連結上的 sid 就能
  替任意使用者建立雙向好友關係、寫私人 connection_tags、灌 scan_count。
  **撤 anon 不夠**(登入者仍可冒充),已在函式內加 `auth.uid() = p_new_user_id`
  守衛。唯一呼叫點 AppNavigator.tsx:893 傳的是 `session.user.id`,守衛對它透明。
  ②`select_tag_nudge_due_users` 回傳 push_token/bio/full_name 且筆數由呼叫端控制,
  已具名撤除 anon/authenticated(唯一 caller 走 service role,行為不變)。
  ③`get_tribe_size` **刻意重新開放給 anon** —— 20260626000000 當它「已退役」撤掉,
  但公開個人頁還在用 anon key 呼叫(landing/api/u/[username].js:151),且該呼叫把
  tribe size 當裝飾性、吞掉錯誤,所以**從 6/25 起靜默壞了兩個半月沒人發現**。
  創辦人裁決保留功能、還原 grant。**教訓:撤 grant 前先 grep landing/api,
  mobile 沒 caller 不代表沒 caller。**
- **`public.bookings` 孤兒表 — 2026-09-09 已 DROP(20260909220000)。**
  Supabase 範本殘留,`WITH CHECK true` 讓匿名可無限寫入。全 repo 零命中
  (大小寫不敏感、不限副檔名,涵蓋 234 個 migration 與所有前端目錄)。
  advisor 上那條 WARN 隨表消失。**不要再建回來。**
- **`piktag_connection_tags` 的 is_private 稽核 — 2026-09-09 結案,無需修補。**
  疑慮:被刪掉的 ConnectionsScreen 批次 modal 沒寫 is_private,若欄位預設是
  false,那些私人標籤會被當成公開背書,還會灌 search 的 endorser_count。
  20260909120000 的稽核在 Supabase Deploy log 印出答案:**預設本來就是 true**;
  全表 public(false)=13 / private(true)=12 / null=0;符合批次寫入特徵的公開列
  **0 筆**。等於舊路徑漏寫欄位剛好落在安全的那一邊,沒有任何資料要救。
  該 migration 把預設明文釘成 true 的部分**仍然有效且該留**——攔的是下一個
  忘記寫的人,不是已發生的事。**不要再開這個調查。**
- Admin 儀表板接 moat 指標 RPC — 2026-07-06 完成(be3c17e)。
- 官方帳號標籤 v2 + 教學 bio — 2026-07-06 完成(20260706010000)。
- 人脈圖聯絡人層 — 2026-07-06 完成(6506b05)。
- 離線支援(沒網路仍可操作)— 2026-08-08 完成上線,13 筆 commit;驗收阻擋項
  與所有 MEDIUM 缺陷已修,2026-09-01 逐項核對。詳見 HANDOFF-offline-logout.md。
- **「滿 30 天強制手動登入」— 創辦人 2026-09-01 裁決不做。** 維持 30 天信任窗
  只作用於離線 fallback、線上成功即回到 app。不要再提案。
