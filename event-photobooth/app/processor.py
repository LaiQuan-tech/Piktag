"""Image processing pipeline: bg removal → composite onto 5 backgrounds → watermark.

Standalone module — no R2 / printer / state DB dependencies. Pure I/O so
the visual result can be iterated on independently.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Sequence

import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from rembg import new_session, remove


def _select_providers() -> list[str]:
    """Pick the best ONNX Runtime execution provider for this machine.

    CPU-only by default. CoreML is opt-in via EVENT_PHOTOBOOTH_USE_COREML=1
    because some macOS / onnxruntime combinations hang inside CoreAnalytics
    during birefnet-portrait load (process spins at 0% CPU emitting
    "Context leak detected, CoreAnalytics returned false" forever).
    On M2 the CPU path is ~10-15s/image — still well within budget — so
    we don't need to chase the CoreML speedup to ship.
    """
    available = ort.get_available_providers()
    use_coreml = os.environ.get("EVENT_PHOTOBOOTH_USE_COREML") == "1"
    preferred = []
    if use_coreml:
        preferred.append("CoreMLExecutionProvider")  # Apple Silicon (opt-in)
    preferred.extend([
        "CUDAExecutionProvider",     # NVIDIA GPU
        "CPUExecutionProvider",      # always available
    ])
    return [p for p in preferred if p in available]


# Working resolution: long edge capped here to bound bg-removal cost.
# 2048px is the sweet spot — quality indistinguishable from 4K for web/phone
# viewing, but ~4x faster than full-res for BiRefNet.
WORKING_LONG_EDGE = 2048

# Output JPEG quality. 90 = visually lossless for these subjects, ~1-2 MB / image
# at 2048x1365 — keeps R2 storage low and download fast.
JPEG_QUALITY = 90

# Cutout vertical fit: scale subject to this fraction of canvas height,
# anchored to bottom (typical event photo: standing or upper body).
CUTOUT_HEIGHT_RATIO = 0.92

# Watermark: width as fraction of canvas, margin from edges in px
WATERMARK_WIDTH_RATIO = 0.12
WATERMARK_MARGIN_PX = 40

# Event title overlay — rendered ON TOP of the cutout (in front of the person)
# at bottom-center. Three lines: title / subtitle / today's date. White text +
# soft drop shadow + thin black stroke = legible against any background.
TITLE_LINE_1 = "2026 Rotary International Convention in Taipei"
TITLE_LINE_2 = "House of Friendship"
TITLE_LINE_1_FONT_SIZE = 60      # main title
TITLE_LINE_2_FONT_SIZE = 38      # subtitle
TITLE_DATE_FONT_SIZE = 32        # today's date
TITLE_BOTTOM_MARGIN_PX = 60      # from canvas bottom up to the date line
TITLE_LINE_GAP_PX = 12
TITLE_SHADOW_OFFSET = 5
TITLE_SHADOW_BLUR_RADIUS = 6
TITLE_SHADOW_ALPHA = 200         # 0-255; higher = darker shadow
TITLE_STROKE_WIDTH = 2           # crisp 1-2 px outline for edge contrast

# Font selection — bold preferred for the main title, regular for subtitle.
# Tries macOS first, then Linux fonts. Falls back to PIL's default (small)
# if nothing found, which is ugly enough that it'd prompt manual fix.
TITLE_BOLD_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",  # tries index 8 = Bold
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
TITLE_REGULAR_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",  # index 0 = Regular
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


@dataclass
class ProcessResult:
    code: str
    input_path: Path
    output_paths: list[Path]
    bg_remove_ms: int
    compose_ms: int
    total_ms: int


class Processor:
    def __init__(
        self,
        backgrounds: Sequence[Path],
        watermark_path: Path,
        model: str = "birefnet-portrait",
    ):
        if len(backgrounds) != 5:
            raise ValueError(f"Need exactly 5 backgrounds, got {len(backgrounds)}")

        # Load bg images eagerly. They're reused across every photo, so this
        # avoids repeated decoding. Convert to RGB (no alpha needed for bg).
        self.backgrounds: list[Image.Image] = [
            Image.open(p).convert("RGB") for p in backgrounds
        ]
        self.background_names: list[str] = [p.stem for p in backgrounds]

        # Watermark stays RGBA — alpha mask is required for transparent paste
        self.watermark: Image.Image = Image.open(watermark_path).convert("RGBA")

        # rembg session: load model once, reuse for every image.
        # birefnet-portrait is the strongest free model for human subjects.
        # First call downloads ~973MB to ~/.u2net/.
        # Explicitly pass providers — rembg's default is CPU-only and ignores
        # CoreML/CUDA even when available.
        self.providers = _select_providers()
        self.session = new_session(model, providers=self.providers)

    def process(self, input_path: Path, output_dir: Path, code: str) -> ProcessResult:
        """Run full pipeline on one input photo. Writes 1.jpg ... 5.jpg to output_dir."""
        t0 = time.perf_counter()
        output_dir.mkdir(parents=True, exist_ok=True)

        # 1. Load + honor EXIF orientation (phones/cameras encode rotation in metadata,
        #    not pixels — without this, sideways portraits stay sideways)
        img = Image.open(input_path)
        img = ImageOps.exif_transpose(img)
        img.thumbnail((WORKING_LONG_EDGE, WORKING_LONG_EDGE), Image.LANCZOS)

        # 2. Background removal → RGBA cutout
        t_bg_start = time.perf_counter()
        cutout = remove(img, session=self.session)
        if cutout.mode != "RGBA":
            cutout = cutout.convert("RGBA")
        bg_ms = int((time.perf_counter() - t_bg_start) * 1000)

        # 3. Composite onto each background + watermark
        t_comp_start = time.perf_counter()
        output_paths: list[Path] = []
        for idx, bg in enumerate(self.backgrounds, start=1):
            composed = self._compose(cutout, bg)
            out_path = output_dir / f"{idx}.jpg"
            composed.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
            output_paths.append(out_path)
        comp_ms = int((time.perf_counter() - t_comp_start) * 1000)

        total_ms = int((time.perf_counter() - t0) * 1000)
        return ProcessResult(
            code=code,
            input_path=input_path,
            output_paths=output_paths,
            bg_remove_ms=bg_ms,
            compose_ms=comp_ms,
            total_ms=total_ms,
        )

    def _compose(self, cutout: Image.Image, bg: Image.Image) -> Image.Image:
        canvas = bg.copy()

        # Scale cutout so its height = CUTOUT_HEIGHT_RATIO of canvas height.
        # Anchored bottom-center: works for standing/seated/upper-body shots.
        # If a background's composition needs the subject off-center, we'd
        # add per-background anchor points — out of scope for v1.0.
        target_h = int(canvas.height * CUTOUT_HEIGHT_RATIO)
        scale = target_h / cutout.height
        new_size = (int(cutout.width * scale), target_h)
        cutout_resized = cutout.resize(new_size, Image.LANCZOS)

        x = (canvas.width - cutout_resized.width) // 2
        y = canvas.height - cutout_resized.height
        # Third arg = alpha mask. Without it, you get black halos around hair.
        canvas.paste(cutout_resized, (x, y), cutout_resized)

        # Title at bottom-center — drawn AFTER the cutout so it sits in front
        # of the person rather than getting hidden by their legs/feet.
        _draw_title_overlay(canvas)

        return canvas

    def _scaled_watermark(self, canvas_width: int) -> Image.Image:
        target_w = int(canvas_width * WATERMARK_WIDTH_RATIO)
        ratio = target_w / self.watermark.width
        target_h = int(self.watermark.height * ratio)
        return self.watermark.resize((target_w, target_h), Image.LANCZOS)


def _load_title_font(size: int, bold: bool) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load the first available font. For HelveticaNeue.ttc, picks the right
    style by index (bold=8, regular=0)."""
    candidates = TITLE_BOLD_FONT_CANDIDATES if bold else TITLE_REGULAR_FONT_CANDIDATES
    for path in candidates:
        if not Path(path).exists():
            continue
        try:
            if path.endswith("HelveticaNeue.ttc"):
                return ImageFont.truetype(path, size, index=8 if bold else 0)
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _measure(text: str, font) -> tuple[int, int, tuple[int, int, int, int]]:
    """Return (width, height, bbox) for `text` rendered with `font`."""
    img = Image.new("L", (1, 1))
    draw = ImageDraw.Draw(img)
    bbox = draw.textbbox((0, 0), text, font=font)
    return (bbox[2] - bbox[0], bbox[3] - bbox[1], bbox)


