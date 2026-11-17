# PikTag 精簡回工具 — 決策與執行計畫(2026-11-18)

## 目前進度(每完成一階段就更新這裡)

- 2026-11-18:階段 0 完成(CLAUDE.md North Star 改寫;舊定位文件加「已被取代」標記)。
- 2026-11-18:階段 1 完成(35461fd0,聊天介面下架、鈴鐺搬到人脈頁)。
- 2026-11-18:階段 2 完成(Ask 介面下架;只改客戶端;weekly-ask-prompt cron 與 landing /a/:askId 暫不動,舊版 App 仍在用,待全部階段完成後再決定)。
- 階段 4 注意:EditProfile 仍借用 ask.regenerateAiTags、ask.aiNoSuggestions 兩個 i18n 鍵;舊的 ask_* 通知列仍顯示在通知頁(點擊已改導向)。
- 2026-11-18:階段 3 完成(搜尋只搜自己人脈,客戶端本機索引;未改 DB)。待創辦人決定的缺口:
  (a) 我是掃碼方時讀不到活動標籤(piktag_scan_sessions RLS 只開主辦方);
  (b) 非會員聯絡人標籤要大小寫完全一致才對得到 concept —— 草稿 RPC `search_my_network_concepts` 可解,未寫成 migration;
  (c) 「對方封鎖我」方向需 SECURITY DEFINER RPC 才能排除;
  (d) 搜尋排序整個換成本機計分,未過 CLAUDE.md 的重放門檻;impression 仍寫 surface='search',會混進舊漏斗。
- 階段 4 注意:Settings 的 share_location 開關與 lib/sharedLocation.ts 已無消費者。

## 創辦人決策(2026-11-18,本 session 逐項選定)

1. **下架**:聊天整套(含 AI 破冰)、Ask 提問動態整套。
2. **搜尋**:只搜自己人脈(朋友私有標籤、非會員聯絡人標籤、事件標籤)。
   探索、附近的人、熱門標籤、FoF、朋友位置地圖從搜尋畫面拿掉。
3. **North Star 改寫成工具定位**:「激活舊人脈 + 加人工具化(QR/名片/匯入/名片頁)」,
   拿掉「跨語言連結新朋友」。
4. **這次不動**:推薦與配對通知、追蹤者清單與人脈圖橋樑(創辦人未勾選)。
   注意:搜尋改成只搜自己後,「推薦陌生人」通知仍會把人帶到陌生人頁 ——
   與工具定位有張力,待創辦人另外決定。
5. **原則**:先下架介面,資料與資料表保留(不 drop、不刪 RLS)。

## 盤點重點(依據:origin/main 208aec33)

- 底部 5 tab:人脈 / 搜尋 / 活動 QR / 聊天 / 我的。
- **通知唯一入口是聊天 tab 的鈴鐺**(ChatListScreen.tsx:368)→ 砍聊天前要先把鈴鐺搬到人脈頁 header。
- **follows 是好友清單的資料模型**(ConnectionsScreen 只顯示 connections ∩ follows),不能動。
- Ask 織進 9 個以上畫面:ConnectionsScreen header(AskStoryRow)與好友光圈、Profile、EditProfile、
  FriendDetail、UserDetail、TagDetail、SearchScreen(空結果引導)、RingedAvatar、dataCache、notificationRouter。
- SearchScreen 4629 行,friends/explore/nearby/FoF/熱門/地圖擠一起;`search_users` RPC 跨用戶,
  含 ask_matches。只搜自己人脈 ≈ 重寫此畫面,改走 `search_owner_contacts_by_tag` 一路。
- 個人模式 AI 標籤推薦只吃本人資料,不受影響。

## 執行階段(依序,彼此碰同一批檔,不平行)

| 階段 | 內容 | 主要檔案 |
|---|---|---|
| 0 | 改寫 CLAUDE.md North Star(先讀 docs/claude/40-MAINTENANCE.md、先備份) | CLAUDE.md、ref-tag-algorithm.md 相關段落 |
| 1 | 通知鈴鐺搬到人脈頁 header;拿掉聊天 tab 與所有「傳訊息」入口;停聊天推播 trigger 的觸發面(不刪表) | AppNavigator、ConnectionsScreen、FriendDetail、UserDetail、ChatList/Thread/Compose |
| 2 | 拿掉 Ask:AskStoryRow、好友光圈、各頁 AskCreateModal、TagDetail 的 Ask 區、/a/:askId 改導向下載頁、停 weekly-ask-prompt cron | 見盤點清單 |
| 3 | 搜尋改成只搜自己人脈 | SearchScreen、FriendsMapModal |
| 4 | 通知類型清理(四點檢查契約)、19 語系 i18n 鍵清理過 i18n-parity、Settings 開關 | notificationTypes、NotificationsScreen、locales ×19 |
| 5 | fresh-context 驗收;合批一次 push(push 觸發 TestFlight) | — |

每階段:tsc 0 錯 → commit(只 stage 明確路徑)。push 等全部完成後合批。

## 外部阻擋

- iOS TestFlight build 目前因 Apple Program License Agreement 未同意而失敗(帳號持有人 Yu Ming Li 需同意)。
