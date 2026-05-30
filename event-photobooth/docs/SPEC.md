# Event Photobooth — 技術規格 v1.0

> 扶輪社活動現場拍照 → 自動去背 → 合成 5 張背景 → 加浮水印 →
> 上雲端 → 印 QR + 備援碼給來賓 → 來賓掃 QR 下載並看到 PikTag 入口

**狀態**：規格已敲定，待實作
**最後更新**：2026-05-28

---

## 0. North Star 與設計原則

1. **每位來賓獨立資料夾、不可猜的 URL** — 保護隱私是硬約束
2. **不擋現場流程** — 處理 + 列印 ≤ 30 秒 / 張原檔；列印失敗不能阻塞下一張
3. **離線優先** — 場館 Wi-Fi 不可信任，列印走 USB，上傳走背景重試
4. **簡單勝過聰明** — 5 張背景寫死、Logo 寫死、流程線性，不做配置介面
5. **PikTag 入口低調但確定觸達** — 不放在收據上（會被丟），放在下載落地頁底部

---

## 1. 系統架構

```
┌──────────────────────────────────────────────────────────────┐
│                        活動現場筆電                                 │
│                                                              │
│   ┌──────────┐   ┌─────────────────────────────────────┐     │
│   │  相機     │──▶│  inbox/  (watch folder)              │     │
│   │ tethered │   └─────────────────────────────────────┘     │
│   └──────────┘                    │                          │
│                                   ▼                          │
│              ┌────────────────────────────────────┐          │
│              │     Processing Pipeline (Python)     │          │
│              │  1. 產生 8 碼 code                    │          │
│              │  2. rembg birefnet-portrait 去背      │          │
│              │  3. Pillow 合成 5 張背景 + 浮水印      │          │
│              │  4. 寫入 outbox/{code}/{1-5}.jpg      │          │
│              │  5. 更新 SQLite state                 │          │
│              └────────────────────────────────────┘          │
│                       │                       │              │
│                       ▼                       ▼              │
│         ┌─────────────────────┐    ┌──────────────────┐      │
│         │ Uploader (async)     │    │ Printer (sync)    │      │
│         │ → Cloudflare R2      │    │ → V58-H ESC/POS   │      │
│         │ 5 張 JPEG            │    │ QR + 8 碼編號     │      │
│         └─────────────────────┘    └──────────────────┘      │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
           ┌──────────────────────────────────┐
           │   Cloudflare R2 (private bucket)   │
           │   rotary/{code}/{1-5}.jpg          │
           │   30 天 lifecycle 自動刪除          │
           └──────────────────────────────────┘
                            │
                            ▼
           ┌──────────────────────────────────┐
           │   Cloudflare Worker                │
           │   pikt.ag/rotary/{code}            │
           │   ├─ 產生落地頁 HTML                │
           │   └─ 從 R2 取圖（簽章 URL）         │
           └──────────────────────────────────┘
                            │
                            ▼
                       來賓的手機
                  （5 張照片 + PikTag 入口）
```

---

## 2. Tech Stack

| 層 | 選擇 | 理由 |
|---|---|---|
| 語言 | Python 3.11+ | rembg、Pillow、escpos 都是 Python 生態最成熟 |
| GUI | 最小化 — 終端 + 一個 status window（Tkinter / Rich） | 不做花俏介面，操作員看狀態即可 |
| 去背模型 | rembg + `birefnet-portrait` | 免費中肖像最強，髮絲級 |
| 影像處理 | Pillow (PIL) | 業界標準，合成 + 浮水印 + JPEG 編碼 |
| 檔案監視 | watchdog | Python 跨平台 file watcher |
| 狀態儲存 | SQLite（透過 stdlib `sqlite3`） | 零依賴、單檔、可靠 |
| 上傳 | boto3 → Cloudflare R2 (S3 相容) | R2 用 S3 SDK 即可 |
| 列印 | python-escpos | V58-H 走 USB ESC/POS |
| QR 生成 | qrcode (Python) | 印在收據上、嵌在落地頁也可用 |
| 落地頁/路由 | Cloudflare Worker (TypeScript) | 免費 10 萬 req/天，已遠遠夠用 |
| 短網域 | `pikt.ag` (已購) | QR 編碼更精簡，掃描更穩 |

---

## 3. 資料夾結構

### 3.1 Repo 結構

