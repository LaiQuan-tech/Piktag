"""V58-H thermal receipt printer.

Strategy: render the entire receipt as a 384px-wide bitmap in Pillow,
then ship it to the printer as a single ESC/POS image. We don't rely on the
printer's built-in font / QR commands — they vary between firmware revisions
and we want the receipt to look EXACTLY how we previewed it.

Receipt layout (in dots, 1 dot = 1/8mm at 203 DPI):
    ┌──────────── 384 dots wide (48 mm) ────────────┐
    │                  (30 dot top margin)          │
    │                                                │
    │              ┌────────────┐                    │
    │              │            │                    │
    │              │  QR  280×  │                    │
    │              │     280    │                    │
    │              │            │                    │
    │              └────────────┘                    │
    │                                                │
    │              K4Q8-M2P3        (36px mono bold)│
    │                                                │
    │           rotary.pikt.ag/K4Q8M2P3  (18px)     │
    │                                                │
    └────────────────────────────────────────────────┘
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import qrcode
from PIL import Image, ImageDraw, ImageFont
from qrcode.constants import ERROR_CORRECT_M

from .code_gen import display
from .config import PrinterConfig
from .qr_gen import url_for

# Physical printer constants (V58-H spec, also generic 58mm)
PRINT_WIDTH_DOTS = 384  # 48mm at 203 DPI

# Layout tunables — tweak if real-world print looks off
QR_BOX_SIZE = 9        # px per QR module; 9 yields ~280px at 8 module border
QR_BORDER = 2
TOP_MARGIN = 24
QR_TO_CODE_GAP = 24
CODE_TO_URL_GAP = 16
BOTTOM_MARGIN = 32

CODE_FONT_SIZE = 40
URL_FONT_SIZE = 20

# Font candidates, ordered by preference. Sticks to monospace bold for
# digit/letter alignment of the backup code.
FONT_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",            # macOS
    "/System/Library/Fonts/Monaco.ttf",           # macOS
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",  # Linux
    "C:\\Windows\\Fonts\\consolab.ttf",           # Windows
]


@dataclass
class PrintResult:
    code: str
    bitmap_path: Optional[Path]   # set in dry-run mode
    bytes_sent: Optional[int]     # set when actually printed
    duration_ms: int


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Find the first installed monospace font from our preference list.
    Falls back to PIL's default if none found (the default is small —
    receipts will still print but the code will look tiny)."""
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except (OSError, IOError):
                continue
    return ImageFont.load_default()


def _build_qr(data: str, box_size: int) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=QR_BORDER,
    )
    qr.add_data(data)
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").convert("L")


