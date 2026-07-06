# 10 — 模型調度守則(主對話 = 指揮官)

> 讀者:未來每個 session 的主模型(可能是 Sonnet/Opus/Haiku)。
> 原則一句話:**主對話做決策與整合,苦工派出去,結論收回來。**

## 1. 指揮官不下場 —— 硬門檻

以下情況**必須**派 subagent,不准在主對話親自做:

| 情況 | 門檻 | 派誰 |
|---|---|---|
| 讀檔/定位程式碼 | 一回合要讀 >2 個檔,或合計 >400 行 | `Explore`(唯讀搜索) |
| 掃 repo / 找所有呼叫點 / 盤點命名 | 任何跨目錄掃描 | `Explore`,指明廣度("medium" 或 "very thorough") |
| 查網頁 / 外部文件 | 任何需要 WebSearch/WebFetch 的研究 | `general-purpose` |
| 批次改檔 | >5 檔的機械性修改 | `general-purpose`;會互相衝突的並行改檔加 `isolation:"worktree"` |
| 設計實作計畫 | 跨 >3 檔的功能、或動到鎖定契約 | `Plan` |
| 驗收別人(或自己)的產出 | 一律 | fresh-context agent(見第 6 節) |

主對話**可以**自己做:≤2 檔的精準區段 Read(用 offset/limit)、單檔 Edit、
跑 tsc/git/curl、與使用者對話、整合各 agent 的結論。

例外:使用者明說「你直接看/直接改」時照辦,但仍用區段讀不讀全檔。

## 2. 派工三件套(每個 Agent prompt 必含)

1. **目標與動機**:做什麼 + 為什麼(讓 agent 在邊界情況能自行取捨)。
2. **驗收條件**:可機械判定的完成標準(「tsc 0 錯」「19/19 locale 有新 key」
   「回傳的每個檔案:行號都真實存在」),不是「做好一點」。
3. **回報格式**:明說要什麼形狀的答案(見第 4 節回報合約)。

缺任何一件 = 重寫 prompt 再派。模板直接抄 `30-TEMPLATES.md`。

## 3. model 與 effort 顯式指定

本環境 Agent 工具可用 model:`haiku`、`sonnet`、`opus`、`fable`
(fable 僅到 2026-07-07,之後從清單消失 —— 若指定失敗就退 `opus`)。
Workflow 的 agent() 另有 effort:`low`/`medium`/`high`/`xhigh`/`max`。

| 層級 | 用在 | 例 |
|---|---|---|
| `haiku` | 純機械:grep 彙整、單檔讀取摘要、格式檢查、字數統計 | 「列出所有 navigate('X') 呼叫點」 |
| `sonnet` | 標準工作:一般實作、多檔搜索+綜合、i18n 批次、翻譯、常規審查 | 「在 19 個 locale JSON 加 key 並驗證」 |
| `opus` | 難題:跨模組設計、纏手的 debug、對抗性驗證、最終審查、高風險判斷 | 「找出這個 race condition 的根因」 |
| 省略 model | 跟主對話同級即可時(預設繼承) | 多數驗收 agent |

原則:**能用低階就低階,但別為省錢冒險** —— 判斷錯誤的重工成本遠高於
模型差價。拿不準就用 sonnet;事關鎖定契約或不可逆操作就 opus。

**以當下環境為準**:本節與第 7 節提到的工具名/model/effort 檔位,一律以
你當下環境的實際工具清單為準 —— 找不到的名字視為不存在,不要硬呼叫
(harness 會改版;model 清單會變,例:fable 2026-07-07 後移除)。

## 4. 回報合約(subagent 的最終訊息)

- 只回**結論 + 依據**(`檔案:行號` 或指令輸出的關鍵行),不回貼整檔內容。
- 產物 >30 行(報告、diff、清單)→ **落檔**(scratchpad 或 repo 適當位置),
  回報只給路徑 + 3 行摘要。
- 找不到/做不到要明說 + 已排除了什麼,不准編造。
- 派工 prompt 裡把這條原文貼給 agent(agent 看不到本檔)。

## 5. 升降級路徑

- **haiku 錯 1 次** → 同任務直接升 sonnet(不重試 haiku)。
- **sonnet 同一子任務連錯 2 次** → 升 opus,prompt 附**完整失敗軌跡**
  (兩次的嘗試、錯誤輸出、已排除的假設)—— 不帶軌跡的升級 = 重犯一次。
- **解出模式後降級**:opus 解出的修法,套用到其餘 N 處時降回 sonnet/haiku
  批次執行(把 opus 的解法原樣貼進 prompt 當範本)。
- **同一件事最多重試 2 輪**;還不行 → 換方法或按 `20-JUDGMENT.md` 第 3/4 節
  停下來問使用者/換路,**不准第 3 輪同法重試**。
- 續用同一個 agent 的上下文:用 SendMessage 傳給該 agent(名字/ID),
  不要重開新 agent 重講一遍。

## 6. 驗證不自驗

寫的人不能當驗的人 —— 驗收一律派 **fresh-context agent**(新開,不給它
實作過程,只給驗收條件):

| 產物 | 驗法 |
|---|---|
| 檔案寫入(文件、config、i18n) | read-back:agent 讀實際檔案,核對驗收條件逐項打勾 |
| 程式碼 | 測試/tsc/實跑優先;無測試時 agent 讀 diff + 追關鍵路徑的呼叫鏈 |
| DB/migration | live 探測(ref-infra-ops 的食譜)讀回實際狀態,不看 SQL 文字自嗨 |
| 高風險判斷(動鎖定契約、不可逆操作前) | 第二意見:另派一個 opus 只問「反對這個做法的最強理由」;或 3 個 agent 各自獨立做,再派 judge 選優 |

驗收 agent 回報「不過」→ 修 → 再派**新的** fresh-context agent(不是同一個)。

## 7. 並行與 Workflow

- 互不依賴的 agent **同一則訊息一起派**(並行跑)。
- 會同時改檔的並行 agent 各給 `isolation:"worktree"`。
- **Workflow 工具只在使用者明說要多代理編排時用**(關鍵字 ultracode、
  「用 workflow」等)。沒說就用單發 Agent —— 這是 harness 的成本規則,
  不是建議。本專案慣例:重大重構後的深掃才用 workflow(創辦人會主動說)。

## 8. 主對話 context 保養

- 收到 agent 回報後,**用自己的話一句總結進下一步**,別把回報原文再引用一遍。
- 任務切換時用 mark_chapter 分章。
- 感覺 context 過半:把已確立的決策落檔(講定即落檔),之後壓縮才不失真。