```
event-photobooth/
├── docs/
│   ├── SPEC.md             # 本文件
│   └── RUNBOOK.md          # 活動現場操作手冊（之後寫）
├── app/                    # Python 主程式
│   ├── __init__.py
│   ├── main.py             # 進入點
│   ├── config.py           # 設定載入（.env + config.toml）
│   ├── watcher.py          # inbox 監視
│   ├── pipeline.py         # 串接 processor / uploader / printer
│   ├── processor.py        # rembg 去背 + Pillow 合成
│   ├── uploader.py         # R2 上傳 + 重試
│   ├── printer.py          # V58-H USB ESC/POS
│   ├── code_gen.py         # 8 碼 Crockford 產生器
│   ├── state.py            # SQLite 狀態
│   └── status_window.py    # 簡易 status UI
├── assets/
│   ├── backgrounds/
│   │   ├── bg1.png         # 寫死 5 張背景
│   │   ├── bg2.png
│   │   ├── bg3.png
│   │   ├── bg4.png
│   │   └── bg5.png
│   └── watermark.png       # 透明 PNG Logo（主辦提供）
├── worker/                 # Cloudflare Worker
│   ├── src/
│   │   └── index.ts        # 路由 + 落地頁渲染
│   ├── wrangler.toml
│   └── package.json
├── scripts/
│   ├── test_printer.py     # 印測試收據
│   ├── test_upload.py      # 測 R2 連線
│   └── batch_process.py    # 離線批次處理（事後補救用）
├── config.toml             # 非機密設定
├── .env.example            # R2 credentials 範本（.env 加 .gitignore）
├── requirements.txt
└── README.md
```

### 3.2 執行時資料夾（活動筆電）

```
~/PhotoBooth/
├── inbox/                  # 相機 tethered 落地 / 或手動拖入
├── outbox/                 # 合成後成品
│   └── {CODE}/
│       ├── 1.jpg
│       ├── 2.jpg
│       ├── 3.jpg
│       ├── 4.jpg
│       └── 5.jpg
├── processed/              # 處理完的原檔備份
│   └── {CODE}_{原檔名}     # ← 保留 7 天後手動刪
├── errors/                 # 處理失敗的原檔（人工處理）
├── state.db                # SQLite 狀態
└── logs/
    └── {YYYY-MM-DD}.log
```

---

## 4. R2 Bucket 結構

**Bucket 名稱**：`piktag-events`（建議；user 自定）

```
piktag-events/
└── rotary/
    └── {CODE}/
        ├── 1.jpg
        ├── 2.jpg
        ├── 3.jpg
        ├── 4.jpg
        └── 5.jpg
```

**Lifecycle rule**：`rotary/*` 物件 → 30 天後自動刪除

**Bucket 設定**：
- **非公開** bucket（不能任意 list、不能 root access）
- Worker 透過 R2 binding 取檔，產生**簽章 URL**給來賓（24 小時過期、可重新生）
- 或：簡化版用公開 bucket，靠 8 碼 code 不可猜當作 gate（同 Google Photos 共享連結模型）
  - **推薦先用此簡化版**，未來要嚴格再升級簽章 URL

**CORS 設定**：允許 `pikt.ag` origin GET，其他擋掉

---

## 5. Cloudflare Worker 路由

### 5.1 路由表

| Path | 行為 |
|---|---|
| `pikt.ag/rotary/{CODE}` | 渲染落地頁 HTML，列出 5 張照片 + PikTag 入口 |
| `pikt.ag/rotary/` | 手動輸入 code 的查詢頁（QR 印壞備援） |
| `pikt.ag/rotary/{CODE}/dl/{1-5}` | 強制下載對應照片（`Content-Disposition: attachment`） |
| `pikt.ag/rotary/{CODE}/zip` | （v2，暫不做）打包 ZIP 下載 |
| 其他路徑 | 404 |

### 5.2 Code 驗證

- Code 格式：`^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$`（去 dash、轉大寫後）
- 不符合 → 404
- 符合但 R2 查無此 prefix → 404 + 「照片不存在或已過期」

### 5.3 落地頁 schema

```
┌──────────────────────────────────────┐
│ [扶輪社活動 Logo（小）]                  │
│                                       │
│ 你的活動紀念照 ✨                       │
│ 編號：K4Q8-M2P3                       │
│ ─────────────────                    │
│                                       │
│ [照片 1 縮圖] [照片 2 縮圖]            │
│ [照片 3 縮圖] [照片 4 縮圖]            │
│        [照片 5 縮圖]                  │
│                                       │
│ 點縮圖放大；長按或點下載按鈕保存              │
│                                       │
│ [ ⬇ 一鍵保存全部 ]                    │
│                                       │
│ ─────────────────                    │
│                                       │
│ 想記住今天認識的朋友？                    │
│ PikTag — 用 AI 標籤媒合人脈              │
│                                       │
│ [App Store] [Google Play]            │
│                                       │
│ 30 天後自動刪除                         │
└──────────────────────────────────────┘
```

