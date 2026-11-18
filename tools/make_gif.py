#!/usr/bin/env python3
"""Record a Sketch Studio demo GIF by driving the live app in headless Chromium.

Regenerates assets/sketch-studio.gif from real interactions: drawing, labels,
elbow arrows, rotation, grouping/alignment, copy/paste, pan/zoom, grid/snap,
dark mode, the properties panel, SVG export and a corrupt-JSON recovery.

Playwright and Pillow are not project dependencies. Install them in a venv:
    python3 -m venv ~/.cache/sketch-studio-venv
    ~/.cache/sketch-studio-venv/bin/pip install playwright pillow
    ~/.cache/sketch-studio-venv/bin/playwright install chromium
Then, with the dev server running on :4171:
    ~/.cache/sketch-studio-venv/bin/python tools/make_gif.py [output.gif]
"""
import io
import json
import math
import os
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:4171/index.html"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sketch-studio.gif"
CORRUPT_FILE = "/tmp/sketch-studio-corrupt.json"
CLIP = {"x": 0, "y": 0, "width": 1280, "height": 800}
FRAMES = []
DURATIONS = []


class Rec:
    def __init__(self, page):
        self.page = page

    def grab(self, ms=120):
        FRAMES.append(self.page.screenshot(clip=CLIP))
        DURATIONS.append(ms)

    def pause(self, ms=450):
        self.grab(ms)


def click(page, rec, selector, wait=250):
    page.click(selector)
    rec.grab(wait)


def drag(page, rec, x0, y0, x1, y1, steps=8, frame_ms=70):
    page.mouse.move(x0, y0)
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        rec.grab(frame_ms)
    page.mouse.up()
    rec.grab(frame_ms)


def click_at(page, rec, x, y, wait=220):
    page.mouse.click(x, y)
    rec.grab(wait)


def type_text(page, rec, text, frame_ms=85):
    for ch in text:
        page.keyboard.type(ch)
        rec.grab(frame_ms)


