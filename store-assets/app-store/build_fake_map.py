#!/usr/bin/env python3
"""Generate a clean illustrated Taipei map for screenshot #6 (no Google
watermark, no "For dev purposes only" overlay).

Output: 1320×2868 PNG that mimics a city-map look — beige roads on warm
gray background, parks as green blobs, river as blue strip, plus a
cluster of 4 PikTag (#) pins around the user's location.

Then we overlay the screen chrome (status bar + header "好友地圖") to
match what the real app would render at top.
"""
import os
import math
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1320, 2868
BASE = os.path.dirname(os.path.abspath(__file__))
# Output + header text are env-overridable so the same script builds the
# zh-TW (default) AND the English (screenshots-6.9-en) dark map.
OUT = os.environ.get("MAP_OUT", os.path.join(BASE, "screenshots-6.9", "06-map.png"))
MAP_TITLE = os.environ.get("MAP_TITLE", "好友地圖")
MAP_SUB = os.environ.get("MAP_SUB", "顯示與你共享位置的好友")
# Source grid of AI-generated (Gemini) faces — 5 cols x 4 rows. Founder-
# supplied, synthetic (no real person), so safe for store marketing.
GRID = os.path.join(BASE, "_faces-grid.png")
GRID_COLS, GRID_ROWS = 5, 4

# Map palette — DARK (Apple Maps / Google Maps dark style) so the screenshot
# matches the app's dark mode. Avatar pins (white ring + purple) pop on this.
BG_BEIGE = (26, 26, 28)         # background land (dark)
ROAD_MAJOR = (58, 58, 62)       # major roads
ROAD_MINOR = (40, 40, 43)       # minor roads
PARK_GREEN = (26, 46, 34)       # parks (dark green)
WATER_BLUE = (22, 38, 58)       # river (dark blue)
BUILDING_GRAY = (36, 36, 39)    # building footprints
TEXT_LIGHT = (110, 110, 115)

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


def load_faces(cells):
    """Crop a circular-ready face square for each (col, row) grid cell."""
    grid = Image.open(GRID).convert("RGB")
    cw, ch = grid.width / GRID_COLS, grid.height / GRID_ROWS
    side = int(min(cw, ch) * 0.96)
    faces = []
    for (c, r) in cells:
        left = int(round(c * cw))
        top = int(round(r * ch)) + 12  # skip a little headroom → center the face
        faces.append(grid.crop((left, top, left + side, top + side)))
    return faces


def circular(face_img: Image.Image, diameter: int) -> Image.Image:
    """Resize a face to `diameter` and apply a circular alpha mask."""
    f = face_img.resize((diameter, diameter), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, diameter - 1, diameter - 1), fill=255)
    f.putalpha(mask)
    return f


def overlay_pin(img: Image.Image, face: Image.Image, cx: int, cy: int, scale: float = 1.0):
    """Place a profile-photo map pin (white-ringed circular face + purple
    drop tail) at cx,cy. cy is the TIP of the pin (sticks into the ground)."""
    d = ImageDraw.Draw(img)
    r = int(58 * scale)
    head_cy = int(cy - r * 1.6)
    # Drop tail (triangle)
    d.polygon(
        [
            (cx, cy),
            (cx - r * 0.32, head_cy + r * 0.45),
            (cx + r * 0.32, head_cy + r * 0.45),
        ],
        fill=PIKTAG_PURPLE,
    )
    # White ring backing
    d.ellipse((cx - r, head_cy - r, cx + r, head_cy + r), fill=(255, 255, 255))
    # Circular face, inset so a white ring shows around it
    inner = r - 9
    av = circular(face, inner * 2)
    img.paste(av, (cx - inner, head_cy - inner), av)
    # Purple outer ring — brand cue + definition against the map
    d.ellipse((cx - r, head_cy - r, cx + r, head_cy + r), outline=PIKTAG_PURPLE, width=5)


def draw_status_bar_and_header(img: Image.Image):
    """Top white bar with status (time, signal, battery) + page title."""
    d = ImageDraw.Draw(img)
    # Status bar + header — DARK (black) with white text
    d.rectangle((0, 0, W, 180), fill=(0, 0, 0))
    d.rectangle((0, 180, W, 380), fill=(0, 0, 0))
    # Thin separator under the header so it reads apart from the dark map
    d.rectangle((0, 379, W, 381), fill=(44, 44, 48))

    # Time
    time_font = ImageFont.truetype(FONT_PATH, 56, index=2)
    d.text((100, 70), "12:18", font=time_font, fill=(255, 255, 255))
    # Right side icons (placeholder dots)
    d.text((1090, 80), "•••• ✦ █", font=time_font, fill=(255, 255, 255))
    # Dynamic island
    d.rounded_rectangle((520, 56, 800, 124), radius=34, fill=(0, 0, 0))

    # Back arrow
    back_font = ImageFont.truetype(FONT_PATH, 60, index=2)
    d.text((90, 240), "←", font=back_font, fill=(255, 255, 255))
    # Title
    title_font = ImageFont.truetype(FONT_PATH, 60, index=2)
    bbox = d.textbbox((0, 0), MAP_TITLE, font=title_font)
    tw = bbox[2] - bbox[0]
    d.text(((W - tw) // 2, 240), MAP_TITLE, font=title_font, fill=(255, 255, 255))
    # Subtitle small
    sub_font = ImageFont.truetype(FONT_PATH, 32, index=0)
    sub_text = MAP_SUB
    bbox = d.textbbox((0, 0), sub_text, font=sub_font)
    tw = bbox[2] - bbox[0]
    d.text(
        ((W - tw) // 2, 320),
        sub_text,
        font=sub_font,
        fill=(150, 150, 155),
    )


def add_zoom_controls(img: Image.Image):
    """+ / - buttons on right side bottom."""
    d = ImageDraw.Draw(img)
    x = W - 130
    sym_col = (200, 200, 205)
    # Draw +/- as shapes (the − glyph is missing in the font → tofu box).
    for i in range(2):  # i=0 lower button (+), i=1 upper button (−)
        y = H - 380 - i * 110
        d.rounded_rectangle((x - 50, y - 50, x + 50, y + 50), radius=20, fill=(28, 28, 30))
        d.rounded_rectangle((x - 22, y - 4, x + 22, y + 4), radius=4, fill=sym_col)  # horizontal bar
        if i == 0:
            d.rounded_rectangle((x - 4, y - 22, x + 4, y + 22), radius=4, fill=sym_col)  # vertical → plus


def main():
    map_img = build_map_layer()
    # 6 distinct faces (you + 5 nearby friends) cropped from the grid.
    cells = [(2, 1), (0, 0), (3, 0), (4, 2), (1, 3), (2, 2)]
    faces = load_faces(cells)
    # User location + 5 nearby PikTag pins clustered around center
    center_x, center_y = W // 2, int(H * 0.55)
    # Main pin (you) — slightly larger
    overlay_pin(map_img, faces[0], center_x, center_y, scale=1.4)
    # Nearby friends
    offsets = [
        (-280, -260, 0.95),
        (220, -140, 1.05),
        (-180, 320, 0.95),
        (300, 280, 1.0),
        (60, -440, 0.85),
    ]
    for i, (ox, oy, sc) in enumerate(offsets):
        overlay_pin(map_img, faces[i + 1], center_x + ox, center_y + oy, sc)

    draw_status_bar_and_header(map_img)
    add_zoom_controls(map_img)

    map_img.save(OUT, "PNG", optimize=True)
    print(f"Wrote: {OUT}")


if __name__ == "__main__":
    main()