技術細節：
- Tailwind via CDN 或 inline styles，**不要拉 npm 依賴讓 Worker bundle 變大**
- 圖片走 `<img src="https://{R2_PUB_URL}/rotary/{CODE}/1.jpg" loading="lazy">`
- 「一鍵保存全部」= 並排觸發 5 個 `<a download>`，手機端有些瀏覽器會擋，需測試
- iOS Safari 對 `download` attribute 不友善 → 長按圖片「儲存到照片」是更穩的指引
- PikTag App Store / Play 連結走 PikTag 主站既有的 deep link
- 落地頁底部極小字：「Powered by PikTag · pikt.ag」

### 5.4 Worker 部署

- 用 wrangler CLI
- 綁定到 `pikt.ag/rotary/*` route
- R2 bucket 用 binding（不是公開 URL）

---

## 6. Python 程式邏輯

### 6.1 主迴圈

```python
# app/main.py 主旨
watcher.start(inbox_path, on_new_file=enqueue)

while running:
    file = queue.get()  # blocking
    try:
        code = code_gen.new_unique(state_db)
        cutout = processor.remove_bg(file)
        outputs = processor.compose_all(cutout, backgrounds, watermark)
        processor.save_outputs(outputs, outbox_path / code)
        state.mark_processed(code, file)

        # 列印先（給來賓最重要）
        printer.print_receipt(code)
        state.mark_printed(code)

        # 上傳走背景 thread（不阻塞下一張）
        uploader.enqueue(code, outputs)

        # 原檔搬到 processed/
        move_to_processed(file, code)
    except Exception as e:
        log.error(...)
        move_to_errors(file)
```

### 6.2 8 碼產生器

```python
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # 32 chars, no 0/1/I/L/O/U

def new_unique(db) -> str:
    for _ in range(10):
        code = "".join(secrets.choice(ALPHABET) for _ in range(8))
        if not db.exists(code):
            db.reserve(code)
            return code
    raise RuntimeError("Code collision impossible — check RNG")

def display(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"  # K4Q8-M2P3
```

### 6.3 影像處理流程

```python
# processor.py
from rembg import remove, new_session

session = new_session("birefnet-portrait")

def remove_bg(input_path: Path) -> Image.Image:
    img = Image.open(input_path)
    # 長邊 resize 到 2048px，避免處理太慢
    img.thumbnail((2048, 2048), Image.LANCZOS)
    cutout = remove(img, session=session)  # 回傳 RGBA
    return cutout

def compose_one(cutout: Image, bg: Image, watermark: Image) -> Image:
    # bg 也預先 resize 到統一尺寸（例如 2048×1365，3:2 比例）
    canvas = bg.copy()
    # 把 cutout scale 到 canvas 高度的 90%，垂直置中、水平中下
    scale = canvas.height * 0.9 / cutout.height
    cutout_resized = cutout.resize(
        (int(cutout.width * scale), int(cutout.height * scale)),
        Image.LANCZOS
    )
    x = (canvas.width - cutout_resized.width) // 2
    y = canvas.height - cutout_resized.height
    canvas.paste(cutout_resized, (x, y), cutout_resized)  # alpha mask

    # 浮水印右下角，距邊 40px，寬 = canvas 寬的 12%
    wm = scale_to_width(watermark, int(canvas.width * 0.12))
    wm_x = canvas.width - wm.width - 40
    wm_y = canvas.height - wm.height - 40
    canvas.paste(wm, (wm_x, wm_y), wm)

    return canvas

def save_jpeg(img: Image, path: Path):
    img.convert("RGB").save(path, "JPEG", quality=90, optimize=True)
```

**合成位置取捨**：
- 預設「垂直置中、水平中下」對「站姿全身或半身」最通用
- 5 張背景如果有特殊構圖（例如左半邊是裝飾、人要靠右），需要 per-background 設定 anchor
- **v1.0 寫死統一位置；如果背景需要個別 anchor，下次反映**

### 6.4 R2 上傳

```python
# uploader.py
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name="auto",
)

def upload_set(code: str, files: list[Path]):
    for idx, f in enumerate(files, start=1):
        key = f"rotary/{code}/{idx}.jpg"
        s3.upload_file(str(f), BUCKET, key,
                       ExtraArgs={"ContentType": "image/jpeg",
                                  "CacheControl": "public, max-age=2592000"})
```

