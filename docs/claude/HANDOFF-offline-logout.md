# 交接:離線支援(程式碼已全部 push)

**目前狀態(2026-08-07 03:49 更新):離線這批的程式碼已經全部推上
`origin/main`,最新是 `ccd9ca4`,已進 TestFlight build 流程。**
本地頂多只剩文件 commit 未推。接手第一件事是
`git log --oneline origin/main..HEAD` 看自己手上還有什麼沒推 ——
**不要**再照本檔舊版說明去找「掉了的 commit」,那段已作廢。

推送歷程:`437639d`/`3b580fe`/`2762abe`/`e31661e`(離線登出、30 天上限、
四個快取、驗收三缺陷)於 01:51 推;`6c075c8`/`ccd9ca4`(團體 QR 離線化、
最後三個裝置全域鍵)於 03:49 推。

**未結案項目見本檔最下方「2026-08-07 驗收」節 —— `ccd9ca4` 上有一個
已確認的 HIGH 缺陷還沒修。**

## 已完成(皆已 push)

### `437639d` 修好「離線被登出」
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

新增 `mobile/src/lib/authSession.ts` 為單一真相來源:只有「明確回報沒有 session
且沒有錯誤」才判定未登入;錯誤/逾時/拋例外一律回退持久化 session;null 事件
只有 `SIGNED_OUT` 才當登出。啟動解析上限 2.5 秒(閘門不可 block 在網路上)。

### `3b580fe` 30 天上限 + 四個離線快取
- **30 天上限**:年齡基準 = `expires_at - expires_in`(auth server 最後認可
  這組憑證的時刻)。**不可改用 `expires_at` 本身** —— 那只有一小時,等於
  把原 bug 從正門放回來。超過只導向登入頁、**不刪憑證**。只作用於 fallback,
  線上成功的 `getSession()` 永遠權威。
- 快取(全部依帳號隔離、有上限、stale-while-revalidate):通知 ≤50、
  聊天收件匣 ≤50 對話、聊天歷史 20 對話 × 30 則(只存已送達,重試仍歸
  `chatSendQueue`)、搜尋預設面、**自己的 QR 卡含身分標籤**。
- 順手修掉既有跨帳號洩漏:`piktag_last_qr` 原是裝置全域鍵,共用手機上
  前一位主辦人的活動 QR 與標籤會出現在下一位使用者畫面。已遷 per-user,
  舊鍵盡力刪除且**刻意不當 fallback 讀**。

## 已完成(`2762abe`):驗收擋下的三個缺陷

當時 fresh-context 驗收判定 **DO NOT SHIP**,三個缺陷已於 `2762abe` 全數修復並
push。**不必再確認工作區**(舊版寫「已派 agent 修、接手先看 `git status`」,
那是當下狀態,現在 `git status` 是乾淨的,照做會誤判成沒修)。三個缺陷:

1. **HIGH 離線登出靜默失效**:`supabase.auth.signOut()` 網路失敗是
   **resolve `{error}` 而非拋例外**,而清憑證的呼叫寫在 `catch` 裡 → 永遠不執行。
   結果:storage 沒清、沒發 SIGNED_OUT、**人還在 app 裡**,但離線快取照樣被刪。
   `AuthContext.signOut` 有正確順序(先清 storage 再 signOut)但**是死碼**,
   沒有任何 UI 呼叫它;實際走 SettingsScreen 自己的 `doLogout`。
   修法:合併成單一登出路徑,不得依賴例外被拋出。
2. **HIGH 空快照毒化**:好友頁三個併發查詢若部分失敗(弱網常見),結果被
   filter 成 `[]` 並寫進**無 TTL** 的磁碟快取,離線好友清單從此永久是空的。
   修法:只有完整成功才准覆蓋持久快照;並稽核 `3b580fe` 所有快取寫入點的同類風險。
3. **MEDIUM 記憶體快取未依帳號隔離**:SIGNED_OUT 只清了 PROFILE。同機
   A 登出、B 於 5 分鐘 TTL 內登入且未 kill app → B 看到 A 的好友清單。
   (磁碟層命名空間是對的,問題在 module 層的 Map。)

## 待辦(2026-08-07 更新)

