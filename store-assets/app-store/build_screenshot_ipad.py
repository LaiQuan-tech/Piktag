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

# SS_LANG=zh (default) or en — mirrors build_screenshot.py.
LANG = os.environ.get("SS_LANG", "zh")

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

FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"
TITLE_FONT_IDX = 2
SUBTITLE_FONT_IDX = 0
TITLE_FONT_SIZE = 116      # was 132 — gives title 2-line room without crowding subtitle
SUBTITLE_FONT_SIZE = 54    # was 58


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
    if "，" in title and len(title) > 9:
        return title.split("，", 1)
    if ", " in title and len(title) > 18:
        return [p.strip() for p in title.split(", ", 1)]
    return [title]


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
    font = ImageFont.truetype(FONT_PATH, 52, index=2)
    icon_font = ImageFont.truetype(FONT_PATH, 60, index=2)
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

_CHIP_FAST = "3 秒就好" if LANG == "zh" else "3 seconds flat"
_CHIP_AI = "AI 自動加標籤" if LANG == "zh" else "AI adds the tags"

CARD_EXTRAS = {
    1: {"sparkles": _SPARKLES, "chips": []},
    2: {"sparkles": _SPARKLES, "chips": []},
    # Chips only on the card-scan card (now #3 after the story reorder).
    3: {
        "sparkles": _SPARKLES,
        "chips": [
            (380, 1080, _CHIP_FAST, "", _G_WHITE),
            (1690, 1900, _CHIP_AI, "", _G_PINK),
        ],
    },
    4: {"sparkles": _SPARKLES, "chips": []},
    5: {"sparkles": _SPARKLES, "chips": []},
    6: {"sparkles": _SPARKLES, "chips": []},
}


def build(title, subtitle, app_screenshot_path, out_path, extras=None):
    bg = gradient_bg().convert("RGBA")
    draw = ImageDraw.Draw(bg)
    title_font = ImageFont.truetype(FONT_PATH, TITLE_FONT_SIZE, index=TITLE_FONT_IDX)
    sub_font = ImageFont.truetype(FONT_PATH, SUBTITLE_FONT_SIZE, index=SUBTITLE_FONT_IDX)
    lines = wrap_title(title)
    y = TITLE_TOP
    for line in lines:
        y = draw_text_centered(draw, line, title_font, y, WHITE)
        y += TITLE_LINE_GAP
    y += SUBTITLE_GAP - TITLE_LINE_GAP
    draw_text_centered(draw, subtitle, sub_font, y, WHITE)
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


# Order + captions mirror build_screenshot.py (the 2026-06-11 story order).
CARDS_BY_LANG = {
    "zh": [
        ("讓別人搜得到你", "朋友需要你這種人時，搜標籤就找到你", "04-profile.png"),
        ("見面掃一下，朋友自動歸檔", "一場活動一個 QR，認識誰都記得住", "05-qr.png"),
        ("拍張名片，3 秒記住一個人", "自動建檔、自動加標籤，想得起他是誰", "01-cardscan.png"),
        ("不知道怎麼開口，AI 給你 3 句", "從你們的共同點，接回上次停下的話題", "03-ai.png"),
        ("附近誰跟你同頻，地圖看得見", "同標籤的朋友，就在你身邊", "06-map.png"),
        ("你的人脈，看得見的成長", "誰掃了你、誰點了你，一張表全記得", "02-stats.png"),
    ],
    "en": [
        ("Let people find you", "The right people find you by your tags", "04-profile.png"),
        ("One scan, friends filed", "One QR per event — friends auto-organized", "05-qr.png"),
        ("Scan a card, remember them", "Auto-saved with tags in 3 seconds", "01-cardscan.png"),
        ("AI breaks the ice, 3 openers ready", "Personalized from what you two share", "03-ai.png"),
        ("Your people, on a map", "Nearby friends who share your tags", "06-map.png"),
        ("Your circle, in numbers", "Who scanned you, who tapped you", "02-stats.png"),
    ],
}
CARDS = CARDS_BY_LANG[LANG]


def main():
    if len(sys.argv) < 2:
        print("Usage: build_screenshot_ipad.py <1-6>")
        sys.exit(1)
    idx = int(sys.argv[1]) - 1
    title, subtitle, default_src = CARDS[idx]
    src_dir = "screenshots-6.9" if LANG == "zh" else "screenshots-6.9-en"
    source = f"{src_dir}/{default_src}"
    out_dir = Path(__file__).parent / ("screenshots-ipad-marketing" + ("" if LANG == "zh" else "-en"))
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{idx+1:02d}-marketing.png"
    here = Path(__file__).parent
    abs_source = here / source
    extras = CARD_EXTRAS.get(idx + 1)
    build(title, subtitle, str(abs_source), str(out_path), extras=extras)


if __name__ == "__main__":
    main()
