#!/usr/bin/env python3
"""Build PikTag App Store marketing screenshots.

LINE-style layout: purple→pink gradient background, big bold title at top,
small subtitle below, simplified rounded-white phone frame containing the
real app screenshot below.

Output: 1320×2868 PNG per card (iPhone 17 Pro Max / 6.9" ASC slot).
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Canvas / brand ─────────────────────────────────────────────────────
W, H = 1320, 2868
# Brand purple→pink gradient. piktag500 = #8c52ff, end = pink-500 #ec4899.
GRAD_START = (140, 82, 255)   # purple
GRAD_END = (236, 72, 153)     # pink
WHITE = (255, 255, 255)
DARK = (255, 255, 255)        # title color on gradient

# ── Layout ─────────────────────────────────────────────────────────────
PAD_X = 90
TITLE_TOP = 260
TITLE_LINE_GAP = 14
SUBTITLE_GAP = 50
PHONE_TOP = 700
# Aspect-match source 1320×2868 so the screenshot fits without bottom crop.
# inner aspect = 952/2068 ≈ 0.460 = source aspect. Outer adds border 14×2.
PHONE_W = 980
PHONE_H = 2096
PHONE_RADIUS = 70    # phone corner radius
PHONE_BORDER_W = 14  # white frame thickness
PHONE_SHADOW_BLUR = 60

# ── Fonts ──────────────────────────────────────────────────────────────
FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"
TITLE_FONT_IDX = 2   # W6 (bold)
SUBTITLE_FONT_IDX = 0  # W3 (regular)
TITLE_FONT_SIZE = 116
SUBTITLE_FONT_SIZE = 48


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
    """If title is short (≤ 9 zh chars), one line; else split on comma."""
    if "，" in title and len(title) > 9:
        return title.split("，", 1)
    return [title]


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
    font = ImageFont.truetype(FONT_PATH, 44, index=2)
    icon_font = ImageFont.truetype(FONT_PATH, 50, index=2)
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

CARD_EXTRAS = {
    1: {
        "sparkles": _SPARKLES,
        "chips": [
            (220, 1120, "3 秒就好", "", _G_WHITE),
            (1100, 1900, "AI 自動加標籤", "", _G_PINK),
        ],
    },
    # #2-6 use sparkles only — chips only on #1 (拍照名片) per founder
    2: {"sparkles": _SPARKLES, "chips": []},
    3: {"sparkles": _SPARKLES, "chips": []},
    4: {"sparkles": _SPARKLES, "chips": []},
    5: {"sparkles": _SPARKLES, "chips": []},
    6: {"sparkles": _SPARKLES, "chips": []},
}


def build(
    title: str, subtitle: str, app_screenshot_path: str, out_path: str,
    extras: dict | None = None
) -> None:
    bg = gradient_bg().convert("RGBA")
    draw = ImageDraw.Draw(bg)
    title_font = ImageFont.truetype(FONT_PATH, TITLE_FONT_SIZE, index=TITLE_FONT_IDX)
    sub_font = ImageFont.truetype(FONT_PATH, SUBTITLE_FONT_SIZE, index=SUBTITLE_FONT_IDX)

    # Title — possibly multi-line.
    lines = wrap_title(title)
    y = TITLE_TOP
    for line in lines:
        y = draw_text_centered(draw, line, title_font, y, WHITE)
        y += TITLE_LINE_GAP

    # Subtitle.
    y += SUBTITLE_GAP - TITLE_LINE_GAP
    draw_text_centered(draw, subtitle, sub_font, y, WHITE)

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
CARDS = [
    ("拍張名片，標籤幫你記住", "3 秒掃描建檔，幫你想起對方是誰", "01-cardscan.png"),
    ("誰看過你，數據都記得", "點擊、觀看、停留 — 業務型人脈儀表板", "02-stats.png"),
    ("不用想話題，AI 給你 3 個", "根據對方標籤，推薦最對的破冰話題", "03-ai.png"),
    ("定義我自己，貴人找到你", "一張電子名片，分享給對的人", "04-profile.png"),
    ("一場活動一個碼，朋友自動分類", "不同場合不同 QR，認識誰自動歸位", "05-qr.png"),
    ("附近跟你同標籤的人，一目了然", "地圖打開，看見和你頻率相同的人", "06-map.png"),
]


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: build_screenshot.py <index 1-6> [source-app.png]")
        sys.exit(1)
    idx = int(sys.argv[1]) - 1
    if not (0 <= idx < len(CARDS)):
        print(f"index must be 1..{len(CARDS)}")
        sys.exit(1)
    title, subtitle, default_src = CARDS[idx]
    source = sys.argv[2] if len(sys.argv) > 2 else f"screenshots-6.9/{default_src}"
    out = Path(__file__).parent / "screenshots-6.9-marketing"
    out.mkdir(exist_ok=True)
    out_path = out / f"{idx+1:02d}-marketing.png"
    here = Path(__file__).parent
    abs_source = (here / source) if not Path(source).is_absolute() else Path(source)
    extras = CARD_EXTRAS.get(idx + 1)
    build(title, subtitle, str(abs_source), str(out_path), extras=extras)


if __name__ == "__main__":
    main()
