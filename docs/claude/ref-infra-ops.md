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
- [2026-07-12] 上線前總體檢(Android/iOS 過審後)方法與教訓:四路平行對抗審查
  (mobile 正確性 / backend+安全 / landing / UX+i18n),各自「只回可重現真問題+
  檔案:行號+嚴重度」,主對話彙整去重後只修存活的。真實產出:6 個可修真 bug、
  0 誤報。**最大類 = 除錯鷹架忘了拆**:2026-07-11 幽靈鎖故障排查時在
  linker-health-alert 塞了 embed 探針 + force-relay(清鎖+強制跑 linker),
  auto-link-concepts 加了 force 分支 —— 故障解了要**主動移除**,否則健康檢查每天
  多打 Gemini + 繞過並發互斥鎖(地雷)。規則:**incident 用的 force/probe/繞過碼,
  收尾時當成待辦拆掉**,只留零成本、有長期價值的(如 env key 指紋)。其餘真 bug
  類型供參:(1) 記錄先於送達→訊息失敗留幽靈記錄且 UNIQUE 擋重試(改送達優先);
  (2) throw new Error 塞硬編中文→蓋掉 catch 的 i18n fallback;(3) landing meta 雙重
  escapeHtml→分享卡顯示 &#039; 殘留(og:title 模式=原文組、只在插入點跳脫一次);
  (4) 內部 fetch 信任 client Host header→cache poisoning(寫死 origin);
  (5) 官方判斷用 username 字串比對而非 is_official 欄位(username 無 DB UNIQUE)。

### [2026-07-15] 部署毒藥:重複 migration 時間戳鎖死整條 Supabase Deploy
`schema_migrations` 的 PK 是 14 位版本號。兩個檔共用同一戳(本次
`20260712020000_contact_bridges_empty_guard` 與 `..._follows_cleanup_cascade`,
不同 session 平行建立)→ 第一個套用並記錄後,第二個套用時 INSERT 追蹤列撞
PK,`ERROR: duplicate key ... schema_migrations_pkey (SQLSTATE 23505)`,
**整個 db push 失敗並回滾**,而且每一次後續 push 都卡在同一顆毒藥(排在它
後面的新 migration 一起被擋、永遠套不進去)。症狀:Supabase Deploy 連續紅、
但 migration「內容」看起來都沒問題。
- **診斷**:`gh run view <id> --log-failed | grep 23505`,看它卡在哪個檔名。
- **修法**:把「未被記錄的那個」改成唯一新戳(`git mv`),body 不動(冪等就
  安全)。判斷哪個未記錄:deploy log 的 "Applying migration ..." 那行就是卡住
  的檔;另一個同戳檔才是已記錄的。
- **根因防呆**:CLAUDE.md 的「寫戳前 `ls | tail -3`」擋不住**平行 session**
  在你檢查後才建的同戳檔。建戳時盡量用當下分秒(非整點 000000),可大幅降低
  對撞。回寫 migration 前先 `git pull --rebase` 拉進別人的新檔再看尾巴。

- [2026-09-01] 觸發:某個修復 commit 進了 main、CI 全綠、大家都當它結案了 →
  規則:**修完先問「這個 surface 靠什麼把 main 送到使用者手上」**。沒有自動
  部署的 surface,commit ≠ 上線,必須當場部署或排進 CI。
  例:`e99c614`(8/17)修好 landing 的 `VALID_USERNAME`(舊正則不含點,擋掉
  app 自己產生的 `name.<數字>` 帳號,**112 個真實帳號中 48 個**分享連結與 QR
  全死)。程式碼正確、在 main、沒被改回,但 landing 是**唯一沒有 CI 部署的
  surface**(iOS/Android/Supabase 都會自己出貨,網站不會),而 Vercel 的 CLI
  部署當時自己也壞著(根目錄部署上傳 1.6GB,到 8/20 才用 `.vercelignore` 修)。
  結果修復躺了兩週,使用者端毫無改變,**沒有任何訊號會叫出來**。9/1 創辦人
  親測 `pikt.ag/karlcohen.71222` 仍是「找不到這個使用者」才發現。
  已補 `.github/workflows/deploy-landing.yml`(含 `workflow_dispatch`,手機也能
  觸發)+ `landing/scripts/check-username-pattern.cjs` 守住該正則。
- [2026-09-01] 觸發:想把「守衛正則」寫得比 signup 規則嚴 → 規則:**面向使用者
  的路由守衛只擋「明顯不是人」(靜態檔、含斜線),能不能查到人交給 DB 決定;
  守衛比 signup 嚴 = 直接讓真實使用者的連結消失**。
  例:同上。landing 現在刻意比 mobile 寬鬆(mobile 要 3–30 字,守衛接受 1 字),
  這是安全的方向;反過來收緊就是 48 人掉線的成因。`check-username-pattern.cjs`
  有一條 case 明文釘住這個方向,別「順手修正」它。
- [2026-09-01] 觸發:在 `.vercelignore` / `.dockerignore` 這類 gitignore 語意的檔案裡
  寫**裸目錄名** → 規則:**只想排除根目錄的,一定要加前導斜線 `/name`**。裸名會
  匹配任意深度的同名目錄。
  例:`545573d`(8/20,本意是修「部署上傳 1.6GB」)寫了裸的 `scripts`。根目錄
  **根本沒有** `scripts/`,但它把 `landing/scripts/` 一起排除了 —— 那裡放著
  `rename-shell.mjs`,正是 landing 的 `postbuild`。於是 8/20 之後**每一次部署都失敗**:
  `Command "npm ci && npm run build" exited with 1`。因為 landing 當時沒有部署
  自動化,沒人看到,8/17 的分享連結修復就這樣躺了兩週,48 個真實使用者的連結
  一直是死的。診斷法:本地 `cd landing && npm ci && npm run build` 會成功(檔案
  在),只有 Vercel 會失敗(檔案沒被上傳)—— **本地過、線上掛,先懷疑 ignore 檔**。
