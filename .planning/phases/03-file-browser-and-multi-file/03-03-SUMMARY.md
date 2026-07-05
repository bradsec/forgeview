---
phase: 03-file-browser-and-multi-file
plan: "03"
subsystem: ui
tags: [three.js, zustand, react, tauri, multi-model, scene-management, resizable-panels]

# Dependency graph
requires:
  - phase: 03-file-browser-and-multi-file
    plan: "01"
    provides: "loadedModels store with addModel/removeModel/clearModels/updateModelTriangles, fitAllModels/loadModel(center=false)/countTriangles in loaders"
  - phase: 03-file-browser-and-multi-file
    plan: "02"
    provides: "DirectoryPanel component with dirFiles from store, useDirOpen hook"
provides:
  - "Multi-model scene management via modelMapRef in Viewer3D — add/remove/fitAll"
  - "ModelList component showing loaded models with remove buttons and triangle counts"
  - "DirectoryPanel '+' add-to-scene button per file entry (toggle add/remove)"
  - "Sidebar Scene Models section between DirectoryPanel and File Info"
  - "App.tsx shows Viewer3D when loadedModels.length > 0 even without preview file"
  - "updateModelTriangles store action for post-load triangle count updates"
  - "Resizable Explorer panel (left side) with drag handle and close/reopen toggle"
  - "Resizable right Sidebar with drag handle and close toggle"
  - "Last-directory memory for file and folder open dialogs"
  - "fs:allow-stat permission in capabilities for directory stat calls"
