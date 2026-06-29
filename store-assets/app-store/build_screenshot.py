#!/usr/bin/env python3
"""Build PikTag App Store marketing screenshots.

LINE-style layout: purple→pink gradient background, big bold title at top,
small subtitle below, simplified rounded-white phone frame containing the
real app screenshot below.

Output: 1320×2868 PNG per card (iPhone 17 Pro Max / 6.9" ASC slot).
"""
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# SS_LANG = one of the 17 caption locales (default zh-TW). zh-TW reads the
# Chinese app screenshots from screenshots-6.9/ and writes to
# screenshots-6.9-marketing/; every other locale reads the ENGLISH app-
# screen set (screenshots-6.9-en/, NA primary market) and writes to
# screenshots-6.9-marketing-<locale>/. Captions live in captions.py.
LANG = os.environ.get("SS_LANG", "zh-TW")
from captions import CARDS_BY_LANG, CHIP_BY_LANG  # noqa: E402

# ── Canvas / brand ─────────────────────────────────────────────────────
W, H = 1320, 2868
# Brand purple→pink gradient. piktag500 = #8c52ff, end = pink-500 #ec4899.
GRAD_START = (140, 82, 255)   # purple
GRAD_END = (236, 72, 153)     # pink
WHITE = (255, 255, 255)
DARK = (255, 255, 255)        # title color on gradient

# ── Layout ─────────────────────────────────────────────────────────────
PAD_X = 90
TITLE_TOP = 208
TITLE_LINE_GAP = 14
SUBTITLE_GAP = 44
PHONE_TOP = 724
# Aspect-match source 1320×2868 so the screenshot fits without bottom crop.
# inner aspect = 952/2068 ≈ 0.460 = source aspect. Outer adds border 14×2.
PHONE_W = 980
PHONE_H = 2096
PHONE_RADIUS = 70    # phone corner radius
PHONE_BORDER_W = 14  # white frame thickness
PHONE_SHADOW_BLUR = 60

# ── Fonts ──────────────────────────────────────────────────────────────
# CJK locales use Hiragino (full CJK coverage). Every other locale uses Arial,
# which renders Latin Extended (œ, î), Vietnamese/Turkish diacritics, Cyrillic,
# AND a normal-width apostrophe — Hiragino lacks œ/î and draws ' full-width
# (the "d' œil → d' [tofu]" bug the founder caught on the fr card 2026-06-27).
_CJK_LANGS = {"zh-TW", "zh-CN", "ja"}
# League Spartan = PikTag brand typeface (2026-06-27). It is Latin-only — covers these
# 8 locales but NOT Vietnamese/Cyrillic, so vi/ru stay on Arial; CJK stays
# Hiragino. (See memory: piktag-brand-typeface-outfit.)
_LSPARTAN_LANGS = {"en", "de", "fr", "es", "pt", "it", "id", "tr"}
_IS_CJK = LANG in _CJK_LANGS
_IS_LSPARTAN = LANG in _LSPARTAN_LANGS
_HERE = os.path.dirname(os.path.abspath(__file__))
HIRAGINO = "/System/Library/Fonts/Hiragino Sans GB.ttc"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
LSPARTAN = os.path.join(_HERE, "fonts", "LeagueSpartan-Regular.ttf")
LSPARTAN_BOLD = os.path.join(_HERE, "fonts", "LeagueSpartan-Bold.ttf")
FONT_PATH = HIRAGINO  # legacy alias (sparkle/decoration only)
TITLE_FONT_SIZE = 116
SUBTITLE_FONT_SIZE = 62   # was 48 — founder 2026-06-29: caption too small for older eyes


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    if _IS_CJK:
        return ImageFont.truetype(HIRAGINO, size, index=(2 if bold else 0))
    if _IS_LSPARTAN:
        return ImageFont.truetype(LSPARTAN_BOLD if bold else LSPARTAN, size)
    return ImageFont.truetype(ARIAL_BOLD if bold else ARIAL, size)  # vi, ru


