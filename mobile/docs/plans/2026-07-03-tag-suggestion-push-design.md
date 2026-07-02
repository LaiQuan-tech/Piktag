# tag_suggest_nudge — 每 3 天 AI 標籤建議推播（設計定稿）

Founder 需求（2026-07-02）：每 3 天推播建議標籤給 user，讓他補上適合自己的標籤，
檔案更健全、更容易被潛在 TA 搜尋到。直接餵養 North Star：更多高品質自我標籤 =
search / Ask / 推薦的可匹配面更大。所有顯示過的建議依原則 #5 落庫
`piktag_ai_tag_suggestions`（source='push_nudge'）——這批資料同時是未來
tag-auction Quality Score 的燃料。

## Founder 拍板的決策
1. 全員每 3 天推（無 health gating；「零個好建議 → 整個跳過」是防噪閥）
2. 鎖定畫面文案跟隨 app 語言（19 語模板內嵌 edge fn；鈴鐺列照常 client i18n）
3. 建議 AI 生成，重用 suggest-tags person-mode 大腦（SQL 網路啟發式因冷啟動品質差否決）
4. 文案直接標出建議標籤：「為你挑了幾個標籤」+「#a #b #c — 補上，讓對的人找到你」

## 架構
pg_cron 每日 16:00 UTC → `trigger_tag_suggest_nudge()`（vault + net.http_post）
→ edge fn `notification-tag-suggest`：
`select_tag_nudge_due_users(50)` 一次回齊 bio/full_name/headline/language/push_token/
existing/removed/recent_suggested → 每 user（併發 4、thinkingBudget 0）呼 Gemini
2.5-flash→lite → 過濾 已有∪已移除(self_unstag+ai_dismissed)∪30天內推過 → 取 3，
0 個→跳過 → 寫建議日誌（拿 ids）→ 寫通知（分類閘可擋；被擋不推）→ Expo push
（19 語模板，data 帶 tag_names+suggestion_ids）。
點擊（推播或鈴鐺列）→ notificationRouter → EditProfile 預載為現有 AI 灰 chip
（aiSuggestions + aiSuggestionIds 名字→id map）→ 點 chip 加標籤時現成的
handleAddAiSuggestion 直接 markAiSuggestionAccepted 閉環。

## 關鍵防護（Plan agent 對抗驗證後補上）
- 分類函式現行版在 20260605020000（非 20260530000000）——重現時保住 contact_sync_nudge 映射
- RPC 預過濾 `COALESCE(notif_memories,true)`：關掉分類的人不會天天被白呼 Gemini（花費漏洞）
- 標籤數 <10 才選（EditProfile 的 AI 區在 10 上限時隱藏）
- 品質地板：bio 非空 或 ≥1 公開標籤（模型只有名字會生垃圾）
- 新帳號 2 天寬限；公平輪替 ORDER BY 上次 nudge 時間 ASC NULLS FIRST
- push_token/language 都在 RPC 一次帶回；language 讀既有 `piktag_profiles.language`
  欄位（Settings 既有同步 + 新增開機同步於 registerForPushNotifications）
- 批次數學：50 user/run × ~2s ÷ 併發 4 ≈ 25-40s（150s 上限內）；規模觸發器寫在 fn 頭

## 檔案
- migration `mobile/supabase/migrations/20260702170000_tag_suggest_nudge.sql`
- edge fn `mobile/supabase/functions/notification-tag-suggest/index.ts` + config.toml
- client：notificationTypes / NotificationsScreen（memories 分頁+渲染）/
  notificationRouter / EditProfileScreen（params+預載+強制顯示）/
  pushNotifications（language 同步）/ i18n ×19 `notifications.types.tag_suggest_nudge`

## 驗收
curl 帶 service key POST `{"user_ids":["<uuid>"]}` 單人煙測 → 查兩表 → 重跑 0 新列
（3 天閘）→ 新 build 實機：鈴鐺列在地化、點入 EditProfile 見 3 chip、加標籤後
accepted=true、zh-TW 機收中文鎖定畫面推播。
校準看板：`select accepted, count(*) from piktag_ai_tag_suggestions
where source='push_nudge' group by 1`。

## v2 掛鉤
- 維度多樣性提示詞（CLAUDE.md deferred #6）：等 semantic_type 穩定，缺身份/個性就補該維度
- 規模 >150 活躍：升 LIMIT（付費 400s）或加第二班次；>1k 考慮 SQL 先 AI 補的混合式
- 頻率調整：拿 push_nudge 接受率對比 bio_extract 再決定
