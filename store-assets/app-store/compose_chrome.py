#!/usr/bin/env python3
"""Chrome-rendered marketing card — for scripts PIL/FreeType can't shape.

build_screenshot.py (PIL) covers Latin / CJK / Cyrillic perfectly, but
Hiragino has no Korean/Thai/Devanagari/Arabic glyphs AND PIL does no
complex-text shaping (Arabic joining + RTL bidi, Thai mark stacking,
Devanagari conjuncts). So ko / ar / th / hi are rendered here instead:
one HTML card (gradient + title + subtitle + phone-framed screenshot +
card-3 chips) screenshotted by headless Chrome, which has full font
fallback + HarfBuzz shaping + bidi. Layout mirrors the PIL constants so
each locale's 6 cards stay on-brand.

Usage: compose_chrome.py <lang> <iphone|ipad> <1-6>
Outputs to the same marketing dirs as the PIL pipeline.
"""
import base64, os, subprocess, sys
from pathlib import Path
from captions import CARDS_BY_LANG, CHIP_BY_LANG

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = Path(__file__).parent
GRAD = "linear-gradient(135deg, rgb(140,82,255) 0%, rgb(236,72,153) 100%)"

# (W,H, pad_x, title_top, title_fs, sub_fs, line_gap, sub_gap, shadow,
#  phone_top, phone_w, phone_h, phone_radius, border, chip_fs, chips[])
GEO = {
  "iphone": dict(W=1320, H=2868, padx=90, ttop=238, tfs=116, sfs=62, lgap=14,
                 sgap=44, sh=4, ptop=724, pw=980, ph=2096, prad=70, pb=14,
                 chipfs=44, chips=[(220, 1120, "white"), (1100, 1900, "pink")],
                 outdir="screenshots-6.9-marketing", srcdir="screenshots-6.9-en"),
  "ipad": dict(W=2064, H=2752, padx=120, ttop=184, tfs=116, sfs=64, lgap=14,
               sgap=48, sh=5, ptop=700, pw=960, ph=2050, prad=76, pb=16,
               chipfs=52, chips=[(380, 1080, "white"), (1690, 1900, "pink")],
               outdir="screenshots-ipad-marketing", srcdir="screenshots-6.9-en"),
}
CHIP_GRAD = {"white": ("#ffffff", "#f0e6ff"), "pink": ("#ffebfa", "#f0dcff")}


def data_uri(png_path):
    b = base64.b64encode(open(png_path, "rb").read()).decode()
    return f"data:image/png;base64,{b}"


def card(lang, canvas, idx):
    g = GEO[canvas]
    title, subtitle, src = CARDS_BY_LANG[lang][idx]
    rtl = lang == "ar"
    title_html = title.replace("\n", "<br>")
    inner_w, inner_h = g["pw"] - 2 * g["pb"], g["ph"] - 2 * g["pb"]
    img = data_uri(HERE / g["srcdir"] / src)
    phone_x = (g["W"] - g["pw"]) // 2

    chips_html = ""
    if idx == 2:  # card 3 (0-based 2) = card scan
        fast, ai = CHIP_BY_LANG[lang]
        labels = [fast, ai]
        for (cx, cy, kind), label in zip(g["chips"], labels):
            c1, c2 = CHIP_GRAD[kind]
            chips_html += (
              f'<div class="chip" style="left:{cx}px;top:{cy}px;'
              f'background:linear-gradient(180deg,{c1},{c2})" dir="{"rtl" if rtl else "ltr"}">{label}</div>')

    fontstack = ('"Apple SD Gothic Neo"' if lang == "ko" else
                 '"Geeza Pro","Al Bayan"' if lang == "ar" else
                 '"Thonburi"' if lang == "th" else
                 '"Kohinoor Devanagari","Devanagari Sangam MN"' if lang == "hi" else
                 '-apple-system')
    return f'''<!doctype html><html dir="{"rtl" if rtl else "ltr"}"><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}}
html,body{{width:{g["W"]}px;height:{g["H"]}px;overflow:hidden}}
body{{background:{GRAD};position:relative;font-family:{fontstack},sans-serif}}
.title{{position:absolute;top:{g["ttop"]}px;left:{g["padx"]}px;right:{g["padx"]}px;
text-align:center;color:#fff;font-weight:800;font-size:{g["tfs"]}px;line-height:1.12;
text-shadow:{g["sh"]}px {g["sh"]}px 8px rgba(0,0,0,.24)}}
.sub{{position:absolute;left:{g["padx"]}px;right:{g["padx"]}px;text-align:center;
color:#fff;font-weight:400;font-size:{g["sfs"]}px;line-height:1.3;opacity:.96;
text-shadow:{g["sh"]}px {g["sh"]}px 8px rgba(0,0,0,.24)}}
.phone{{position:absolute;left:{phone_x}px;top:{g["ptop"]}px;width:{g["pw"]}px;height:{g["ph"]}px;
background:#fff;border-radius:{g["prad"]}px;box-shadow:0 40px 90px rgba(0,0,0,.32)}}
.shot{{position:absolute;left:{g["pb"]}px;top:{g["pb"]}px;width:{inner_w}px;height:{inner_h}px;
border-radius:{g["prad"]-g["pb"]}px;object-fit:cover;object-position:top}}
.chip{{position:absolute;transform:translate(-50%,-50%);padding:22px 40px;border-radius:60px;
font-size:{g["chipfs"]}px;font-weight:700;color:#281e46;white-space:nowrap;
box-shadow:0 14px 30px rgba(0,0,0,.22)}}
</style></head><body>
<div class="title">{title_html}</div>
<div class="sub" style="top:{g["ttop"] + g["tfs"]*2 + g["sgap"] + 30}px">{subtitle}</div>
<div class="phone"><img class="shot" src="{img}"></div>
{chips_html}
</body></html>'''


def main():
    lang, canvas, idx = sys.argv[1], sys.argv[2], int(sys.argv[3]) - 1
    g = GEO[canvas]
    html_path = f"/tmp/genscreens/card_{lang}_{canvas}_{idx}.html"
    Path("/tmp/genscreens").mkdir(exist_ok=True)
    open(html_path, "w").write(card(lang, canvas, idx))
    suffix = "" if lang == "zh-TW" else f"-{lang}"
    out_dir = HERE / (g["outdir"] + suffix)
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{idx+1:02d}-marketing.png"
    if out.exists():
        out.unlink()
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", f"--window-size={g['W']},{g['H']}",
                    f"--screenshot={out}", "file://" + html_path],
                   check=True, capture_output=True)
    print(f"Wrote: {out}")


if __name__ == "__main__":
    main()