1. ~~**30 天硬性重新登入**~~ —— **誤記,已作廢。創辦人 2026-08-07 明確澄清
   「沒有要」** ,從來沒有「滿 30 天一定要手動登入一次,不管伺服器怎麼說」
   這個需求。**現行行為即正確行為**:30 天上限只在 fallback 路徑導向登入頁、
   **不刪憑證**,恢復連線後背景 refresh 成功就讓使用者自動回到 app;線上成功的
   `getSession()` 永遠權威。**不要**為此新增獨立旗標。
2. ~~**團體 QR 離線快取**~~ —— 已完成。`6c075c8` 用單一鍵底下的 map
   (`CACHE_KEYS.QR_GROUP_DETAILS`,上限 12 組)而非 per-group 鍵,因此不會逃出
   `clearPersistentCaches()`。`ccd9ca4` 再補強:同一個 detail route 被換 params
   重用時,舊團體會**永遠**留在畫面上(主辦人秀出錯的活動 QR 比空白更糟),
   以三道獨立防線修掉。
3. ~~**`piktag_recent_locations` 遷成 per-user**~~ —— 已完成(`6c075c8`,
   `CACHE_KEYS.RECENT_LOCATIONS`)。**沒有伺服器表可回補,本地損失是永久的**;
   清單上限兩筆,挑兩次地點即重建。
4. ~~**`piktag_user_presets` 遷成 per-user**~~ —— 已完成(`ccd9ca4`,
   `CACHE_KEYS.TAG_PRESETS`)。三個裝置全域鍵裡**外洩最嚴重**的一個,而且是
   活的洩漏不只是殘留:`loadPresets` 先畫本地副本、且只在伺服器回**非空**結果
   時才覆蓋,所以自己沒有 preset 的使用者會一直看到前一位帳號的,接著 merge
   還會把它們寫回自己名下、一鍵套進自己的 QR。有 `piktag_tag_presets` 表可回補,
   只有離線存的 `local_...` preset 會消失。

**其餘仍未處理的裝置全域鍵**(同一類,但嚴重度低於上面幾個):
`piktag_recent_searches`、`piktag_viewed_ask_ids`、`piktag_burst_tag_prompted_v1`、
`piktag_chat_send_queue_v1`(有 sender_id 過濾,不外洩但殘留)。

## 鐵則(別破壞)

- **網路失敗永遠不等於登出。** 只有伺服器明確回覆憑證無效、或使用者自己
  按登出才可以清狀態。
- 任何新的持久快取**必須依帳號隔離,且必須被 `clearPersistentCaches()` 涵蓋**
  —— 不能用會逃出清除迴圈的 per-entity 鍵。
- 只有**完整成功**的結果才准覆蓋持久快照;降級/空結果不得覆蓋既有的好快照。
- **push 前必須重跑一次 fresh-context 驗收。** 這條路徑決定所有人能不能
  登入,改壞比原 bug 更嚴重,不能因為趕而跳過。
- 驗收要求明確給出 `SHIP` / `DO NOT SHIP`。

---
_2026-08-06 更新。前一個 session 的 context 用盡於此;所有成果已 commit 到本地,
未 push。_

---

## 最終複驗結果(2026-08-06)

判定 **DO NOT SHIP,但只卡一項**。審查者逐條對照安裝版 auth-js 2.97 原始碼,
明說「核心我會賭,登出流程不敢」。

**唯一阻擋項(HIGH)—— 已於 `e31661e` 修復**(`AppNavigator.tsx:498` 現在直接
`useAuthContext()`,導航層不再自己存一份 session、不再等 auth-js 事件):
離線登出後畫面最久滯留約 25 秒。
`AuthContext.signOut()` 的清憑證/清快取/翻狀態都即時完成,但
`AppNavigator` 有**自己一份 `session` state**,唯一清除來源是 auth-js 的
`SIGNED_OUT` —— 離線時該事件被卡在 refresh 退避重試後面(上限 ~25s)。
結果:憑證已清、但前一位使用者的好友列表/通知還留在螢幕上。共用手機必撞。
修法:讓導航層與 AuthContext 共用單一真相來源,不要等 auth-js 事件。

**同批建議處理(MEDIUM)**:
- ~~連線數歸零時磁碟快照不更新~~ —— **已於 `2762abe` 修復**
  (`ConnectionsScreen.tsx:421`:確定為空時會寫 `[]`,與「查詢失敗」分開)。
  原述:刪光好友後每次冷啟動仍畫出已刪除的人,且線上不會自我修正
  (disk 層刻意無 TTL)。需區分「成功但為空」與「失敗」。
