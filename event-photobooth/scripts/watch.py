"""Main event-day entry point: watch inbox/, auto-process every dropped photo.

Run this in a Terminal that stays open during the event. The photographer
drops/transfers photos into ~/PhotoBooth/inbox/; each one auto-processes,
uploads to Supabase, and (in the future) gets sent to the printer.

Stop with Ctrl+C.
"""

import argparse
import signal
import sys
import time
from pathlib import Path

# Make `app` importable when running this file directly
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from watchdog.observers import Observer

from app.config import PrinterConfig, SupabaseConfig, load_dotenv  # noqa: E402
from app.printer import Printer  # noqa: E402
from app.processor import Processor  # noqa: E402
from app.uploader import SupabaseUploader  # noqa: E402
from app.watcher import InboxHandler  # noqa: E402

BG_DIR = ROOT / "assets" / "backgrounds"
WM_PATH = ROOT / "assets" / "watermark.png"
ENV_FILE = ROOT / ".env"

# Real-world directories on the event laptop
PHOTOBOOTH_ROOT = Path.home() / "PhotoBooth"
INBOX = PHOTOBOOTH_ROOT / "inbox"
PROCESSED = PHOTOBOOTH_ROOT / "processed"
ERRORS = PHOTOBOOTH_ROOT / "errors"
OUTPUT_ROOT = PHOTOBOOTH_ROOT / "output"


def main():
    parser = argparse.ArgumentParser(description="Watch inbox/ and auto-process new photos.")
    parser.add_argument(
        "--model",
        default="birefnet-portrait",
        help="rembg model (default: birefnet-portrait). isnet-general-use is faster.",
    )
    parser.add_argument(
        "--org",
        default="rotary",
        help="URL slug for pikt.ag/{org}/{code}. Default: rotary.",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Don't upload to Supabase (local-only mode).",
    )
    parser.add_argument(
        "--no-print",
        action="store_true",
        help="Don't print receipts (useful for dev without printer connected).",
    )
    args = parser.parse_args()

    # Ensure dirs exist
    for d in (INBOX, PROCESSED, ERRORS, OUTPUT_ROOT):
        d.mkdir(parents=True, exist_ok=True)

    # Assets
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

    # Load .env if present
    load_dotenv(ENV_FILE)

    print(f"Loading {args.model} model …")
    processor = Processor(backgrounds=backgrounds[:5], watermark_path=WM_PATH, model=args.model)
    print(f"  providers: {processor.providers}")

    uploader = None
    if not args.no_upload:
        sb_cfg = SupabaseConfig.from_env()
        if sb_cfg is None:
            print("WARNING: .env missing Supabase keys — upload disabled.")
        else:
            uploader = SupabaseUploader(sb_cfg)
            ok, msg = uploader.check_connection()
            if not ok:
                sys.exit(f"Supabase connection failed: {msg}")
            print(f"  Supabase OK (bucket={sb_cfg.bucket}, org={sb_cfg.org})")

    printer = None
    if not args.no_print:
        pr_cfg = PrinterConfig.from_env()
        if pr_cfg is None:
            print("WARNING: .env missing PRINTER_VENDOR_ID/PRODUCT_ID — printing disabled.")
        else:
            printer = Printer(pr_cfg)
            print(f"  Printer config OK (VID=0x{pr_cfg.vendor_id:04x}, PID=0x{pr_cfg.product_id:04x})")

    handler = InboxHandler(
        processor=processor,
        uploader=uploader,
        printer=printer,
        output_root=OUTPUT_ROOT,
        processed_dir=PROCESSED,
        errors_dir=ERRORS,
        org=args.org,
    )

    observer = Observer()
    observer.schedule(handler, str(INBOX), recursive=False)
    observer.start()

    print()
    print(f"  Watching: {INBOX}")
    print(f"  Output:   {OUTPUT_ROOT}/{{CODE}}/")
    print(f"  Backup:   {PROCESSED}/")
    print()
    print("Drop photos into the inbox to process. Ctrl+C to stop.")
    print()

    # Catch anything already in inbox at startup (e.g. files dropped before
    # the watcher came up, or leftovers from a previous crashed session).
    handler.scan_inbox(INBOX)

    # Graceful stop
    stop = False

    def handle_signal(_sig, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        while not stop:
            time.sleep(0.5)
    finally:
        print("\nStopping watcher …")
        observer.stop()
        observer.join()
        print("Stopped.")


if __name__ == "__main__":
    main()
