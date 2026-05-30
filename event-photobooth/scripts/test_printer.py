"""Standalone printer testing tool.

Two modes:
    python scripts/test_printer.py              # dry-run: render to PNG only
    python scripts/test_printer.py --real       # actually print (needs hardware)

Optional:
    --code KQ3XBDE7                              # specify code to encode
    --domain rotary.pikt.ag                      # override URL domain

Dry-run output goes to ~/PhotoBooth/output/test-receipt.png — open it to see
exactly what would print on the V58-H paper roll.
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.code_gen import display, new_code  # noqa: E402
from app.config import PrinterConfig, load_dotenv  # noqa: E402
from app.printer import Printer, dry_run  # noqa: E402

ENV_FILE = ROOT / ".env"
DEFAULT_OUTPUT = Path.home() / "PhotoBooth" / "output" / "test-receipt.png"


def main():
    parser = argparse.ArgumentParser(description="Test the V58-H thermal printer (dry-run or real).")
    parser.add_argument("--real", action="store_true", help="Actually print to USB printer (default: dry-run to PNG).")
    parser.add_argument("--code", default=None, help="Use a specific 8-char code. Default: random.")
    parser.add_argument("--domain", default="rotary.pikt.ag", help="URL domain to encode in QR. Default: rotary.pikt.ag.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT, help=f"Dry-run output path. Default: {DEFAULT_OUTPUT}")
    args = parser.parse_args()

    load_dotenv(ENV_FILE)
    code = args.code or new_code()

    print(f"Code:   {display(code)}")
    print(f"URL:    https://{args.domain}/{code}")

    if args.real:
        cfg = PrinterConfig.from_env()
        if cfg is None:
            sys.exit(
                "Printer config missing. Set PRINTER_VENDOR_ID and PRINTER_PRODUCT_ID\n"
                "in .env first. Find IDs with:\n"
                "    system_profiler SPUSBDataType | grep -A 4 -i 'vendor\\|printer'"
            )
        print(f"Mode:   REAL PRINT (VID=0x{cfg.vendor_id:04x}, PID=0x{cfg.product_id:04x})")
        printer = Printer(cfg, domain=args.domain)
        try:
            result = printer.print_receipt(code)
            print(f"\n✓ Printed in {result.duration_ms} ms ({result.bytes_sent} bytes raster)")
        finally:
            printer.close()
    else:
        print(f"Mode:   DRY-RUN → {args.out}")
        result = dry_run(code, args.out, domain=args.domain)
        size_kb = args.out.stat().st_size // 1024
        print(f"\n✓ Rendered in {result.duration_ms} ms ({size_kb} KB)")
        print(f"  Open with: open {result.bitmap_path}")


if __name__ == "__main__":
    main()
