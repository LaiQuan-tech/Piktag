# PikTag 資料庫搬遷:kbwfdskulxnhjckdvghj → uamgqflfuqejjeatudqg

創辦人決定 2026-11-16:合併進共用庫並刪除舊庫,採 **B 快速版**(一輪發版,
切換當下凍結舊庫,沒更新的舊版 App 會失效直到更新)。

## 盤點(2026-11-16 實測)
| | 來源 kbwf (Singapore) | 目標 uamg (Tokyo, lqtech+ifar+liyuanzhen) |
|---|---|---|
| DB | 374 MB, public 57 表 | 12 MB, public 14 表 |
| auth.users | 205 | 0 |
| storage | avatars, event / 158 檔 58 MB | 無 |
| extensions | pg_cron pg_net pg_trgm vector 等 | 缺 pg_cron pg_net pg_trgm vector |
| 其他 | 28 edge fn、22 cron、171 函式、39 觸發器 | 無 migration 歷史表 |
- 表名零衝突。org 方案 Pro。App 無強制更新機制。

## 階段 1 準備(不影響線上)
1. 目標啟用 extensions:pg_cron, pg_net, pg_trgm, vector。
2. 預演:schema+資料 dump/restore 到目標,比對每表筆數、函式數、觸發器數;
   schema 保留在目標,切換日只重灌資料。
3. 目標 auth 設定:Apple/Google provider(同 client id)、Resend SMTP、
   recovery 信件模板、site_url / redirect 白名單 —— 先確認目標的其他站沒在用 auth。
4. 部署 28 支 edge function 到目標 + 搬 secrets;vault secret 重建(加密綁專案,不能 dump)。
5. 建 storage buckets(avatars, event)與 policy。

### 階段 1 結果(2026-11-16 完成,目標庫現況)
目標庫已具備完整 PikTag 結構與 11/16 當下資料快照(預演用,切換日會重灌資料):
- schema:57 表 / 195 索引 / 86 外鍵 / 127 policy / 26 觸發器,與來源一致;
  auth.users 上 2 個觸發器(auto_confirm_on_signup、on_auth_user_created)、
  storage.objects 6 條 avatars policy、realtime publication 12 張表,皆已補。
- 權限:目標的 default privileges 會自動把新物件開給 anon/authenticated,
  已逐物件 revoke 179 項,三角色有效權限與來源 612 組 0 差異。
  **切換日若有新 migration,要重跑權限比對。**
- 資料:auth.users 205、identities 206(來源 215,9 筆指向不存在使用者的孤兒不搬);
  public 63851 筆(來源 63856,差 5 筆 = 來源指向已刪使用者的孤兒列,
  按 ON DELETE CASCADE 語意刪除:invites 1、biolink_clicks 1、close_friends 1、
  conversations 2)。來源這 6 個 FK 標示 validated 但實際有孤兒,是來源的資料異常。
- storage:avatars 27、event 131 物件,逐物件 md5 一致。
- vault:3 個 secret 已以目標的 URL 與 secret key 重建,cron_secret 沿用原值。
- edge functions:28 支已部署,verify_jwt 與來源一致;其中 capi-forward、
  list-event-sessions、notification-search-digest 不在 repo,是從來源下載的。
  secrets:ADMIN_EMAILS_RAW、CRON_SECRET、GEMINI_API_KEY、RESEND_API_KEY 已搬。
- auth 設定:Apple/Google(同 client id,skip_nonce_check)、autoconfirm、HIBP、
  site_url、redirect 白名單、全部信件主旨與模板已同步。
  SMTP 密碼改用 RESEND_API_KEY(原值 API 只回雜湊);Google client secret
  同理無法取得 —— 原生 ID token 登入不需要,若日後要網頁版 Google 登入需補。
- cron:22 個 job 的建立語句已備妥,**未排程**(避免演練期間對真實用戶推播)。
- 資料內寫死舊網址:piktag_profiles.avatar_url 15、piktag_local_contacts.avatar_url 3、
  piktag_notifications.data 235,切換日用 replace() 改寫。schema 內無寫死 ref。

### 方法備忘
- 連線:Management API `POST /v1/projects/{ref}/cli/login-role` 取 5 分鐘暫時角色,
  走 pooler + `SET ROLE postgres`(pg_dump 用 `--role=postgres`)。來源 pooler
  aws-1-ap-southeast-1,目標 aws-1-ap-northeast-1。用 bash 跑,zsh 陣列參數會壞。
- pre-data / data / post-data 分段,各自 `--single-transaction` + `ON_ERROR_STOP`。
  pre.sql 過濾 `CREATE SCHEMA public`、`COMMENT ON SCHEMA public`、
  `GRANT USAGE ON SCHEMA public`;post.sql 過濾 `ALTER DEFAULT PRIVILEGES`
  (目標 public 是三站共用,不可動 schema 層設定)。

## 階段 2 新版 App
6. 程式/CI 中寫死的 ref kbwf → uamg(workflows、config.toml、scripts、landing/admin 程式碼)。
7. 出新版 App 指向目標(EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 換新);送審設「手動發布」,
   核准後先不放出。

## 階段 3 切換日(停機約 30-60 分鐘)
8. 凍結舊庫:停 cron、撤 anon/authenticated 寫入。
9. 先比對來源有無 11/16 後的新 migration,有就補到目標並重跑權限比對。
   目標 truncate PikTag 57 表 + auth.users/identities,在
   `session_replication_role = replica` 下重灌最終資料(否則 pg_net 觸發器會對
   每筆 insert 打推播);重灌後重跑孤兒清理,再改寫舊網址。
10. 重跑 storage 搬遷(只補新增檔);排程 22 個 cron job;比對筆數。
    寄一封重設密碼信給創辦人自己的帳號,驗證 SMTP 金鑰可用。
11. 官網、後台 Vercel env 切到目標;CI secrets(DB password、project ref)切到目標。
12. 創辦人按發布新版 App(送審/發布永遠由創辦人按)。
13. 驗收:登入、加好友、掃名片、推播、搜尋、後台數據。

## 階段 4 收尾
14. 觀察 1-2 週。
15. **刪除舊庫前再跟創辦人確認一次**(不可逆)。

## 已知代價
- 所有會員須重新登入一次(JWT secret 不同),資料不遺失。
- 舊版 App 切換後無法使用,直到更新。
