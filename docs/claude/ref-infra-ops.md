# ref — 基礎設施與維運:admin 後台、Auth 信件、DNS、CI 陷阱、Gemini 模型、live-DB 探測

> 本檔內容 2026-07-06 自 CLAUDE.md 原文搬出(逐字,未改寫)。完整舊版:docs/claude/archive/CLAUDE-2026-07-06-full.md
> 檔內「see above / 上文」類指涉以舊版為準。

## Infra & ops — admin backend, auth emails, DNS (set 2026-06-07)

- **Ops/营运 data lives in the admin backend, NEVER the user app.** Founder
  verbatim: *"app 別做不關使用者的事情"* + *"所有營運的資料,你要顯示都顯示
  在後台"*. So:
    - The user app must NOT push internal telemetry. We REMOVED the
      concept-health digest, the linker-stall alert, AND the growth-pulse
      pushes (new-signup / first-friend triggers `notify_admin_new_signup`
      / `notify_admin_first_connection` were dropped). The
      `notify-admin-growth` edge fn + its `admin_alert` event are now
      dormant/unused — don't revive into the app.
    - Anything ops-facing goes in the **piktag-admin** Next.js app
      (`admin.pikt.ag`). Concept-graph health + GC merge candidates render
      on its **Tags page** (`app/(admin)/tags/page.tsx`) via read-only RPCs
      `admin_concept_graph_health()` + `admin_report_concept_merge_candidates()`
      (service-role; SECURITY DEFINER; 20260605060000).
- **Supabase Auth config is managed AS CODE**, not in the dashboard:
  `.github/workflows/supabase-auth-config.yml` PATCHes the Management API
  (`/v1/projects/<ref>/config/auth`) on push to `mobile/supabase/auth/**`.
  It sets `site_url`, **read-merge-writes** `uri_allow_list` (so existing
  OAuth/deep-link redirect URLs are never clobbered), the recovery email
  subject + template, and SMTP (when `SMTP_*` secrets exist). **NEVER use
  `supabase config push`** — it's declarative and would reset the
  dashboard-only Apple/Google OAuth providers.