def render_receipt(code: str, domain: str = "rotary.pikt.ag") -> Image.Image:
    """Render the receipt to a 1-bit PIL Image ready for ESC/POS printing.

    Pure function — no I/O, no printer. Used by both the dry-run preview and
    the actual print path so what-you-see-is-what-you-print.

    Layout:
        [Photo QR]
        K4Q8-M2P3
        rotary.pikt.ag/...
    """
    display_code = display(code)
    short_url = url_for(code, domain=domain).replace("https://", "")

    qr_img = _build_qr(url_for(code, domain=domain), QR_BOX_SIZE)
    qr_w = min(qr_img.width, PRINT_WIDTH_DOTS - 16)
    qr_img.thumbnail((qr_w, qr_w), Image.LANCZOS)

    code_font = _load_font(CODE_FONT_SIZE)
    url_font = _load_font(URL_FONT_SIZE)

    _, code_h = _text_size(display_code, code_font)
    _, url_h = _text_size(short_url, url_font)

    total_h = (
        TOP_MARGIN
        + qr_img.height
        + QR_TO_CODE_GAP
        + code_h
        + CODE_TO_URL_GAP
        + url_h
        + BOTTOM_MARGIN
    )

    canvas = Image.new("L", (PRINT_WIDTH_DOTS, total_h), color=255)
    draw = ImageDraw.Draw(canvas)

    y = TOP_MARGIN
    canvas.paste(qr_img, ((PRINT_WIDTH_DOTS - qr_img.width) // 2, y))
    y += qr_img.height + QR_TO_CODE_GAP

    code_w, _ = _text_size(display_code, code_font)
    draw.text(((PRINT_WIDTH_DOTS - code_w) // 2, y), display_code, font=code_font, fill=0)
    y += code_h + CODE_TO_URL_GAP

    url_w, _ = _text_size(short_url, url_font)
    draw.text(((PRINT_WIDTH_DOTS - url_w) // 2, y), short_url, font=url_font, fill=0)

    return canvas


def _text_size(text: str, font) -> tuple[int, int]:
    """Pillow's textsize is deprecated; use textbbox to measure."""
    img = Image.new("L", (1, 1))
    draw = ImageDraw.Draw(img)
    bbox = draw.textbbox((0, 0), text, font=font)
    return (bbox[2] - bbox[0], bbox[3] - bbox[1])


class Printer:
    """Wraps python-escpos for our specific receipt layout.

    Opens a fresh USB connection on every print rather than caching, because
    a power-cycled printer gets a new USB address — a cached handle from the
    previous boot becomes invalid and every subsequent print fails with
    "No such device" until the watcher restarts. Fresh-open is robust to:
    printer reboot, USB cable unplug/replug, sleep/wake cycles.

    Cost: ~10-50 ms per print to enumerate USB. Trivial vs print itself."""

    def __init__(self, cfg: PrinterConfig, domain: str = "rotary.pikt.ag"):
        self.cfg = cfg
        self.domain = domain

    def print_receipt(self, code: str) -> PrintResult:
        """Render and print a receipt for `code`. Synchronous, ~1-2s on V58-H."""
        t0 = time.perf_counter()
        bitmap = render_receipt(code, domain=self.domain)

        # Imported lazily so a missing libusb / pyusb doesn't crash dry-run callers
        from escpos.printer import Usb
        import usb.core

        # Send a USB-level reset BEFORE python-escpos claims the device.
        # If a previous print attempt left the device in an iffy state
        # (claim-but-no-release, half-buffered ESC/POS, firmware confused
        # after a power cycle), this returns it to known-good before we
        # try to talk to it again. Swallow errors — if reset fails the
        # subsequent Usb() open will surface the real problem.
        try:
            raw = usb.core.find(
                idVendor=self.cfg.vendor_id,
                idProduct=self.cfg.product_id,
            )
            if raw is not None:
                raw.reset()
        except Exception:
            pass

        printer = Usb(
            idVendor=self.cfg.vendor_id,
            idProduct=self.cfg.product_id,
            in_ep=self.cfg.in_ep,
            out_ep=self.cfg.out_ep,
        )
        try:
            printer.image(bitmap, center=False, impl="bitImageRaster")
            printer.cut()
        finally:
            # Release the USB interface so the next print can re-enumerate
            # cleanly. Swallow errors here — we already got the data out.
            try:
                printer.close()
            except Exception:
                pass

        duration_ms = int((time.perf_counter() - t0) * 1000)
        return PrintResult(
            code=code,
            bitmap_path=None,
            bytes_sent=bitmap.width * bitmap.height // 8,
            duration_ms=duration_ms,
        )

    def close(self):
        # Kept for API compatibility — connections are now opened/closed per
        # print_receipt() call, so there's nothing to clean up here.
        pass


def dry_run(code: str, output_path: Path, domain: str = "rotary.pikt.ag") -> PrintResult:
    """Render the receipt as PNG to a file — for previewing without a printer."""
    t0 = time.perf_counter()
    bitmap = render_receipt(code, domain=domain)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bitmap.save(output_path, "PNG")
    duration_ms = int((time.perf_counter() - t0) * 1000)
    return PrintResult(
        code=code,
        bitmap_path=output_path,
        bytes_sent=None,
        duration_ms=duration_ms,
    )
