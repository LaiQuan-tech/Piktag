#!/usr/bin/env python3
"""Generate a clean illustrated Taipei map for screenshot #6 (no Google
watermark, no "For dev purposes only" overlay).

Output: 1320×2868 PNG that mimics a city-map look — beige roads on warm
gray background, parks as green blobs, river as blue strip, plus a
cluster of 4 PikTag (#) pins around the user's location.

Then we overlay the screen chrome (status bar + header "好友地圖") to
match what the real app would render at top.
"""
import math
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1320, 2868
OUT = (
    "/Users/aimand/.gemini/File/PikTag-mobile/store-assets/app-store/"
    "screenshots-6.9/06-map.png"
)

# Map palette — warm minimalist (Apple Maps / Mapbox light style)
BG_BEIGE = (242, 238, 230)      # background land
ROAD_MAJOR = (255, 255, 255)    # major roads
ROAD_MINOR = (252, 247, 238)    # minor roads
PARK_GREEN = (210, 230, 200)    # parks
WATER_BLUE = (200, 220, 235)    # river
BUILDING_GRAY = (228, 222, 210) # building footprints
TEXT_LIGHT = (160, 150, 130)

PIKTAG_PURPLE = (140, 82, 255)
PIKTAG_PINK = (236, 72, 153)

FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def draw_curve(draw, points, fill, width):
    """Draw a smooth-ish polyline through points."""
    if len(points) < 2:
        return
    draw.line(points, fill=fill, width=width, joint="curve")


def build_map_layer() -> Image.Image:
    """The map illustration itself, full 1320×2868."""
    img = Image.new("RGB", (W, H), BG_BEIGE)
    d = ImageDraw.Draw(img)

    # Background subtle texture: scatter tiny lighter blobs (building footprints)
    rng = random.Random(7)
    for _ in range(900):
        x = rng.randint(0, W)
        y = rng.randint(0, H)
        size = rng.randint(20, 80)
        d.rectangle(
            (x, y, x + size, y + size * rng.uniform(0.5, 1.5)),
            fill=BUILDING_GRAY,
        )

    # River — diagonal blue strip (淡水河 vibe)
    river_pts = [
        (W * 0.05, H * 0.0),
        (W * 0.18, H * 0.30),
        (W * 0.22, H * 0.55),
        (W * 0.10, H * 0.80),
        (W * -0.05, H * 1.0),
    ]
    # Build a polygon for the river width
    for w in range(180, 0, -10):
        offset_pts = [(x + w, y) for x, y in river_pts]
        d.line(river_pts + offset_pts[::-1], fill=WATER_BLUE, width=w)

    # Parks (green blobs)
    parks = [
        (W * 0.62, H * 0.20, 260),  # 大安森林公園 vibe
        (W * 0.30, H * 0.65, 200),  # smaller park
        (W * 0.78, H * 0.78, 180),
    ]
    for cx, cy, r in parks:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PARK_GREEN)
        # rough edges
        rng2 = random.Random(int(cx + cy))
        for _ in range(8):
            ox = rng2.randint(-30, 30)
            oy = rng2.randint(-30, 30)
            sr = rng2.randint(int(r * 0.5), int(r * 0.8))
            d.ellipse(
                (cx + ox - sr, cy + oy - sr, cx + ox + sr, cy + oy + sr),
                fill=PARK_GREEN,
            )

    # Major roads — bold white strips, both directions
    major_roads = [
        # horizontal-ish
        [(0, H * 0.18), (W, H * 0.22)],
        [(0, H * 0.42), (W, H * 0.44)],
        [(0, H * 0.62), (W, H * 0.60)],
        [(0, H * 0.82), (W, H * 0.86)],
        # vertical-ish
        [(W * 0.35, 0), (W * 0.38, H)],
        [(W * 0.55, 0), (W * 0.52, H)],
        [(W * 0.75, 0), (W * 0.78, H)],
    ]
    for road in major_roads:
        draw_curve(d, road, ROAD_MAJOR, 36)

    # Minor roads — thinner grid
    for i in range(20):
        y = H * (0.05 + i * 0.05)
        draw_curve(d, [(0, y), (W, y + rng.randint(-30, 30))], ROAD_MINOR, 10)
    for i in range(12):
        x = W * (0.05 + i * 0.08)
        draw_curve(d, [(x, 0), (x + rng.randint(-30, 30), H)], ROAD_MINOR, 10)

    # Soft road shadow lines (mimics depth)
    return img


