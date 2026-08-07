"""Batch-reprint labels for a list of codes (one per line in a file).

Used to recover labels that failed to print during an event (e.g. printer
USB dropped out). Prints each receipt sequentially with a small gap so the
thermal head doesn't overheat. Skips nothing — every code in the file prints.

Usage:
    python scripts/reprint_batch.py /tmp/reprint_real.txt
"""

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import PrinterConfig, load_dotenv  # noqa: E402
from app.printer import Printer  # noqa: E402

load_dotenv(ROOT / ".env")


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: reprint_batch.py <codes_file>")
    codes = [c.strip() for c in Path(sys.argv[1]).read_text().splitlines() if c.strip()]
    if not codes:
        sys.exit("no codes in file")

    cfg = PrinterConfig.from_env()
    if cfg is None:
        sys.exit("no printer config in .env")

    # Verify printer is on the USB bus before starting the batch.
    import usb.core
    if usb.core.find(idVendor=cfg.vendor_id, idProduct=cfg.product_id) is None:
        sys.exit("PRINTER NOT FOUND on USB — connect it and retry.")

    printer = Printer(cfg)
    print(f"Reprinting {len(codes)} labels …")
    ok = 0
    failed = []
    for i, code in enumerate(codes, start=1):
        try:
            r = printer.print_receipt(code)
            ok += 1
            print(f"  [{i}/{len(codes)}] {code}  OK {r.duration_ms}ms")
        except Exception as e:
            failed.append(code)
            print(f"  [{i}/{len(codes)}] {code}  FAILED: {type(e).__name__}: {str(e)[:60]}")
            # printer likely dropped — pause a moment before next attempt
            time.sleep(1.0)
        # small gap between prints so the head stays cool + paper feeds cleanly
        time.sleep(0.4)

    print(f"\nDone: {ok} printed, {len(failed)} failed.")
    if failed:
        Path("/tmp/reprint_failed.txt").write_text("\n".join(failed))
        print("Failed codes saved to /tmp/reprint_failed.txt (rerun on those).")


if __name__ == "__main__":
    main()
