#!/usr/bin/env python3
"""Record a Sketch Studio demo GIF by driving the live app in headless Chromium.

Regenerates assets/sketch-studio.gif by driving the running app, so the
demo is real interaction rather than a hand-made animation.

Needs the dev server on :4171 plus Playwright and Pillow (not project deps):
    pip install playwright pillow && playwright install chromium
    python3 tools/make_gif.py [output.gif]   # default: /tmp/sketch-studio.gif
"""
import io
import math
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:4171/index.html"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sketch-studio.gif"
CLIP = {"x": 40, "y": 60, "width": 1180, "height": 700}
FRAMES = []


class Rec:
    def __init__(self, page):
        self.page = page

    def grab(self):
        FRAMES.append(self.page.screenshot(clip=CLIP))


def drag(page, rec, x0, y0, x1, y1, steps=8):
    page.mouse.move(x0, y0)
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        rec.grab()
    page.mouse.up()
    rec.grab()


def wiggle(page, rec, x0, y0, count=34, span=6):
    page.mouse.move(x0, y0)
    page.mouse.down()
    for i in range(1, count + 1):
        page.mouse.move(x0 + i * span, y0 + 40 * math.sin(i / 3))
        rec.grab()
    page.mouse.up()
    rec.grab()


def type_text(page, rec, text):
    for ch in text:
        page.keyboard.type(ch)
        rec.grab()


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
    pg.goto(URL)
    pg.wait_for_function("window.sketchStudio !== undefined")
    pg.evaluate("sketchStudio.scene.elements = []")
    pg.evaluate("localStorage.clear()")
    pg.reload()
    pg.wait_for_function("window.sketchStudio !== undefined")
    pg.wait_for_timeout(400)
    rec = Rec(pg)
    rec.grab()

    pg.evaluate("sketchStudio.setTool('rect')")
    drag(pg, rec, 300, 220, 560, 400)

    pg.evaluate("sketchStudio.setTool('ellipse')")
    drag(pg, rec, 700, 200, 900, 360)

    pg.evaluate("sketchStudio.setTool('diamond')")
    drag(pg, rec, 980, 230, 1120, 400)

    # pick a new ink and a fill: everything drawn after this uses them
    pg.click(".grid#colorGrid button.swatch:nth-of-type(3)")
    pg.wait_for_timeout(200)
    rec.grab()
    pg.click(".grid#fillGrid button.swatch:nth-of-type(4)")
    pg.wait_for_timeout(200)
    rec.grab()

    pg.evaluate("sketchStudio.setTool('freehand')")
    wiggle(pg, rec, 200, 560)

    pg.evaluate("sketchStudio.setTool('arrow')")
    drag(pg, rec, 545, 300, 790, 285)

    # label inside the rectangle: click to start editing, type, Escape commits
    pg.evaluate("sketchStudio.setTool('text')")
    pg.mouse.click(430, 310)
    pg.wait_for_timeout(150)
    rec.grab()
    type_text(pg, rec, "Sketch Studio")
    pg.wait_for_timeout(120)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(180)
    rec.grab()

    # ink and fill changes, then move the ellipse: the arrow follows its link
    # unfilled shapes pick up by their outline, so grab the ellipse's top edge
    pg.evaluate("sketchStudio.setTool('select')")
    drag(pg, rec, 800, 202, 900, 392, steps=10)

    # duplicate the diamond, then undo
    pg.mouse.click(1050, 315)
    pg.wait_for_timeout(150)
    rec.grab()
    pg.click("#dupBtn")
    pg.wait_for_timeout(250)
    rec.grab()
    pg.click("#undoBtn")
    pg.wait_for_timeout(250)
    rec.grab()

    for _ in range(8):
        pg.wait_for_timeout(120)
        rec.grab()
    b.close()

W = 680  # GIF width; source clip is 1180x700
first = Image.open(io.BytesIO(FRAMES[0]))
scale = W / first.width
pal = [
    Image.open(io.BytesIO(data)).convert("RGB").resize((W, int(first.height * scale)), Image.LANCZOS)
    .convert("P", palette=Image.ADAPTIVE, colors=256)
    for data in FRAMES
]
pal[0].save(OUT, save_all=True, append_images=pal[1:], duration=10, loop=0, optimize=True)
print(f"frames={len(pal)} size={first.width}x{first.height} -> {OUT}")
