"""Standalone single-print helper, designed to be invoked as a subprocess.

Why a subprocess instead of running inline in watcher.py: when a print hangs
(printer firmware confused, USB cable wiggled, paper jam, cover ajar), the
USB write can block indefinitely with no clean Python-level way to abort.
Threads can't be killed; only a process can. By running each print in its
own subprocess and using subprocess.run(timeout=...), we get a hard kill
on hang and the OS reliably reclaims all USB handles.

Exit codes:
    0   printed successfully (stdout has "OK <ms>ms")
    1   configuration error (no printer config in .env)
    2   print raised an exception (stderr has traceback)
"""

import argparse
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import PrinterConfig, load_dotenv  # noqa: E402
from app.printer import Printer  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("code", help="8-char code to encode in the receipt QR")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    cfg = PrinterConfig.from_env()
    if cfg is None:
        print("printer config missing in .env", file=sys.stderr)
        sys.exit(1)

    try:
        result = Printer(cfg).print_receipt(args.code)
        print(f"OK {result.duration_ms}ms")
        sys.exit(0)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(f"ERR {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
