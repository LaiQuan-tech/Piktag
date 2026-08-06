# 交接:離線支援(進行中,未 push)

**目前狀態:兩個 commit 在本地、都沒有 push,沒有任何東西進到 build。**
接手第一件事:`git log --oneline -3` 確認 `3b580fe` 與 `437639d` 還在。

## 已完成(本地 commit)

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

## 進行中:修驗收擋下的三個缺陷

fresh-context 驗收判定 **DO NOT SHIP**,已派 agent 修(接手時先確認它是否完成:
`git status` 看工作區有無未提交改動)。三個缺陷:

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

## 待辦(創辦人已裁決,尚未動工)

1. **30 天硬性重新登入**:目前滿 30 天後若恢復連線、背景 refresh 成功,
   使用者會**自動回到 app**,不必手動登入。創辦人要的是「滿 30 天一定要
   手動登入一次,不管伺服器怎麼說」→ 需要一個獨立旗標,不能只靠 session 年齡。
2. **團體 QR 離線快取**(QrGroupDetailScreen):需要 per-group 鍵,而 per-group
   鍵**會逃出 `clearPersistentCaches()`**(它 iterate `Object.values(CACHE_KEYS)`)
   —— 那正是剛修掉的跨帳號洩漏成因。必須設計成不會逃出清除範圍的結構
   (例如單一鍵底下的 map,如 `CHAT_THREADS` 的做法)。
3. **`piktag_recent_locations` 遷成 per-user**(AddTagScreen):同一類裝置全域鍵
   跨帳號外洩,與 `piktag_last_qr` 同款,照同樣方式處理。

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