def gradient_bg() -> Image.Image:
    """Diagonal purple→pink gradient covering 1320×2868."""
    bg = Image.new("RGB", (W, H), GRAD_START)
    px = bg.load()
    # Diagonal blend: t = (x + y) / (W + H), where t∈[0,1] interpolates colors.
    denom = float(W + H)
    for y in range(H):
        for x in range(W):
            t = (x + y) / denom
            r = int(GRAD_START[0] * (1 - t) + GRAD_END[0] * t)
            g = int(GRAD_START[1] * (1 - t) + GRAD_END[1] * t)
            b = int(GRAD_START[2] * (1 - t) + GRAD_END[2] * t)
            px[x, y] = (r, g, b)
    return bg


def draw_text_centered(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    y: int,
    color: tuple,
) -> int:
    """Draw text horizontally centered. Returns the bottom y of drawn text."""
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (W - text_w) // 2
    # Subtle drop shadow for readability on gradient.
    shadow_offset = 4
    draw.text((x + shadow_offset, y + shadow_offset), text, font=font, fill=(0, 0, 0, 60))
    draw.text((x, y), text, font=font, fill=color)
    return y + text_h


def wrap_title(title: str) -> list:
    """Split the title into visual lines. An explicit '\\n' in the caption
    forces the break (used by the localized captions); otherwise fall back
    to splitting on a full-width / half-width comma for the en/zh authored
    titles."""
    if "\n" in title:
        return title.split("\n")
    if "，" in title and len(title) > 9:
        return title.split("，", 1)
    if ", " in title and len(title) > 18:
        return [p.strip() for p in title.split(", ", 1)]
    return [title]


def wrap_to_width(draw, text, font, max_width):
    """Greedy-wrap text to fit max_width px. Word-wraps on spaces (Latin/
    Cyrillic); falls back to per-character wrapping for space-less CJK."""
    text = text.strip()
    if not text:
        return [""]
    units = text.split(" ") if " " in text else list(text)
    joiner = " " if " " in text else ""
    lines, cur = [], ""
    for u in units:
        trial = (cur + joiner + u) if cur else u
        if not cur or draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            lines.append(cur)
            cur = u
    if cur:
        lines.append(cur)
    return lines


def round_corners(im: Image.Image, radius: int) -> Image.Image:
    """Round the corners of an RGBA image with a soft mask."""
    mask = Image.new("L", im.size, 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, im.size[0], im.size[1]), radius=radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def paste_phone(
    bg: Image.Image, app_screenshot_path: str
) -> None:
    """Paste the app screenshot inside a rounded white phone frame, centered.

    Frame = white rounded rect bigger than the screenshot by PHONE_BORDER_W
    on each side. Drop shadow on the frame.
    """
    # Load + resize the app screenshot to fit inside the inner rect.
    inner_w = PHONE_W - PHONE_BORDER_W * 2
    inner_h = PHONE_H - PHONE_BORDER_W * 2
    inner_radius = PHONE_RADIUS - PHONE_BORDER_W
    screenshot = Image.open(app_screenshot_path).convert("RGBA")
    # Fit-to-cover the inner rect (preserve aspect, crop the overflow).
    src_w, src_h = screenshot.size
    target_aspect = inner_w / inner_h
    src_aspect = src_w / src_h
    if abs(src_aspect - target_aspect) < 0.005:
        # Aspects match (phone frame is now sized to source aspect) — no crop.
        pass
    elif src_aspect > target_aspect:
        # source wider — crop horizontally, centered.
        new_w = int(src_h * target_aspect)
        offset_x = (src_w - new_w) // 2
        screenshot = screenshot.crop((offset_x, 0, offset_x + new_w, src_h))
    else:
        # source taller — center-crop vertically (preserve both top & bottom).
        new_h = int(src_w / target_aspect)
        offset_y = (src_h - new_h) // 2
        screenshot = screenshot.crop((0, offset_y, src_w, offset_y + new_h))
    screenshot = screenshot.resize((inner_w, inner_h), Image.LANCZOS)
    screenshot = round_corners(screenshot, inner_radius)

    # Build the white-frame layer (PHONE_W × PHONE_H), rounded.
    frame_layer = Image.new("RGBA", (PHONE_W, PHONE_H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame_layer)
    fd.rounded_rectangle(
        (0, 0, PHONE_W, PHONE_H), radius=PHONE_RADIUS, fill=WHITE
    )
    # Inset the screenshot at PHONE_BORDER_W offset.
    frame_layer.paste(
        screenshot, (PHONE_BORDER_W, PHONE_BORDER_W), screenshot
    )

    # Drop shadow: blurred black rect under the frame.
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    phone_x = (W - PHONE_W) // 2
    phone_y = PHONE_TOP
    sd.rounded_rectangle(
        (phone_x, phone_y + 24, phone_x + PHONE_W, phone_y + PHONE_H + 24),
        radius=PHONE_RADIUS,
        fill=(0, 0, 0, 120),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=PHONE_SHADOW_BLUR))
    bg.paste(shadow, (0, 0), shadow)

    # Paste the actual phone frame on top.
    bg.paste(frame_layer, (phone_x, phone_y), frame_layer)


