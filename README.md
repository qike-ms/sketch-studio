# Sketch Studio

A hand-drawn editor for the browser: paint sketchy shapes, type text, and
connect objects with arrows that stay attached when you move things around.

No dependencies, no build step, no network calls — everything happens in one
HTML page and saves to your browser's local storage.

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
| Select | `V` | click / shift-click, marquee drag, move, 8 resize handles |
| Rect | `R` | jittered corners, straight edges; `Shift` constrains to a square |
| Ellipse | `O` | `Shift` constrains to a circle |
| Diamond | `D` | rhombus through the box edge midpoints |
| Line | `L` | `Shift` snaps to 15° steps |
| Arrow | `A` | ends dock into shapes: they follow the shape and show link dots |
| Pen | `P` | freehand stroke |
| Eraser | `E` | drag across shapes to delete them |
| Text | `T` | click to type, `Enter` for a newline, `Esc` to commit |

Style controls: stroke width, solid/dashed/dotted, pen palette plus a custom
colour picker, fill (none or 8 colours at 35% alpha), text size.
Actions: undo, redo, duplicate, bring to front, clear, export PNG, export JSON,
open a saved JSON file.

Anything centred inside a shape — including a label you typed — re-centres
when that shape moves or resizes.

## Layout

```
index.html        markup, toolbar cells, data-* attributes
assets/app.js     DOM, canvas sizing, toolbar state, undo, persistence
assets/render.js  canvas painting (strokes, fills, handles, caret)
assets/styles.css layout and toolbar chrome
src/geometry.js   bounds, hit-testing, resize handles, connector resolution
src/tools.js      draft rects, angle/aspect constraints, palette
src/rough.js      deterministic sketchy path generation (seeded by element id)
src/scene.js      element store, history (undo/redo), selection model
tests/*.test.mjs  unit tests for the DOM-free layers
```

The `src/` layer has no DOM access, which is what keeps it unit-testable.

## License

MIT (see `LICENSE`). Fonts are referenced by system name only; no font files
or other third-party assets are distributed.