- **Password reset uses the token_hash flow, NOT the PKCE ConfirmationURL.**
  Mobile is `flowType:'pkce'`, so a `{{ .ConfirmationURL }}` link
  (`/auth/v1/verify?token=pkce_…`) needs the code_verifier stored in the
  app's SecureStore — opening it in any browser fails ("invalid/expired")
  100% of the time. Fix: the recovery email links to
  `https://pikt.ag/reset-password?token_hash={{ .TokenHash }}&type=recovery`
  and `landing/src/pages/ResetPassword.tsx` calls
  `verifyOtp({type:'recovery', token_hash})` **at submit** (so email
  link-scanners can't pre-burn the one-time token). `recovery-email.html`
  is **English-only** (founder call — Supabase sends one template to all
  users regardless of app language; per-locale emails would need a custom
  edge-fn send pipeline, out of scope).
- **Branded sender via Resend custom SMTP** — `noreply@pikt.ag`, "PikTag".
  Secrets in GitHub Actions: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`,
  `SMTP_USER=resend`, `SMTP_PASS=<resend api key>`, `SMTP_SENDER_NAME=PikTag`,
  `SMTP_ADMIN_EMAIL=noreply@pikt.ag`. pikt.ag is verified in Resend (DKIM/
  SPF/MX/DMARC records live at Dynadot).
- **DNS facts.** `pikt.ag` is registered at **Dynadot**; DNS hosted on
  Dynadot's nameservers (`ns1/ns2.dyna-ns.net`) — **NOT** Vercel
  (`vercel domains inspect` shows the intended-NS ✘). So subdomain/email
  records (admin A 76.76.21.21, Resend DKIM/SPF/MX/DMARC on
  `resend._domainkey` + `send` + `_dmarc`) must be added **by hand in the
  Dynadot DNS panel** — browser automation of Dynadot does NOT work (its
  page never reaches `document_idle`, so every screenshot/read times out).
  Vercel CLI is authed as `lqtech2026`; the Vercel apex + a `*` wildcard
  ALIAS exist in Vercel's zone but are dormant until NS points at Vercel.
- **CI gotcha — pgvector `<=>` + search_path.** A `LANGUAGE sql` function
  using the `<=>` cosine operator MUST `SET search_path = public,
  extensions` (pgvector lives in `extensions`). A bare `search_path =
  public` throws 42883 at CREATE time, and because it's validated eagerly
  it FAILS the whole migration → `supabase db push` stops there and every
  later migration silently never applies. (This blocked the entire
  060000→140000 stack for hours on 2026-06-06.) plpgsql bodies are
  late-bound and don't hit this.
- **Gemini model ids — ONLY the 2.5 family is live (verified 2026-06-07
  by direct probe of the project key).** Google RETIRED
  `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.0-flash-001`,
  `gemini-1.5-flash`, `gemini-1.5-pro`, and the dated 2.5 previews — they
  return **404 "no longer available"**. The ONLY live chat models for this
  key are **`gemini-2.5-flash`** (quality) and **`gemini-2.5-flash-lite`**
  (the fast/cheap one — use it where speed matters: card-scan tagging,
  scan OCR-structuring). `gemini-flash-latest` also resolves but points at
  a thinking model (slower) — avoid. Embeddings stay `gemini-embedding-001`.
  Why this bit hard: every edge-fn model chain led with now-dead ids, so
  calls silently fell through to whatever live model was deeper in the
  chain — and suggest-tags' `fast` chain had NO live model at all →
  **503 on every card scan** (the "0 AI tags" bug, 2026-06-07). Two rules:
  (1) NEVER put a non-2.5 model id in a chain. (2) For 2.5 models, set
  `generationConfig.thinkingConfig.thinkingBudget = 0` on latency-
  sensitive calls (2.5 has thinking on by default; scan-business-card
  already does `if (model.startsWith('gemini-2.5'))`). When Google ships
  the next generation, re-probe before adding ids (a quick `{diag:true}`-
  style per-model status loop, then remove it).


## Live-DB 探測(寫 SQL / 依賴 schema 前必跑)

```bash
KEY=$(npx supabase projects api-keys --project-ref kbwfdskulxnhjckdvghj -o json \
  | python3 -c "import json,sys; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")
curl -s "https://kbwfdskulxnhjckdvghj.supabase.co/rest/v1/<table>?select=<col>&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
- 回 `[]` 或資料列 = 欄位存在;回 `42703` 錯誤 = 欄位不存在;`42P01` = 表不存在。
- RPC 探測:POST `…/rest/v1/rpc/<fn>` 同兩個 header + JSON body。
- 文件與探測結果衝突:**以探測為準,立刻回寫修文件**(實例:文件曾稱
  `piktag_user_tags.source` 存在,2026-07-06 探測證偽 —— source 是從
  owning table 推導的,不是欄位)。
- 用完 key 的暫存檔要刪;key 絕不進 commit。

## 踩坑補遺

- [2026-07-11] 觸發:概念覆蓋率掉破 60%、官方新標籤全是 concept 孤兒 → 根因:
  concept linker 的 embedding 呼叫**自 2026-06-22 起全數失敗**(tag_concepts 最後
  一筆 mint 停在 06-22;之後只有不需 Gemini 的 alias 連結還活)。表層症狀是
  `linker_run_lock` 卡死(fetch 無 timeout → 上游 hang → Deno worker 被 wall-clock
  強殺 → finally 的 releaseLock 跑不到 → 鎖永久佔用)。**兩層病**:(1) hang 已修
  (auto-link-concepts/index.ts 三個 Gemini fetch 加 AbortController,commit
  「AbortController timeout on Gemini fetches」);(2) 底層是 **GEMINI_API_KEY
  死掉/配額爆**——假 key 測 gemini-embedding-001 與 gemini-2.5-flash 都回
  400「API key not valid」證明**端點與模型都活著**,問題在那把真 key。
  規則:**concept 覆蓋率(admin_concept_coverage)是 embedding 健康的 canary**——
  掉了先懷疑 Gemini key/配額,不要只當冷啟動。**九支 fn 共用同一把 GEMINI_API_KEY**
  (auto-link-concepts / generate-embedding / semantic-tag-search / scan-business-card /
  suggest-tags / extract-search-intent / generate-icebreaker / generate-ask-title /
  notification-tag-suggest)——key 全死則**掃名片也掛**(北極星路徑),key 若只是
  embedding 配額爆則 2.5-flash 那幾支還活。修 key 是創辦人端(Supabase secret +
  Google AI Studio 配額/帳單),Claude 讀不到 secret 無法代修。診斷確認法:看
  Supabase edge fn logs 的「embedding upstream error: HTTP XXX」(401=key、
  429=配額、403=帳單)。

- [2026-07-11] 觸發:Google 標記 API key 公開外洩 → 根因:**public repo
  (LaiQuan-tech/Piktag)commit 了 `dist/`(Expo web build)**,舊版
  ManageTagsScreen 曾把 Gemini key 硬編進 client 直呼,build 產物把 key
  inline 進 bundle,commit 到公開 repo 就被掃到(順帶 Google Places key)。
  規則:**`dist/` 等 build 產物永遠不 commit**(已 gitignore);client 端
  絕不硬編 API key,一律走 edge fn(現在 ManageTagsScreen 走 suggest-tags,
  已修)。移除檔案**擋不掉歷史**——key 進過 public repo 就當作永久外洩,
  **唯一有效解是 Google console 換 key**;新 key 設 application/API 限制,
  server key 只進 Supabase secret。app.json/google-services.json 的
  Maps/Firebase client key 也在公開 repo,要靠簽章限制鎖死。
- [2026-07-11] 觸發:核心引擎(embedding linker)靜默停擺三週無人知 →
  根因:2026-06-06 移除了 linker 停擺告警(對:ops 不該在 app/user 通知
  流),但**沒有在後台補上替代監控**,16 天後 embedding 掛掉就沒有任何
  告警。教訓:**移除一個監控時,要嘛確認有別的東西涵蓋、要嘛同時建替代**,
  不能只拆不補。修法:後台 edge fn `linker-health-alert`(CRON_SECRET-gated,
  每天 daily-cron 觸發)覆蓋率 <60% 或最舊未連 >24h 就 email 創辦人
  (Resend,noreply@pikt.ag → lqtech2026)+ workflow exit 1 雙心跳;純後台、
  不寫 piktag_notifications。**concept 覆蓋率(admin_concept_coverage)是
  embedding 健康的 canary**,admin.pikt.ag 的 Algo Health 卡片也看得到。
- [2026-07-11] 觸發:key 修好、探針證明 embed+pgvector 全通,linker 卻仍零連結,
  每次都回「another linker run in progress」→ 根因:**PostgREST 幽靈鎖**——
  `.update({locked_at}).eq('id',1).or('locked_at.is.null,…').select()` 的
  UPDATE 會執行(鎖被設上)但 RETURNING 回空陣列,程式誤判「有人在跑」而
  自我跳過,無限輪空。規則:**mutex/條件更新絕不用 PostgREST 過濾鏈拼,
  一律寫成原子 SQL RPC**(`claim_linker_lock()` → UPDATE…RETURN FOUND,
  migration 20260711040000)。診斷法(可複用):linker-health-alert 的
  三層探針——(1) embed probe(key 指紋+HTTP 狀態)、(2) find_similar_concepts
  verdict、(3) relay:清鎖+帶 `{force:true}` 直接調用 linker 本尊、轉述其
  verbatim 回應。force 模式(CRON_SECRET-gated)保留在 auto-link-concepts,
  探針在不健康時會自動 force 一輪 = **自癒**。整案時間軸:6/22 Gemini API
  未啟用+key 死 → 7/11 換 key(途中 secret 一度被貼成佔位字「你的KE�」5 字元,
  探針的 key_len 指紋抓到)→ key 好了仍不動 → 幽靈鎖 → 原子宣告修復 →
  三輪 force 排空 103 → **覆蓋率 56.7% → 100%**。