**上傳策略**：
- 主執行緒只負責 enqueue，**實際上傳在背景 thread pool**（2-3 workers）
- 失敗 → 指數退避重試 5 次（1s, 2s, 4s, 8s, 16s）
- 全部失敗 → 寫入 `state.db` 的 `upload_pending` 表，下次啟動時重試
- 不阻塞印刷或下一張處理

### 6.5 V58-H 列印

```python
# printer.py
from escpos.printer import Usb
import qrcode
from io import BytesIO
from PIL import Image

# VID/PID 從 lsusb 找；若印表機是 USB Class Printer，多數情況通用驅動可吃
printer = Usb(0xXXXX, 0xYYYY)

def print_receipt(code: str):
    url = f"https://pikt.ag/rotary/{code}"
    display_code = f"{code[:4]}-{code[4:]}"

    # 整張 render 成 384px 寬 bitmap，再交給印表機
    canvas = Image.new("L", (384, 380), color=255)  # 白底

    # QR 中央，~280px
    qr = qrcode.QRCode(border=2, box_size=10,
                       error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(url)
    qr.make()
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("L")
    qr_img.thumbnail((280, 280), Image.LANCZOS)
    canvas.paste(qr_img, ((384 - qr_img.width) // 2, 30))

    # 8 碼編號（大字、置中）
    from PIL import ImageDraw, ImageFont
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype("DejaVuSansMono-Bold.ttf", 36)
    text_w = draw.textlength(display_code, font=font)
    draw.text(((384 - text_w) // 2, 320), display_code, font=font, fill=0)

    printer.image(canvas)
    printer.cut()
```

**為什麼整張 render bitmap**：
- 不依賴印表機內建字型（中文支援不穩、不同批次可能不一樣）
- 排版完全可控
- 我們只需要 QR + 8 碼數字字母，bitmap 化的成本可忽略

---

## 7. 狀態 DB Schema

```sql
CREATE TABLE photos (
    code TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    processed_at INTEGER,
    printed_at INTEGER,
    uploaded_at INTEGER,
    upload_attempts INTEGER DEFAULT 0,
    error TEXT
);

CREATE INDEX idx_upload_pending ON photos(uploaded_at) WHERE uploaded_at IS NULL;
CREATE INDEX idx_created ON photos(created_at);
```

啟動時：找出 `processed_at IS NOT NULL AND uploaded_at IS NULL` 的，重新 enqueue 上傳。

---

## 8. Status Window（操作員監看）

最低需求：一個常駐的小視窗顯示：

```
┌─ Event Photobooth ─ ROTARY ──────────┐
│                                       │
│  今日處理：  342 / 5000               │
│  待處理：    2                        │
│  待上傳：    5                        │
│  已列印：    340                      │
│  錯誤：      0                        │
│                                       │
│  R2 連線：   ● 正常                   │
│  印表機：    ● 已連接                  │
│                                       │
│  最近處理 K4Q8-M2P3 (12 秒前)         │
└───────────────────────────────────────┘
```

實作可用 `rich` 套件做終端版，或 Tkinter 做視窗版。**v1.0 用 rich 終端版即可**，視窗版 v1.1 再加。

---

## 9. 錯誤處理 / 復原

| 錯誤情境 | 行為 |
|---|---|
| BG removal 失敗（少數圖 rembg 拋例外） | 重試 1 次 → 仍失敗 → 原檔移到 `errors/`，記錄到 DB |
| 合成失敗（OOM 等） | 重試 1 次 → 同上 |
| 列印失敗（USB 斷線） | 重試 3 次 → 仍失敗 → 螢幕警示，**處理繼續進行**（避免阻塞），操作員手動補印 |
| 上傳失敗 | 背景 thread 重試 5 次指數退避 → 寫入 `upload_pending`，下次啟動補傳 |
| 磁碟空間 < 5GB | 螢幕警示，繼續運作（5GB ≈ 還可處理 1000+ 張） |
| 磁碟空間 < 1GB | 停止接收新檔，等操作員處理 |
| 程式 crash | systemd（Linux）/ launchd（Mac）/ NSSM（Win）自動重啟，從 DB 恢復狀態 |

---

## 10. 部署到活動筆電

### 10.1 一次性安裝

```bash
# 假設 macOS
brew install python@3.11
git clone <repo>
cd event-photobooth
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# rembg 第一次跑會自動下載 birefnet-portrait 模型（~400MB），確保活動前先跑過
python scripts/test_upload.py    # 驗 R2
python scripts/test_printer.py   # 驗印表機
```

