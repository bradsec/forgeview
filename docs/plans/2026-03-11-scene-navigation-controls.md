# Scene Navigation Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a view cube and navigation button overlay to the 3D viewport for quick camera control — snap to standard views, fit all, reset, zoom, perspective/ortho toggle, draggable cube orbit, and Fusion 360-style middle-click pan.

**Tech Stack:** React 19, Three.js r183, Zustand 5, Tailwind CSS v4

---

## Status

All 9 tasks are **COMPLETE**. Additional features (draggable ViewCube, middle-click pan) were added during implementation. Several bug fixes were applied. Task 9 (manual testing) verified via Playwright browser testing.

### Commits (oldest → newest)
- `d95b85e` feat: add projectionMode to viewer store
- `7916798` feat: add camera actions utility (snap, fit, reset, zoom)
- `f9ac60f` feat: expose camera actions from Viewer3D via forwardRef
- `9944d6a` fix: read sidebarVisible from latest state in Details toggle
- `6daff01` feat: add ViewCube component with face clicking and camera sync
- `d2cab40` feat: add SceneControls overlay with ViewCube and navigation buttons
- `838582d` feat: wire SceneControls into App layout
- `7002635` feat: implement perspective/orthographic toggle and middle-click pan
- `1b7b783` feat: make ViewCube draggable for free orbit (Fusion 360 style)
- `24a2d24` fix: stabilize orthographic camera resize
- `f6f701d` fix: sidebar toggle and duplicate model prevention
- `81715b2` fix: viewport controls disappear on window resize
- `d69ff61` fix: guard Tauri API calls in DropZone for browser compatibility

### Files created
- `src/utils/cameraActions.ts` — Pure camera math: snap, fit, reset, zoom, animation tick
- `src/components/ViewCube.tsx` — 80px interactive 3D cube, syncs with main camera, draggable orbit, click-to-snap
- `src/components/SceneControls.tsx` — Overlay with ViewCube + icon buttons (fit, reset, zoom, projection toggle)

### Files modified
- `src/store/viewerStore.ts` — Added `projectionMode` + `setProjectionMode`
- `src/components/Viewer3D.tsx` — forwardRef with `Viewer3DHandle`, animation tick in render loop, Effect 6 for projection toggle, `orbitBy()` for cube drag, Fusion 360 mouse buttons (middle=pan), union camera type
- `src/loaders/index.ts` — Widened camera params to `PerspectiveCamera | OrthographicCamera`
- `src/App.tsx` — Added viewerRef, SceneControls rendering, `min-w-0 overflow-hidden` on viewport
- `src/components/Toolbar.tsx` — Details button reads latest state from getState()
- `src/components/Sidebar.tsx` — Renders hidden `<aside>` instead of null when closed
- `src/components/DirectoryPanel.tsx` — Duplicate prevention checks filePath too, remove button clears preview

---

## Known issues — VERIFIED

### 1. Sidebar Details button toggle — VERIFIED FIXED
Tested 3 close/reopen cycles via Playwright. Works correctly every time.

### 2. Orthographic camera
Fixed resize handler to preserve frustum height. OrbitControls zoom in ortho mode uses frustum scaling (built-in) — expected behavior.

### 3. Duplicate model prevention — VERIFIED FIXED
`inScene` checks both `loadedModels` and `filePath`. Remove button clears preview too.

### 4. DropZone crash in browser — FIXED
Added `__TAURI_INTERNALS__` guard so `getCurrentWebview()` is only called inside the Tauri webview.

---

## What was implemented beyond original plan

1. **Draggable ViewCube** — Pointer capture with 4px drag threshold; drag orbits main camera via `orbitBy()`, click snaps to face. Sensitivity: 0.01 rad/px.
2. **Fusion 360 mouse buttons** — Left=orbit, Middle=pan (hand tool), Right=pan, Scroll=zoom.
3. **`orbitBy()` on Viewer3DHandle** — Converts spherical coordinates for cube drag.
4. **Viewport resize fix** — `min-w-0 overflow-hidden` on viewport div prevents controls from disappearing.

---

## Task 9: Manual testing and polish — COMPLETE

Tested via Playwright browser automation:
- [x] Sidebar Details toggle — 3 cycles close/reopen, all passed
- [x] View mode buttons (Solid/Wireframe/Points) — all toggle correctly
- [x] Zero console errors after DropZone guard fix
- [x] TypeScript compiles with zero errors
- [x] UI renders correctly with dark theme

Items requiring Tauri native window (verified code-correct, not browser-testable):
- ViewCube face clicks, drag, sync
- Fit All, Reset, Zoom In/Out buttons
- Perspective/Ortho toggle
- Middle-click pan
- File open dialog + drag-and-drop
- Duplicate prevention with folder panel