affects: [phase-04, any phase that uses multi-model workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "modelMapRef (Map<id, Object3D>) pattern — Three.js objects in ref, metadata only in Zustand"
    - "Two-path loading in Viewer3D: Effect 2 (preview, center=true, clears loadedModels) vs Effect 5 (multi-model, center=false, fitAllModels)"
    - "crypto.randomUUID() for model IDs generated in DirectoryPanel '+' click handler"
    - "Triangle count starts at 0, updated via updateModelTriangles after async load completes"

key-files:
  created:
    - src/components/ModelList.tsx
  modified:
    - src/components/Viewer3D.tsx
    - src/components/DirectoryPanel.tsx
    - src/components/Sidebar.tsx
    - src/App.tsx
    - src/store/viewerStore.ts

key-decisions:
  - "modelMapRef lives in a ref (not state) — Three.js Object3Ds must never enter Zustand to avoid serialization and ref ownership issues"
  - "Preview path (Effect 2) clears both modelMapRef and Zustand loadedModels to prevent phantom models when switching to single-file preview"
  - "Triangle count initialized to 0 in addModel, updated by Viewer3D after load via updateModelTriangles(id, count) — async update visible in ModelList"
  - "Effect 5 uses Promise.all to batch fitAllModels and grid resize after all adds complete, not per-model"
  - "Double-click raycasting extended to target all models (preview + multi-model Map values)"
  - "Explorer panel moved to left side for VS Code-style layout; resizable via drag handle"
  - "Right Sidebar made resizable and closable for user-adjustable workspace"
  - "Last-directory remembered per dialog type (file open vs folder open) in store"
  - "Multi-model objects centered on grid (not raw file coordinates) for consistent placement"

patterns-established:
  - "Two-path loading: single-preview (Effect 2, center=true) and multi-model (Effect 5, center=false+fitAllModels)"
  - "e.stopPropagation() on '+' button to prevent triggering parent li click (preview load)"
  - "ModelList: triangle count shows '...' while 0, real count after updateModelTriangles fires"
  - "Resizable panels: onMouseDown drag handle + document mousemove/mouseup + useEffect cleanup"
  - "Last-directory memory: store fields lastFileDir/lastFolderDir, passed as defaultPath to dialog hooks"

requirements-completed: [MULTI-01, MULTI-02, MULTI-03]

# Metrics
duration: 45min
completed: 2026-03-11
---

# Phase 03 Plan 03: Multi-Model Scene Management Summary

**Three.js multi-model scene management with Map-based ref tracking, ModelList, resizable Explorer panel, last-directory memory, and per-file add-to-scene via DirectoryPanel '+' button**

## Performance

- **Duration:** ~45 min (including checkpoint review and additional UX iterations)
- **Started:** 2026-03-11T11:14:52Z
- **Completed:** 2026-03-11T12:05:00Z
- **Tasks:** 3 of 3 (Task 3 human-verify — APPROVED)
- **Files modified:** 8+

## Accomplishments
- Viewer3D extended with modelMapRef for multi-model tracking alongside existing single-preview modelGroupRef
- Diff-based Effect 5 loads newly added models (center=false), disposes removed models, calls fitAllModels after all changes
- ModelList component shows all scene models with format badge, triangle counts (updating from 0 post-load), remove buttons, and Clear All
- DirectoryPanel '+' button toggles add/remove per file without disrupting the preview click handler
- Sidebar reorganized with Scene Models section between DirectoryPanel and File Info
- App.tsx shows Viewer3D when loadedModels.length > 0, even without a single preview file active
- Explorer panel rebuilt as VS Code-style tree and moved to left side; resizable via drag handle with close/reopen toggle
- Right Sidebar made resizable and closable for user-adjustable workspace layout
- Last-directory memory for both file and folder open dialogs (persisted in store)
- Multi-model objects centered on grid using bounding box centering (not raw file coordinates)
- Added fs:allow-stat to capabilities for directory stat calls

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Viewer3D for multi-model scene management** - `936bced` (feat)
2. **Task 2: Create ModelList component and wire add-to-scene flow** - `ca784a4` (feat)
3. **Task 3: Human-verify checkpoint** - APPROVED by user

Additional commits during checkpoint review:
- `1ab3357` — fix(03-03): add fs:allow-stat permission and rebuild DirectoryPanel as VS Code-style tree
- `927324b` — refactor(03-03): move Explorer panel to left side of layout
- `4e83ef5` — feat(03-03): add resizable Explorer panel with drag handle
- `af15a73` — feat(03-03): add close/reopen toggle for Explorer panel
- `4eb28d1` — feat(03-03): remember last directory in file and folder open dialogs
- `123f0f0` — fix(03-03): make add-to-scene (+) button more visible in Explorer
- `96710bb` — fix(03-03): toggle add/remove button in Explorer and increase scrollbar clearance
- `7f88a82` — fix(03-03): center multi-model objects on grid instead of raw coordinates
- `44d2f2f` — fix(03-03): preserve original model positions for multi-model assembly
- `3503e2c` — feat(03-03): make right sidebar resizable and closable

## Files Created/Modified
- `src/components/Viewer3D.tsx` - Added modelMapRef, Effect 5 multi-model management, raycasting all models
- `src/store/viewerStore.ts` - Added updateModelTriangles action; lastFileDir/lastFolderDir for dialog memory
- `src/components/ModelList.tsx` - New: loaded models list with remove/clear-all
- `src/components/DirectoryPanel.tsx` - Added '+' toggle add/remove button; rebuilt as VS Code-style tree
- `src/components/Sidebar.tsx` - Added Scene Models section with ModelList; resizable and closable
- `src/App.tsx` - Show Viewer3D when loadedModels.length > 0; Explorer moved to left side
- `src-tauri/capabilities/default.json` - Added fs:allow-stat permission
- `src/hooks/useFileOpen.ts` / `src/hooks/useDirOpen.ts` - Last-directory memory wired to dialog defaultPath

## Decisions Made
- modelMapRef (not Zustand state) for Three.js Object3D tracking — avoids serialization issues
- Preview path clears loadedModels to prevent phantom models when switching to single-file preview
- Triangle count async pattern: starts at 0, updates via updateModelTriangles after load completes
- Promise.all batching for fitAllModels call after all model adds complete
- Explorer panel moved to left side (VS Code pattern) for better UX
- Resizable panels via drag handle (document-level mousemove/mouseup) rather than CSS resize for cross-browser consistency
- Last-directory memory: separate fields for file dialog vs folder dialog in store
- Multi-model objects centered on grid using bounding box (not raw file origin coordinates)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unused `controls` local variable in Effect 5**
- **Found during:** Task 1 (Viewer3D multi-model extension)
- **Issue:** Declared `const controls = controlsRef.current` but Promise callback used `controlsRef.current` directly — TS6133 error
- **Fix:** Removed unused local variable; Promise callback accesses refs directly for safety
- **Files modified:** src/components/Viewer3D.tsx
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** 936bced (Task 1 commit)

**2. [Rule 3 - Blocking] Added fs:allow-stat permission to capabilities**
- **Found during:** Task 3 (human-verify checkpoint)
- **Issue:** DirectoryPanel stat calls failed at runtime — `fs:allow-stat` was missing from capabilities/default.json
- **Fix:** Added `fs:allow-stat` to the permissions array
- **Files modified:** src-tauri/capabilities/default.json
- **Verification:** Directory browsing works after permission added
- **Committed in:** 1ab3357

**3. [Rule 1 - Bug] Multi-model objects placed at raw file coordinates instead of grid-centered**
- **Found during:** Task 3 (human-verify checkpoint)
- **Issue:** Models appeared at their original file coordinates rather than centered on the scene grid
- **Fix:** Applied bounding box centering to multi-model add path; two-iteration refinement to preserve relative positions for assembly
- **Files modified:** src/components/Viewer3D.tsx
- **Verification:** Models appear correctly placed on grid in scene
- **Committed in:** 7f88a82, 44d2f2f

---

**Total deviations:** 3 auto-fixed (1 TypeScript bug, 1 blocking permission, 1 positioning bug)
**Impact on plan:** All fixes necessary for correct operation. Checkpoint review also produced 7 additional UX improvements (resizable panels, VS Code-style Explorer layout, dialog memory, toggle add/remove) beyond core plan scope.

## Issues Encountered
- `fs:allow-stat` missing from initial capabilities — resolved by adding to default.json
- Multi-model coordinate positioning required two iterations: first pass centered objects, second preserved relative positions for assembly viewing

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Multi-model scene management fully verified and complete
- All MULTI-0x requirements satisfied (MULTI-01, MULTI-02, MULTI-03)
- Phase 3 complete — ready for Phase 4 (Polish and Packaging)
- Active blocker: `libwebkit2gtk-4.1-dev` system package needed for `pnpm tauri dev`

---
*Phase: 03-file-browser-and-multi-file*
*Completed: 2026-03-11*