### 10.2 啟動

```bash
./scripts/start.sh
# 會啟動 main.py，建立 ~/PhotoBooth/* 資料夾，連 R2，連印表機，開始 watch
```

### 10.3 相機接入

三種方式（操作員選一種，事前測過）：
- **Sony Imaging Edge / Canon EOS Utility**：相機 USB tethered，直接落地到 `~/PhotoBooth/inbox/`
- **SD 卡讀卡機 + Image Capture (Mac)**：插卡後自動匯入到 `inbox/`
- **手動拖拉**：最簡單，但攝影師要每張手動

---

## 11. 活動現場 Runbook（草稿，詳細版另寫 RUNBOOK.md）

**事前一天**：
1. 筆電充電、檢查磁碟空間 > 50GB free
2. 印表機接 USB、裝紙、跑 `test_printer.py`
3. R2 cred 確認、跑 `test_upload.py`
4. 跑一張真實照片 end-to-end，掃 QR 確認落地頁正常
5. 5G/4G 路由器準備好當備援

**每天開場**：
1. 啟動程式
2. 印一張測試收據確認印表機
3. 拍一張測試照片走完整流程
4. 紙卷剩餘 < 30% 換新

**收場**：
1. 確認狀態視窗的「待上傳」歸零（可能要等幾分鐘）
2. 備份 `~/PhotoBooth/state.db` 到雲端硬碟
3. `processed/` 原檔保留 7 天再刪

---

## 12. 開發排程估算

| 階段 | 工時 | 內容 |
|---|---|---|
| 1. 環境 + 骨架 | 0.5 天 | repo、requirements、config、state.db |
| 2. 影像 pipeline | 1 天 | rembg + Pillow 合成 + 浮水印；本機驗證 |
| 3. 上傳 + R2 設定 | 0.5 天 | boto3、bucket、lifecycle、CORS |
| 4. 列印整合 | 1 天 | python-escpos + V58-H 實機測試（**需印表機到貨**） |
| 5. Watcher + 主迴圈 | 0.5 天 | watchdog + queue + 串接 |
| 6. Status UI | 0.5 天 | rich 終端版 |
| 7. Cloudflare Worker | 1 天 | 路由 + 落地頁 + R2 binding |
| 8. 錯誤處理 + 重試 | 0.5 天 | 各種失敗情境 |
| 9. 壓力測試 | 0.5 天 | 連續處理 100 張、模擬斷網 / 斷電 |
| 10. RUNBOOK + 部署腳本 | 0.5 天 | 給操作員的文件 |
| **總計** | **約 6.5 工作天** | 約 1.5 週 |

緩衝：再抓 30% buffer → **2 週實際** 可以從 0 做到活動 ready。

**前置依賴（先到才能開始）**：
1. V58-H 印表機（測 USB / ESC/POS 相容性）
2. 5 張背景圖檔（最終定稿）
3. 主辦方 Logo PNG（透明背景）
4. R2 帳號開好、bucket 建好
5. `pikt.ag` Cloudflare DNS / Workers 設定權限

**主機已敲定**：Mac mini M2 (2023, 16GB)
- rembg 啟用 CoreML execution provider 加速
- 預估 pipeline 7-11 秒/張，有 ~3× 緩衝
- 現場需備：螢幕、鍵鼠、Ethernet 線（場館有插孔的話）、USB hub（USB-A 只有 2 個）

---

## 13. 未列入 v1.0 的事（v1.1 或之後再做）

- 「主辦上傳背景套件」配置介面（v1.0 寫死）
- 簽章 URL（v1.0 用不可猜 code 當 gate）
- ZIP 一鍵下載（v1.0 個別下載）
- 來賓 email/手機驗證（v1.0 純 QR）
- 多印表機（v1.0 單機）
- 統計儀表板（v1.0 終端 status 即可）
- PikTag deep link 帶參數預填好友（v1.0 純下載連結）

---

## 14. 開放問題（等決策）

1. **主辦方 Logo**：等 PNG（透明背景，建議 ≥ 512px 寬）
2. **5 張背景**：等定稿 PNG / JPG（建議 2048×1365 統一尺寸、3:2 比例）
3. **PikTag App Store / Play Store 連結**：取現行 PikTag 主站上的連結即可
4. **R2 bucket 命名 + Cloudflare 帳號**：等開好給 access key

---

**規格結束 — 文件會隨實作演進，重大變動更新本文件並標記 changelog。**