def draw_sparkle(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int, alpha: int = 200) -> None:
    """Draw a 4-point sparkle (✦) centered at (cx, cy)."""
    color = (255, 255, 255, alpha)
    # Two diamond shapes — one horizontal, one vertical — overlapping
    half = size
    quarter = size // 4
    # Vertical diamond
    draw.polygon(
        [(cx, cy - half), (cx + quarter, cy), (cx, cy + half), (cx - quarter, cy)],
        fill=color,
    )
    # Horizontal diamond
    draw.polygon(
        [(cx - half, cy), (cx, cy - quarter), (cx + half, cy), (cx, cy + quarter)],
        fill=color,
    )


def draw_chip(
    bg: Image.Image,
    cx: int,
    cy: int,
    label: str,
    icon: str = "",
    gradient: tuple = ((255, 255, 255), (250, 240, 255)),
) -> None:
    """Floating callout chip — rounded pill, two-tone gradient, icon + text.

    Centered at (cx, cy). Auto-sizes to fit text + icon.
    """
    font = load_font(44, bold=True)
    icon_font = load_font(50, bold=True)
    # Measure text + icon
    text_bbox = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox(
        (0, 0), label, font=font
    )
    text_w = text_bbox[2] - text_bbox[0]
    text_h = text_bbox[3] - text_bbox[1]
    icon_w = 0
    if icon:
        ib = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox(
            (0, 0), icon, font=icon_font
        )
        icon_w = ib[2] - ib[0] + 20
    pad_x = 36
    pad_y = 24
    chip_w = icon_w + text_w + pad_x * 2
    chip_h = max(text_h, 50) + pad_y * 2

    chip = Image.new("RGBA", (chip_w + 60, chip_h + 60), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chip)
    # Drop shadow
    shadow = Image.new("RGBA", chip.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (30, 30 + 12, 30 + chip_w, 30 + chip_h + 12),
        radius=chip_h // 2,
        fill=(0, 0, 0, 90),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=14))
    chip.paste(shadow, (0, 0), shadow)
    # Pill background — vertical gradient
    for y in range(chip_h):
        t = y / max(chip_h - 1, 1)
        r = int(gradient[0][0] * (1 - t) + gradient[1][0] * t)
        g = int(gradient[0][1] * (1 - t) + gradient[1][1] * t)
        b = int(gradient[0][2] * (1 - t) + gradient[1][2] * t)
        cd.line(
            [(30, 30 + y), (30 + chip_w, 30 + y)], fill=(r, g, b, 255)
        )
    # Re-mask to pill shape
    mask = Image.new("L", chip.size, 0)
    mk = ImageDraw.Draw(mask)
    mk.rounded_rectangle(
        (30, 30, 30 + chip_w, 30 + chip_h),
        radius=chip_h // 2,
        fill=255,
    )
    chip.putalpha(mask)

    # Icon + text
    cd2 = ImageDraw.Draw(chip)
    text_x = 30 + pad_x + icon_w
    text_y = 30 + (chip_h - text_h) // 2 - 6
    if icon:
        cd2.text(
            (30 + pad_x, 30 + (chip_h - icon_w) // 2 - 4),
            icon,
            font=icon_font,
            fill=(120, 70, 220),
        )
    cd2.text((text_x, text_y), label, font=font, fill=(40, 30, 70))

    # Paste centered at (cx, cy) of bg
    px = cx - chip.size[0] // 2
    py = cy - chip.size[1] // 2
    bg.paste(chip, (px, py), chip)


# Per-card decorative extras (chips + sparkles). Key = 1-based card index.
_SPARKLES = [
    (130, 460, 32),
    (1200, 510, 28),
    (90, 2580, 36),
    (1240, 2540, 30),
    (200, 1550, 22),
    (1170, 1400, 22),
]
_G_WHITE = ((255, 255, 255), (240, 230, 255))  # white→pale-purple
_G_PINK = ((255, 235, 250), (240, 220, 255))   # pink→pale-purple

_CHIP_FAST, _CHIP_AI = CHIP_BY_LANG[LANG]

CARD_EXTRAS = {
    1: {"sparkles": [], "chips": []},
    2: {"sparkles": [], "chips": []},
    # Chips only on the card-scan card (now #3 after the 2026-06-11
    # story reorder) per founder.
    3: {
        "sparkles": [],
        "chips": [
            (220, 1120, _CHIP_FAST, "", _G_WHITE),
            (1100, 1900, _CHIP_AI, "", _G_PINK),
        ],
    },
    4: {"sparkles": [], "chips": []},
    5: {"sparkles": [], "chips": []},
    6: {"sparkles": [], "chips": []},
}


def build(
    title: str, subtitle: str, app_screenshot_path: str, out_path: str,
    extras=None
) -> None:
    bg = gradient_bg().convert("RGBA")
    draw = ImageDraw.Draw(bg)
    title_font = load_font(TITLE_FONT_SIZE, bold=True)
    sub_font = load_font(SUBTITLE_FONT_SIZE, bold=False)
    max_w = W - 2 * PAD_X
    title_lh = int(TITLE_FONT_SIZE * 1.16)
    sub_lh = int(SUBTITLE_FONT_SIZE * 1.32)

    # Title — explicit \n parts, each auto-wrapped to fit the canvas width.
    y = TITLE_TOP
    for part in wrap_title(title):
        for line in wrap_to_width(draw, part, title_font, max_w):
            draw_text_centered(draw, line, title_font, y, WHITE)
            y += title_lh

    # Subtitle — auto-wrapped, may span multiple lines.
    y += SUBTITLE_GAP
    for line in wrap_to_width(draw, subtitle, sub_font, max_w):
        draw_text_centered(draw, line, sub_font, y, WHITE)
        y += sub_lh

    # Phone with screenshot.
    paste_phone(bg, app_screenshot_path)

    # Optional decorations: sparkles + floating chips on top of phone layer.
    if extras:
        deco = Image.new("RGBA", bg.size, (0, 0, 0, 0))
        dd = ImageDraw.Draw(deco)
        for cx, cy, size in extras.get("sparkles", []):
            draw_sparkle(dd, cx, cy, size)
        bg.paste(deco, (0, 0), deco)
        for cx, cy, label, icon, grad in extras.get("chips", []):
            draw_chip(bg, cx, cy, label, icon, grad)

    bg.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"Wrote: {out_path}")


