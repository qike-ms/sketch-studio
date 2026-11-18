# Sketch Studio — Excalidraw parity roadmap

Sketch Studio is a dependency-free, single-page hand-drawn editor. This document
compares it with the core Excalidraw editor, records the gaps, and lists the
implementation order. Fault tolerance is treated as a first-class feature, not
an afterthought: a drawing must survive bad input, bad saves and bad tabs.

Status legend: **done** = shipped on `excalidraw-parity`; **partial** = present
but narrower than Excalidraw; **missing** = not implemented.

> Review note: the first draft of this roadmap marked every target as done before
> the implementation existed. This revision restores the honest baseline
> (everything in P0–P4 is missing except where noted) and is the plan this
> branch now implements, in priority order.

## 1. Gap analysis

The "before" column records the honest baseline on `main` before this branch.
The status column is the current state after implementation.

### 1.1 Canvas and viewport

| Capability | Excalidraw | Sketch Studio before | Status |
| --- | --- | --- | --- |
| Infinite canvas | yes | fixed viewport, no pan | done |
| Pan: space+drag, middle mouse, wheel, trackpad | yes | missing | done |
| Zoom: ctrl/⌘+wheel, pinch, buttons, reset | yes | missing | done |
| Zoom indicator | yes | missing | done |
| Zoom to fit / zoom to selection | yes | missing | done |
| Grid toggle + snap to grid | yes | decorative dots, always on | done |
| Dark mode / theme toggle | yes | light only | done |

### 1.2 Editing and selection

| Capability | Excalidraw | Sketch Studio before | Status |
| --- | --- | --- | --- |
| Click / shift-click / marquee | yes | yes | done |
| Multi-element resize | yes | one element at a time | done |
| Copy / cut / paste (in-app + system clipboard JSON) | yes | duplicate only | done |
| Group / ungroup | yes | missing | done |
| Lock / unlock | yes | missing | done |
| Align (6 edges) and distribute | yes | missing | done |
| Z-order: front/back/forward/backward | front only | front only | done |
| Rotation handle | yes | missing | done |
| Arrow-key nudge | yes | missing | done |
| Select all | yes | yes | done |
| Delete / duplicate | yes | yes | done |
| Context menu | yes | missing | done |

### 1.3 Elements and styling

| Capability | Excalidraw | Sketch Studio before | Status |
| --- | --- | --- | --- |
| Rect / ellipse / diamond | yes | yes | done |
| Line / arrow | yes | yes | done |
| Freehand | yes | yes | done |
| Text | yes | yes | done |
| Double-click shape to edit its label | yes | click Text tool, then type | done |
| Arrowheads per end (none/arrow/triangle/dot) | yes | arrow only, one style | done |
| Multi-point lines/arrows, elbow routing | yes | two points, straight | done |
| Opacity | yes | stored but no UI | done |
| Roughness (architect/artist/cartoonist) | yes | one fixed style | done |
| Edge style (sharp/round) | yes | sharp only | done |
| Font family | yes | one hand font | done |
| Images (paste/drop, data URL) | yes | missing | done |
| Bindings arrows → shapes | yes | yes | done |
| Labels bound to containers | yes | yes | done |

### 1.4 Export, persistence and resilience

| Capability | Excalidraw | Sketch Studio before | Status |
| --- | --- | --- | --- |
| PNG export | yes | whole scene | done |
| SVG export | yes | missing | done |
| Export selection only | yes | missing | done |
| JSON save / open | yes | yes, no validation | done |
| Schema version + migrations | yes | version field, no migrations | done |
| Validate/repair on load | yes | none | done |
| Debounced atomic autosave | yes | every pointer-up, single slot | done |
| Snapshot ring / corrupt-save recovery | partial | none | done |
| QuotaExceeded handling | yes | none | done |
| Storage unavailable (private mode) | yes | crash on save | done |
| Multi-tab edit detection | yes (collab) | none | done |
| Bounded undo history | yes | 100 entries, no guard | done |
| Error boundary + recovery export | partial | console.warn only | done |
| Import guards (size, count, parse, XSS) | yes | none | done |

