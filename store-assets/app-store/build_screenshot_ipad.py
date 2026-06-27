#!/usr/bin/env python3
"""iPad version of PikTag App Store marketing screenshots.

Canvas: 2064 × 2752 (iPad Pro 13" M4 portrait, ASC slot).
Reuses the same iPhone marketing source PNG inside a centered phone
mockup, on a wider purple→pink gradient canvas with title above.
"""
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# SS_LANG = one of 17 caption locales (default zh-TW) — mirrors
# build_screenshot.py. Captions live in captions.py.
LANG = os.environ.get("SS_LANG", "zh-TW")
from captions import CARDS_BY_LANG, CHIP_BY_LANG  # noqa: E402

# ── iPad canvas ────────────────────────────────────────────────────────
W, H = 2064, 2752
GRAD_START = (140, 82, 255)
GRAD_END = (236, 72, 153)
WHITE = (255, 255, 255)

# ── Layout (iPad) ──────────────────────────────────────────────────────
# 2026-06-09 fix: subtitle was being overlapped by phone mockup top.
# Recipe to fix: smaller title font + larger subtitle-to-phone gap +
# phone pushed down + phone shrunk so it still fits within 2752 canvas.
# Source aspect locked at 0.4602 (1320/2868 iPhone source).
PAD_X = 120
TITLE_TOP = 200
TITLE_LINE_GAP = 14
SUBTITLE_GAP = 64          # was 52 — extra room before subtitle
# Subtitle ends near y≈564; PHONE_TOP=700 leaves a clean 136px band.
PHONE_TOP = 700            # was 540 — pushed down 160px
PHONE_W = 960              # was 1020 — slight shrink to keep total < 2752
PHONE_H = 2050             # inner 928×2018 ≈ 0.460 aspect matches source
PHONE_RADIUS = 76
PHONE_BORDER_W = 16
PHONE_SHADOW_BLUR = 70

# CJK locales → Hiragino; everyone else → Arial (renders œ/î, Vietnamese/
# Turkish diacritics, Cyrillic, and a normal-width apostrophe). Mirrors
# build_screenshot.py's fix (founder caught the fr œ/apostrophe bug 2026-06-27).
_CJK_LANGS = {"zh-TW", "zh-CN", "ja"}
# League Spartan = PikTag brand typeface; Latin-only → 8 covered locales use it, vi/ru
# stay Arial (League Spartan lacks Vietnamese/Cyrillic), CJK stays Hiragino.
_LSPARTAN_LANGS = {"en", "de", "fr", "es", "pt", "it", "id", "tr"}
_IS_CJK = LANG in _CJK_LANGS
_IS_LSPARTAN = LANG in _LSPARTAN_LANGS
_HERE = os.path.dirname(os.path.abspath(__file__))
HIRAGINO = "/System/Library/Fonts/Hiragino Sans GB.ttc"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
LSPARTAN = os.path.join(_HERE, "fonts", "LeagueSpartan-Regular.ttf")
LSPARTAN_BOLD = os.path.join(_HERE, "fonts", "LeagueSpartan-Bold.ttf")
FONT_PATH = HIRAGINO  # legacy alias
TITLE_FONT_SIZE = 116      # was 132 — gives title 2-line room without crowding subtitle
SUBTITLE_FONT_SIZE = 54    # was 58


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    if _IS_CJK:
        return ImageFont.truetype(HIRAGINO, size, index=(2 if bold else 0))
    if _IS_LSPARTAN:
        return ImageFont.truetype(LSPARTAN_BOLD if bold else LSPARTAN, size)
    return ImageFont.truetype(ARIAL_BOLD if bold else ARIAL, size)  # vi, ru


def gradient_bg() -> Image.Image:
    bg = Image.new("RGB", (W, H), GRAD_START)
    px = bg.load()
    denom = float(W + H)
    for y in range(H):
        for x in range(W):
            t = (x + y) / denom
            r = int(GRAD_START[0] * (1 - t) + GRAD_END[0] * t)
            g = int(GRAD_START[1] * (1 - t) + GRAD_END[1] * t)
            b = int(GRAD_START[2] * (1 - t) + GRAD_END[2] * t)
            px[x, y] = (r, g, b)
    return bg