# ── 6-card config ──────────────────────────────────────────────────────
# Order = the locked story (2026-06-11 Zuckerberg-standard pass): be found
# → meet (QR) → meet (card) → reconnect (AI) → discover (map) → grow
# (stats). Captions (17 locales) live in captions.py.
CARDS = CARDS_BY_LANG[LANG]


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: SS_LANG=<locale> build_screenshot.py <index 1-6> [source-app.png]")
        sys.exit(1)
    idx = int(sys.argv[1]) - 1
    if not (0 <= idx < len(CARDS)):
        print(f"index must be 1..{len(CARDS)}")
        sys.exit(1)
    title, subtitle, default_src = CARDS[idx]
    # zh-TW uses the Chinese app captures; every other locale reuses the
    # one English app-screen set (founder 2026-06-12: localize captions,
    # one app-screen set).
    src_dir = "screenshots-6.9" if LANG == "zh-TW" else "screenshots-6.9-en"
    source = sys.argv[2] if len(sys.argv) > 2 else f"{src_dir}/{default_src}"
    out_name = "screenshots-6.9-marketing" if LANG == "zh-TW" else f"screenshots-6.9-marketing-{LANG}"
    out = Path(__file__).parent / out_name
    out.mkdir(exist_ok=True)
    out_path = out / f"{idx+1:02d}-marketing.png"
    here = Path(__file__).parent
    abs_source = (here / source) if not Path(source).is_absolute() else Path(source)
    extras = CARD_EXTRAS.get(idx + 1)
    build(title, subtitle, str(abs_source), str(out_path), extras=extras)


if __name__ == "__main__":
    main()
