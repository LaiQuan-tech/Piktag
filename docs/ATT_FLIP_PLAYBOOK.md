# ATT 翻轉手冊(App Tracking Transparency Flip Playbook)

> 建檔 2026-07-11。創辦人選定「站內第一方贊助標籤」路線(不需 ATT),本手冊
> 是**備用計畫**:未來若引入真正的第三方追蹤,照本手冊一次翻轉到位。
> 平時不需要讀;觸發條件(第 2 節)任一成立時才啟動。
> 所有檔案:行號皆於 2026-07-11 實查;執行前仍要重新核對(檔案會漂移)。

## 1. 背景 — PikTag 現況是四層「不追蹤」聲明

PikTag 目前在四個層面一致聲明「不追蹤」:

1. **iOS Privacy Manifest**:`mobile/plugins/PrivacyInfo.xcprivacy` —
   `NSPrivacyTracking` = false(行 5-6)、`NSPrivacyTrackingDomains` 空陣列
   (行 7-8)、全部 7 個 collected data type 的 Tracking flag 皆 false
   (詳見第 3.2 節位置表)。
2. **商店問卷**(repo 外,founder 管理):App Store Connect App Privacy 全部
   資料類型申報在「Data Not Used to Track You」;Google Play Data Safety 同樣
   未勾追蹤用途。
3. **官網隱私政策**:`landing/public/privacy.html` — 全文無任何廣告/追蹤節,
   行 215 明言 "We do NOT sell your personal information"。
4. **App 內隱私政策**:`mobile/src/screens/legal/PrivacyPolicyScreen.tsx` +
   `privacyPolicy.*` i18n keys ×19(en.json 行 1225-1262;行 1242 同句
   "We do NOT sell your personal information")。

程式面的歷史紀錄:**2026-05-26 因 Apple Review 5.1.2(i) 刻意拔除 ATT**。
始末記載於 `mobile/src/lib/analytics.ts` 行 138-152 的註解:當時
`initAnalytics()` 用 ATT 閘 PostHog,但該閘是死碼(無人呼叫),而
`NSUserTrackingUsageDescription` 字串仍留在 Info.plist —— Apple 以
「聲明追蹤但未實作 ATT 徵詢」的不一致拒審。正確修法(已執行)= 整條 ATT
路徑拔除 + 清掉 plist 字串 + 隱私聲明歸零。PostHog 用匿名 device-scoped
distinct_id,不用 IDFA。

**第一方個人化不構成 Apple 定義的 tracking。** Apple 對 tracking 的定義:
將**本 app 收集的**用戶或裝置資料,與**第三方 app/網站收集的**資料**連結**,
用於定向廣告或廣告量測;或將用戶資料分享給 data broker。因此:

- 推薦 cron 的 IDF 排序、biolink 興趣訊號(見 ref-tag-algorithm)——
  資料全在 PikTag 自家 DB、只在站內使用 → 不是 tracking。
- **站內第一方贊助標籤**(廣告主是站內客戶、定向只用 PikTag 自家資料、
  量測只在站內)→ 不是 tracking,**不觸發本手冊**。

## 2. 觸發條件(任一成立才啟動本手冊)

1. 引入第三方廣告 SDK(AdMob、Meta Audience Network 等)。
2. 與 data broker 共享任何用戶資料。
3. 使用 IDFA,或引入第三方歸因/MMP SDK(AppsFlyer、Adjust、Branch)。
4. 匯入第三方資料集與站內用戶資料連結做廣告定向。
5. 站外 retargeting:把用戶名單(email hash、裝置 ID)餵給外部廣告平台
   (Meta Custom Audiences、Google Customer Match 之類)。

**明確不算**:站內第一方贊助標籤、第一方推薦個人化、PostHog 匿名分析
(現行模式)。這些維持四層「不追蹤」聲明即可,不要因為「感覺像廣告」
就啟動翻轉——過度申報 tracking 會白白吃 ATT 授權率的折損(見第 4 節)。

## 3. 翻轉改動清單(全部必須同一個 PR 原子落地,見第 4 節鐵則)

### 3.1 mobile/app.json