def draw_text_centered(draw, text, font, y, color):
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (W - text_w) // 2
    shadow_offset = 5
    draw.text((x + shadow_offset, y + shadow_offset), text, font=font, fill=(0, 0, 0, 60))
    draw.text((x, y), text, font=font, fill=color)
    return y + text_h


def wrap_title(title):
    if "\n" in title:
        return title.split("\n")
    if "，" in title and len(title) > 9:
        return title.split("，", 1)
    if ", " in title and len(title) > 18:
        return [p.strip() for p in title.split(", ", 1)]
    return [title]


def wrap_to_width(draw, text, font, max_width):
    """Greedy-wrap to fit max_width px. Word-wrap on spaces; char-wrap for CJK."""
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


def round_corners(im, radius):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0], im.size[1]), radius=radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def paste_phone(bg, app_screenshot_path):
    inner_w = PHONE_W - PHONE_BORDER_W * 2
    inner_h = PHONE_H - PHONE_BORDER_W * 2
    inner_radius = PHONE_RADIUS - PHONE_BORDER_W
    screenshot = Image.open(app_screenshot_path).convert("RGBA")
    src_w, src_h = screenshot.size
    target_aspect = inner_w / inner_h
    src_aspect = src_w / src_h
    if abs(src_aspect - target_aspect) < 0.005:
        pass
    elif src_aspect > target_aspect:
        new_w = int(src_h * target_aspect)
        offset_x = (src_w - new_w) // 2
        screenshot = screenshot.crop((offset_x, 0, offset_x + new_w, src_h))
    else:
        new_h = int(src_w / target_aspect)
        offset_y = (src_h - new_h) // 2
        screenshot = screenshot.crop((0, offset_y, src_w, offset_y + new_h))
    screenshot = screenshot.resize((inner_w, inner_h), Image.LANCZOS)
    screenshot = round_corners(screenshot, inner_radius)

    frame_layer = Image.new("RGBA", (PHONE_W, PHONE_H), (0, 0, 0, 0))
    ImageDraw.Draw(frame_layer).rounded_rectangle((0, 0, PHONE_W, PHONE_H), radius=PHONE_RADIUS, fill=WHITE)
    frame_layer.paste(screenshot, (PHONE_BORDER_W, PHONE_BORDER_W), screenshot)

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    phone_x = (W - PHONE_W) // 2
    phone_y = PHONE_TOP
    ImageDraw.Draw(shadow).rounded_rectangle(
        (phone_x, phone_y + 28, phone_x + PHONE_W, phone_y + PHONE_H + 28),
        radius=PHONE_RADIUS, fill=(0, 0, 0, 130),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=PHONE_SHADOW_BLUR))
    bg.paste(shadow, (0, 0), shadow)
    bg.paste(frame_layer, (phone_x, phone_y), frame_layer)


def draw_sparkle(draw, cx, cy, size, alpha=200):
    color = (255, 255, 255, alpha)
    half = size
    quarter = size // 4
    draw.polygon([(cx, cy - half), (cx + quarter, cy), (cx, cy + half), (cx - quarter, cy)], fill=color)
    draw.polygon([(cx - half, cy), (cx, cy - quarter), (cx + half, cy), (cx, cy + quarter)], fill=color)