def overlay_pin(img: Image.Image, cx: int, cy: int, scale: float = 1.0):
    """Place a PikTag-style pin (purple circle + # icon + drop tail) at cx,cy.
    cy is the TIP of the pin (sticks into the ground).
    """
    d = ImageDraw.Draw(img)
    r = int(58 * scale)
    head_cy = cy - r * 1.6
    # Drop tail (triangle)
    d.polygon(
        [
            (cx, cy),
            (cx - r * 0.35, head_cy + r * 0.4),
            (cx + r * 0.35, head_cy + r * 0.4),
        ],
        fill=PIKTAG_PURPLE,
    )
    # Head circle (outer)
    d.ellipse(
        (cx - r, head_cy - r, cx + r, head_cy + r), fill=(255, 255, 255)
    )
    d.ellipse(
        (cx - r + 8, head_cy - r + 8, cx + r - 8, head_cy + r - 8),
        fill=PIKTAG_PURPLE,
    )
    # # icon
    f = ImageFont.truetype(FONT_PATH, int(r * 1.1), index=2)
    bbox = d.textbbox((0, 0), "#", font=f)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text(
        (cx - tw // 2, head_cy - th // 2 - 6),
        "#",
        font=f,
        fill=(255, 255, 255),
    )


def draw_status_bar_and_header(img: Image.Image):
    """Top white bar with status (time, signal, battery) + page title."""
    d = ImageDraw.Draw(img)
    # Status bar (180px tall white)
    d.rectangle((0, 0, W, 180), fill=(255, 255, 255))
    # Header (under status bar, 200px)
    d.rectangle((0, 180, W, 380), fill=(255, 255, 255))

    # Time
    time_font = ImageFont.truetype(FONT_PATH, 56, index=2)
    d.text((100, 70), "12:18", font=time_font, fill=(0, 0, 0))
    # Right side icons (placeholder dots)
    d.text((1090, 80), "•••• ✦ █", font=time_font, fill=(0, 0, 0))
    # Dynamic island
    d.rounded_rectangle((520, 56, 800, 124), radius=34, fill=(0, 0, 0))

    # Back arrow
    back_font = ImageFont.truetype(FONT_PATH, 60, index=2)
    d.text((90, 240), "←", font=back_font, fill=(0, 0, 0))
    # Title
    title_font = ImageFont.truetype(FONT_PATH, 60, index=2)
    bbox = d.textbbox((0, 0), "好友地圖", font=title_font)
    tw = bbox[2] - bbox[0]
    d.text(((W - tw) // 2, 240), "好友地圖", font=title_font, fill=(0, 0, 0))
    # Subtitle small
    sub_font = ImageFont.truetype(FONT_PATH, 32, index=0)
    sub_text = "顯示與你共享位置的好友"
    bbox = d.textbbox((0, 0), sub_text, font=sub_font)
    tw = bbox[2] - bbox[0]
    d.text(
        ((W - tw) // 2, 320),
        sub_text,
        font=sub_font,
        fill=(120, 120, 120),
    )


def add_zoom_controls(img: Image.Image):
    """+ / - buttons on right side bottom."""
    d = ImageDraw.Draw(img)
    x = W - 130
    for i, sym in enumerate(["+", "−"]):
        y = H - 380 - i * 110
        d.rounded_rectangle((x - 50, y - 50, x + 50, y + 50), radius=20, fill=(255, 255, 255))
        f = ImageFont.truetype(FONT_PATH, 70, index=2)
        bbox = d.textbbox((0, 0), sym, font=f)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        d.text((x - tw // 2, y - th // 2 - 6), sym, font=f, fill=(80, 80, 80))


def main():
    map_img = build_map_layer()
    # User location + 4 nearby PikTag pins clustered around center
    center_x, center_y = W // 2, int(H * 0.55)
    # Main pin (you)
    overlay_pin(map_img, center_x, center_y, scale=1.4)
    # Nearby friends
    offsets = [
        (-280, -260, 0.95),
        (220, -140, 1.05),
        (-180, 320, 0.95),
        (300, 280, 1.0),
        (60, -440, 0.85),
    ]
    for ox, oy, sc in offsets:
        overlay_pin(map_img, center_x + ox, center_y + oy, sc)

    draw_status_bar_and_header(map_img)
    add_zoom_controls(map_img)

    map_img.save(OUT, "PNG", optimize=True)
    print(f"Wrote: {OUT}")


if __name__ == "__main__":
    main()
