---
phase: 02-core-viewer
plan: "04"
subsystem: ui
tags: [react, three.js, orbit-controls, lighting, view-modes, integration]

# Dependency graph
requires:
  - phase: 02-core-viewer/02-02
    provides: Viewer3D component with Three.js renderer and OrbitControls
  - phase: 02-core-viewer/02-03
    provides: DropZone, Toolbar, Sidebar components and useFileOpen hook

provides:
  - App.tsx full layout wiring (Toolbar + Viewer3D/DropZone + Sidebar)
  - Loading overlay with CSS animate-spin spinner
  - Error banner with dismiss button
  - Verified end-to-end 3D viewer (orbit/pan/zoom, all view modes, drag-and-drop)
  - Models placed on grid plane (not floating or sinking)
  - Dynamic grid scaling to loaded model size
  - Orbit target set to model bounding center on load
  - Double-click to re-center orbit on clicked surface point
  - 3-point lighting with MeshStandardMaterial for better surface definition

affects: [03-file-browser, 04-distribution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Points companions tracked via userData.pointsCompanions[] array on parent mesh for deterministic cleanup"
    - "Grid helper replaced after each model load, sized to maxDim * 2 from model bounding box"
    - "OrbitControls.target set to bounding box center on load for correct orbit pivot"
    - "Double-click fires Raycaster, moves controls.target to clicked surface point"
    - "MeshStandardMaterial with metalness/roughness replaces MeshPhongMaterial for better depth definition"

key-files:
  created: []
  modified:
    - src/App.tsx
    - src/components/Viewer3D.tsx

key-decisions:
  - "Loading overlay uses CSS animate-spin on border circle div — no external spinner library"
  - "Error banner at viewport bottom with dismiss button calls setError(null) directly"
  - "Models translated by -boundingBox.min.y so base rests exactly on grid plane at y=0"
  - "Points companions stored in userData.pointsCompanions[] array per mesh for explicit cleanup"
  - "Grid size = maxDim * 2 with proportional divisions after each model load"
  - "Custom zoom-to-cursor removed — standard OrbitControls zoom restored for smooth behavior"
  - "Double-click re-centers orbit via Raycaster intersectObjects on the scene"
  - "3-point lighting: ambient + key directional + fill directional for better surface shading"

patterns-established:
  - "App layout: flex-col h-screen root, Toolbar top, flex-1 main area, absolute overlays for loading/error"
  - "Overlay z-index convention: loading inset-0 z-10, error bottom-0 z-10"
  - "userData flags on Three.js objects for tracking companion geometry (isPointsCompanion, pointsCompanions[])"

requirements-completed: [UI-03, UI-05]

# Metrics
duration: ~45min
completed: "2026-03-11"
---

# Phase 2 Plan 04: App Integration Summary

**Complete 3D viewer wired end-to-end: App.tsx integrates all components with loading/error states, then refined through human verification to fix model placement, view mode cleanup, grid scaling, orbit pivot, lighting, and double-click re-center.**

## Performance

- **Duration:** ~45 min (Task 1 + checkpoint + 8 verification fix iterations)
- **Started:** 2026-03-11T10:10:52Z
- **Completed:** 2026-03-11
- **Tasks:** 2 (Task 1: App.tsx wiring; Task 2: Human verification — approved after fixes)
- **Files modified:** 2

## Accomplishments

- App.tsx wired with Toolbar, Viewer3D/DropZone, Sidebar in dark-theme layout matching CLAUDE.md Phase 6 spec
- Loading overlay (semi-transparent with animate-spin) and dismissible error banner implemented
- Human verification checkpoint approved — all 12 test steps passed after 8 refinement commits
- Models now sit correctly on the grid plane (bottom face at y=0) rather than floating or clipping through it
- Grid scales dynamically to match loaded model dimensions for proportional visual framing
- Orbit pivot correctly set to model's bounding center; double-click re-centers on any surface point
- Improved 3-point lighting and MeshStandardMaterial for substantially better surface shading

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire App.tsx with all components, loading overlay, and error display** - `0b70973` (feat)
2. **Task 2: Human-verify checkpoint — 8 refinement commits applied during verification:**
   - `44770a0` - fix: place models on grid plane and fix view mode switching
   - `d4236c9` - fix: track Points companions explicitly to fix cleanup on mode switch
   - `3d4942b` - fix: scale grid dynamically to fit loaded model
   - `4b95fcd` - feat: zoom toward mouse cursor via raycast target shifting
   - `6eee606` - fix: smooth zoom-to-cursor by disabling OrbitControls zoom
   - `b48a848` - fix: restore standard OrbitControls zoom, add double-click to re-center
   - `b846c51` - fix: set initial orbit target to model's true center
   - `5a77553` - feat: improve lighting and material for better surface definition

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `src/App.tsx` - Root layout: Toolbar + conditional Viewer3D/DropZone + Sidebar; loading overlay and error banner
- `src/components/Viewer3D.tsx` - Model placement on grid, dynamic grid, orbit target, double-click re-center, improved lighting

## Decisions Made

- Loading overlay uses Tailwind `animate-spin` on a border-radius circle div — no external icon library needed
- Error banner uses `&times;` for close button, fixed at viewport bottom, dismisses via `setError(null)`
- Root background uses exact spec color `bg-[#1a1a2e]` (not `bg-gray-900`)
- Models translated by `-boundingBox.min.y` so the lowest point rests at y=0 on the grid
- Custom zoom-to-cursor (4b95fcd) was attempted but caused OrbitControls state conflicts — reverted (b48a848) in favor of standard zoom + double-click re-center
- MeshStandardMaterial chosen over MeshPhongMaterial for physically-based shading

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed model placement — models were floating or sinking through grid**
- **Found during:** Task 2 human verification (step 8 — grid visible beneath model)
- **Issue:** Models loaded with bounding origin at y=0 but min.y could be negative, causing them to intersect or sink below the grid plane
- **Fix:** After loading, translate model by `-boundingBox.min.y` on Y axis so the base sits at y=0
- **Files modified:** src/components/Viewer3D.tsx
- **Verification:** Visual inspection — model base touches grid at all view angles
- **Committed in:** 44770a0

**2. [Rule 1 - Bug] Fixed Points view mode leaving orphaned point clouds on mode switch**
- **Found during:** Task 2 human verification (step 10 — switching view modes)
- **Issue:** applyViewMode added Points companion objects but switching away didn't remove them; orphaned clouds accumulated in the scene
- **Fix:** Store companions in `userData.pointsCompanions[]` array on each parent mesh; cleanup loop checks this array and disposes explicitly
- **Files modified:** src/components/Viewer3D.tsx
- **Verification:** Solid → Points → Wireframe → Solid cycle leaves no orphaned geometry
- **Committed in:** d4236c9

**3. [Rule 1 - Bug] Fixed grid not scaling to model size**
- **Found during:** Task 2 human verification (step 8 — grid proportions)
- **Issue:** GridHelper used a fixed size of 200, dwarfed by large models and oversized for small ones
- **Fix:** After each model load, remove the old GridHelper and create a new one sized to `maxDim * 2` from the model's bounding box
- **Files modified:** src/components/Viewer3D.tsx
- **Verification:** Grid matches model footprint proportionally across different file sizes
- **Committed in:** 3d4942b

**4. [Rule 2 - Enhancement] Attempted zoom-toward-cursor via raycast target shifting**
- **Found during:** Task 2 user feedback on zoom behavior
- **Issue:** Standard OrbitControls scroll zoom moves toward scene center, not cursor position
- **Fix:** Added mouse-move + wheel listener to raycast the scene and shift controls.target toward the cursor hit point before zoom
- **Files modified:** src/components/Viewer3D.tsx
- **Committed in:** 4b95fcd

**5. [Rule 1 - Bug] Removed custom zoom-to-cursor — caused jerky/stuttering zoom**
- **Found during:** Task 2 follow-up verification of 4b95fcd
- **Issue:** Custom zoom implementation conflicted with OrbitControls internal state, producing stuttering and drift
- **Fix:** Reverted to standard OrbitControls zoom entirely; replaced with double-click orbit re-center as spatial navigation alternative
- **Files modified:** src/components/Viewer3D.tsx
- **Committed in:** b48a848

**6. [Rule 1 - Bug] Fixed orbit pivot defaulting to world origin instead of model center**
- **Found during:** Task 2 human verification (orbit behavior after model load)
- **Issue:** OrbitControls.target remained at (0,0,0) after model load; orbit rotated around the world origin rather than the model
- **Fix:** After `fitModelToView`, set `controls.target` to the model's bounding box center and call `controls.update()`
- **Files modified:** src/components/Viewer3D.tsx
- **Committed in:** b846c51

**7. [Rule 2 - Enhancement] Improved lighting and switched to MeshStandardMaterial**
- **Found during:** Task 2 visual quality assessment during verification
- **Issue:** Single directional + ambient light with MeshPhongMaterial produced flat renders lacking clear surface definition
- **Fix:** Added a fill directional light (positioned opposite the key light), switched default material to MeshStandardMaterial with `metalness: 0.1, roughness: 0.7`
- **Files modified:** src/components/Viewer3D.tsx
- **Committed in:** 5a77553

---

**Total deviations:** 7 auto-fixed (4 bugs, 2 enhancements, 1 revert of enhancement replaced by better approach)
**Impact on plan:** All fixes discovered and resolved during human verification. No scope creep — all changes are within Viewer3D and directly serve the verified Phase 2 requirements.

## Issues Encountered

- Zoom-to-cursor was implemented (4b95fcd) but conflicted with OrbitControls internals causing stuttering; reverted (b48a848) and replaced with double-click re-center which is simpler and more reliable
- `libwebkit2gtk-4.1-dev` must be installed before `pnpm tauri dev` works (pre-existing system dependency note)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Complete working 3D viewer application verified end-to-end — ready for Phase 3 (file browser and multi-file)
- All Phase 2 requirements (UI-03, UI-05 plus requirements from prior plans) are verified via human testing
- App.tsx layout pattern established; Viewer3D internals (companion tracking, dynamic grid, orbit target) documented for Phase 3 multi-model work

---
*Phase: 02-core-viewer*
*Completed: 2026-03-11*
