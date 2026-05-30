"""Create placeholder backgrounds (5) and a placeholder watermark.

Run this once after first checkout to populate assets/. Replace these
files with the real assets (扶輪社 backgrounds + logo) when ready —
the pipeline reads from disk so no code changes needed.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BG_DIR = ROOT / "assets" / "backgrounds"
WM_PATH = ROOT / "assets" / "watermark.png"

# 3:2 landscape — matches typical DSLR aspect ratio so cutouts compose naturally
BG_SIZE = (2048, 1365)

# Visually distinct so you can tell at a glance which output came from which bg
BACKGROUNDS = [
    # name, top color, bottom color
    ("bg1_indigo",   (40, 60, 130),   (90, 130, 210)),
    ("bg2_sunset",   (255, 170, 100), (200, 70, 130)),
    ("bg3_studio",   (180, 180, 185), (110, 110, 115)),
    ("bg4_tropical", (200, 230, 150), (40, 110, 70)),
    ("bg5_cream",    (250, 240, 220), (210, 180, 140)),
]


def vertical_gradient(size, top_rgb, bottom_rgb) -> Image.Image:
    """Build a vertical gradient by drawing a 1px-wide strip and resizing."""
    w, h = size
    strip = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(top_rgb[i] * (1 - t) + bottom_rgb[i] * t) for i in range(3))
        strip.putpixel((0, y), c)
    return strip.resize(size, Image.LANCZOS)


def add_vignette(img: Image.Image, strength: float = 0.15) -> Image.Image:
    """Subtle dark vignette to give backgrounds depth."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    # Bright center, dark edges
    for i in range(20):
        bbox = (i * w // 60, i * h // 60, w - i * w // 60, h - i * h // 60)
        draw.ellipse(bbox, fill=int(255 * (1 - strength * i / 20)))
    mask = mask.filter(ImageFilter.GaussianBlur(80))
    black = Image.new("RGB", img.size, (0, 0, 0))
    return Image.composite(img, black, mask)


def generate_backgrounds():
    BG_DIR.mkdir(parents=True, exist_ok=True)
    for name, top, bottom in BACKGROUNDS:
        path = BG_DIR / f"{name}.jpg"
        if path.exists():
            print(f"  exists, skipping: {path.name}")
            continue
        img = vertical_gradient(BG_SIZE, top, bottom)
        img = add_vignette(img, strength=0.18)
        img.save(path, "JPEG", quality=92, optimize=True)
        print(f"  created: {path.name}")


def generate_watermark():
    if WM_PATH.exists():
        print(f"  exists, skipping: {WM_PATH.name}")
        return
    WM_PATH.parent.mkdir(parents=True, exist_ok=True)

    # 600x180 transparent canvas, white text at 65% opacity
    canvas = Image.new("RGBA", (600, 180), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Try a few likely-installed fonts; fall back to default
    font = None
    for candidate in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]:
        if Path(candidate).exists():
            try:
                font = ImageFont.truetype(candidate, 90)
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()

    text = "LOGO"
    # Center text in canvas
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (canvas.width - tw) // 2 - bbox[0]
    y = (canvas.height - th) // 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 165))

    canvas.save(WM_PATH, "PNG")
    print(f"  created: {WM_PATH.name}")


if __name__ == "__main__":
    print("Generating placeholder backgrounds...")
    generate_backgrounds()
    print("Generating placeholder watermark...")
    generate_watermark()
    print("\nDone. Replace these with real assets when ready:")
    print(f"  {BG_DIR}/*.jpg  (5 backgrounds)")
    print(f"  {WM_PATH}  (transparent PNG logo)")
