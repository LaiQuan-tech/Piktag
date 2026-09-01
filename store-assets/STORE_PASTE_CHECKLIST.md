# 商店文案「照著貼」清單

**執行者可以是人或 AI agent。整份照做,不要自己發揮。**

唯一的文案來源:**`store-assets/STORE_LISTING_SHORT_ALL.md`**
(2026-08-10 精簡版,19 語系。它**取代** `STORE_LISTING_FINAL.md` 的長版 Rev 3 —— 長版只留作歷史,**不要貼長版**。)

---

## 絕對禁止(違反即中止)

1. **不准按任何「送出審核 / Submit for Review / 發布 / Publish / Send for review」。**
   貼完就停,回報給創辦人,由他自己按。這是創辦人的鐵律,沒有例外。
2. **不准輸入或更動任何帳號、密碼、金流、憑證資料。**
3. **不准改動任何一個字的文案。** 你的工作是搬運,不是編輯。看到疑似錯字也照貼,回報即可。
4. **不准動 KEYWORDS 和 SUBTITLE** —— 見下面第 3 節。

---

## 貼之前的三個共通規則

1. **去掉 Markdown 粗體記號 `**`。**
   來源檔為了排版,功能標題寫成 `**TAG YOURSELF**`。貼進商店後台時要變成 `TAG YOURSELF`。
   星號**只出現在標題行**;內文沒有。
2. **保留換行與空行。** DESCRIPTION / 完整說明 的段落結構是刻意的,原樣貼。
3. **這兩句全語系保留英文,不翻譯、不轉寫、不改標點:**
   `Tag yourself. Find anyone.` 與 `Pick. Tag. Connect.`
   全文**不得出現任何 emoji**。

---

## 一、App Store Connect(17 個語系)

**語系清單(照這 17 個,不多不少):**
`en, zh-TW, zh-CN, ja, ko, es, fr, de, pt, it, ru, tr, id, vi, th, ar, hi`

> **ur 和 bn 不在這裡。** App Store Connect 沒有這兩個語系的 listing 在地化欄位,Apple 端會 fall through 到 en。來源檔那兩節的 App Store 區塊寫的就是「無法填寫」。**不要嘗試新增這兩個語系。**

**每個語系要做的:**

| 後台欄位 | 貼什麼 | 注意 |
|---|---|---|
| Subtitle | **不要動** | 精簡版與原本相同,已經是線上的值 |
| Keywords | **不要動** | 隱藏搜尋欄位,與長度無關,改了只會少曝光 |
| Promotional Text | 該語系 `### App Store` 底下 `**PROMOTIONAL TEXT**` 的內容 | **這個欄位不需送審就會生效**,是本次唯一能立刻上線的 |
| Description | 該語系 `### App Store` 底下 `**DESCRIPTION**` 的全部內容 | 去掉 `**`;**Apple 版本鎖定,要隨下一次版本送審才會顯示** |

**特別注意 fr:** 舊的長版法文曾超過 4000 字元上限、可能被截斷過。**fr 一定要重貼一次**,不要假設它是好的。

**做完的預期狀態:** 17 個語系的 Promotional Text 立即生效;Description 已存但要等下次版本送審。

---

## 二、Google Play Console(19 個語系)

**語系清單(比 App Store 多 ur 和 bn):**
`en, zh-TW, zh-CN, ja, ko, es, fr, de, pt, it, ru, tr, id, vi, th, ar, hi, ur, bn`

**每個語系要做的:**

| 後台欄位 | 貼什麼 |
|---|---|
| 簡短說明 (Short description) | 該語系 `### Google Play` 底下 `**簡短說明 / SHORT DESCRIPTION**` 的內容 |
| 完整說明 (Full description) | 該語系 `### Google Play` 底下 `**完整說明 / FULL DESCRIPTION**` 的全部內容,去掉 `**` |

**Google Play 隨時可更新,不需要跟著版本送審** —— 所以這 19 個語系貼完就會上線。

---

## 三、貼完之後

1. **不要按送審。** 回報給創辦人:
   - App Store:17 個語系已貼(Promotional Text 已生效;Description 等下次版本送審)
   - Google Play:19 個語系已貼並生效
   - 過程中任何欄位超過字數上限、或後台拒絕的,**逐一列出來**,不要自行改短
2. 回報後由創辦人決定何時送審。
3. 送審完成後,請創辦人告知,以便把 `docs/claude/60-TRIGGERS.md` 的第 18 項標記為已結案。

---

## 字數上限(後台會擋,先知道)

| 欄位 | 上限 |
|---|---|
| App Store Subtitle | 30 |
| App Store Promotional Text | 170 |
| App Store Keywords | 100 |
| App Store Description | 4000 |
| Play 簡短說明 | 80 |
| Play 完整說明 | 4000 |

來源檔每個欄位都標了實際字數(例:`**SUBTITLE**（30/30）`)。**以「字元」計,不是位元組。**
注意 `id` 的 subtitle 是 30/30,**完全沒有餘裕** —— 但反正 subtitle 不動。
