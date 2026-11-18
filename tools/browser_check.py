#!/usr/bin/env python3
"""Headless-Chromium smoke checks for the real app.

Not a project dependency. Run with a throwaway venv that has Playwright:

    ~/.cache/sketch-studio-venv/bin/python tools/browser_check.py

The script starts a local stdlib HTTP server, drives real pointer/keyboard
input, and asserts user-visible outcomes. It exits non-zero on failure.
"""
from __future__ import annotations

import json
import random
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY = "sketch-studio:v2"
CHECKS = []


def check(name, condition, detail=""):
    if not condition:
        raise AssertionError(f"{name}: {detail}")
    CHECKS.append(name)
    print(f"ok - {name}")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_ready(page):
    page.wait_for_function("() => !!window.sketchStudio && !!document.getElementById('board')")
    page.wait_for_timeout(50)


def canvas(page):
    return page.locator("#board").bounding_box()


def click_scene(page, x, y, **kwargs):
    box = canvas(page)
    page.mouse.click(box["x"] + x, box["y"] + y, **kwargs)


def scene_eval(page, expression, arg=None):
    return page.evaluate(expression, arg)


def load_scene(page, elements):
    page.evaluate(
        """(els) => {
            const app = window.sketchStudio;
            app.scene.loadFrom({ elements: els });
            app.viewport.reset();
            app.setTool('select');
        }""",
        elements,
    )
    page.wait_for_timeout(30)


def make(page, spec):
    return page.evaluate(
        """async (spec) => {
            const { makeElement } = await import('/src/scene.js');
            return makeElement(spec);
        }""",
        spec,
    )