- 仍有數個 device-global key 承載使用者資料未隨登出清除:
  `piktag_recent_searches`、`piktag_user_presets`、`piktag_recent_locations`、
  `piktag_chat_send_queue_v1`(有 sender_id 過濾,不外洩但殘留)、
  `piktag_viewed_ask_ids`、`piktag_burst_tag_prompted_v1`。
  本批已修掉同類的 `piktag_last_qr`,其餘未處理。
  (2026-08-07 後續:`piktag_recent_locations` 已於 `6c075c8`、
  `piktag_user_presets` 已於 `ccd9ca4` 遷成 per-user,詳見上方待辦節。)

**複驗確認健全(不必重查)**:找不到任何會把合法使用者鎖在登入頁的路徑;
全新安裝/損毀 blob/token 撤銷/超過 30 天 全部導向正確且可復原;離線登出的
auth-js 呼叫序列正確(storage 已空時零網路、必發 SIGNED_OUT);記憶體與磁碟
兩層跨帳號隔離正確;**快取污染的每一個 .error 檢查都放對位置**(含最易寫錯的
allSettled vs 直接 await 的差別);30 天基準 `expires_at - expires_in` 經原始碼
驗證等於最後一次成功握手,且不套用於線上結果;啟動總計 6.5s < 7s watchdog,
既有帳號不會被誤送進精靈。

**延後觸發(低)**:登出後在途寫入可能落地(同帳號殘留,不跨帳號);
captive portal 回 4xx 仍會被 auth-js 自己讀成登出(超出本次範圍,
要防守只能在 storage adapter 層攔截);iOS Keychain 在 App 移除後保留。

---

## 2026-08-07 驗收(針對 `6c075c8` + `ccd9ca4`)

兩位獨立 fresh-context 驗收者,視角分開派:跨帳號洩漏面判 **SHIP**,
離線行為面判 **DO NOT SHIP**。**注意:`ccd9ca4` 在驗收進行中就被 push 了
(03:49),所以這個判定是在上線之後才到的 —— 鐵則「push 前必須重跑驗收」
這次沒有被遵守。**

### 已修:HIGH —— 成員區把「問不到」講成「還沒有人掃這個 QR」

**修復狀態:已修,見本節末。** 以下先記錄原始缺陷。

`mobile/src/screens/QrGroupDetailScreen.tsx`。已逐行確認屬實:

1. `:265` 在成員 RPC **之前**就把 `liveFetchDoneRef.current` 設成 `true`。
2. `:291-300` 成員 RPC 失敗時 `freshMembers` 留 `null`、不呼叫 `setMembers`,
   畫面停在初始的 `[]`。
3. `:375` 的磁碟水合因為第 1 點直接 bail,**快取裡的成員永遠貼不上來**。
4. `:345` 寫快照時 `(freshMembers ?? prevSnapshot?.members ?? [])` ——
   首次快取(`prevSnapshot` 為 null)就把「問不到」寫成 `[]`,
   而磁碟層刻意無 TTL,於是往後每次離線冷啟動都畫這個空清單。
5. `:924-926` 該空狀態渲染的是 `qrGroup.membersEmpty`
   =「還沒有人掃這個 QR — 分享給朋友吧」。

後果:主辦人在弱訊號現場,自己 40 人的活動被寫成「還沒有人掃」,
而且會被固化進離線快取。這正是本批要擋的「謊稱」,只是發生在成員面
而不是清單面(清單面 `QrGroupListScreen.tsx:715` 是對的)。

**實際修法(三處,無新 i18n key)**:
- `liveFetchDoneRef` 拆成 `liveGroupDoneRef` / `liveMembersDoneRef` /
  `liveTagsDoneRef` 三個旗標,照 `QrGroupListScreen` 的
  `liveGroupsDoneRef`/`liveAttendedDoneRef` 模式。取得團體 row 只放倒
  group 那一支;伺服器答「已刪除」時三支同時放倒(整列都不該再畫)。
  磁碟水合改成**逐段** gate,所以成員 RPC 失敗時快取的成員清單補得上來。
