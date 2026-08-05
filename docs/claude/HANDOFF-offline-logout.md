# 交接:離線時被登出(下一個 session 的第一優先)

狀態:**未開始**。診斷方向已備妥,程式碼一行未動。

## 問題(創辦人原話)

> 在沒有網路時,會直接登出帳號,無法使用 piktag,這個是蠻致命的缺點,
> 因為很多展覽會場,網路環境是非常脆弱的,如果不能離線還可以顯示部分功能,
> 這個 app 會是多餘的

為什麼這是紅線,不是小瑕疵:**展場就是 PikTag 的主場**(掃→標→連)。
在最需要它的場合 app 反而消失,等於產品在自己的核心情境缺席。
北極星第一條(把每個加好友機會優化到極致)在這裡直接歸零。

## 修的原則(先立下,再動手)

**網路失敗永遠不等於「已登出」。** 只有兩種情況可以清掉登入狀態:
1. 伺服器明確回覆憑證無效(401 / invalid token),
2. 使用者自己按登出。

其餘一律維持登入,等連線恢復後讓 token 自己 refresh。

## 診斷起點(尚未查證,下一個 session 請自行驗證)

尚未確認實際成因,以下是**待查清單**,不是結論:

1. **grep 所有會清狀態的路徑**:`signOut`、`supabase.auth.signOut`、
   `setSession(null)`、`setUser(null)`、`SIGNED_OUT`、`onAuthStateChange`、
   `TOKEN_REFRESHED`、`refreshSession`、`getSession`、`getUser`。
2. **`mobile/src/navigation/AppNavigator.tsx`** —— 決定 auth stack vs app
   stack 的條件是什麼?profile 抓取失敗時會怎樣?
3. **啟動閘門**:是否有 bootstrap 把「網路錯誤」與「未登入」當成同一件事?
   典型長相是 `const { data, error } = await supabase.auth.getUser()`,
   離線時 error 非 null → 程式當成未登入 → 導去登入頁或直接 signOut。
   (專案已有硬規則:「啟動閘門不可 block 在網路上」,可對照是否被違反。)
4. **Supabase client 設定**(`mobile/src/lib/supabase.ts` 或同類):
   `storage` 有沒有正確設成 AsyncStorage?`persistSession`、
   `autoRefreshToken` 是否為 true?storage adapter 沒接好的話,
   session 根本沒落地,任何離線冷啟動都會看起來像沒登入。
5. 區分 `AuthRetryableFetchError`(傳輸層,可重試)與明確的 401。

## 第二部分:離線可用性

創辦人要的不只是「不要登出」,還要「離線仍能顯示部分功能」。最低標準:

- **自己的 QR / 個人頁必須能離線顯示**(展場最關鍵的一件事:
  把自己的 QR 秀出來讓別人掃)。
- 抓取失敗的畫面顯示快取內容或明確的離線狀態,而不是空白、錯誤頁、
  或彈回登入。

先盤點既有快取再決定要不要新增(已知至少有 `piktag_last_qr`,
搜尋與標籤也有快取)。**優先重用既有快取,不要為此重寫 app。**

## 驗收

- `cd mobile && npx tsc --noEmit` = 0。
- 自己重讀 diff,確認**沒有任何一條路徑**是「fetch 失敗 → signOut /
  導向 auth stack」。
- 實測三個情境並回報結果:離線冷啟動、離線熱恢復、連線恢復後。
- 高風險改動(這就是):由 fresh-context subagent 驗收。

## 注意

這題碰的是 auth session 與啟動閘門 —— **改壞的話是每個人都登不進來**,
比原本的問題更嚴重。寧可慢,不要猜。需要產品判斷的地方
(例如過期 session 要信任多久、哪些畫面值得快取)先做安全的部分,
其餘明確標出來問創辦人,不要自己決定。

---
_2026-08-06 建檔。前一個 session 派出的 agent 因用量額度中斷,無任何改動留下;
工作區乾淨。_
