"""Settings loaded from .env file + environment variables.

Keeps Supabase credentials out of git. Avoids extra `python-dotenv`
dependency — the .env format we need is a tiny subset (KEY=VALUE per line,
# comments).
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


def load_dotenv(path: Path) -> None:
    """Read .env into os.environ. Existing env vars take precedence."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class PrinterConfig:
    """V58-H USB thermal printer.

    Find VID/PID by plugging the printer in and running:
        system_profiler SPUSBDataType | grep -A 3 -i "vendor\\|usb printer"
    Or:
        ls /dev/usb 2>/dev/null  # (Linux only)
    Then set PRINTER_VENDOR_ID and PRINTER_PRODUCT_ID in .env as hex strings
    like 0x0483 and 0x5743.
    """
    vendor_id: int
    product_id: int
    # Optional: in_ep / out_ep override if libusb auto-detect picks wrong endpoints
    in_ep: int = 0x82
    out_ep: int = 0x02

    @classmethod
    def from_env(cls) -> Optional["PrinterConfig"]:
        vid = os.environ.get("PRINTER_VENDOR_ID")
        pid = os.environ.get("PRINTER_PRODUCT_ID")
        if not (vid and pid):
            return None
        try:
            return cls(
                vendor_id=int(vid, 16) if vid.startswith("0x") else int(vid, 16),
                product_id=int(pid, 16) if pid.startswith("0x") else int(pid, 16),
                in_ep=int(os.environ.get("PRINTER_IN_EP", "0x82"), 16),
                out_ep=int(os.environ.get("PRINTER_OUT_EP", "0x02"), 16),
            )
        except ValueError:
            return None


@dataclass(frozen=True)
class SupabaseConfig:
    url: str                  # https://xxxxxxxxxxxxxxxx.supabase.co
    service_role_key: str     # server-side secret — bypasses RLS
    bucket: str               # storage bucket name
    org: str                  # url path prefix; becomes pikt.ag/{org}/{code}

    @classmethod
    def from_env(cls) -> Optional["SupabaseConfig"]:
        """Return None if any required key is missing. Callers should
        treat None as 'upload disabled' rather than fatal."""
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        bucket = os.environ.get("SUPABASE_BUCKET")
        if not (url and key and bucket):
            return None
        return cls(
            url=url.rstrip("/"),
            service_role_key=key,
            bucket=bucket,
            org=os.environ.get("SUPABASE_ORG", "rotary"),
        )