- `GroupDetailSnapshot` 的 `members` / `currentTags` 改為 optional。
  寫入時 `freshX ?? prevSnapshot?.X`,兩者皆無就**整個欄位不寫** ——
  欄位不存在代表「沒問到過」,空陣列代表「問到了,答案就是空」。
  原本收尾的 `?? []` 正是把「問不到」寫死成「空」的那一行。
- 新增 `membersKnown` state。空清單且 `!membersKnown` 時改顯示既有的
  `common.loadFailed` + `common.checkConnection`(19/19 已齊);
  只有確定問到過才顯示「還沒有人掃這個 QR」。從快取還原成員時
  一併還原 knownness,所以「真的沒人掃」離線時仍正確顯示為空。

**驗證**:`npx tsc --noEmit` 0 錯;新增行零 emoji;無新增 i18n key。

### 其餘項目 —— 已全數處理(2026-08-07,見下方「已修」標註)

- **中** ~~登出時的在途寫入會落地,繞過 `clearPersistentCaches`~~ —— **已修**。
  所有快照寫入都是 fire-and-forget,登出當下才回來的 fetch 會在
  `multiRemove` 之後把資料寫回磁碟。現在 `setPersistentCache` 在寫入前比對
  `cacheOwnerId`,不符就丟棄;`clearPersistentCaches` 自己先呼叫
  `setCacheOwner(null)`(放在函式內而不是呼叫端,這樣清除進行中護欄就已經
  上膛)。
- **中低** ~~`QR_GROUPS` 的 50 筆修剪會剪掉最新建立的群組~~ —— **已修**。
  改成**用 `created_at` 挑要保留哪 50 筆,但仍以顯示順序寫入**
  (filter `merged` 而非寫入排序後的副本),所以主辦人自訂的拖曳順序
  離線時不會被打亂。
- **低** ~~`QR_ATTENDED` 沒有 `.order()`~~ —— **已修**,加上
  `.order('event_date', { ascending: false, nullsFirst: false })`。
- **低** ~~`loadPresets` 沒解構 `error`~~ —— **已修**。同時修掉一個更嚴重的
  連帶問題:原本的 append merge 會把伺服器沒回傳的 preset 一律加回去,
  等於在別台裝置刪掉的 preset 永遠不死。現在只有 `local_` 前綴
  (離線存、從未 insert)才保留。
- **低** ~~三個 legacy key 沒進登出清單~~ —— **已修**,見
  `GLOBAL_KEYS_CLEARED_ON_SIGN_OUT`。
- **低** ~~`EventQrSnapshot` 沒帶 session id~~ —— **已修**,加上
  optional `sessionId`,刪除群組時比對後清除。欄位不存在(舊快照)
  刻意不猜、不動。
- **範圍外、同類** —— **已一併處理**:
  - `piktag_recent_searches` → `CACHE_KEYS.RECENT_SEARCHES`(per-user,
    舊鍵刪不讀)。這個是實質洩漏:共用手機上看得到前一位在找誰。
  - `piktag_ai_tags_${user.id}` → `CACHE_KEYS.AI_TAGS`。本來就有命名空間,
    問題只在不被登出掃到。24 小時 TTL 保留(這是生成內容,重建要花模型呼叫,
    與離線快照刻意無 TTL 的理由不同)。
  - `piktag_chat_send_queue_v1` → **維持裝置全域,但加入登出清除清單**。
    送出路徑沒有 user id 可用,為了它重接整條 chat send path 風險不划算。
    代價講明:登出會丟掉尚未送出的訊息。這是刻意取捨 —— 登出是使用者自己
    按的,把某人未送出的訊息留在他已經還回去的手機上更糟。

### 仍未處理(低,已知)

- 離線冷啟動時「載入失敗」可能閃一下才被快取內容取代(失敗分支的
  `finally` 無條件 `setLoading(false)`,磁碟讀是另一條 async)。內容最終
  正確,只有瞬間文案錯。
- `fetchGroup` 的 `setLoading(true)` 沒過 `onScreen()`,陳舊 closure 被叫起
  時會把 loading 設 true 卻不清。目前無可見影響。
- 拖曳排序後不回寫 `QR_GROUPS` 快照,離線冷啟動看到舊順序。
- 「載入失敗/請檢查網路連線」對 RLS 拒絕、JWT 過期、5xx 也照顯示,
  措辭誤導(不寫快照的行為是對的)。
