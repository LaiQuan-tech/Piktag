# 離線支援 — 結案紀錄(已上線)

**狀態:完成並已在 main。** 13 筆 commit,2026-08-06 → 08-08,全部驗證在
`origin/main` 上。這份檔案原本是「進行中的交接」,工作結束後改寫為結案紀錄。

> (原記載為「進行中,未 push」+ 驗收判定 **DO NOT SHIP**,那是 2026-08-06 的狀態;
> 該判定的唯一阻擋項已於 08-07 修復,2026-09-01 逐項比對程式碼證實,故更新。)

## 做了什麼

### 核心:網路失敗不再被誤讀成登出
根因是兩個各自獨立、錯法相同的機制:
1. 啟動閘門與 AuthContext 呼叫 `getSession()` 時**只解構 `data`、丟掉 `error`**。
   `getSession()` 不是純本地讀取 —— access token 過期(或距到期 < 90 秒)時
   它會打網路 refresh,離線失敗回 `{session: null, error: AuthRetryableFetchError}`。
   呼叫端看到 null 就導向登入頁。token 效期一小時,所以「離線冷啟動 +
   距上次上線超過一小時」= 必被登出。
2. `onAuthStateChange` 會帶 null 發 `INITIAL_SESSION`,**覆蓋掉**第 1 點的正確結果。
   只修一個沒用。

auth-js 本身很謹慎(只有非可重試錯誤才刪 session),所以**憑證從來沒真的消失**,
純粹是客戶端誤讀 —— 修復不需動任何持久化格式。

`mobile/src/lib/authSession.ts` 是單一真相來源:只有「明確回報沒有 session
且沒有錯誤」才判定未登入;錯誤/逾時/拋例外一律回退持久化 session;null 事件
只有 `SIGNED_OUT` 才當登出。啟動解析上限 2.5 秒(閘門不可 block 在網路上)。

### 30 天離線信任窗
年齡基準 = `expires_at - expires_in`(auth server 最後認可這組憑證的時刻)。
**不可改用 `expires_at` 本身** —— 那只有一小時,等於把原 bug 從正門放回來。
超過只導向登入頁、**不刪憑證**。只作用於 fallback,線上成功的 `getSession()`
永遠權威。

### 離線快取
全部依帳號隔離、有上限、stale-while-revalidate:通知 ≤50、聊天收件匣 ≤50 對話、
聊天歷史 20 對話 × 30 則(只存已送達,重試仍歸 `chatSendQueue`)、搜尋預設面、
自己的 QR 卡含身分標籤、團體 QR、開啟過的好友(連結與標籤)。

**覆蓋現況**:17 個畫面具離線快取或守衛;`OfflineBanner` 用於 2 處。

## 驗收阻擋項與後續缺陷 — 全數修復(2026-09-01 逐項核對)

| 項目 | 結果 | 依據 |
|---|---|---|
| **(阻擋)離線登出後畫面滯留約 25 秒** —— AppNavigator 有自己一份 `session` state,只等 auth-js 的 `SIGNED_OUT`,而該事件卡在 refresh 退避重試後面 | ✓ 已修 | `e31661e`;AppNavigator 已無自有 session state,改用 `lib/authSession.ts` |
| 離線登出靜默失效(`signOut()` 網路失敗是 resolve `{error}` 非拋例外,清憑證寫在 `catch` 裡 → 永不執行) | ✓ 已修 | `2762abe0` 合併為單一登出路徑 |
| 空快照毒化(部分查詢失敗 → 寫入無 TTL 磁碟快取,離線好友清單永久為空) | ✓ 已修 | ConnectionsScreen 區分 `CONFIRMED-successful empty` 與失敗 |
| 記憶體快取未依帳號隔離(A 登出、B 於 TTL 內登入會看到 A 的清單) | ✓ 已修 | `2762abe0` |
| 團體 QR 離線快取 | ✓ 已做 | `6c075c8` |
| `piktag_recent_locations` 遷 per-user | ✓ 已做 | `6c075c8` |
| 6 個裝置全域 key 未隨登出清除(`recent_searches` / `user_presets` / `recent_locations` / `chat_send_queue_v1` / `viewed_ask_ids` / `burst_tag_prompted_v1`) | ✓ 六個全部納入 `dataCache`,受清除涵蓋 | `af9883b2` 等 |

**複驗確認健全(不必重查)**:找不到任何會把合法使用者鎖在登入頁的路徑;
全新安裝/損毀 blob/token 撤銷/超過 30 天 全部導向正確且可復原;離線登出的
auth-js 呼叫序列正確(storage 已空時零網路、必發 SIGNED_OUT);記憶體與磁碟
兩層跨帳號隔離正確;快取污染的每一個 `.error` 檢查都放對位置(含最易寫錯的
`allSettled` vs 直接 `await` 的差別);30 天基準經原始碼驗證等於最後一次成功
握手,且不套用於線上結果;啟動總計 6.5s < 7s watchdog。

## 創辦人裁決:「滿 30 天強制手動登入」— 不做(2026-09-01)

原本列為待辦:滿 30 天後若恢復連線、背景 refresh 成功,使用者會**自動回到 app**,
不必手動登入;曾規劃加一個獨立旗標強制手動登入一次,不管伺服器怎麼說。

**創辦人 2026-09-01 裁決:不做。** 維持現狀(30 天信任窗只作用於離線 fallback,
線上成功即回到 app)。**不要再提案或自行實作** —— 這是體驗與安全性的取捨,
已經決定。

## 已知且接受的限制(低,非阻擋)

- 登出後在途寫入可能落地(同帳號殘留,不跨帳號)。
- captive portal 回 4xx 仍會被 auth-js 自己讀成登出(要防守只能在 storage
  adapter 層攔截)。
- iOS Keychain 在 App 移除後保留。

## 鐵則(仍然有效 —— 任何未來動到快取/登入的工作都適用)

- **網路失敗永遠不等於登出。** 只有伺服器明確回覆憑證無效、或使用者自己
  按登出才可以清狀態。
- 任何新的持久快取**必須依帳號隔離,且必須被 `clearPersistentCaches()` 涵蓋**
  —— 不能用會逃出清除迴圈的 per-entity 鍵(`piktag_last_qr` 的跨帳號洩漏
  就是這樣來的;per-group 鍵要設計成單一鍵底下的 map,如 `CHAT_THREADS`)。
- 只有**完整成功**的結果才准覆蓋持久快照;降級/空結果不得覆蓋既有的好快照。
- 動到登入路徑後,**push 前必須重跑一次 fresh-context 驗收**,並明確給出
  `SHIP` / `DO NOT SHIP`。這條路徑決定所有人能不能登入,改壞比原 bug 更嚴重。

---
_2026-09-01 結案。原交接內容(2026-08-06)已依實際程式碼更新。_
