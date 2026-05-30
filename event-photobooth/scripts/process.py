"""CLI entry to process a single photo end-to-end (offline + optional upload).

Usage:
    python scripts/process.py path/to/photo.jpg
    python scripts/process.py path/to/photo.jpg --model isnet-general-use
    python scripts/process.py path/to/photo.jpg --no-upload

Output:
    output/{CODE}/1.jpg ... 5.jpg
    output/{CODE}/qr.png         (QR encoding pikt.ag/rotary/{CODE})

Upload to R2 runs automatically if .env is configured (and --no-upload not set).
If .env is missing/incomplete, upload is skipped silently — local files still produced.
"""

import argparse
import sys
from pathlib import Path

# Make `app` importable when running this file directly
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.code_gen import display, new_code  # noqa: E402
from app.config import SupabaseConfig, load_dotenv  # noqa: E402
from app.processor import Processor  # noqa: E402
from app.qr_gen import make_qr, url_for  # noqa: E402
from app.uploader import SupabaseUploader  # noqa: E402

BG_DIR = ROOT / "assets" / "backgrounds"
WM_PATH = ROOT / "assets" / "watermark.png"
# Write to the same canonical location as watch.py — one place to look for
# any output regardless of how the photo was processed.
OUTPUT_ROOT = Path.home() / "PhotoBooth" / "output"
ENV_FILE = ROOT / ".env"


def main():
    parser = argparse.ArgumentParser(description="Process one photo through bg-removal + 5-bg composite + watermark + QR + (optional) upload.")
    parser.add_argument("input", type=Path, help="Path to input photo (JPG/PNG/HEIC).")
    parser.add_argument(
        "--model",
        default="birefnet-portrait",
        help="rembg model. Default: birefnet-portrait. "
             "Try isnet-general-use for ~3x speed at slightly lower hair quality.",
    )
    parser.add_argument(
        "--code",
        default=None,
        help="Override auto-generated code (for reproducible test runs).",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Skip Supabase upload even if .env is configured.",
    )
    parser.add_argument(
        "--org",
        default="rotary",
        help="URL slug (pikt.ag/{org}/{code}). Default: rotary.",
    )
    args = parser.parse_args()

    if not args.input.exists():
        sys.exit(f"Input not found: {args.input}")

    backgrounds = sorted(BG_DIR.glob("*.jpg")) + sorted(BG_DIR.glob("*.png"))
    if len(backgrounds) < 5:
        sys.exit(
            f"Need 5 backgrounds in {BG_DIR}, found {len(backgrounds)}.\n"
            f"Run: python scripts/generate_placeholders.py"
        )
    if not WM_PATH.exists():
        sys.exit(
            f"Watermark not found at {WM_PATH}.\n"
            f"Run: python scripts/generate_placeholders.py"
        )

    # Load .env if present; falls through silently if not
    load_dotenv(ENV_FILE)

    print(f"Loading {args.model} model (first run downloads ~973MB)...")
    processor = Processor(
        backgrounds=backgrounds[:5],
        watermark_path=WM_PATH,
        model=args.model,
    )
    print(f"  providers: {processor.providers}")

    code = args.code or new_code()
    output_dir = OUTPUT_ROOT / code
    print(f"\nCode:    {display(code)}")
    print(f"Input:   {args.input.name}")

    # --- 1. Process image (bg removal + composite + watermark) ---
    result = processor.process(args.input, output_dir, code)

    print()
    print(f"  bg removal : {result.bg_remove_ms:>6} ms")
    print(f"  composite  : {result.compose_ms:>6} ms")
    print(f"  total      : {result.total_ms:>6} ms")

    # --- 2. Generate QR code ---
    url = url_for(code, org=args.org)
    qr_path = output_dir / "qr.png"
    make_qr(url, qr_path)
    print(f"\nQR:      {qr_path}")
    print(f"URL:     {url}")

    print(f"\nOutput:  {output_dir}")
    for p in sorted(output_dir.glob("*.jpg")):
        size_kb = p.stat().st_size // 1024
        print(f"  {p.name}  ({size_kb} KB)")

    # --- 3. Upload to R2 (if configured) ---
    if args.no_upload:
        print("\nUpload skipped (--no-upload).")
        return

    sb_cfg = SupabaseConfig.from_env()
    if sb_cfg is None:
        print("\nUpload skipped: .env missing or incomplete.")
        print(f"  Copy .env.example to .env and fill in Supabase credentials to enable.")
        return

    print(f"\nUploading to Supabase Storage (bucket={sb_cfg.bucket}, org={sb_cfg.org})...")
    uploader = SupabaseUploader(sb_cfg)
    ok, msg = uploader.check_connection()
    if not ok:
        print(f"  Supabase connection FAILED: {msg}")
        return

    photo_files = sorted(output_dir.glob("*.jpg"))[:5]
    up_result = uploader.upload_set(code, photo_files)
    mb = up_result.bytes_uploaded / 1024 / 1024
    print(f"  uploaded {len(up_result.keys)} files, {mb:.1f} MB in {up_result.duration_ms} ms")
    for url in up_result.public_urls:
        print(f"    {url}")


if __name__ == "__main__":
    main()