def screen_point(page, selector):
    return page.evaluate(
        """(sel) => {
            const el = sketchStudio.scene.elements.find(e => e.type === sel);
            if (!el) return null;
            const p = sketchStudio.viewport.sceneToScreen({ x: el.x + el.width / 2, y: el.y });
            return { x: p.x, y: p.y };
        }""",
        selector,
    )


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
    page.on("download", lambda download: download.cancel())
    page.goto(URL)
    page.wait_for_function("window.sketchStudio !== undefined")
    page.evaluate("localStorage.clear(); sketchStudio.scene.elements = []; sketchStudio.viewport.reset();")
    page.reload()
    page.wait_for_function("window.sketchStudio !== undefined")
    page.wait_for_timeout(500)
    rec = Rec(page)
    rec.pause(700)

    # Three shapes, with fill and ink changes.
    click(page, rec, '[data-tool="rect"]')
    drag(page, rec, 320, 200, 560, 360)
    click(page, rec, '#fillGrid button.swatch:nth-of-type(4)', 350)
    click(page, rec, '#colorGrid button.swatch:nth-of-type(6)', 300)
    click(page, rec, '[data-tool="ellipse"]')
    drag(page, rec, 680, 200, 860, 340)
    click(page, rec, '[data-tool="diamond"]')
    drag(page, rec, 880, 220, 1000, 360)
    click(page, rec, '#fillGrid button.swatch:nth-of-type(4)', 300)

    # Double-click the rectangle, type its label, commit with Escape.
    page.mouse.dblclick(440, 280)
    rec.pause(350)
    type_text(page, rec, "Sketch Studio")
    page.keyboard.press("Escape")
    rec.pause(450)

    # Connect rectangle and ellipse, then make the arrow an elbow with heads.
    click(page, rec, '[data-tool="arrow"]')
    drag(page, rec, 560, 280, 680, 270)
    page.select_option("#startArrowheadSelect", "dot")
    rec.pause(250)
    page.select_option("#endArrowheadSelect", "triangle")
    rec.pause(250)
    page.check("#elbowToggle")
    rec.pause(450)

    # Move the ellipse: the bound elbow arrow follows it.
    click(page, rec, '[data-tool="select"]')
    drag(page, rec, 770, 201, 820, 270, steps=10)
    rec.pause(550)

    # Rotate the diamond with its rotation handle.
    click_at(page, rec, 940, 222)
    handle = page.evaluate(
        """() => {
            const el = sketchStudio.scene.elements.find(e => e.type === 'diamond');
            return { x: el.x + el.width / 2, y: el.y - 26 };
        }"""
    )
    drag(page, rec, handle["x"], handle["y"], handle["x"] + 78, handle["y"] + 34, steps=10)
    rec.pause(500)

    # Shift-select rectangle + ellipse, group, align their tops.
    click_at(page, rec, 321, 201)
    page.keyboard.down("Shift")
    click_at(page, rec, 821, 271)
    page.keyboard.up("Shift")
    rec.pause(250)
    click(page, rec, '#groupBtn', 400)
    click(page, rec, '[data-align="top"]', 500)
    click(page, rec, '#ungroupBtn', 300)

    # Copy/paste the diamond, then undo and redo the paste.
    point = page.evaluate(
        """() => {
            const el = sketchStudio.scene.elements.find(e => e.type === 'diamond');
            const p = sketchStudio.viewport.sceneToScreen({ x: el.x + el.width / 2, y: el.y + el.height / 2 });
            return { x: p.x, y: p.y };
        }"""
    )
    click_at(page, rec, point["x"], point["y"])
    click(page, rec, '#copyBtn', 350)
    click(page, rec, '#pasteBtn', 500)
    click(page, rec, '#undoBtn', 400)
    click(page, rec, '#redoBtn', 400)

    # Pan with Space+drag, zoom in, then zoom to fit.
    page.keyboard.down("Space")
    drag(page, rec, 600, 420, 700, 470, steps=7)
    page.keyboard.up("Space")
    rec.pause(350)
    click(page, rec, '#zoomInBtn', 300)
    click(page, rec, '#zoomInBtn', 300)
    click(page, rec, '#zoomFitBtn', 600)

    # Grid and snap toggles.
    click(page, rec, '#gridBtn', 400)
    click(page, rec, '#gridBtn', 350)
    click(page, rec, '#snapBtn', 500)

    # Dark mode.
    click(page, rec, '#themeBtn', 600)

    # Properties panel: select the ellipse, lower opacity, change roughness/dash.
    point = screen_point(page, "ellipse")
    click_at(page, rec, point["x"], point["y"], 300)
    page.evaluate(
        """() => { const r = document.getElementById('opacityRange'); r.value = '55'; r.dispatchEvent(new Event('input', { bubbles: true })); }"""
    )
    rec.pause(350)
    page.select_option("#roughnessSelect", "2")
    rec.pause(300)
    click(page, rec, '[data-style="dashed"]', 450)

    # Export SVG (download cancelled; the toast is the visible result).
    click(page, rec, '#svgBtn', 700)

    # Fault tolerance: open a corrupt JSON that still contains this drawing.
    drawing = json.loads(page.evaluate("JSON.stringify(sketchStudio.scene.toJSON())"))
    corrupt = {
        "version": 1,
        "elements": drawing["elements"]
        + [
            {"id": drawing["elements"][0]["id"], "type": "rect", "x": "oops", "y": 0, "width": -40, "height": 20},
            {"id": "bad-type", "type": "triangle", "x": 0, "y": 0, "width": 10, "height": 10},
            {"id": "bad-link", "type": "arrow", "x": 0, "y": 0, "points": [{"x": 0, "y": 0}, {"x": 60, "y": 0}],
             "startBinding": {"elementId": "ghost"}},
        ],
    }
    with open(CORRUPT_FILE, "w", encoding="utf-8") as handle:
        json.dump(corrupt, handle)
    click(page, rec, '#openBtn', 250)
    page.set_input_files(".filepicker", CORRUPT_FILE)
    rec.pause(900)
    click(page, rec, '#zoomFitBtn', 900)
    rec.pause(800)

    browser.close()

W = 650  # GIF width; source clip is 1280x800
first = Image.open(io.BytesIO(FRAMES[0]))
scale = W / first.width
height = int(first.height * scale)
pal = [
    Image.open(io.BytesIO(data)).convert("RGB").resize((W, height), Image.LANCZOS)
    .convert("P", palette=Image.ADAPTIVE, colors=144)
    for data in FRAMES
]
pal[0].save(
    OUT,
    save_all=True,
    append_images=pal[1:],
    duration=DURATIONS,
    loop=0,
    optimize=True,
    disposal=2,
)
size_mb = os.path.getsize(OUT) / (1024 * 1024)
total_s = sum(DURATIONS) / 1000
print(f"frames={len(pal)} duration={total_s:.1f}s size={size_mb:.2f}MB -> {OUT}")