### 1.5 UX

| Capability | Excalidraw | Sketch Studio before | Status |
| --- | --- | --- | --- |
| Properties panel reflecting selection | yes | static toolbar | done |
| Keyboard shortcut help (`?`) | yes | missing | done |
| Context menu | yes | missing | done |
| Toasts / non-blocking errors | yes | missing | done |
| Command palette | yes | missing | out of scope |
| Collaboration / libraries / frames | yes | missing | out of scope |

## 2. Prioritised plan

Priority is driven by two questions: what protects the user's drawing, and what
does a user reach for on the first minute of editing?

### P0 — Fault tolerance (implement first)

1. `src/schema.js`: schema version 2, migration from v1/unversioned, element
   defaults, strict validation and repair with an issue report.
2. `src/persistence.js`: debounced atomic autosave, current + backup + ring of
   N good snapshots, quota detection, unavailable-storage fallback, multi-tab
   revision detection.
3. `src/import.js`: file-size, element-count, parse-error and string guards.
4. `src/errors.js`: guarded handlers, toast state, recovery JSON escape hatch.
5. Bounded undo/redo with snapshot validation.

### P1 — Canvas

6. `src/viewport.js`: pan, anchored zoom, zoom limits, zoom-to-fit, grid snap.
7. App integration: space/middle/wheel pan, ctrl-wheel/pinch zoom, indicator,
   grid toggle, fit/reset buttons, dark theme.

### P2 — Editing power

8. `src/arrange.js`: z-order, group/ungroup, lock, align, distribute, nudge.
9. Rotation: angle field, rotate handle, rotated hit-testing and bounds.
10. `src/clipboard.js`: in-app clipboard, system clipboard JSON, remapped paste.
11. Keyboard: select all, arrow nudge, copy/cut/paste, group, z-order, help.

### P3 — Element richness

12. Double-click label editing on shapes.
13. Arrowheads per end, multi-point connectors, elbow routing.
14. Opacity, roughness, edge style, font family in the properties panel.
15. Images from paste/drop, stored as data URLs with size caps.

### P4 — Export and UX

16. `src/export.js`: SVG export (escaped), PNG/SVG selection-only.
17. Properties panel that reflects the selection and applies changes live.
18. Context menu, shortcut help overlay (`?`), toasts.

### P5 — Verification and docs

19. Browser verification with headless Chromium; fix interaction bugs.
20. README feature table, shortcuts, layout and fault-tolerance sections.
21. This roadmap updated with what shipped and what remains.

## 3. Architecture rules

- `src/` is DOM-free and unit-tested; `assets/` owns the canvas and DOM.
- No dependencies, no build step, no network calls.
- Every load path (localStorage, opened file, clipboard) goes through the same
  validator, so corruption cannot reach the renderer.
- Persistence never deletes the previous good snapshot before the new one is
  written and verified.
- A failing element is dropped or repaired, reported in the UI, and never takes
  the rest of the scene with it.

## 4. What shipped (final)

P0–P4 shipped on `excalidraw-parity`, and P5 (browser verification, README and
this roadmap) is complete. Every new `src/` function and fault-tolerance path
has unit coverage; the suite went from 59 to 214 tests. A headless-Chromium
story run checks 18/18 behaviours end to end, including corrupt-file recovery,
elbow binding, rotation, grouping/alignment, clipboard remapping, zoom/pan,
theme, properties and SVG export.

Known remaining gaps (deliberately out of scope for a toy app):

- Rotation of connectors; rotation is single-element for shapes/text/images.
- Frames, libraries, collaboration, laser pointer, command palette.
- Rich text (inline styling, text alignment beyond centre).
- Image cropping and SVG image import.
- IndexedDB storage for very large scenes; localStorage + snapshot ring is the
  current ceiling.
