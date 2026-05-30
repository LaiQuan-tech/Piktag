"""Image processing pipeline: bg removal → composite onto 5 backgrounds → watermark.

Standalone module — no R2 / printer / state DB dependencies. Pure I/O so
the visual result can be iterated on independently.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import onnxruntime as ort
from PIL import Image, ImageOps
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

        # Watermark in bottom-right corner
        wm = self._scaled_watermark(canvas.width)
        wm_x = canvas.width - wm.width - WATERMARK_MARGIN_PX
        wm_y = canvas.height - wm.height - WATERMARK_MARGIN_PX
        canvas.paste(wm, (wm_x, wm_y), wm)

        return canvas

    def _scaled_watermark(self, canvas_width: int) -> Image.Image:
        target_w = int(canvas_width * WATERMARK_WIDTH_RATIO)
        ratio = target_w / self.watermark.width
        target_h = int(self.watermark.height * ratio)
        return self.watermark.resize((target_w, target_h), Image.LANCZOS)