- `ios.infoPlist`(行 21-34):加 `NSUserTrackingUsageDescription`,文案要
  誠實說明追蹤用途(Apple 會審字串內容)。現況該 dict 完全沒有這個 key
  (2026-05-26 刻意清除)。
- `plugins` 陣列(行 92-161):加 `expo-tracking-transparency`。可用 plugin
  帶 `userTrackingPermission` 選項的寫法(plugin 會代填 plist 字串),或
  裸列 plugin 名 + 自己在 infoPlist 填字串——擇一,不要兩處都填造成漂移。

### 3.2 mobile/plugins/PrivacyInfo.xcprivacy

- `NSPrivacyTracking`(行 5-6):false → **true**。
- `NSPrivacyTrackingDomains`(行 7-8):空陣列 → 填實際會連的追蹤網域
  (第三方 SDK 的文件會列;漏填的網域 iOS 會在 ATT 拒絕時直接斷連)。
- 各 collected data type dict 的 `NSPrivacyCollectedDataTypeTracking` flag
  按實況翻(哪些資料真的送去第三方廣告用途,哪些仍只是 app functionality)。
  現有 7 個 data type dict 的位置:

  | Data type | dict 位置 | Tracking flag 行 |
  |---|---|---|
  | EmailAddress | 行 11-20 | 行 16-17 |
  | Name | 行 21-30 | 行 26-27 |
  | PhotosorVideos | 行 31-40 | 行 36-37 |
  | Contacts | 行 41-50 | 行 46-47 |
  | PreciseLocation | 行 51-60 | 行 56-57 |
  | CrashData | 行 61-70 | 行 66-67 |
  | ProductInteraction | 行 71-80 | 行 76-77 |

- 引入廣告 SDK 通常還要**新增** data type(如 DeviceID/AdvertisingData);
  另注意 2024+ 的第三方 SDK 多半自帶自己的 privacy manifest,app 層的這份
  只申報 app 自己送出去的部分,不要重複替 SDK 申報。

### 3.3 mobile/plugins/withPrivacyManifest.js(機制說明)

行 9-25:`withDangerousMod` 在 **prebuild 時**把
`mobile/plugins/PrivacyInfo.xcprivacy` 複製到
`ios/<projectName>/PrivacyInfo.xcprivacy`(src 在行 13,copyFileSync 在
行 21)。意涵:改 plugins/ 下的源檔即可,但**只有走 prebuild(EAS build /
`expo prebuild`)才生效**。翻轉後必須驗證:build 產出的
`ios/PikTag/PrivacyInfo.xcprivacy` 內容確為新版(NSPrivacyTracking=true),
不要只看源檔就宣稱完成。

### 3.4 程式碼 — ATT prompt 呼叫點

- 現況:`expo-tracking-transparency` 是**零呼叫的殘留依賴** ——
  `mobile/package.json` 行 45(`"expo-tracking-transparency": "~6.0.8"`)+
  `mobile/types/modules.d.ts` 行 30-46 的 ambient stub。`mobile/src` 內
  沒有任何 import 或 `requestTrackingPermissionsAsync` 呼叫(2026-07-11
  實查)。若已依第 5 節清理,先裝回依賴。
- 新增呼叫比照**推播權限 doctrine**(`maybeAskPushPermission`,
  `mobile/src/lib/pushNotifications.ts` 行 213;啟動路徑只做
  `requestPermission: false` 的 token 刷新,行 58-59):**情境式索取、
  絕不放 App 啟動路徑**。ATT prompt 放在第一個真正涉及追蹤的功能面
  (例:用戶首次遇到個人化廣告開關或贊助內容),先
  `getTrackingPermissionsAsync()`,status 為 undetermined 才 request。
- ATT prompt 一生只會彈一次;拒絕後只能導引用戶去系統設定,不要重複騷擾。
- 行為閘:status != granted 時,所有 IDFA/第三方追蹤路徑必須關閉
  (SDK 初始化參數層面關,不是只藏 UI)。Apple 明文禁止在拒絕後改用
  fingerprinting 替代。

### 3.5 landing/public/privacy.html(2026-07-11 已通讀,共 289 行)

- 行 180:`Last updated` 日期(現為 April 17, 2026)必改。
- 行 184-187:TL;DR 區塊 —— "never sell your data" 敘述要與新的廣告揭露
  一致化改寫。
