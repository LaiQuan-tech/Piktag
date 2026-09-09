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
| 12 | 付費批次標籤 | (併入 #19 PikTag Pro) | **界線 2026-09-09 改切**:免費 = 使用者手選(已出貨);付費 = 使用者自訂條件選人/多標籤/整批 AI/匯出選取批次。系統自動提出的 cohort 一律免費。照 CLAUDE.md 硬規則;BatchTagScreen 是唯一共用 UI(好友列表那套自建 modal 已於 abe542a5 併入)。需求證據看 PostHog `manual_batch_tagged` —— 沒人手選就沒東西可賣 | ref-future-plans 收費節 #3 | 併入 #19 |
| 13 | 跨語言媒合率首報 | 上線後數週,`admin_cross_language_match_rate()` 有量 | 主動報給創辦人(募資可用的數字);覆蓋率掉 = linker 出事 | ref-tag-algorithm 七條 #3 | 觀察中 |
| 14 | RTL 版面 | ar 市場有真實 traction 才做 | I18nManager 全套;目前 ar 是 LTR 排版屬刻意 | ref-founder-style | 未達 |
| 15 | 大字體破版 | 用戶回報 Dynamic Type 破版 | 逐元件 maxFontSizeMultiplier(全域法在 RN 0.81+React19 不可靠) | ref-founder-style 字級節 | 未達 |
| 16 | 程式一致性合併 | 下次動到對應畫面時順手做,不專程 | connectUsers 統一 ×4 處、UserDetail inline tag helper 換 lib 版 | ref-product-history 一致性 | 未達 |
| 17 | v2 小號上線時 | v2 開工 | 排序面檢查表加第 5 點 `is_alt=false`;掃 23 支函式加謂詞 | ref-future-plans | 等 v2 |
| 18 | 店面文案**精簡版**貼上 | Play 隨時可貼;ASC 的 Promotional Text 也是隨時生效,只有 **Description 要等下次版本送審**(**等創辦人開口才動**) | 照 `store-assets/STORE_PASTE_CHECKLIST.md` 逐步做(可交給 agent 執行)。ASC 17 語系、Play 19 語系(多 ur/bn);**SUBTITLE 與 KEYWORDS 不動**;fr 必重貼(長版曾超 4000 被截斷) | **store-assets/STORE_LISTING_SHORT_ALL.md**(2026-08-10 精簡版,~1695→~600 字。**取代** STORE_LISTING_FINAL.md 的長版 Rev 3 —— 長版只留歷史,不要貼) | 材料已備,未貼 |
| 19 | **PikTag Pro 啟動**(貴人王+批次標籤+標籤置頂+CRM 進階,$5-8/mo 單一訂閱) | 門檻(暫定值,創辦人可調):WAU ≥500 且 週真實加好友 ≥200 且 推薦→加好友轉化 ≥10%(查法:PostHog WAU;friend_added 週計數;recommendation 通知→friend_added 歸因) | 啟動 Pro 設計 + IAP;批次界線見 #12(2026-09-09 改切,手選維持免費);置頂=補 pin UI(is_pinned 機制已在 FriendDetail 排序鏈最高位);冷啟動期不開賣 | ref-future-plans 收費節 | 未達 |
| 20 | 真人認證徽章 | Pro 上線後,或 Ask/活動房間出現信任摩擦回報 | 低價($2-3/mo 或一次性);is_verified 只表真人,絕不與廣告主資格共用 flag | ref-future-plans 收費節 | 未達 |
| 21 | 主辦方方案(B2B) | 同一 host 辦 ≥3 場活動,或主辦方主動詢價 | 大房間/名單匯出/品牌 QR/會後分析;向企業收費補貼用戶成長 | ref-future-plans 收費節 | 未達 |
| 22 | 人氣王 → 標示贊助軌道 | **絕不以保證前三混排形式做**;僅當 v3 原語齊備(品質分 view、search_users 讀 dismissals)且 Pro 已驗證付費意願 | 獨立贊助區塊、明確標示、每查詢限 1-2 席、品質分把關 | ref-future-plans 收費節 + v3 節 | 未達 |
| 23 | 商業檔案(business_profiles) | 賣車/賣房型「想被看到」請求累積 ≥3 起,或 #22 軌道啟動前 | v3 選項(b);個人標籤置頂需求導入此處,不做小配件 | ref-future-plans 收費節 | 未達 |
| 24 | 贊助標籤上線時建 personalized_ads 欄 | Phase 3 贊助標籤(#22 軌道)開工 | 建 `piktag_profiles.personalized_ads` 欄,與 personalized_recs **並列**:一顆管推薦個人化、一顆管廣告個人化,**永不共用 flag**;贊助管線只讀 personalized_ads | ref-tag-algorithm Biolink 興趣訊號節 | 等 Phase 3 |
| 25 | 推薦 affinity tiebreaker 成效檢查 | 上線 2-4 週後跑 `admin_recommendation_funnel(30)`:affinity>0 與 =0 兩群 read/轉化**無差異** | 提「mutual_score 改 ROUND(,1) 分桶」升級案給創辦人;**不得逕行改主排序** | ref-tag-algorithm Biolink 興趣訊號節 | 觀察中 |
| 26 | 微信個人 QR 圖片上傳(取代目前的「點擊複製微信號」) | 創辦人示意做微信第一版加好友體驗(2026-07-18 選「先上線,QR 排後續」) | EditProfile 加 QR 圖片上傳欄→存 Supabase storage→名片頁 BiolinkSocialSection 顯示可長按辨識的圖片。**技術硬事實:個人微信號無法生成可點加好友連結**(`weixin://dl/chat` 已停用;`weixin.qq.com/r/` 後綴是每張 QR 的加密 token 非帳號;自生成純文字 QR 微信掃不觸發加好友)——唯一可靠是使用者上傳自己微信「我的二維碼」圖片(帶微信 token)。**絕不走自生成 QR 或第三方中轉頁** | platforms.ts:100-113 idMode 註記 + 本 session 查證 | 未達 |
| 27 | UTM 活動追蹤(產連結 UI + admin 分管道報表) | **有第二個外部管道要分辨**才做:第一筆付費廣告、電子報、或合作夥伴連結上線;或創辦人要比較兩個外部來源的成效 | 才做產連結 UI 與 admin 分管道報表。**現在明確不做**:管道只有 QR、個人檔案連結、口耳,三者已由 `signup_source`(qr / web_profile / app_store / play_store)分開,加 utm 等於手工維護一組沒人看的參數 | 2026-09-09 裁決。防禦已先做:robots.txt 擋 `/*?utm_`、`/*&utm_`(跟 `?sid=` 同一種爬蟲陷阱,且每次爬會觸發 server-side share_link_viewed,等於把機器人算成活動流量);acquisition.ts 的 utm_campaign 跟著 utm_source 一起轉小寫(EP01 / ep01 不會裂成兩個活動) | 未達 |

## 已結案(留檔防重做)
- Admin 儀表板接 moat 指標 RPC — 2026-07-06 完成(be3c17e)。
- 官方帳號標籤 v2 + 教學 bio — 2026-07-06 完成(20260706010000)。
- 人脈圖聯絡人層 — 2026-07-06 完成(6506b05)。
- 離線支援(沒網路仍可操作)— 2026-08-08 完成上線,13 筆 commit;驗收阻擋項
  與所有 MEDIUM 缺陷已修,2026-09-01 逐項核對。詳見 HANDOFF-offline-logout.md。
- **「滿 30 天強制手動登入」— 創辦人 2026-09-01 裁決不做。** 維持 30 天信任窗
  只作用於離線 fallback、線上成功即回到 app。不要再提案。
