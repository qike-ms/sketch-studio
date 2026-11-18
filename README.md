# Sketch Studio

> ### A toy app, written by a local model
> 
> This is a toy drawing app built entirely using **`local/qwen3.8-flash-next-coder`** — a Qwen3.8-Flash-Next GGUF at **IQ1_M quantization**, assisted by a speculative draft model.
> The model runs locally on a MacBook, served by **Splash** (`splash serve --offline --host 127.0.0.1`) and driven through the **pi** coding agent with some of its coding skills at `high` reasoning effort.
> **No cloud models, no API calls, no telemetry.** Everything runs locally.
> The goal is to explore **what a heavily quantized local model can build in a few hours**. The app now includes 347 unit tests and a 21-check headless-Chromium smoke script, with a broad, still dependency-free feature set. This is a toy: the checks below are evidence for the flows they exercise, not a claim of exhaustive browser coverage or production readiness.

A hand-drawn editor for the browser: paint sketchy shapes, type text, and
connect objects with arrows that stay attached when you move things around.

No dependencies, no build step, no network calls — everything happens in one
HTML page and saves to your browser's local storage.

## See it

![Sketch Studio demo](assets/sketch-studio.gif)

Not a mock-up: every frame is the live app in headless Chromium. The 24-second
loop draws a rectangle, ellipse and diamond, fills them, double-clicks a label
onto the rectangle, binds an elbow arrow between two shapes, moves the ellipse
so the arrow follows, rotates the diamond, groups and aligns two shapes,
copies/pastes, pans and zooms to fit, toggles grid and snap, switches to dark
mode, changes opacity/roughness/dash in the properties panel, exports SVG, and
finally opens a corrupt JSON file: the toast reports what was repaired and the
drawing survives. Regenerate with `python3 tools/make_gif.py`; Playwright and
Pillow are not project dependencies, so use a throwaway venv:

```bash
python3 -m venv ~/.cache/sketch-studio-venv
~/.cache/sketch-studio-venv/bin/pip install playwright pillow
~/.cache/sketch-studio-venv/bin/playwright install chromium
~/.cache/sketch-studio-venv/bin/python tools/make_gif.py
~/.cache/sketch-studio-venv/bin/python tools/browser_check.py
```

`tools/browser_check.py` starts a local server, drives real pointer/keyboard
input in headless Chromium, and asserts user-visible outcomes. It covers the
drawing/autosave path, selection and mixed style controls, lock, long-text
round-trips, corrupt-backup recovery, conflict cancellation and Load, zoom-aware
rotation, rotated resize, elbow endpoint editing, SVG text placement, and boot
with denied storage. It is a smoke check, not a full browser test suite.

## Run

```bash
npm start          # then open http://localhost:4171
```

Needs Python 3 (stdlib `http.server`, nothing to install); `npm start` is just
`python3 -m http.server 4171`. That server sends no `Cache-Control` header, so
after editing `assets/` do a hard reload (`Cmd+Shift+R`) to skip the browser's
cached copy. Node 20+ is only needed for the tests.

## Test

```bash
npm test           # Node 20+; runs the DOM-free unit tests in tests/
```

## What it does

| Tool | Key | Behaviour |
| --- | --- | --- |
| Select | `V` | click / shift-click, marquee drag, single-element move, 8 handles on a single selection, aggregate multi-selection resize, rotation handle, arrow-key nudge |
| Rect | `R` | jittered corners, straight edges; `Shift` constrains to a square |
| Ellipse | `O` | `Shift` constrains to a circle |
| Diamond | `D` | rhombus through the box edge midpoints |
| Line | `L` | `Shift` snaps to 15° steps |
| Arrow | `A` | docked ends follow their shapes; drag a stored bend point to add a vertex; elbow routing is a midpoint dogleg (no obstacle avoidance), and elbow connectors expose only their stored endpoints |
| Pen | `P` | freehand stroke |
| Eraser | `E` | drag across shapes to delete them |
| Text | `T` | click to type, `Enter` for a newline, `Esc` to commit; text is kept verbatim up to a 1,000,000-character scene budget |
| Image | — | insert, paste or drop PNG/JPEG/GIF/WebP; stored as a validated data URL |

