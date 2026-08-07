"""Long-running print worker.

Started ONCE by watcher.py and kept alive. Reads one code per line from
stdin, prints, writes "OK <ms>ms" or "ERR <msg>" to stdout.

This avoids the ~1-2s Python startup + module-import cost that the old
print_one.py subprocess paid on every single print.
"""

import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import PrinterConfig, load_dotenv  # noqa: E402
from app.printer import Printer  # noqa: E402

load_dotenv(ROOT / ".env")
cfg = PrinterConfig.from_env()
if cfg is None:
    print("ERR no printer config in .env", flush=True)
    sys.exit(1)

printer = Printer(cfg)

# Signal readiness to the parent process.
print("READY", flush=True)

def _check_paper() -> None:
    """Warn if the printer reports paper near-end. Best-effort — swallows all
    errors so a non-supporting printer doesn't break the print loop."""
    try:
        # DLE EOT 4 queries paper near-end sensor; response bit 3 = near end.
        import usb.core
        raw = usb.core.find(idVendor=cfg.vendor_id, idProduct=cfg.product_id)
        if raw is None:
            return
        raw.write(cfg.out_ep, b"\x10\x04\x04")
        resp = raw.read(cfg.in_ep, 1, timeout=300)
        if resp and (resp[0] & 0x0C):
            print("WARN paper near end — replace roll soon", flush=True)
    except Exception:
        pass


for line in sys.stdin:
    code = line.strip()
    if not code:
        continue
    try:
        _check_paper()
        # Suppress escpos library's print() warnings during print — they go to
        # stdout and break the IPC protocol (watcher reads the warning as the
        # response, "OK Xms" ends up in the buffer shifted by one print).
        _real_stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            result = printer.print_receipt(code)
        finally:
            sys.stdout = _real_stdout
        print(f"OK {result.duration_ms}ms", flush=True)
    except Exception as e:
        msg = str(e).lower()
        if "paper" in msg or "out of paper" in msg or "cover" in msg:
            print(f"WARN {type(e).__name__}: {e}", flush=True)
        else:
            print(f"ERR {type(e).__name__}: {e}", flush=True)
