# PikTag「透過標籤串起每一個人」功能實作計畫

## 現況分析

- DB 有 27 位用戶、17 個標籤、6 筆 user_tags 關聯
- `piktag_user_tags` 有 `is_private` 欄位可過濾
- `piktag_profiles` 有 `is_public` 欄位可過濾
- TagDetailScreen 目前只查 `piktag_connection_tags`（只有已連結的人）
- **不需要新增 DB table**，現有 schema 足以支撐

---

## P0：透過標籤發現全平台使用者（3 項）

### 1. 改造 TagDetailScreen — 加入「探索」Tab
**檔案**：`src/screens/TagDetailScreen.tsx`

- 新增兩個 Tab：「我的人脈」(現有) +「探索」(新增)
- 「探索」Tab 查詢：`piktag_user_tags` JOIN `piktag_profiles`
  - 過濾：`is_private = false`、`is_public = true`、排除自己和已連結的人
- 點擊用戶 → 導航到 UserDetailScreen（可追蹤）
- 顯示共同標籤數量 badge

### 2. SearchScreen tag 搜尋結果改進
**檔案**：`src/screens/SearchScreen.tsx`

- Tag 搜尋結果下方新增「使用此標籤的用戶」區塊
- 查詢 `piktag_user_tags` JOIN `piktag_profiles`，顯示前 5 位公開用戶
- 點擊 → 導航到 UserDetailScreen
- 點擊「查看全部」→ 導航到改造後的 TagDetailScreen 的「探索」Tab

### 3. 共同標籤推薦（ConnectionsScreen）
**檔案**：`src/screens/ConnectionsScreen.tsx`

- 在 ListHeader 新增「你可能認識」推薦卡片
- 查詢邏輯：找出與當前用戶共同 user_tags 最多的陌生人（非已連結）
- 顯示：頭像、名字、共同標籤數、標籤 chips
- 點擊 → UserDetailScreen
- 可左右滑動（horizontal FlatList）

---

## P1：標籤篩選與互動深化（2 項）

### 4. 人脈列表標籤篩選
**檔案**：`src/screens/ConnectionsScreen.tsx`

- 在排序按鈕旁新增「篩選」圖示
- 篩選 Modal：列出用戶所有使用過的 connection_tags
- 選擇 tag 後只顯示有該 tag 的人脈
- 支持多選 tag 篩選

### 5. UserDetailScreen 共同標籤列表可點擊
**檔案**：`src/screens/UserDetailScreen.tsx`

- 將「X 個共同標籤」改為可展開的列表
- 每個標籤都可點擊 → 導航到 TagDetailScreen
- 增強「社交圖譜」感受

---

## P2：標籤分類瀏覽（1 項）

### 6. 標籤分類瀏覽
**檔案**：`src/screens/SearchScreen.tsx`

- 利用 DB 現有的 `category` 欄位（interest / career / personality）
- 在搜尋頁的 categories 區域新增按分類展開的標籤列表
- 點擊分類 → 顯示該類別下所有標籤 + 使用人數

---

## i18n 翻譯
- 為上述所有新 UI 元素新增 zh-TW 和 en 翻譯

## 不需要修改的
- 不新增 DB table
- 不需要建 Edge Function（直接用 Supabase client query）
- RLS policy 需確認 `piktag_user_tags` 和 `piktag_profiles` 對 authenticated users 有 SELECT 權限（基本上已有）
