---
phase: 03-file-browser-and-multi-file
plan: 01
subsystem: ui
tags: [zustand, three.js, multi-model, state-management]

# Dependency graph
requires:
  - phase: 02-core-viewer
    provides: viewerStore with single-model state, loaders/index.ts with fitModelToView and loadModel
provides:
  - LoadedModel and DirFileEntry exported TypeScript interfaces
  - Zustand store extended with loadedModels[], activeFilePath, dirPath, dirFiles
  - addModel, removeModel, clearModels, setActiveFile, setDir actions
  - fitAllModels function in loaders/index.ts computing union bounding box
  - loadModel with optional center=false to skip auto-centering for multi-model scenes
affects:
  - 03-02-file-browser
  - 03-03-multi-model

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fitAllModels computes union Box3 across all objects and positions camera + controls.target to center"
    - "loadModel options.center=false skips fitModelToView for multi-model add-to-scene"

key-files:
  created: []
  modified:
    - src/store/viewerStore.ts
    - src/store/viewerStore.test.ts
    - src/loaders/index.ts
    - src/loaders/index.test.ts

key-decisions:
  - "fitAllModels positions camera at center.y + maxDim*0.75 and center.z + maxDim*2 — consistent with fitModelToView proportions but relative to union center"
  - "loadModel center option defaults to true (undefined treated as true) so existing callers are unaffected"
  - "fitAllModels accepts OrbitControls as type import only — avoids DOM constructor dependency in tests"
  - "Mock OrbitControls in tests with plain object {target: Vector3, update: vi.fn()} — no DOM required"

patterns-established:
  - "Store multi-model actions use functional set() with spread to ensure immutability"
  - "TDD red-green cycle: write failing tests first, implement minimal passing code, commit"

requirements-completed: [MULTI-01, MULTI-02, MULTI-03]

# Metrics
duration: 8min
completed: 2026-03-11
---

# Phase 3 Plan 01: Multi-model Store and fitAllModels Summary

**Zustand store migrated to multi-model with LoadedModel/DirFileEntry types, plus fitAllModels() computing union bounding box across N objects to position camera**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T21:05:00Z
- **Completed:** 2026-03-11T21:08:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended Zustand store with loadedModels[], activeFilePath, dirPath, dirFiles state and matching actions
- Exported LoadedModel and DirFileEntry interfaces for use by Plan 02 (file browser) and Plan 03 (multi-model scene)
- Added fitAllModels() to loaders/index.ts with union bounding box logic for MULTI-03 camera fit
- Extended loadModel() with center option to support adding models without re-centering the camera
- 43 total tests passing (13 store + 30 loader) with 10 new tests covering all new functionality

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Zustand store with multi-model and directory state** - `019a2ac` (feat)
2. **Task 2: Add fitAllModels function and loadModel center option** - `bf2d46b` (feat)

**Plan metadata:** (docs commit follows)

_Note: Both TDD tasks used red-green cycle — failing tests committed inline with implementation._

## Files Created/Modified
- `src/store/viewerStore.ts` - Added LoadedModel, DirFileEntry interfaces; loadedModels[], activeFilePath, dirPath, dirFiles state; addModel, removeModel, clearModels, setActiveFile, setDir actions
- `src/store/viewerStore.test.ts` - Added 5 new tests for multi-model actions plus updated beforeEach reset
- `src/loaders/index.ts` - Added fitAllModels() function; added OrbitControls type import; extended loadModel() with options.center parameter
- `src/loaders/index.test.ts` - Added 5 new fitAllModels tests using mock OrbitControls object

## Decisions Made
- fitAllModels positions camera at `center.y + maxDim*0.75` and `center.z + maxDim*2` to match fitModelToView proportions but relative to union center
- loadModel `center` option defaults to true (undefined treated as true) — existing callers need no changes
- OrbitControls imported as `type` only to avoid DOM constructor in non-browser test environment
- Mock controls in tests uses plain `{target: new THREE.Vector3(), update: vi.fn()}` — no DOM dependency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Store is ready for Plan 02 (FileBrowser component) which needs setDir and dirFiles
- Store is ready for Plan 03 (multi-model scene) which needs addModel/removeModel/clearModels
- fitAllModels is available for Plan 03 to call after loading multiple models
- No blockers

---
*Phase: 03-file-browser-and-multi-file*
*Completed: 2026-03-11*
