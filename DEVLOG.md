# PikTag 開發日誌

## 產品願景

PikTag 是一款以「語義標籤」串連人脈的社交 App。核心理念建立在三大支柱上：

1. **Link Bio** — 每個用戶就是一個個人頁面，展示 bio、社交連結、聯絡方式（類似 Linktree，但以「人」為核心）
2. **Semantic Tag** — 標籤不只是標記，而是語義化的人脈橋樑，六種語義類型讓「對的人」找到你
3. **QR Code** — 掃碼即時建立帶有標籤的人脈連結，線下見面→線上連結→標籤化管理

---

## Phase 1：基礎建設（2/15 - 3/5）

**目標：建立專案骨架與部署流程**

- 初始化專案，建立 Supabase 資料庫 schema
- 實作 Dashboard UI（Next.js + Supabase Realtime + Liquid Glass 風格）
- 建立 React Native Expo Mobile App
- 整理 monorepo 結構（web + mobile 分離）
- 設定 Vercel 部署（go.pikt.ag）

**技術選型：**
- Frontend: Next.js (Web) + React Native Expo (Mobile)
- Backend: Supabase (PostgreSQL + Auth + Realtime + Edge Functions)
- Hosting: Vercel

---

## Phase 2：核心功能開發（3/9）

**目標：打造 App 的核心互動功能**

- **Event Tag QR Code** — 設計文件 → 實作計畫 → 完成開發，QR Code 包含事件資訊
- **Notification Wall** — 取代原本的 heart/chat tab，改為通知牆
- **i18n 多語系** — 支援 11 種語言，搜尋頁加入熱門標籤
- **Personal Dashboard** — 社交統計轉型為個人儀表板（10 項指標）
- **QR 掃描修復** — 修復 8 個 QR 掃碼 + 加好友流程的 bug

---

## Phase 3：UX 精煉與社交功能（3/13 - 3/18）

**目標：優化使用者體驗，建立社交連結功能**

### 註冊流程簡化
- 移除註冊時的 name/username 欄位，降低門檻
- 加入 inline 密碼驗證提示

### 效能優化
- ConnectionsScreen API 呼叫從 5 次降到 2 次，並行化 + memoize
- 全站查詢效能優化

### UI 大改
- 標籤卡片改為 compact pill-style chips
- 移除所有訊息功能（聊天不是核心）
- 統一使用 go.pikt.ag 網域

### 個人頁面
- 公開 Profile 頁面（SEO + 下載引導）
- Avatar 上傳功能
- EAS build 設定

### 社交連結系統
- Platform picker（IG/FB/LinkedIn/Line/網站）帶品牌 icon
- Biolink 輸入改為固定前綴 + 帳號欄位
- 隱私設定（公開/私密帳號）

### QR Code 進化
- QR Code 改為標準 URL — 任何手機相機都能掃
- 新增 /scan landing page

---

## Phase 4：Semantic Tag 系統（3/26 - 3/29）

**目標：實作核心差異化功能 — 語義標籤**

### 標籤系統全面重構
- 實作 Semantic Tag 系統 — 六種語義類型（identity / skill / interest / social / meta / relation）
- 多國語言支援擴展到 15 種語言
- 透過共同標籤發現人脈、推薦連結

### Profile 大改版
- 三段式佈局（Profile + Friend + User 頁面統一）
- IG 風格排版 → Threads 風格佈局（多次迭代）
- 統計數據：標籤數 / 朋友數 / 追蹤者數

### Pick Tag 核心功能
- 追蹤後可選擇對方的公開標籤
- 共同標籤 Modal 顯示

### 隱藏標籤
- 自己給好友的私人註記標籤（對方看不到）
- 整合到「標籤」按鈕 Modal

### 好友標籤智慧排序
- 置頂標籤、Pick 標籤視覺區分
- 標籤排序功能（點選交換 → chip 直接拖拉）

### 標籤管理重新設計
- 置頂標籤 + 全面重新設計
- Optimistic UI + 即時回饋
- 最終採用 Chip 直接拖拉排序（PanGestureHandler + Reanimated）

---

## Phase 5：社交深化與 App Store 準備（3/30 - 3/31）

**目標：完善社交功能，達到 App Store 上架標準**

### 通訊錄整合
- Onboarding 引導同步
- 好友邀請 + 好友頁提示

### 登入系統
- Apple Sign-In + Google Sign-In + Phone OTP

### 連結系統升級
- Icon 並排 + 卡片清單（display_mode 控制）
- PlatformIcon 擴充 — 更多平台 + favicon fallback
- 連結隱私權設定 — 公開/朋友/摯友/自己 四等級
- 摯友管理功能

### QR Code 功能強化
- 隱藏標籤 — 掃碼時自動存為私人備註
- 日期選擇改為快捷按鈕 + 展開日曆
- 地點選擇改為 GPS + 最近地點 + 手動輸入
- 常用 QR Code 模板
- 活動模式 — 全螢幕黑底大 QR Code

### 好友管理
- 封鎖/檢舉功能（App Store 審核必要）
- 連結強度指標
- Tag 趨勢（前 3 名熱門標籤上升箭頭）
- 活動後整理模式 — Tinder 式卡片滑動整理新朋友

### CRM 功能
- 每日壽星通知（App 內 + Edge Function）
- 簡化 CRM — 專注生日提醒

### App Store 合規
- 隱私權政策 + 服務條款頁面
- 帳號停用 + 密碼修改
- 匯出通訊錄（CSV）

### 搜尋頁重構
- 三 Tab 切換：熱門標籤 / 附近標籤 / 搜尋紀錄
- 搜尋結果改為列表呈現

### i18n 全面補齊
- 設定頁、封鎖、檢舉、停用、好友詳情等全面翻譯

---

## 技術架構

```
Piktag/
├── src/              # Next.js Web App (Dashboard)
├── mobile/           # React Native Expo App
│   └── src/
│       ├── screens/  # 各頁面
│       ├── i18n/     # 多語系（15 語言）
│       └── lib/      # Supabase client, utils
├── web/              # go.pikt.ag 靜態頁面
├── supabase/         # Edge Functions + Schema
└── app/              # App routing
```

**核心技術：**
- React Native + Expo SDK 53
- Supabase（Auth + PostgreSQL + Realtime + Edge Functions）
- react-native-reanimated + PanGestureHandler（拖拉排序）
- expo-location（GPS 定位）
- expo-contacts（通訊錄同步）

---

## 開發統計

- **總 commit 數：** 181
- **開發期間：** 2026/2/15 - 2026/3/31（約 6 週）
- **支援語言：** 15 種
- **主要頁面：** Profile / Friends / Search / QR Code / Notifications / Settings

---

## 下一步

- [ ] Dark mode 完整實作
- [ ] App Store / Google Play 上架
- [ ] 標籤推薦演算法
- [ ] 附近的人功能
- [ ] 效能監控與 analytics