Style controls: stroke width, solid/dashed/dotted, palette plus a custom colour
picker, fill (none or 8 colours at 35% alpha), opacity, roughness
(architect/artist/cartoonist), sharp/round edges, three font families, text
size, and arrowheads per end (none/arrow/triangle/dot).

Editing actions: undo/redo (bounded history), duplicate, copy/cut/paste with
in-app and system-clipboard JSON, group/ungroup, lock/unlock, align six edges,
distribute horizontally/vertically, bring to front/back and forward/backward,
clear, and a right-click context menu.

Canvas and UX: infinite pan (space+drag, middle-drag, wheel/trackpad), anchored
zoom (Ctrl/⌘+wheel, pinch, buttons), zoom indicator, zoom-to-fit and
zoom-to-selection, grid toggle and snap, light/dark theme, a properties panel
that reflects single-selection values and marks mixed values explicitly, toasts,
and a `?` shortcut overlay.

Anything centred inside a shape — including a label you typed — re-centres
when that shape moves or resizes. Labels follow their container's angle on
move/resize and on angle-field edits.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `V` `R` `O` `D` `L` `A` `P` `E` `T` | select / rect / ellipse / diamond / line / arrow / pen / eraser / text |
| `Space`+drag, middle-drag, wheel | pan |
| `Ctrl/⌘`+wheel, pinch | zoom at the cursor |
| `Ctrl/⌘` `+` / `-` / `0` / `1` / `2` | zoom in / out / reset / fit all / fit selection |
| `Ctrl/⌘+Z`, `Shift+Ctrl/⌘+Z`, `Ctrl/⌘+Y` | undo / redo / redo |
| `Ctrl/⌘+A`, `Ctrl/⌘+D` | select all / duplicate |
| `Ctrl/⌘+C`, `Ctrl/⌘+X`, `Ctrl/⌘+V` | copy / cut / paste |
| `Ctrl/⌘+G`, `Shift+Ctrl/⌘+G` | group / ungroup |
| `Ctrl/⌘+Shift+L` | toggle lock |
| `Ctrl/⌘+]`, `Ctrl/⌘+[` | forward / backward; add `Shift` for front / back |
| Arrow keys, `Shift`+arrows | nudge 1 px / 10 px |
| `Delete` / `Backspace` | delete selection |
| `G`, `S` | toggle grid / snap |
| `?`, `Esc` | shortcut help / cancel, deselect, close menu |

## Fault tolerance

The drawing is treated as data that must survive bad input, bad saves and
concurrent tabs. Every load path — localStorage, opened JSON and clipboard —
goes through the same validator before anything reaches the renderer.

- **Validate and repair; reject only when nothing usable remains.**
  `src/schema.js` repairs recoverable elements (bad coordinates, colours, enums,
  duplicate ids, dangling bindings/containers) and drops only unrecoverable
  ones. The UI reports what happened instead of failing silently. Long text is
  kept verbatim; whole-scene text/point budgets reject oversized scenes with a
  clear issue rather than silently truncating content.
- **Schema versioning.** Scenes are version 2; version 1 and unversioned data
  are migrated by filling missing fields only.
- **Two-phase debounced autosave.** `src/persistence.js` writes a pending copy,
  verifies it, promotes it to current, keeps the previous validated snapshot as
  backup, and maintains a best-effort ring of up to five validated snapshots.
  Quota pressure can trim or remove the ring, and the pending slot is staging,
  not a crash journal. Separate Web Storage writes are not a cross-key
  transaction. Corrupt current data is never allowed to overwrite the backup.
- **Quota and unavailable storage.** `QuotaExceededError` and private-mode
  storage failures are detected, surfaced as toasts, and do not lose the
  in-memory drawing. Reads still work when the quota is full.