def main():
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}/"
    for _ in range(50):
        try:
            urllib.request.urlopen(url, timeout=0.2)
            break
        except Exception:
            time.sleep(0.1)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)

            # --- normal app -------------------------------------------------
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.goto(url)
            wait_ready(page)

            # Draw with real keyboard + pointer input.
            page.keyboard.press("r")
            box = canvas(page)
            page.mouse.move(box["x"] + 500, box["y"] + 300)
            page.mouse.down()
            page.mouse.move(box["x"] + 660, box["y"] + 410, steps=8)
            page.mouse.up()
            page.wait_for_timeout(500)
            drawn = scene_eval(page, "() => window.sketchStudio.scene.elements")
            check("draw rect with pointer", len(drawn) == 1 and drawn[0]["type"] == "rect")
            saved = scene_eval(page, "(key) => localStorage.getItem(key)", KEY)
            check("debounced autosave reaches localStorage", bool(saved))

            # Style controls reflect a single selection.
            rect = make(page, {"id": "styled", "type": "rect", "x": 500, "y": 300,
                               "width": 120, "height": 80, "opacity": 25,
                               "strokeColor": "#e03131", "backgroundColor": "#ffc9c9"})
            load_scene(page, [rect])
            click_scene(page, 560, 340)
            check("single selection summary", page.locator("#selectionSummary").inner_text().startswith("1"))
            check("opacity control reflects selection", page.locator("#opacityRange").input_value() == "25",
                  page.locator("#opacityRange").input_value())
            pressed = page.evaluate("""() => [...document.querySelectorAll('#colorGrid button')]
                .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.color)""")
            check("stroke colour reflects selection", pressed == ["#e03131"], str(pressed))

            # Mixed values are explicit, not creation defaults.
            a = make(page, {"id": "a", "type": "rect", "x": 500, "y": 300,
                            "width": 120, "height": 80, "opacity": 25,
                            "strokeColor": "#e03131", "backgroundColor": "#ffc9c9"})
            b = make(page, {"id": "b", "type": "rect", "x": 700, "y": 300,
                            "width": 120, "height": 80, "opacity": 75, "roughness": 2,
                            "strokeColor": "#1971c2", "backgroundColor": "#a5d8ff"})
            load_scene(page, [a, b])
            click_scene(page, 560, 340)
            page.keyboard.down("Shift")
            click_scene(page, 760, 340)
            page.keyboard.up("Shift")
            check("mixed opacity marked", page.evaluate(
                "() => document.getElementById('opacityRange').dataset.mixed === 'true'"))
            check("mixed colour marked", page.evaluate(
                "() => document.getElementById('colorGrid').dataset.mixed === 'true'"))
            check("mixed select cleared", page.locator("#roughnessSelect").input_value() == "")

            # Locked shapes cannot be labelled by double-click + typing.
            locked = make(page, {"id": "locked", "type": "rect", "x": 500, "y": 300,
                                 "width": 140, "height": 100, "locked": True,
                                 "backgroundColor": "#ffc9c9"})
            load_scene(page, [locked])
            box = canvas(page)
            page.mouse.dblclick(box["x"] + 570, box["y"] + 350)
            page.keyboard.type("X")
            page.wait_for_timeout(100)
            texts = page.evaluate("() => window.sketchStudio.texts()")
            check("locked shape rejects double-click label", texts == [], str(texts))

            # Long text survives save + reload without silent truncation.
            page.evaluate("(key) => localStorage.clear()", KEY)
            page.evaluate("() => window.sketchStudio.saveController.noteLoaded({ revision: null })")
            long_text = "x" * 10001
            text = make(page, {"id": "long", "type": "text", "x": 500, "y": 300,
                               "width": 600, "height": 40, "text": long_text})
            load_scene(page, [text])
            page.evaluate("() => window.sketchStudio.save()")
            page.reload()
            wait_ready(page)
            loaded = page.evaluate("() => window.sketchStudio.texts()")
            check("10001-char text round-trips", loaded and len(loaded[0]["text"]) == 10001,
                  str(len(loaded[0]["text"]) if loaded else None))

            # Corrupt current slot falls back to the backup.
            page.evaluate(
                """(key) => {
                    localStorage.setItem(key, '{"version":2,"elements":null}');
                    localStorage.setItem(key + ':backup', JSON.stringify({
                        version: 2, revision: 'backup-1', savedAt: Date.now(),
                        elements: [{ id: 'from-backup', type: 'rect', x: 20, y: 20,
                                     width: 80, height: 80, version: 2 }]
                    }));
                }""",
                KEY,
            )
            page.reload()
            wait_ready(page)
            ids = page.evaluate("() => window.sketchStudio.scene.elements.map(e => e.id)")
            check("corrupt current recovers from backup", ids == ["from-backup"], str(ids))

            # Real browser conflict: queued debounce is cancelled.
            page.evaluate("(key) => localStorage.clear()", KEY)
            page.evaluate("() => window.sketchStudio.saveController.noteLoaded({ revision: null })")
            local = make(page, {"id": "local", "type": "rect", "x": 500, "y": 300,
                                "width": 120, "height": 80, "backgroundColor": "#ffc9c9"})
            load_scene(page, [local])
            page.evaluate("() => window.sketchStudio.save()")
            page.evaluate("() => { window.sketchStudio.scene.elements[0].x = 50; }")
            page.keyboard.press("g")  # schedules a save
            page.wait_for_timeout(100)
            foreign = {"version": 2, "revision": "foreign-1",
                       "elements": [{"id": "foreign", "type": "rect", "x": 700, "y": 300,
                                     "width": 100, "height": 100, "version": 2}]}
            page.evaluate(
                """([key, raw]) => {
                    localStorage.setItem(key, raw);
                    window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw }));
                }""",
                [KEY, json.dumps(foreign)],
            )
            page.wait_for_timeout(600)
            current = page.evaluate("(key) => JSON.parse(localStorage.getItem(key)).elements[0].id", KEY)
            check("conflict cancels queued write", current == "foreign", current)
            check("conflict keeps local dirty", page.evaluate("() => window.sketchStudio.saveController.dirty"))
            page.get_by_role("button", name="Load other tab").last.click()
            page.wait_for_timeout(100)
            ids = page.evaluate("() => window.sketchStudio.scene.elements.map(e => e.id)")
            check("Load other tab adopts external scene", ids == ["foreign"], str(ids))

            # Rotation handle is picked where it is drawn at zoom 2.
            rot = make(page, {"id": "rot", "type": "rect", "x": 300, "y": 250,
                              "width": 100, "height": 100, "backgroundColor": "#ffc9c9"})
            load_scene(page, [rot])
            page.evaluate("() => window.sketchStudio.viewport.setZoom(2)")
            click_scene(page, 700, 600)
            page.evaluate("() => window.sketchStudio.renderNow?.()")
            page.wait_for_timeout(50)
            # rect centre is scene (150,150); handle is 26/2 = 13 scene above top.
            box = canvas(page)
            page.mouse.move(box["x"] + 700, box["y"] + 474)
            page.mouse.down()
            page.mouse.move(box["x"] + 800, box["y"] + 600, steps=6)
            page.mouse.up()
            angle = page.evaluate("() => window.sketchStudio.scene.elements[0].angle")
            check("rotation handle picked at zoom 2", abs((angle or 0) - 90) < 8, str(angle))

            # Rotated resize keeps the opposite world-space corner fixed.
            rotated = make(page, {"id": "rotated", "type": "rect", "x": 500, "y": 300,
                                  "width": 100, "height": 40, "angle": 90,
                                  "backgroundColor": "#ffc9c9"})
            load_scene(page, [rotated])
            click_scene(page, 550, 320)
            before = page.evaluate(
                """async () => {
                    const geo = await import('/src/geometry.js');
                    const el = window.sketchStudio.scene.elements[0];
                    return geo.rotatePoint({x: el.x, y: el.y}, geo.elementCenter(el), el.angle);
                }""")
            handle = page.evaluate(
                """async () => {
                    const tools = await import('/src/tools.js');
                    const geo = await import('/src/geometry.js');
                    const el = window.sketchStudio.scene.elements[0];
                    const rect = geo.rectOf(el);
                    return geo.rotatePoint(tools.handlePosition(rect, 'se'), geo.elementCenter(el), el.angle);
                }""")
            box = canvas(page)
            page.mouse.move(box["x"] + handle["x"], box["y"] + handle["y"])
            page.mouse.down()
            page.mouse.move(box["x"] + handle["x"] + 30, box["y"] + handle["y"] + 20, steps=6)
            page.mouse.up()
            after = page.evaluate(
                """async () => {
                    const geo = await import('/src/geometry.js');
                    const el = window.sketchStudio.scene.elements[0];
                    return geo.rotatePoint({x: el.x, y: el.y}, geo.elementCenter(el), el.angle);
                }""")
            check("rotated resize keeps opposite corner fixed",
                  abs(before["x"] - after["x"]) < 1 and abs(before["y"] - after["y"]) < 1,
                  f"{before} -> {after}")

            # Elbow endpoint handle edits the stored endpoint, not a generated bend.
            arrow = make(page, {"id": "elbow", "type": "arrow", "x": 500, "y": 300,
                                "width": 100, "height": 100, "elbow": True,
                                "points": [{"x": 0, "y": 0}, {"x": 100, "y": 100}]})
            load_scene(page, [arrow])
            click_scene(page, 550, 350)
            box = canvas(page)
            page.mouse.move(box["x"] + 600, box["y"] + 400)
            page.mouse.down()
            page.mouse.move(box["x"] + 640, box["y"] + 460, steps=6)
            page.mouse.up()
            last = page.evaluate("() => window.sketchStudio.scene.elements[0].points.at(-1)")
            check("elbow end handle moves stored endpoint",
                  abs(last["x"] - 140) < 2 and abs(last["y"] - 160) < 2, str(last))

            # SVG text carries absolute y and line offsets.
            page.evaluate("""async () => {
                const { makeElement } = await import('/src/scene.js');
                window.sketchStudio.scene.loadFrom({ elements: [makeElement({
                    id: 'svg-text', type: 'text', x: 200, y: 500,
                    width: 100, height: 80, text: 'one\\ntwo'
                })] });
            }""")
            svg = page.evaluate("() => window.sketchStudio.exportSVG()")
            check("SVG text has absolute y", 'y="500.00"' in svg)
            check("SVG multiline keeps second-line offset", 'dy="30.00"' in svg)

            browser.close()

            # --- denied localStorage getter at boot -------------------------
            browser = pw.chromium.launch(headless=True)
            denied = browser.new_context(viewport={"width": 1000, "height": 700})
            denied.add_init_script("""
                Object.defineProperty(window, 'localStorage', {
                    configurable: true,
                    get() { throw new DOMException('denied', 'SecurityError'); }
                });
            """)
            page = denied.new_page()
            page.goto(url)
            wait_ready(page)
            check("boots with denied localStorage", page.evaluate("() => !!window.sketchStudio"))
            toasts = page.locator("#toasts").inner_text()
            check("denied storage is surfaced", "unavailable" in toasts.lower(), toasts)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
    print(f"\n{len(CHECKS)}/{len(CHECKS)} browser checks passed")


if __name__ == "__main__":
    main()