- 第 3 節 Information Sharing(行 214-220):加「與廣告夥伴共享」bullet。
- 第 4 節 Third-Party Services(行 222-232):加廣告/歸因 SDK 條目
  (含其 privacy policy 連結,照現有 bullet 格式)。
- **新增「Advertising and Tracking」節**:建議插在第 4 節之後(行 232 後)。
  注意現有 section 用 `id="section-N"` 錨點且 h2 有編號(行 189/204/214/
  222/234/243/254/265/268/271/274/277 共 12 節)——插入後第 5-12 節
  (行 234-278)須全數重編號,或改用 `id="section-ads"` 不佔編號以免
  外部錨點斷鏈,擇一並全檔一致。
- 第 6 節 Your Rights(行 243-252):加 opt-out of tracking 權利說明。

### 3.6 App 內隱私政策 + i18n ×19

- `mobile/src/screens/legal/PrivacyPolicyScreen.tsx`:行 25-71 逐節渲染
  9 個 section(純 t() 呼叫,無 hardcode 文案)。新增追蹤揭露 = 加一組
  section title/body 的渲染行。
- `mobile/src/i18n/locales/*.json` ×19:`privacyPolicy.*` 區塊(en.json
  行 1225-1262)加對應 keys,並更新 `privacyPolicy.lastUpdated`(en.json
  行 1225,現為 March 30, 2026)。現有第 3 節 Information Sharing keys 在
  en.json 行 1239-1243,無任何廣告字眼,需同步改寫。
- 批次改動照 CLAUDE.md i18n 規則:Python round-trip + assert 19/19 +
  `git diff --stat` 核對。

### 3.7 商店問卷(founder 本人手動,絕不代按)

- App Store Connect → App Privacy:把實際用於追蹤的資料類型移到
  「Data Used to Track You」,並回答 tracking 相關問題為 Yes。
- Google Play Console → Data Safety:同步勾選廣告用途/與第三方共享。
- 依 CLAUDE.md 硬規則:送審/發布按鈕永遠由創辦人自己按;本手冊執行者
  只準備材料與草稿。

## 4. 風險

- **5.1.2(i) 歷史**:2026-05-26 就是因為「聲明追蹤但未實作 ATT」被拒
  (analytics.ts 行 138-152)。翻轉時的**鏡像風險**同樣致命:有追蹤行為
  (SDK 已在跑)卻漏了 prompt 或漏了聲明,一樣是 5.1.2 拒審,情節重者
  直接下架。
- **鐵則:聲明、prompt、實際行為三者必須同一個 PR 原子一致。**
  聲明 = xcprivacy + 商店問卷 + 兩份隱私政策;prompt = ATT 呼叫點;
  實際行為 = SDK 是否真的在追蹤。三者任一先行或落後於其他兩者,
  就重演 2026-05-26。禁止「先上 SDK 下版補 prompt」或「先改聲明觀望」。
- **商業效益先打折**:iOS ATT 授權率業界常態約 2-4 成。任何依賴 IDFA 的
  收益模型(retargeting、lookalike、精準歸因)要先按授權率折算,再評估
  值不值得付出整套翻轉 + 審查風險。這也是 2026-07 選站內第一方路線的
  核心理由之一。

## 5. 順手清理建議(短期無 ATT 計畫時做,獨立 PR)

短期內沒有翻轉計畫的話,可以移除殘留依賴,降低未來 session 誤觸面:

- `mobile/package.json` 行 45:刪 `"expo-tracking-transparency": "~6.0.8"`,
  `npm install` 更新 package-lock.json。
- `mobile/types/modules.d.ts` 行 30-46:一併刪 `expo-tracking-transparency`
  的 ambient stub(留著會讓 tsc 對已移除的套件保持沉默,反而危險)。
- 順手項:`settings.attRationale` 是 ATT 拔除後的死 i18n key ×19
  (en.json 行 801,"We never track you across other apps.";2026-07-11
  實查零程式引用),可同 PR 刪除。
- 未來若要翻轉,重新 `npm install expo-tracking-transparency` 並照第 3 節
  執行即可,移除不構成單向門。