def draw_chip(bg, cx, cy, label, icon, gradient):
    font = load_font(52, bold=True)
    icon_font = load_font(60, bold=True)
    text_bbox = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox((0, 0), label, font=font)
    text_w = text_bbox[2] - text_bbox[0]
    text_h = text_bbox[3] - text_bbox[1]
    icon_w = 0
    if icon:
        ib = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox((0, 0), icon, font=icon_font)
        icon_w = ib[2] - ib[0] + 20
    pad_x = 42
    pad_y = 28
    chip_w = icon_w + text_w + pad_x * 2
    chip_h = max(text_h, 60) + pad_y * 2
    chip = Image.new("RGBA", (chip_w + 70, chip_h + 70), (0, 0, 0, 0))
    shadow = Image.new("RGBA", chip.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((35, 35 + 14, 35 + chip_w, 35 + chip_h + 14), radius=chip_h // 2, fill=(0, 0, 0, 100))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=16))
    chip.paste(shadow, (0, 0), shadow)
    cd = ImageDraw.Draw(chip)
    for y in range(chip_h):
        t = y / max(chip_h - 1, 1)
        r = int(gradient[0][0] * (1 - t) + gradient[1][0] * t)
        g = int(gradient[0][1] * (1 - t) + gradient[1][1] * t)
        b = int(gradient[0][2] * (1 - t) + gradient[1][2] * t)
        cd.line([(35, 35 + y), (35 + chip_w, 35 + y)], fill=(r, g, b, 255))
    mask = Image.new("L", chip.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((35, 35, 35 + chip_w, 35 + chip_h), radius=chip_h // 2, fill=255)
    chip.putalpha(mask)
    cd2 = ImageDraw.Draw(chip)
    text_x = 35 + pad_x + icon_w
    text_y = 35 + (chip_h - text_h) // 2 - 8
    if icon:
        cd2.text((35 + pad_x, 35 + (chip_h - icon_w) // 2 - 4), icon, font=icon_font, fill=(120, 70, 220))
    cd2.text((text_x, text_y), label, font=font, fill=(40, 30, 70))
    bg.paste(chip, (cx - chip.size[0] // 2, cy - chip.size[1] // 2), chip)


# Sparkles spread across the wider iPad canvas
_SPARKLES = [
    (200, 440, 38),
    (1880, 490, 34),
    (140, 2480, 44),
    (1940, 2440, 38),
    (310, 1490, 28),
    (1830, 1340, 28),
    (1030, 130, 32),
    (1030, 2640, 30),
]
_G_WHITE = ((255, 255, 255), (240, 230, 255))
_G_PINK = ((255, 235, 250), (240, 220, 255))

_CHIP_FAST, _CHIP_AI = CHIP_BY_LANG[LANG]

CARD_EXTRAS = {
    1: {"sparkles": [], "chips": []},
    2: {"sparkles": [], "chips": []},
    # Chips only on the card-scan card (now #3 after the story reorder).
    3: {
        "sparkles": [],
        "chips": [
            (380, 1080, _CHIP_FAST, "", _G_WHITE),
            (1690, 1900, _CHIP_AI, "", _G_PINK),
        ],
    },
    4: {"sparkles": [], "chips": []},
    5: {"sparkles": [], "chips": []},
    6: {"sparkles": [], "chips": []},
}


def build(title, subtitle, app_screenshot_path, out_path, extras=None):
    bg = gradient_bg().convert("RGBA")
    draw = ImageDraw.Draw(bg)
    title_font = load_font(TITLE_FONT_SIZE, bold=True)
    sub_font = load_font(SUBTITLE_FONT_SIZE, bold=False)
    max_w = W - 2 * PAD_X
    title_lh = int(TITLE_FONT_SIZE * 1.16)
    sub_lh = int(SUBTITLE_FONT_SIZE * 1.32)
    y = TITLE_TOP
    for part in wrap_title(title):
        for line in wrap_to_width(draw, part, title_font, max_w):
            draw_text_centered(draw, line, title_font, y, WHITE)
            y += title_lh
    y += SUBTITLE_GAP
    for line in wrap_to_width(draw, subtitle, sub_font, max_w):
        draw_text_centered(draw, line, sub_font, y, WHITE)
        y += sub_lh
    paste_phone(bg, app_screenshot_path)
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


# Order + captions mirror build_screenshot.py — both import captions.py.
CARDS = CARDS_BY_LANG[LANG]


def main():
    if len(sys.argv) < 2:
        print("Usage: SS_LANG=<locale> build_screenshot_ipad.py <1-6>")
        sys.exit(1)
    idx = int(sys.argv[1]) - 1
    title, subtitle, default_src = CARDS[idx]
    src_dir = "screenshots-6.9" if LANG == "zh-TW" else "screenshots-6.9-en"
    source = f"{src_dir}/{default_src}"
    out_dir = Path(__file__).parent / ("screenshots-ipad-marketing" if LANG == "zh-TW" else f"screenshots-ipad-marketing-{LANG}")
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{idx+1:02d}-marketing.png"
    here = Path(__file__).parent
    abs_source = here / source
    extras = CARD_EXTRAS.get(idx + 1)
    build(title, subtitle, str(abs_source), str(out_path), extras=extras)


if __name__ == "__main__":
    main()