def _draw_text_with_shadow(
    canvas: Image.Image,
    text: str,
    font,
    y_pos: int,
):
    """Draw `text` horizontally centered at `y_pos` with soft drop shadow
    and white fill + thin black stroke. Mutates `canvas` in place."""
    text_w, _, bbox = _measure(text, font)
    x_pos = (canvas.width - text_w) // 2 - bbox[0]

    # 1) Soft drop shadow on a separate RGBA layer (so we can blur it).
    shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow_layer).text(
        (x_pos + TITLE_SHADOW_OFFSET, y_pos + TITLE_SHADOW_OFFSET),
        text,
        font=font,
        fill=(0, 0, 0, TITLE_SHADOW_ALPHA),
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(TITLE_SHADOW_BLUR_RADIUS))
    canvas.paste(shadow_layer, (0, 0), shadow_layer)

    # 2) White text + crisp black stroke (helps against busy/light backgrounds).
    ImageDraw.Draw(canvas).text(
        (x_pos, y_pos),
        text,
        font=font,
        fill=(255, 255, 255),
        stroke_width=TITLE_STROKE_WIDTH,
        stroke_fill=(0, 0, 0),
    )


def _format_event_date(d: date) -> str:
    """Format date as 'June. 13th, 2026' — full month name + period, day with
    English ordinal suffix, comma, year."""
    day = d.day
    if 10 <= day % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{d.strftime('%B')}. {day}{suffix}, {d.year}"


def _draw_title_overlay(canvas: Image.Image):
    """Render the three-line event title (title / subtitle / today's date)
    centered at the bottom of the canvas. Date auto-updates per process run."""
    font_main = _load_title_font(TITLE_LINE_1_FONT_SIZE, bold=True)
    font_sub = _load_title_font(TITLE_LINE_2_FONT_SIZE, bold=False)
    font_date = _load_title_font(TITLE_DATE_FONT_SIZE, bold=False)

    date_str = _format_event_date(date.today())

    _, h1, _ = _measure(TITLE_LINE_1, font_main)
    _, h2, _ = _measure(TITLE_LINE_2, font_sub)
    _, h3, _ = _measure(date_str, font_date)

    # Stack height (3 lines + 2 gaps). Place so the bottom of the date line
    # sits at canvas.height - TITLE_BOTTOM_MARGIN_PX.
    total_h = h1 + TITLE_LINE_GAP_PX + h2 + TITLE_LINE_GAP_PX + h3
    y = canvas.height - TITLE_BOTTOM_MARGIN_PX - total_h

    _draw_text_with_shadow(canvas, TITLE_LINE_1, font_main, y)
    y += h1 + TITLE_LINE_GAP_PX
    _draw_text_with_shadow(canvas, TITLE_LINE_2, font_sub, y)
    y += h2 + TITLE_LINE_GAP_PX
    _draw_text_with_shadow(canvas, date_str, font_date, y)