- **Multi-tab conflicts.** Revision numbers detect another tab changing the
  drawing. A queued debounce is cancelled when a conflict appears, and every
  write is guarded by the revision the controller last observed, so a stale
  timer cannot overwrite the other tab. Newer external revisions replace the
  pending conflict prompt. The user gets `Load other tab` / `Keep mine`;
  closing the tab does not flush over an unresolved conflict.
- **Bounded, validated undo.** History is capped (100 entries); corrupt or
  missing snapshots are skipped rather than crashing undo.
- **Error boundary and recovery export.** Guarded handlers catch unexpected
  failures, show a toast, and offer a recovery JSON download.
- **Import guards.** Byte/character limits are checked before `JSON.parse`;
  element, point and whole-scene text budgets are enforced; malformed JSON,
  invalid roots and oversized images are rejected. Markup-like text is kept
  verbatim and rendered as canvas text or escaped SVG — never via `innerHTML`.
- **Fault-tolerant UI.** Rendering isolates each element so one bad element
  cannot abort the rest; load failures fall through the recovery slots and are
  reported without destroying the current scene.

The unit suite covers these paths with injectable storage, timers and id
factories, including corrupt fixtures and quota/unavailable storage. The
headless-Chromium smoke script checks selected end-to-end flows with real
pointer/keyboard input; it is not exhaustive browser coverage.

## Layout

```
index.html          markup, toolbar, properties panel, help/toasts/context menu
assets/app.js       DOM, canvas sizing, gestures, toolbar state, persistence, shortcuts
assets/render.js    viewport-aware canvas painting (strokes, fills, images, handles, caret)
assets/styles.css   light/dark layout and chrome
src/schema.js       versioning, migration, validation and repair
src/persistence.js  debounced two-phase autosave, backup/ring, quota, multi-tab revisions
src/autosave.js     debounce/conflict controller: cancel stale writes, Load/Keep, unload guard
src/controls.js     selection-to-controls projection, including mixed values
src/edit.js         lock policy, including container-lock inheritance
src/import.js       file/clipboard guards, markup detection, escaping
src/errors.js       error boundary, toasts, recovery payload
src/scene.js        element store, bounded validated history, selection model
src/viewport.js     pan, anchored zoom, fit, grid snap
src/geometry.js     bounds, rotated hit-testing, connector routing, rotation handles
src/arrange.js      z-order, groups, lock, align, distribute, nudge
src/clipboard.js    validated in-app/system clipboard, paste remapping
src/text.js         caret editing, label placement
src/rough.js        deterministic sketchy paths and arrowhead geometry
src/export.js       escaped SVG export, selection bounds, themes, images
src/tools.js        drafts, constraints, connector vertices, rotation handles, palette
src/images.js       MIME/size/data-URL guards, fitting, image elements
src/properties.js   mixed-selection reflection and style patches
tests/*.test.mjs    unit tests for the DOM-free layers
tools/make_gif.py   regenerates the demo GIF (Playwright + Pillow)
tools/browser_check.py  headless-Chromium smoke checks with real input (optional)
```

The `src/` layer has no DOM access, which is what keeps it unit-testable.

## Known limitations

- This is a single-browser toy editor. There is no collaboration backend; the
  conflict path relies on Web Storage events from another tab in the same
  browser profile.
- Elbow routing is a midpoint dogleg, not obstacle avoidance. Connectors are not
  rotated.
- Multi-selection resize uses aggregate bounds, but individual handles are still
  drawn per element, so the affordance is not fully Excalidraw-like.
- Viewport pan/zoom is not persisted; only the scene, style and theme are.
- PNG export has no pixel/side cap, and image data URLs are checked by MIME,
  size and prefix rather than decoded pixel limits.
- The snapshot ring is best effort and can be trimmed under quota pressure.
- The browser smoke script covers the listed flows, not touch/pinch, OS
  clipboard permissions, image decoding or real multi-tab timing.

## License

MIT (see `LICENSE`). Fonts are referenced by system name only; no font files
or other third-party assets are distributed.
