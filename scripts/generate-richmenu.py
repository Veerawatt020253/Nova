#!/usr/bin/env python3
"""Generate the LINE rich menu image (2500x1686, 3x2 grid).

Text is rendered via macOS CoreText (scripts/render-text.js) because PIL
without libraqm breaks Thai combining marks; PIL draws everything else.
"""
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw

W, H = 2500, 1686
COLS, ROWS = 3, 2
CW, CH = W // COLS, H // ROWS  # 833x843

BG = (11, 18, 32)          # deep navy
CARD = (22, 30, 46)        # slate card
CARD_BORDER = (45, 58, 80)
LABEL = (255, 255, 255)
SUB = (148, 163, 184)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def render_texts(items):
    """items: list of dicts {text, font, size, color, out} → PNGs with CoreText."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"items": items}, f, ensure_ascii=False)
        spec = f.name
    subprocess.run(
        ["osascript", "-l", "JavaScript", os.path.join(SCRIPT_DIR, "render-text.js"), spec],
        check=True,
        capture_output=True,
    )
    os.unlink(spec)


def rounded(d, xy, r, **kw):
    d.rounded_rectangle(xy, radius=r, **kw)


def icon_magnifier(d, cx, cy, s, color):
    r = int(s * 0.32)
    w = int(s * 0.09)
    d.ellipse([cx - r - s * 0.08, cy - r - s * 0.08, cx + r - s * 0.08, cy + r - s * 0.08],
              outline=color, width=w)
    x0 = cx + r * 0.55
    y0 = cy + r * 0.55
    d.line([x0 - s * 0.08, y0 - s * 0.08, cx + s * 0.42, cy + s * 0.42], fill=color, width=w)


def icon_bars(d, cx, cy, s, color):
    w = int(s * 0.16)
    gap = int(s * 0.28)
    heights = [0.35, 0.6, 0.85]
    base = cy + s * 0.42
    for i, h in enumerate(heights):
        x = cx + (i - 1) * gap - w // 2
        d.rounded_rectangle([x, base - s * h * 0.9, x + w, base], radius=w // 2, fill=color)


def icon_check(d, cx, cy, s, color):
    w = int(s * 0.11)
    d.line([cx - s * 0.34, cy + s * 0.02, cx - s * 0.08, cy + s * 0.28], fill=color, width=w)
    d.line([cx - s * 0.08, cy + s * 0.28, cx + s * 0.38, cy - s * 0.26], fill=color, width=w)


def icon_plus(d, cx, cy, s, color):
    w = int(s * 0.11)
    l = s * 0.36
    d.line([cx - l, cy, cx + l, cy], fill=color, width=w)
    d.line([cx, cy - l, cx, cy + l], fill=color, width=w)


def icon_swap(d, cx, cy, s, color):
    w = int(s * 0.09)
    l = s * 0.34
    ah = s * 0.13
    y1, y2 = cy - s * 0.16, cy + s * 0.16
    d.line([cx - l, y1, cx + l, y1], fill=color, width=w)
    d.polygon([(cx + l + ah * 0.7, y1), (cx + l - ah * 0.5, y1 - ah), (cx + l - ah * 0.5, y1 + ah)], fill=color)
    d.line([cx - l, y2, cx + l, y2], fill=color, width=w)
    d.polygon([(cx - l - ah * 0.7, y2), (cx - l + ah * 0.5, y2 - ah), (cx - l + ah * 0.5, y2 + ah)], fill=color)


def icon_pencil(d, cx, cy, s, color):
    w = int(s * 0.11)
    d.line([cx - s * 0.3, cy + s * 0.3, cx + s * 0.26, cy - s * 0.26], fill=color, width=w)
    tip = s * 0.14
    d.polygon([(cx - s * 0.3 - tip * 0.4, cy + s * 0.3 + tip * 0.4),
               (cx - s * 0.3 + tip, cy + s * 0.3),
               (cx - s * 0.3, cy + s * 0.3 - tip)], fill=color)


CELLS = [
    ("วิเคราะห์", "ตัดสินแบบกรรมการจริง", (6, 199, 85), icon_magnifier),
    ("สถานะ", "ความคืบหน้า + deadline", (59, 130, 246), icon_bars),
    ("บันทึกงาน", "log สิ่งที่ทำเสร็จ", (245, 166, 35), icon_check),
    ("โครงงานใหม่", "เริ่มโปรเจกต์ใหม่", (168, 85, 247), icon_plus),
    ("สลับโครงงาน", "เปลี่ยนโปรเจกต์", (20, 184, 166), icon_swap),
    ("แก้ไขข้อมูล", "อัพเดทรายละเอียด", (148, 163, 184), icon_pencil),
]

# Render all labels with CoreText first
text_jobs = []
for i, (label, sub, _accent, _icon) in enumerate(CELLS):
    text_jobs.append({"text": label, "font": "Thonburi-Bold", "size": 88,
                      "color": list(LABEL), "out": f"/tmp/rm-label-{i}.png"})
    text_jobs.append({"text": sub, "font": "Thonburi", "size": 44,
                      "color": list(SUB), "out": f"/tmp/rm-sub-{i}.png"})
render_texts(text_jobs)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

PAD = 28
for i, (label, sub, accent, draw_icon) in enumerate(CELLS):
    col, row = i % COLS, i // COLS
    x0, y0 = col * CW + PAD, row * CH + PAD
    x1, y1 = (col + 1) * CW - PAD, (row + 1) * CH - PAD
    rounded(d, [x0, y0, x1, y1], 44, fill=CARD, outline=CARD_BORDER, width=3)

    ccx = (x0 + x1) // 2
    # accent circle + icon
    icr = 130
    icy = y0 + 250
    d.ellipse([ccx - icr, icy - icr, ccx + icr, icy + icr],
              fill=(accent[0] // 5 + 10, accent[1] // 5 + 14, accent[2] // 5 + 20))
    d.ellipse([ccx - icr, icy - icr, ccx + icr, icy + icr], outline=accent, width=6)
    draw_icon(d, ccx, icy, 200, accent)

    # paste CoreText-rendered labels (centered)
    lbl = Image.open(f"/tmp/rm-label-{i}.png")
    img.paste(lbl, (ccx - lbl.width // 2, y0 + 440), lbl)
    s = Image.open(f"/tmp/rm-sub-{i}.png")
    img.paste(s, (ccx - s.width // 2, y0 + 600), s)

img.save("/tmp/richmenu.png", "PNG")
print("saved /tmp/richmenu.png", img.size)
