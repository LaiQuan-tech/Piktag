# Event Photobooth

扶輪社活動現場拍照 → 自動去背 → 合成 5 張背景 → 加浮水印 → 雲端 + QR + 列印。

完整技術規格見 [`docs/SPEC.md`](docs/SPEC.md)。

## 目前狀態（v0.1）

只實作了**影像 pipeline**（去背 + 合成 + 浮水印），用 placeholder 素材，用來
跑你的真實照片看效果、調整 asset。其他模組（上傳、列印、watcher、Worker）等
這塊視覺效果定案再寫。

## 快速開始

```bash
cd event-photobooth
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 產生 placeholder 背景 + 浮水印（5 張漸層 + "LOGO" 字樣）
python scripts/generate_placeholders.py

# 跑一張你自己的照片
python scripts/process.py ~/Desktop/test.jpg

# 開啟看結果
open output/{8碼code}/
```

**第一次跑會下載 birefnet-portrait 模型約 400MB**，到 `~/.u2net/`。

## 換掉 placeholder 素材

```bash
# 把 5 張真實背景丟進去（檔名照順序排，pipeline 用排序後的前 5 張）
rm assets/backgrounds/*.jpg
cp /path/to/real_bg_*.jpg assets/backgrounds/

# 換 Logo
cp /path/to/rotary_logo.png assets/watermark.png
```

不用改任何 code。

## 調整視覺參數

`app/processor.py` 開頭幾個常數：

| 常數 | 預設 | 作用 |
|---|---|---|
| `WORKING_LONG_EDGE` | 2048 | 處理解析度（長邊）。越大越慢，4K 用 3000，網頁用 2048 |
| `JPEG_QUALITY` | 90 | 輸出品質。85 檔案小一半、肉眼幾乎看不出差，下載速度更快 |
| `CUTOUT_HEIGHT_RATIO` | 0.92 | 人像佔背景高度的比例。0.92 = 接近全幅 |
| `WATERMARK_WIDTH_RATIO` | 0.12 | 浮水印寬度佔畫面比例 |
| `WATERMARK_MARGIN_PX` | 40 | 浮水印離邊距 |

## 試不同去背模型

```bash
# 預設 birefnet-portrait（最佳人像，~2-5s/張 on M2）
python scripts/process.py test.jpg

# 較快的替代（~3x 快，品質 80 分 vs 95 分）
python scripts/process.py test.jpg --model isnet-general-use

# 通用 BiRefNet（人 + 物件都好）
python scripts/process.py test.jpg --model birefnet-general
```

## 已知限制（v0.1）

- 合成位置寫死「水平置中、底部對齊」。若某張背景需要把人靠左/靠右才順，
  目前要靠改背景圖去配合，不是改 code。Per-background anchor 是 v1.1 議題。
- HEIC 支援要看 Pillow 是否裝了 pillow-heif。iPhone 拍的 .HEIC 如果讀不到，
  `pip install pillow-heif` 即可。
- 無進度條 / 多檔批次。下一步 watcher 模組會接上。
