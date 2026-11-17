# Embedding v2 + reranker 影子模式（2026-11-18，創辦人核准「安全版」）

## 目的
收集資料，判斷開源 embedding／reranker 能不能：
(1) 讓向量可以建索引、放寬零結果備援只撈前 5 個的上限；
(2) 取代 auto-link-concepts 灰區（0.70–0.85）的 Gemini LLM judge。

**本階段不改任何線上決策**：
- `search_users`、停用詞表、linker 連結判斷、門檻全部不動。
- 線上只用 `embedding`（gemini-embedding-001，3072 維）。
- 換模型需創辦人另行核准（CLAUDE.md「Gemini 只用 2.5 家族」）。

## 選型（2026-11-18 用 HF API 探測，hf-inference 皆 live）
- **Embedding：`BAAI/bge-m3`**
  - 1024 維、MIT 授權。
  - 端點：`https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction`
  - 不選 Qwen3-Embedding-0.6B：它在 HF 的 hf-inference 上是 error，只有 deepinfra 可用。
- **Reranker：`BAAI/bge-reranker-v2-m3`**
  - Apache-2.0 授權，task 為 text-classification（句對）。
  - 備選 `Qwen/Qwen3-Reranker-0.6B`（hf-inference live，text-ranking）。
- **金鑰**：共用 `HF_TOKEN`，與 `_shared/hfFallback.ts` 同一把。沒設 = 整套 no-op。

## 元件
1. **Migration**
   - `tag_concepts.embedding_v2 vector(1024)` + `embedding_v2_model text` + HNSW 索引（vector_cosine_ops）。
   - 新表 `concept_judge_shadow`：記錄灰區 judge 的輸入與 Gemini 判決，供事後讓 reranker 重放。
     - 無 user FK（只存標籤文字與 concept id）。
     - RLS 開、無 policy，只有 service role 能讀寫。
2. **auto-link-concepts**：灰區呼叫 judge 之後，insert 一筆到 `concept_judge_shadow`。
   - 只寫 DB、不打 HF，失敗只記 log。
   - 不得增加 linker 的 HF 延遲：RUN_SOFT_DEADLINE 120s 是硬約束。
3. **新 edge fn `hf-shadow`**（CRON_SECRET gated），三個 action：
   - `backfill`：分批回填 `embedding_v2`。只會有約 595 個舊 concept 加上之後新鑄的。
   - `shadow`：對未評估的 judge 紀錄跑 reranker 與 v2 cosine，存分數。
   - `pairs`：已知同義／非同義詞對，回傳 Gemini 與 bge-m3 的 cosine 對照（不落庫）。
4. **daily-cron**：每天呼叫 `backfill` + `shadow`，失敗不擋其他 job。
5. **報表**：admin RPC，彙總 reranker 與 judge 的一致率，以及 v2 回填覆蓋率。

## 切換門檻（之後才討論，現在不做）
- **reranker 取代 judge**：至少 200 筆影子紀錄，且在 judge 判「是」的案例上 precision 不低於 judge（以人工抽查 judge 錯判為準）。
- **v2 取代 v1**：
  - `pairs` 的同義／非同義分得開。
  - 所有門檻（0.85／0.70／0.5／0.88）在 v2 分佈上重新校準。
  - 碰到搜尋的部分仍要先過 admin_search_funnel 重放。
